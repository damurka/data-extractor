/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the line of downloads, the settings, imported mappings and saved files
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';
import * as vscode from 'vscode';
import { IDhis2ExportItem } from '../core/exportProcessor';
import { IAddMappingDraft, IIndicatorDraft } from '../core/types';
import { DownloadConfig, DownloadRunner } from '../download';
import { customSheetNames, fileNameFor, withAdminColumns, withUnitColumns } from '../exporter';
import { mappingFromFile, reviewImport } from '../host';
import { DownloadQueue } from '../queue';
import { metadataRefreshDue, normalizeSettings } from '../settings';
import { completeIndicators, mappingProgress, withAllCountdownIndicators } from '../shared/mapping';
import { ExtractorStore } from '../store';
import { setDhis2, testLog } from './vscode';

const root = mkdtempSync(path.join(tmpdir(), 'extractor-queue-'));
after(() => rmSync(root, { recursive: true, force: true }));
let n = 0;

const source = (id: string) => ({ id, sourceElement: id, type: 'Data Element', includedCategoriesText: '' });
const indicator = (code: string, sources: string[], rest: Partial<IIndicatorDraft> = {}): IIndicatorDraft => ({ id: code, internalName: code, exportCode: code, kind: 'custom', sources: sources.map(source), ...rest });
const mapping: IAddMappingDraft = { name: 'ANC', mode: 'custom', indicators: [indicator('anc1', ['deA'])] };
const config = (mappingId: string): DownloadConfig => ({ mappingId, mappingName: 'ANC', mappingMode: 'custom', startDate: '2025-01-01', endDate: '2025-03-31', periodType: 'monthly', adminLevel: 'LEVEL-2' });

/** A server whose downloads wait for `release()` before they answer. */
function gatedApi() {
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	setDhis2({
		metadata: { getCalendar: async () => 'iso8601', getOrganisationUnits: async () => ({ rows: [] }) },
		planAnalyticsDownload: async () => ({ totalChunks: 1, organisationUnits: 1 }),
		downloadAnalytics: async (_c: string, _r: unknown, options: { onChunk?: (c: unknown) => void; onProgress?: (p: unknown) => void }, token: vscode.CancellationToken) => {
			await Promise.race([gate, new Promise<void>(resolve => token.onCancellationRequested(() => resolve()))]);
			if (token.isCancellationRequested) {
				throw new Error('Canceled');
			}
			options.onChunk?.({ index: 0, totalChunks: 1, rows: [{ dx: 'deA', pe: '202501', ou: 'ou1', value: 1 }] });
			options.onProgress?.({ completedChunks: 1, totalChunks: 1 });
			return { totalChunks: 1, rows: [] };
		}
	});
	return release;
}

async function setup() {
	const store = new ExtractorStore(path.join(root, String(n++)));
	const { id } = await store.createMapping('c1', mapping);
	const log = testLog() as unknown as vscode.LogOutputChannel;
	const runner = new DownloadRunner(store, log);
	return { store, mappingId: id, runner, queue: new DownloadQueue(store, runner, log) };
}

