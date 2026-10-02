/*---------------------------------------------------------------------------------------------
 *  Data Extractor: carrying the built-in extractor's work over
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';
import * as vscode from 'vscode';
import { migrateBuiltInExtractor } from '../migrate';
import { ExtractorStore } from '../store';
import { setDhis2, testLog } from './vscode';

const root = mkdtempSync(path.join(tmpdir(), 'extractor-migrate-'));
after(() => rmSync(root, { recursive: true, force: true }));

const connection = (id: string, granted: boolean) => ({ id, serverUrl: `https://${id}.example.org`, username: 'admin', displayName: id, usesAccessToken: true, granted });
const mapping = { name: 'Countdown', mode: 'countdown', indicators: [] };

/** The built-in extractor's data for c1, as vscode.dhis2.builtInExtractor.readData gives it. */
const builtIn = {
	mappings: [{ id: 'Mp_1', name: 'Countdown', description: 'all of it', mode: 'countdown', updatedAt: 1000, mapping }],
	draft: { name: 'Half done', mode: 'custom', indicators: [] },
	downloadsInProgress: [{ id: 't9', file: 't9.json', mappingId: 'Mp_1', mappingName: 'Countdown', subtitle: '', progressPct: 40, rightText: '40%', state: 'downloading' }],
	downloadsHistory: [
		{ id: 'h2', file: 'h2.json', mappingName: 'Countdown', status: 'Completed', size: '1 MB', date: 'newer' },
		{ id: 'h1', file: 'h1.json', mappingName: 'Countdown', status: 'Completed', size: '2 MB', date: 'older' }
	],
	downloadFiles: ['h2.json', 'h1.json', 't9.partial.service.json'],
	downloadSettings: { maxConcurrentChunks: 1, maxCellsPerChunk: 50_000, retryAttempts: 3, retryBaseDelayMs: 2000, requestTimeoutMs: 120_000 }
};

function fakeApi(data: typeof builtIn) {
	const reads: string[] = [];
	setDhis2({
		getConnections: async () => [connection('c1', true), connection('c2', false)],
		builtInExtractor: {
			readData: async (id: string) => { reads.push(id); return data; },
			readFile: async (_id: string, name: string) => `contents of ${name}`
		}
	});
	return reads;
}

test('everything comes over once, for the connections the extension has', async () => {
	const reads = fakeApi(builtIn);
	const store = new ExtractorStore(path.join(root, 'all'));
	const log = testLog();
	await migrateBuiltInExtractor(store, log as unknown as vscode.LogOutputChannel);

	assert.deepEqual(reads, ['c1'], 'a connection the extension was not given is not read');
	const [m] = await store.listMappings('c1');
	assert.deepEqual([m.id, m.name, m.description, m.mode, m.lastUpdatedAt], ['Mp_1', 'Countdown', 'all of it', 'countdown', 1000]);
	assert.equal((await store.loadDraft('c1'))?.name, 'Half done');

	const downloads = await store.getSnapshot('c1');
	assert.deepEqual(downloads.inProgress.map(d => [d.id, d.state]), [['t9', 'paused']], 'an unfinished download comes over paused');
	assert.deepEqual(downloads.history.map(h => h.id), ['h2', 'h1'], 'the history keeps its order');

	assert.equal(await store.readFile('c1', 'h1.json'), 'contents of h1.json');
	assert.equal(await store.readFile('c1', 't9.partial.service.json'), 'contents of t9.partial.service.json', 'its checkpoint too, to resume from');
	assert.equal(await store.readSettings('c1'), undefined, 'the old defaults are not kept as settings');
	assert.ok(await store.isMigrated('c1'));
	assert.ok(!(await store.isMigrated('c2')));
	assert.match(log.lines.join('\n'), /1 mappings, 3 downloads, 3 files/);

	await migrateBuiltInExtractor(store, log as unknown as vscode.LogOutputChannel);
	assert.deepEqual(reads, ['c1'], 'not again');
});

test("work already here is kept; settings the user changed come over", async () => {
	fakeApi({ ...builtIn, downloadSettings: { ...builtIn.downloadSettings, requestTimeoutMs: 300_000 } });
	const store = new ExtractorStore(path.join(root, 'kept'));
	await store.saveDraft('c1', { name: 'Mine', mode: 'custom', indicators: [] });
	await store.writeFile('c1', 'h1.json', 'already here');
	await migrateBuiltInExtractor(store, testLog() as unknown as vscode.LogOutputChannel);

	assert.equal((await store.loadDraft('c1'))?.name, 'Mine');
	assert.equal(await store.readFile('c1', 'h1.json'), 'already here');
	assert.equal((await store.readSettings('c1'))?.requestTimeoutMs, 300_000);
});

test('a failure is logged and tried again next time', async () => {
	let fail = true;
	setDhis2({
		getConnections: async () => [connection('c1', true)],
		builtInExtractor: {
			readData: async () => { if (fail) { throw new Error('DataSuite is busy'); } return builtIn; },
			readFile: async () => ''
		}
	});
	const store = new ExtractorStore(path.join(root, 'retry'));
	const log = testLog();
	await migrateBuiltInExtractor(store, log as unknown as vscode.LogOutputChannel);
	assert.ok(!(await store.isMigrated('c1')));
	assert.match(log.lines.join('\n'), /error .*DataSuite is busy/);

	fail = false;
	await migrateBuiltInExtractor(store, log as unknown as vscode.LogOutputChannel);
	assert.ok(await store.isMigrated('c1'));
});
