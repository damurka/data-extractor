/*---------------------------------------------------------------------------------------------
 *  Data Extractor: what it keeps per DHIS2 connection -- mappings, the draft being written, downloads and their
 *  files, download settings -- as JSON files in the extension's global storage:
 *
 *    connections/<connectionId>/mappings.json    { [mappingId]: StoredMapping }
 *                               draft.json        IAddMappingDraft
 *                               downloads.json    { inProgress: [...], history: [...] }
 *                               settings.json     Dhis2DownloadSettings
 *                               files/<id>.json   a finished download; <id>.partial.<part>.ndjson its checkpoint
 *                                                 (one line per finished chunk; the built-in extractor's .json kind
 *                                                 still read)
 *                               migrated.json     when the built-in extractor's work was carried over
 *
 *  (The built-in extractor kept the same in one SQLite file per profile; nothing here needs SQL, and JSON files need no
 *  native module.)
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DownloadsFilter, IAddMappingDraft, IDhis2DownloadHistoryRow, IDhis2DownloadInProgressItem, IMappingListItem, MappingMode } from './core/types';

export interface StoredMapping {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly mode: MappingMode;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly draft: IAddMappingDraft;
}

/** A finished (or failed) download, with when it ended (milliseconds since 1970), for the newest-first list. */
export type HistoryRow = IDhis2DownloadHistoryRow & { endedAt?: number };

export interface DownloadsSnapshot {
	readonly inProgress: IDhis2DownloadInProgressItem[];
	readonly history: HistoryRow[];
}

/** A download file's name: `<id>.json`, or a checkpoint `<id>.partial.<part>.ndjson` (`.json`) -- nothing that leaves the folder. */
const FILE_NAME = /^[A-Za-z0-9_-]+(\.partial\.[a-z]+\.(nd)?json|\.json)$/;

export class ExtractorStore implements vscode.Disposable {

	private readonly _onDidChangeMappings = new vscode.EventEmitter<string>();
	/** The connection whose mappings (or draft) changed. */
	readonly onDidChangeMappings = this._onDidChangeMappings.event;
	private readonly _onDidChangeDownloads = new vscode.EventEmitter<string>();
	/** The connection whose downloads changed. */
	readonly onDidChangeDownloads = this._onDidChangeDownloads.event;

	/** Writes to one file, one after another (read-modify-write never interleaves). */
	private readonly queues = new Map<string, Promise<unknown>>();

	constructor(private readonly root: string) { }

	dispose(): void {
		this._onDidChangeMappings.dispose();
		this._onDidChangeDownloads.dispose();
	}

	// ---- mappings

	async listMappings(connectionId: string): Promise<IMappingListItem[]> {
		const mappings = await this.readJson<Record<string, StoredMapping>>(connectionId, 'mappings.json', {});
		return Object.values(mappings)
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.map(m => ({ id: m.id, name: m.name, description: m.description, mode: m.mode, indicatorsCount: m.draft.indicators?.length ?? 0, lastUpdatedAt: m.updatedAt }));
	}

	async getMapping(connectionId: string, mappingId: string): Promise<IAddMappingDraft | undefined> {
		return (await this.readJson<Record<string, StoredMapping>>(connectionId, 'mappings.json', {}))[mappingId]?.draft;
	}

	/** Saves a new mapping; the draft being written in the editor is done with, unless `keepDraft` (a mapping made in chat). */
	async createMapping(connectionId: string, draft: IAddMappingDraft, options?: { keepDraft?: boolean }): Promise<{ id: string }> {
		const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
		const now = Date.now();
		await this.update<Record<string, StoredMapping>>(connectionId, 'mappings.json', {}, all => ({ ...all, [id]: { id, name: draft.name, description: draft.description, mode: draft.mode, createdAt: now, updatedAt: now, draft } }));
		if (!options?.keepDraft) {
			await this.clearDraft(connectionId);
		}
		this._onDidChangeMappings.fire(connectionId);
		return { id };
	}

