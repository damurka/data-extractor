/*---------------------------------------------------------------------------------------------
 *  Data Extractor: carries the built-in extractor's work over -- mappings, the draft, downloads and their files,
 *  download settings -- once per connection, the first time this extension has the connection. DataSuite reads it for
 *  us (vscode.dhis2.builtInExtractor), as the built-in extractor kept it.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IAddMappingDraft, IDhis2DownloadHistoryRow, IDhis2DownloadInProgressItem, MappingMode } from './core/types';
import { ExtractorStore, HistoryRow, StoredMapping } from './store';

const DEFAULT_SETTINGS: Required<vscode.Dhis2DownloadSettings> = { maxConcurrentChunks: 1, maxCellsPerChunk: 50_000, retryAttempts: 3, retryBaseDelayMs: 2000, requestTimeoutMs: 120_000 };

/** Carries over what has not been yet, for every connection this extension has. Never throws: a failure is logged and tried again next time. */
export async function migrateBuiltInExtractor(store: ExtractorStore, log: vscode.LogOutputChannel): Promise<void> {
	let connections: readonly vscode.Dhis2Connection[];
	try {
		connections = await vscode.dhis2.getConnections();
	} catch (error) {
		log.warn(`Could not list the DHIS2 connections: ${error}`);
		return;
	}
	for (const connection of connections.filter(c => c.granted)) {
		try {
			if (!(await store.isMigrated(connection.id))) {
				await migrateConnection(store, connection, log);
			}
		} catch (error) {
			log.error(`Carrying over the built-in extractor's work for ${connection.username}@${connection.serverUrl} failed (tried again next time): ${error instanceof Error ? error.message : error}`);
		}
	}
}

async function migrateConnection(store: ExtractorStore, connection: vscode.Dhis2Connection, log: vscode.LogOutputChannel): Promise<void> {
	const id = connection.id;
	const data = await vscode.dhis2.builtInExtractor.readData(id);

	const mappings: StoredMapping[] = data.mappings.map(m => ({
		id: m.id,
		name: m.name,
		description: m.description,
		mode: m.mode as MappingMode,
		createdAt: m.updatedAt,
		updatedAt: m.updatedAt,
		draft: m.mapping as IAddMappingDraft
	}));
	if (mappings.length) {
		await store.importMappings(id, mappings);
	}

	if (data.draft && !(await store.loadDraft(id))) {
		await store.saveDraft(id, data.draft as IAddMappingDraft);
	}

	// Nothing runs an unfinished download any more: it comes over paused, to be resumed from its checkpoint
	const inProgress = (data.downloadsInProgress as IDhis2DownloadInProgressItem[]).map(item => ({ ...item, state: 'paused' as const, rightText: 'Paused' }));
	// Newest first, as the built-in extractor listed them; their end times were not kept, so their order stands for them
	const now = Date.now();
	const history: HistoryRow[] = (data.downloadsHistory as IDhis2DownloadHistoryRow[]).map((row, index) => ({ ...row, endedAt: now - index }));
	if (inProgress.length || history.length) {
		await store.importDownloads(id, { inProgress, history });
	}

	let files = 0;
	for (const fileName of data.downloadFiles) {
		if (!(await store.fileExists(id, fileName))) {
			await store.writeFile(id, fileName, await vscode.dhis2.builtInExtractor.readFile(id, fileName));
			files++;
		}
	}

	const settings = data.downloadSettings;
	if (settings && (Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[]).some(k => settings[k] !== undefined && settings[k] !== DEFAULT_SETTINGS[k]) && !(await store.readSettings(id))) {
		await store.writeSettings(id, settings);
	}

	const summary = { mappings: mappings.length, downloads: inProgress.length + history.length, files };
	await store.markMigrated(id, summary);
	log.info(`Carried over the built-in extractor's work for ${connection.username}@${connection.serverUrl}: ${summary.mappings} mappings, ${summary.downloads} downloads, ${summary.files} files`);
}
