/*---------------------------------------------------------------------------------------------
 *  Data Extractor: running a download -- its checkpoints, pausing and resuming
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';
import * as vscode from 'vscode';
import { resolvePeriodLabel } from '../core/exportProcessor';
import { IAddMappingDraft } from '../core/types';
import { DownloadConfig, DownloadRunner } from '../download';
import { ExtractorStore } from '../store';
import { setDhis2, testLog } from './vscode';

const root = mkdtempSync(path.join(tmpdir(), 'extractor-download-'));
after(() => rmSync(root, { recursive: true, force: true }));
let n = 0;

const mapping: IAddMappingDraft = {
	name: 'ANC', mode: 'custom',
	indicators: [{ id: 'i1', internalName: 'ANC 1', exportCode: 'anc1', kind: 'custom', sources: [{ id: 'deA', sourceElement: 'ANC 1st visit', type: 'Data Element', includedCategoriesText: '' }] }]
};
const config = (mappingId: string): DownloadConfig => ({ mappingId, mappingName: 'ANC', mappingMode: 'custom', startDate: '2025-01-01', endDate: '2025-03-31', periodType: 'monthly', adminLevel: 'LEVEL-2' });
const TOTAL = 3;
const rowsOf = (index: number) => [{ dx: 'deA', pe: `20250${index + 1}`, ou: 'ou1', value: index + 1 }];

interface Call { skipChunks: readonly number[] }

/** A server of TOTAL chunks; `onEach(index)` may stop the run, as the user pausing would. */
function fakeApi(onEach: (index: number) => void = () => { }) {
	const calls: Call[] = [];
	setDhis2({
		metadata: {
			getCalendar: async () => 'iso8601',
			getOrganisationUnits: async () => ({ rows: [] })
		},
		planAnalyticsDownload: async () => ({ totalChunks: TOTAL }),
		downloadAnalytics: async (_c: string, request: { skipChunks?: number[] }, options: { onChunk?: (c: unknown) => void; onProgress?: (p: unknown) => void }, token: vscode.CancellationToken) => {
			const skip = request.skipChunks ?? [];
			calls.push({ skipChunks: [...skip].sort() });
			let done = skip.length;
			for (let index = 0; index < TOTAL; index++) {
				if (skip.includes(index)) {
					continue;
				}
				if (token.isCancellationRequested) {
					throw new Error('Canceled');
				}
				options.onChunk?.({ index, totalChunks: TOTAL, rows: rowsOf(index) });
				options.onProgress?.({ completedChunks: ++done, totalChunks: TOTAL });
				onEach(index);
			}
			return { totalChunks: TOTAL, rows: [] };
		}
	});
	return calls;
}

async function setup(withMapping: IAddMappingDraft = mapping) {
	const store = new ExtractorStore(path.join(root, String(n++)));
	const { id } = await store.createMapping('c1', withMapping);
	const log = testLog();
	return { store, mappingId: id, log, runner: new DownloadRunner(store, log as unknown as vscode.LogOutputChannel) };
}

test('incomplete indicators do not stop a download: they are left out, and the estimate names them', async () => {
	const unfinished = { id: 'i2', internalName: 'Maternal deaths', exportCode: '', kind: 'custom' as const, sources: [] };
	const { store, mappingId, runner } = await setup({ ...mapping, indicators: [...mapping.indicators, unfinished] });
	fakeApi();
	const estimate = await runner.estimate('c1', config(mappingId));
	assert.deepEqual(estimate.leftOut, ['Maternal deaths']);
	assert.equal(estimate.dataItems, 1);
	const outcome = await runner.run('c1', config(mappingId), 'task6');
	assert.equal(outcome.status, 'completed', outcome.error);
	assert.deepEqual((await store.getSnapshot('c1')).history.map(h => h.status), ['Completed']);
});

test('a mapping with no complete indicator says so instead of downloading nothing', async () => {
	const { mappingId, runner } = await setup({ ...mapping, indicators: [{ id: 'i9', internalName: '', exportCode: '', kind: 'custom', sources: [] }] });
	fakeApi();
	const outcome = await runner.run('c1', config(mappingId), 'task7');
	assert.equal(outcome.status, 'failed');
	assert.match(outcome.error ?? '', /None of the indicators .* is complete yet/);
});