	async updateMapping(connectionId: string, mappingId: string, draft: IAddMappingDraft): Promise<void> {
		await this.update<Record<string, StoredMapping>>(connectionId, 'mappings.json', {}, all => {
			const existing = all[mappingId];
			if (!existing) {
				throw new Error(`Mapping not found: ${mappingId}`);
			}
			return { ...all, [mappingId]: { ...existing, name: draft.name, description: draft.description, mode: draft.mode, updatedAt: Date.now(), draft } };
		});
		this._onDidChangeMappings.fire(connectionId);
	}

	async deleteMapping(connectionId: string, mappingId: string): Promise<void> {
		await this.update<Record<string, StoredMapping>>(connectionId, 'mappings.json', {}, all => {
			const { [mappingId]: _removed, ...rest } = all;
			return rest;
		});
		this._onDidChangeMappings.fire(connectionId);
	}

	/** Puts mappings in as they are (the built-in extractor's, carried over), keeping their ids and dates. */
	async importMappings(connectionId: string, mappings: readonly StoredMapping[]): Promise<void> {
		await this.update<Record<string, StoredMapping>>(connectionId, 'mappings.json', {}, all => {
			const next = { ...all };
			for (const m of mappings) {
				next[m.id] ??= m;
			}
			return next;
		});
		this._onDidChangeMappings.fire(connectionId);
	}

	// ---- the draft

	loadDraft(connectionId: string): Promise<IAddMappingDraft | undefined> {
		return this.readJson<IAddMappingDraft | undefined>(connectionId, 'draft.json', undefined);
	}

	async saveDraft(connectionId: string, draft: IAddMappingDraft): Promise<void> {
		await this.update(connectionId, 'draft.json', undefined, () => draft);
	}

	async clearDraft(connectionId: string): Promise<void> {
		await this.remove(connectionId, 'draft.json');
	}

	// ---- downloads

	async getSnapshot(connectionId: string, filter: DownloadsFilter = 'all', searchText = ''): Promise<DownloadsSnapshot> {
		const { inProgress, history } = await this.readJson<DownloadsSnapshot>(connectionId, 'downloads.json', { inProgress: [], history: [] });
		const query = searchText.trim().toLowerCase();
		const matches = (row: HistoryRow) => !query || [row.file, row.mappingName, row.date].some(v => (v ?? '').toLowerCase().includes(query));
		const finished = history
			.filter(row => filter === 'completed' ? row.status === 'Completed' : filter === 'failed' ? row.status === 'Failed' : true)
			.filter(matches)
			.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
			.slice(0, 200);
		return { inProgress: filter === 'completed' || filter === 'failed' ? [] : inProgress, history: finished };
	}

	async upsertInProgress(connectionId: string, item: IDhis2DownloadInProgressItem): Promise<void> {
		const row = { ...item, progressPct: Math.max(0, Math.min(100, Math.round(item.progressPct || 0))) };
		await this.update<DownloadsSnapshot>(connectionId, 'downloads.json', { inProgress: [], history: [] }, d => ({ ...d, inProgress: [row, ...d.inProgress.filter(i => i.id !== item.id)] }));
		this._onDidChangeDownloads.fire(connectionId);
	}

	async removeInProgress(connectionId: string, id: string): Promise<void> {
		await this.update<DownloadsSnapshot>(connectionId, 'downloads.json', { inProgress: [], history: [] }, d => ({ ...d, inProgress: d.inProgress.filter(i => i.id !== id) }));
		this._onDidChangeDownloads.fire(connectionId);
	}

	/** Moves a download from in progress to the history (finished or failed). */
	async finishToHistory(connectionId: string, row: HistoryRow): Promise<void> {
		const done = { ...row, endedAt: row.endedAt ?? Date.now() };
		await this.update<DownloadsSnapshot>(connectionId, 'downloads.json', { inProgress: [], history: [] }, d => ({
			inProgress: d.inProgress.filter(i => i.id !== row.id),
			history: [done, ...d.history.filter(h => h.id !== row.id)]
		}));
		this._onDidChangeDownloads.fire(connectionId);
	}

	async deleteFromHistory(connectionId: string, id: string): Promise<void> {
		await this.update<DownloadsSnapshot>(connectionId, 'downloads.json', { inProgress: [], history: [] }, d => ({ ...d, history: d.history.filter(h => h.id !== id) }));
		this._onDidChangeDownloads.fire(connectionId);
	}

