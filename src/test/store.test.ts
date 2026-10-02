/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the store of mappings, the draft, downloads and their files
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { IAddMappingDraft, IDhis2DownloadInProgressItem } from '../core/types';
import { ExtractorStore } from '../store';

const root = mkdtempSync(path.join(tmpdir(), 'extractor-store-'));
after(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = () => new ExtractorStore(path.join(root, String(n++)));
const draft = (name: string): IAddMappingDraft => ({ name, mode: 'custom', indicators: [{ id: 'i1', internalName: 'ANC1', exportCode: 'anc1', kind: 'custom', sources: [] }] });
const inProgress = (id: string): IDhis2DownloadInProgressItem => ({ id, file: `${id}.json`, mappingId: 'm', mappingName: 'M', subtitle: '', progressPct: 0, rightText: '', state: 'downloading' } as unknown as IDhis2DownloadInProgressItem);

test('mappings are saved, listed newest first, changed and deleted -- and kept on disk', async () => {
	const dir = path.join(root, 'persist');
	const store = new ExtractorStore(dir);
	const { id: first } = await store.createMapping('c1', draft('First'));
	await new Promise(r => setTimeout(r, 5));
	const { id: second } = await store.createMapping('c1', draft('Second'));
	assert.deepEqual((await store.listMappings('c1')).map(m => m.name), ['Second', 'First']);

	await store.updateMapping('c1', first, { ...draft('First, renamed'), indicators: [] });
	const reopened = new ExtractorStore(dir);
	const list = await reopened.listMappings('c1');
	assert.deepEqual(list.map(m => [m.name, m.indicatorsCount]), [['First, renamed', 0], ['Second', 1]]);

	await reopened.deleteMapping('c1', second);
	assert.deepEqual((await reopened.listMappings('c1')).map(m => m.id), [first]);
	await assert.rejects(reopened.updateMapping('c1', 'nope', draft('x')), /Mapping not found/);
	assert.deepEqual(await reopened.listMappings('c2'), [], 'connections are kept apart');
});

test('saving a mapping ends the draft, unless it was made in chat', async () => {
	const store = fresh();
	await store.saveDraft('c1', draft('Unsaved'));
	await store.createMapping('c1', draft('From chat'), { keepDraft: true });
	assert.equal((await store.loadDraft('c1'))?.name, 'Unsaved');
	await store.createMapping('c1', draft('From the editor'));
	assert.equal(await store.loadDraft('c1'), undefined);
});

test('a download moves from in progress to the history; filters and search', async () => {
	const store = fresh();
	await store.upsertInProgress('c1', inProgress('t1'));
	await store.upsertInProgress('c1', { ...inProgress('t1'), progressPct: 140 });
	let snapshot = await store.getSnapshot('c1');
	assert.equal(snapshot.inProgress.length, 1);
	assert.equal(snapshot.inProgress[0].progressPct, 100, 'progress is clamped');

	await store.finishToHistory('c1', { ...inProgress('t1'), status: 'Completed', size: '1 MB', date: 'today' } as never);
	await store.finishToHistory('c1', { ...inProgress('t2'), mappingName: 'Malaria', status: 'Failed', size: '-', date: 'today' } as never);
	snapshot = await store.getSnapshot('c1');
	assert.equal(snapshot.inProgress.length, 0);
	assert.deepEqual(snapshot.history.map(h => h.id).sort(), ['t1', 't2']);
	assert.deepEqual((await store.getSnapshot('c1', 'failed')).history.map(h => h.id), ['t2']);
	assert.deepEqual((await store.getSnapshot('c1', 'all', 'malaria')).history.map(h => h.id), ['t2']);
});

test('writes to one file never lose each other', async () => {
	const store = fresh();
	await Promise.all(Array.from({ length: 25 }, (_, i) => store.upsertInProgress('c1', inProgress(`t${i}`))));
	assert.equal((await store.getSnapshot('c1')).inProgress.length, 25);
});

test('download files: written, appended, read, deleted -- and nothing outside the folder', async () => {
	const store = fresh();
	await store.appendFile('c1', 't1.partial.service.ndjson', 'a\n');
	await store.appendFile('c1', 't1.partial.service.ndjson', 'b\n');
	assert.equal(await store.readFile('c1', 't1.partial.service.ndjson'), 'a\nb\n');
	await store.writeFile('c1', 't1.json', '{}');
	assert.ok(await store.fileExists('c1', 't1.json'));
	await store.deleteFile('c1', 't1.json');
	assert.ok(!(await store.fileExists('c1', 't1.json')));

	for (const name of ['../t1.json', 't1.txt', 'a/b.json', '..', 't1.partial.SERVICE.json']) {
		await assert.rejects(store.writeFile('c1', name, 'x'), /Not a download file name/, name);
	}
	await assert.rejects(store.writeFile('../c1', 't1.json', 'x'), /Not a connection id/);
});