async function until(condition: () => Promise<boolean> | boolean): Promise<void> {
	for (let tries = 0; tries < 200; tries++) {
		if (await condition()) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	assert.fail('timed out waiting');
}

test('two downloads run at a time: the third waits its turn, and starts when a place is free', async () => {
	const release = gatedApi();
	const { store, mappingId, runner, queue } = await setup();
	const ids = [await queue.enqueue('c1', config(mappingId)), await queue.enqueue('c1', config(mappingId)), await queue.enqueue('c1', config(mappingId))];
	assert.deepEqual(ids.map(id => runner.isRunning(id)), [true, true, false]);
	assert.equal((await store.getSnapshot('c1')).inProgress.find(i => i.id === ids[2])?.state, 'waiting');
	release();
	await until(async () => (await store.getSnapshot('c1')).history.length === 3);
	const { inProgress, history } = await store.getSnapshot('c1');
	assert.deepEqual([inProgress.length, history.map(h => h.status)], [0, ['Completed', 'Completed', 'Completed']]);
	assert.equal(history[0].rows, 1);
});

test('the line keeps its order; a waiting download moves up, pauses, comes back and is cancelled', async () => {
	const release = gatedApi();
	const { store, mappingId, runner, queue } = await setup();
	await store.writeSettings('c1', { parallelDownloads: 1 });
	const [a, b, c] = [await queue.enqueue('c1', config(mappingId)), await queue.enqueue('c1', config(mappingId)), await queue.enqueue('c1', config(mappingId))];
	assert.deepEqual([a, b, c].map(id => runner.isRunning(id)), [true, false, false]);
	const line = async () => (await store.getSnapshot('c1')).inProgress.map(i => [i.id, i.state]);

	await queue.moveUp('c1', c);
	assert.deepEqual((await line()).map(([id]) => id), [a, c, b]);
	// the first in line stays where it is
	await queue.moveUp('c1', c);
	assert.deepEqual((await line()).map(([id]) => id), [a, c, b]);

	await queue.pause('c1', b);
	assert.equal((await line()).find(([id]) => id === b)?.[1], 'paused');
	await queue.resumeAll('c1');
	assert.equal((await line()).find(([id]) => id === b)?.[1], 'waiting');

	await queue.cancel('c1', c);
	const failed = (await store.getSnapshot('c1')).history.find(h => h.id === c);
	assert.deepEqual([failed?.status, failed?.error], ['Failed', 'Cancelled']);

	await queue.pauseAll('c1');
	await until(async () => (await line()).every(([, state]) => state === 'paused'));
	assert.ok(!runner.isRunning(a));
	release();
});

test('settings: what is missing or out of bounds takes the default', () => {
	const s = normalizeSettings({ parallelDownloads: 99, maxConcurrentChunks: 0, calendar: 'lunar' as never, fileName: '  ', metadataRefresh: 'weekly' });
	assert.deepEqual([s.parallelDownloads, s.maxConcurrentChunks, s.calendar, s.fileName, s.metadataRefresh, s.maxCellsPerChunk], [4, 1, 'server', '{mapping}_{periods}_{level}', 'weekly', 50_000]);
	assert.ok(s.saveFolder.endsWith(path.join('DataSuite', 'Downloads')));
});

test('the metadata copy is refreshed when its setting says it is due', () => {
	const now = Date.UTC(2026, 9, 4), hour = 3_600_000;
	assert.equal(metadataRefreshDue('daily', now - 2 * hour, now, true), false);
	assert.equal(metadataRefreshDue('daily', now - 30 * hour, now, false), true);
	assert.equal(metadataRefreshDue('weekly', now - 30 * hour, now, true), false);
	assert.equal(metadataRefreshDue('open', now - hour, now, true), true);
	assert.equal(metadataRefreshDue('open', now - hour, now, false), false);
	assert.equal(metadataRefreshDue('manual', now - 900 * hour, now, true), false);
	// never copied: fetched unless only when asked
	assert.equal(metadataRefreshDue('weekly', undefined, now, false), true);
	assert.equal(metadataRefreshDue('manual', undefined, now, true), false);
});

test('an indicator marked not available counts as done and keeps its column; one given a source is mapped instead', () => {
	const draft: IAddMappingDraft = {
		name: 'M', mode: 'custom',
		indicators: [indicator('a', ['deA']), indicator('b', [], { notAvailable: { reason: 'notCollected' } }), indicator('c', []), indicator('d', ['deD'], { notAvailable: { reason: 'other' } })]
	};
	assert.deepEqual(mappingProgress(draft), { total: 4, mapped: 2, notAvailable: 1, missing: 1 });
	const { mapping: kept, leftOut } = completeIndicators(draft);
	assert.deepEqual([kept.indicators.map(i => i.exportCode), leftOut], [['a', 'b', 'd'], ['c']]);
});

test('a Countdown mapping has every Countdown indicator, keeping the ones it had', () => {
	const mine = { ...indicator('Penta3', ['dePenta']), kind: 'countdown' as const };
	const all = withAllCountdownIndicators({ name: 'CD', mode: 'countdown', indicators: [mine] });
	assert.ok(all.indicators.length > 50);
	assert.equal(all.indicators.find(i => i.exportCode === 'Penta3'), mine);
	assert.deepEqual(mappingProgress(all).mapped, 1);
	// and once more changes nothing
	assert.equal(withAllCountdownIndicators(all).indicators.length, all.indicators.length);
});

test('an imported mapping: sources the server lacks are taken out, and named', () => {
	const draft = mappingFromFile({ name: 'Shared', mode: 'custom', indicators: [indicator('a', ['deA']), indicator('b', ['deB', 'gone']), indicator('c', ['gone2']), indicator('d', [], { notAvailable: { reason: 'noMatch' } })] });
	const review = reviewImport(draft, (_dataSet, uid) => !uid.startsWith('gone'));
	assert.deepEqual([review.indicators, review.matched, review.notAvailable], [4, 1, 1]);
	assert.deepEqual(review.missingSources, [{ indicator: 'b', source: 'gone' }, { indicator: 'c', source: 'gone2' }]);
	assert.deepEqual(review.draft.indicators.map(i => i.sources.length), [1, 1, 0, 0]);
	assert.throws(() => mappingFromFile({ name: 'Not a mapping' }), /not a mapping/);
});

test('a saved file is named by the pattern, and safely', () => {
	const item = { mappingName: 'Countdown 2030 – Kenya', startDate: '2025-01-01', endDate: '2025-09-30', periodType: 'monthly', adminLevel: 'LEVEL-5' };
	const day = new Date(2026, 9, 4);
	assert.equal(fileNameFor(item, 'EXCEL', '{mapping}_{periods}_{level}', day), 'countdown-2030-kenya_2025-01_2025-09_level-5.xlsx');
	assert.equal(fileNameFor({ ...item, periodType: 'yearly', endDate: '2025-12-31' }, 'JSON', '{date} {mapping} {periods}', day), '2026-10-04 countdown-2030-kenya 2025.json');
	assert.equal(fileNameFor(item, 'EXCEL', 'a/b:c?', day), 'a_b_c_.xlsx');
	assert.equal(fileNameFor(item, 'EXCEL', '   ', day), 'countdown-2030-kenya.xlsx');
});

test("a custom mapping's workbook: its sheets in order, and the columns added beside each organisation unit", () => {
	assert.deepEqual(customSheetNames({ name: 'M', mode: 'custom', sheets: ['B', 'A'], indicators: [indicator('x', [], { sheet: 'A' }), indicator('y', [], { sheet: 'C' })] }), ['B', 'A', 'C']);
	const item: IDhis2ExportItem = {
		headerRow1_HiddenCodes: ['district', 'year', 'month', 'anc1'], headerRow2_VisibleNames: ['District name', 'Year', 'Month', 'ANC 1'],
		dataRows: [['Westlands', '2025', 'January', 4], ['Westlands', '2025', 'February', 5], ['Langata', '2025', 'January', 6], ['Langata', '2025', 'February', 7]]
	};
	const units = [{ id: 'ou1', name: 'Westlands', level: 3, level1_name: 'Kenya', level2_name: 'Nairobi' }, { id: 'ou2', name: 'Langata', level: 3, level1_name: 'Kenya', level2_name: 'Nairobi' }];
	const both = withUnitColumns(item, units, { codes: true, parentColumns: true });
	assert.deepEqual(both.headerRow1_HiddenCodes, ['district', 'district_uid', 'level1_name', 'level2_name', 'year', 'month', 'anc1']);
	assert.deepEqual(both.dataRows[2], ['Langata', 'ou2', 'Kenya', 'Nairobi', '2025', 'January', 6]);
	assert.equal(withUnitColumns(item, units, {}), item);
});

test('what is remembered across connections: when each was used, and whether to open the last one', async () => {
	const store = new ExtractorStore(path.join(root, String(n++)));
	assert.deepEqual(await store.readPreferences(), { openLastUsed: false, lastUsed: {} });
	await Promise.all([store.updatePreferences(p => ({ ...p, openLastUsed: true })), store.updatePreferences(p => ({ ...p, lastUsed: { ...p.lastUsed, c1: 5 } })), store.updatePreferences(p => ({ ...p, lastUsed: { ...p.lastUsed, c2: 9 } }))]);
	assert.deepEqual(await store.readPreferences(), { openLastUsed: true, lastUsed: { c1: 5, c2: 9 } });
});

test("the Countdown workbook: health-system indicators are on the Admin sheet, each unit's latest value", () => {
	const sheet = (codes: string[], rows: (string | number | null)[][]): IDhis2ExportItem => ({ headerRow1_HiddenCodes: codes, headerRow2_VisibleNames: codes.map(c => c.toUpperCase()), dataRows: rows });
	const empty = sheet(['district', 'year'], []);
	const moved = withAdminColumns({
		population: empty, completeness: empty,
		service: sheet(['district', 'year', 'month', 'Number_hospitals', 'ANC1', 'Number_hospital_beds'], [
			['Westlands', '2025', 'January', 3, 40, 120], ['Westlands', '2025', 'February', 4, 44, ''],
			['Langata', '2025', 'January', '', 10, ''], ['Langata', '2025', 'February', '', 12, '']
		]),
		admin: sheet(['district_name', 'first_admin_level', 'country'], [['Westlands', 'Nairobi', 'Kenya'], ['Langata', 'Nairobi', 'Kenya']])
	});
	assert.deepEqual(moved.service.headerRow1_HiddenCodes, ['district', 'year', 'month', 'ANC1']);
	assert.deepEqual(moved.service.dataRows[1], ['Westlands', '2025', 'February', 44]);
	assert.deepEqual(moved.admin.headerRow1_HiddenCodes, ['district_name', 'first_admin_level', 'country', 'Number_hospitals', 'Number_hospital_beds']);
	assert.deepEqual(moved.admin.dataRows, [['Westlands', 'Nairobi', 'Kenya', 4, 120], ['Langata', 'Nairobi', 'Kenya', '', '']]);
});