	/** Puts downloads in as they are (carried over), without replacing ones already here. */
	async importDownloads(connectionId: string, snapshot: DownloadsSnapshot): Promise<void> {
		await this.update<DownloadsSnapshot>(connectionId, 'downloads.json', { inProgress: [], history: [] }, d => ({
			inProgress: [...d.inProgress, ...snapshot.inProgress.filter(i => !d.inProgress.some(x => x.id === i.id))],
			history: [...d.history, ...snapshot.history.filter(h => !d.history.some(x => x.id === h.id))]
		}));
		this._onDidChangeDownloads.fire(connectionId);
	}

	// ---- download files

	async writeFile(connectionId: string, fileName: string, content: string): Promise<void> {
		const file = this.fileOf(connectionId, fileName);
		await fs.mkdir(path.dirname(file), { recursive: true });
		await atomicWrite(file, content);
	}

	/** Adds to the end of a download file (a checkpoint's next chunk), creating it when there is none. */
	async appendFile(connectionId: string, fileName: string, content: string): Promise<void> {
		const file = this.fileOf(connectionId, fileName);
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.appendFile(file, content, 'utf8');
	}

	readFile(connectionId: string, fileName: string): Promise<string> {
		return fs.readFile(this.fileOf(connectionId, fileName), 'utf8');
	}

	async deleteFile(connectionId: string, fileName: string): Promise<void> {
		await fs.rm(this.fileOf(connectionId, fileName), { force: true });
	}

	async fileExists(connectionId: string, fileName: string): Promise<boolean> {
		return fs.stat(this.fileOf(connectionId, fileName)).then(() => true, () => false);
	}

	// ---- settings and the migration mark

	readSettings(connectionId: string): Promise<vscode.Dhis2DownloadSettings | undefined> {
		return this.readJson<vscode.Dhis2DownloadSettings | undefined>(connectionId, 'settings.json', undefined);
	}

	async writeSettings(connectionId: string, settings: vscode.Dhis2DownloadSettings): Promise<void> {
		await this.update(connectionId, 'settings.json', undefined, () => settings);
	}

	async isMigrated(connectionId: string): Promise<boolean> {
		return (await this.readJson<{ at?: number } | undefined>(connectionId, 'migrated.json', undefined)) !== undefined;
	}

	async markMigrated(connectionId: string, summary: object): Promise<void> {
		await this.update(connectionId, 'migrated.json', undefined, () => ({ at: Date.now(), ...summary }));
	}

	// ---- files on disk

	private dirOf(connectionId: string): string {
		if (!/^[A-Za-z0-9_-]+$/.test(connectionId)) {
			throw new Error(`Not a connection id: ${connectionId}`);
		}
		return path.join(this.root, 'connections', connectionId);
	}

	private fileOf(connectionId: string, fileName: string): string {
		if (!FILE_NAME.test(fileName)) {
			throw new Error(`Not a download file name: ${fileName}`);
		}
		return path.join(this.dirOf(connectionId), 'files', fileName);
	}

	private async readJson<T>(connectionId: string, name: string, fallback: T): Promise<T> {
		try {
			return JSON.parse(await fs.readFile(path.join(this.dirOf(connectionId), name), 'utf8')) as T;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return fallback;
			}
			throw error;
		}
	}

	private update<T>(connectionId: string, name: string, fallback: T, change: (value: T) => T): Promise<void> {
		const file = path.join(this.dirOf(connectionId), name);
		const previous = this.queues.get(file) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(async () => {
			const value = change(await this.readJson(connectionId, name, fallback));
			await fs.mkdir(path.dirname(file), { recursive: true });
			await atomicWrite(file, JSON.stringify(value, null, 1));
		});
		this.queues.set(file, next);
		return next;
	}

	private async remove(connectionId: string, name: string): Promise<void> {
		await fs.rm(path.join(this.dirOf(connectionId), name), { force: true });
	}
}

/** Written to a temporary file first, then renamed over: a crash leaves the old file or the new one, never half of one. */
async function atomicWrite(file: string, content: string): Promise<void> {
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	await fs.writeFile(tmp, content, 'utf8');
	await fs.rename(tmp, file);
}