test('a download runs to the end: its file is written, its checkpoint removed, and it is in the history', async () => {
	const calls = fakeApi();
	const { store, mappingId, log, runner } = await setup();
	const outcome = await runner.run('c1', config(mappingId), 'task1');
	assert.equal(outcome.status, 'completed', outcome.error);
	assert.deepEqual(calls, [{ skipChunks: [] }]);
	assert.ok(await store.fileExists('c1', 'task1.json'));
	assert.ok(!(await store.fileExists('c1', 'task1.partial.custom.ndjson')));
	const { inProgress, history } = await store.getSnapshot('c1');
	assert.deepEqual([inProgress.length, history.map(h => [h.id, h.status])], [0, [['task1', 'Completed']]]);
	assert.match(log.lines.join('\n'), /completed: 3 values/);
});

test('paused after a chunk, it resumes without fetching that chunk again', async () => {
	const { store, mappingId, log, runner } = await setup();
	fakeApi(index => { if (index === 0) { runner.stop('task2', 'pause'); } });
	const paused = await runner.run('c1', config(mappingId), 'task2');
	assert.equal(paused.status, 'paused');
	assert.equal((await store.getSnapshot('c1')).inProgress[0]?.state, 'paused');
	assert.equal((await store.readFile('c1', 'task2.partial.custom.ndjson')).trim().split('\n').length, 1, 'one chunk kept');

	const calls = fakeApi();
	const resumed = await runner.run('c1', config(mappingId), 'task2');
	assert.equal(resumed.status, 'completed', resumed.error);
	assert.deepEqual(calls, [{ skipChunks: [0] }]);
	assert.match(log.lines.join('\n'), /completed: 3 values/, "the kept chunk's values are in the download");
});

test('a checkpoint line cut short by a crash is left out, and its chunk fetched again', async () => {
	const { store, mappingId, log, runner } = await setup();
	await store.appendFile('c1', 'task3.partial.custom.ndjson', `${JSON.stringify({ i: 1, r: [['deA', '202502', 'ou1', 2]] })}\n{"i":2,"r":[["deA","2025`);
	const calls = fakeApi();
	const outcome = await runner.run('c1', config(mappingId), 'task3');
	assert.equal(outcome.status, 'completed', outcome.error);
	assert.deepEqual(calls, [{ skipChunks: [1] }]);
	assert.match(log.lines.join('\n'), /completed: 3 values/);
});

test("the built-in extractor's checkpoint (rows, and how many chunks were done in order) resumes too", async () => {
	const { store, mappingId, log, runner } = await setup();
	await store.writeFile('c1', 'task4.partial.custom.json', JSON.stringify({ rows: [...rowsOf(0), ...rowsOf(1)], completedChunks: 2 }));
	const calls = fakeApi();
	const outcome = await runner.run('c1', config(mappingId), 'task4');
	assert.equal(outcome.status, 'completed', outcome.error);
	assert.deepEqual(calls, [{ skipChunks: [0, 1] }]);
	assert.ok(!(await store.fileExists('c1', 'task4.partial.custom.json')), 'the old checkpoint is removed');
	assert.match(log.lines.join('\n'), /completed: 3 values/);
});

test('a failed download is in the history as failed, its checkpoint kept for a retry', async () => {
	const { store, mappingId, runner } = await setup();
	fakeApi(index => { if (index === 1) { throw new Error('DHIS2 rejected the request (HTTP 409 Conflict).'); } });
	const outcome = await runner.run('c1', config(mappingId), 'task5');
	assert.equal(outcome.status, 'failed');
	assert.match(outcome.error ?? '', /HTTP 409/);
	assert.deepEqual((await store.getSnapshot('c1')).history.map(h => h.status), ['Failed']);
	assert.ok(await store.fileExists('c1', 'task5.partial.custom.ndjson'));
});

test('Excel labels: an Ethiopian download relabelled in Gregorian', () => {
	assert.deepEqual(resolvePeriodLabel('201605', 'ethiopic', 'gregorian'), { year: '2024', month: 'January' });
	assert.deepEqual(resolvePeriodLabel('201601', 'ethiopic', 'gregorian'), { year: '2023', month: 'September' });
	assert.deepEqual(resolvePeriodLabel('2016', 'ethiopic', 'gregorian'), { year: '2024', month: '' });
	assert.deepEqual(resolvePeriodLabel('202403', 'gregorian', 'gregorian'), { year: '2024', month: 'March' });
});
