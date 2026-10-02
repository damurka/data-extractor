/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the host's side of the webview's calls (shared/api.ts ExtractorHost), on DataSuite's DHIS2 API, the
 *  store, the download runner and the exporter.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IAddMappingDraft, ICategoryOptionCombo } from './core/types';
import { DownloadRunner } from './download';
import { exportDownload } from './exporter';
import { Connection, DownloadRequest, DownloadSettings, ExtractorHost, ResolvedElement, SourceHit } from './shared/api';
import { ExtractorStore } from './store';

const K = () => vscode.Dhis2MetadataKind;
const R = () => vscode.Dhis2MetadataRelation;

export const DEFAULT_DOWNLOAD_SETTINGS: DownloadSettings = { maxConcurrentChunks: 1, maxCellsPerChunk: 50_000, retryAttempts: 3, retryBaseDelayMs: 2000, requestTimeoutMs: 120_000 };

export function createHost(store: ExtractorStore, runner: DownloadRunner): ExtractorHost {
	const str = (v: unknown) => typeof v === 'string' ? v : undefined;

	const toCocs = (items: readonly vscode.Dhis2MetadataItem[], checked: (uid: string) => boolean): ICategoryOptionCombo[] =>
		items.map(i => ({ uid: i.uid, name: i.name, categoryComboUid: str(i.categoryComboUid) ?? null, checked: checked(i.uid) }));

	const configOf = async (connectionId: string, request: DownloadRequest) => {
		const mapping = await store.getMapping(connectionId, request.mappingId);
		if (!mapping) {
			throw new Error('Mapping not found');
		}
		return { ...request, mappingName: mapping.name, mappingMode: mapping.mode };
	};

	return {
		// ---- connections
		listConnections: async () => (await vscode.dhis2.getConnections()).map(toConnection),
		signIn: async () => {
			const connection = await vscode.dhis2.signIn();
			return connection && toConnection(connection);
		},
		requestAccess: connectionId => Promise.resolve(vscode.dhis2.requestAccess(connectionId)),
		manageConnections: async () => { await vscode.commands.executeCommand('workbench.action.dhis2.manageExtensionAccess'); },

		// ---- metadata
		metadataStatus: connectionId => Promise.resolve(vscode.dhis2.metadata.getStatus(connectionId)),
		syncMetadata: connectionId => Promise.resolve(vscode.dhis2.metadata.sync(connectionId, { force: true })),
		searchSources: async (connectionId, query) => {
			const md = vscode.dhis2.metadata;
			const [elements, indicators, dataSets] = await Promise.all([
				md.search(connectionId, K().DataElement, query, { limit: 50 }),
				md.search(connectionId, K().Indicator, query, { limit: 30 }),
				md.search(connectionId, K().DataSet, query, { limit: 20 })
			]);
			const hit = (type: SourceHit['type']) => (i: vscode.Dhis2MetadataItem): SourceHit => ({ uid: i.uid, name: i.name, code: str(i.code), type, categoryComboIsDefault: i.categoryComboIsDefault === true });
			const withCounts = await Promise.all(indicators.items.map(async i => ({ ...hit('Indicator')(i), elementCount: new Set((await md.getRelated(connectionId, R().IndicatorOperands, i.uid)).map(o => o.uid)).size })));
			return { dataElements: elements.items.map(hit('Data Element')), indicators: withCounts, dataSets: dataSets.items.map(hit('DataSet')) };
		},
		resolveIndicator: async (connectionId, indicatorUid) => {
			const md = vscode.dhis2.metadata;
			const operands = await md.getRelated(connectionId, R().IndicatorOperands, indicatorUid);
			// One source per data element: all its combos when the formula uses the element as a whole, else only the ones it names
			const byElement = new Map<string, { item: vscode.Dhis2MetadataItem; cocs: Set<string>; whole: boolean }>();
			for (const o of operands) {
				const entry = byElement.get(o.uid) ?? { item: o, cocs: new Set<string>(), whole: false };
				const coc = str(o.cocUid);
				if (coc) {
					entry.cocs.add(coc);
				} else {
					entry.whole = true;
				}
				byElement.set(o.uid, entry);
			}
			const resolved: ResolvedElement[] = [];
			for (const { item, cocs, whole } of byElement.values()) {
				const combos = await md.getRelated(connectionId, R().CategoryOptionCombos, item.uid);
				resolved.push({ uid: item.uid, name: item.name, categoryComboIsDefault: item.categoryComboIsDefault === true, cocs: toCocs(combos, uid => whole || cocs.has(uid)) });
			}
			return resolved;
		},
		categoryOptionCombos: async (connectionId, dataElementUid) => toCocs(await vscode.dhis2.metadata.getRelated(connectionId, R().CategoryOptionCombos, dataElementUid), () => true),
		orgUnitLevels: async connectionId => (await vscode.dhis2.metadata.getOrganisationUnitLevels(connectionId)).map(l => ({ level: l.level, name: l.name, count: l.count })),
		searchOrgUnits: async (connectionId, query, level) => (await vscode.dhis2.metadata.search(connectionId, K().OrganisationUnit, query, { limit: 50, level })).items
			.map(i => ({ uid: i.uid, name: i.name, level: typeof i.level === 'number' ? i.level : undefined, pathNames: str(i.pathNames) })),
		calendar: connectionId => Promise.resolve(vscode.dhis2.metadata.getCalendar(connectionId)),

		// ---- mappings
		listMappings: connectionId => store.listMappings(connectionId),
		getMapping: (connectionId, mappingId) => store.getMapping(connectionId, mappingId),
		createMapping: (connectionId, draft) => store.createMapping(connectionId, draft),
		updateMapping: (connectionId, mappingId, draft) => store.updateMapping(connectionId, mappingId, draft),
		deleteMapping: (connectionId, mappingId) => store.deleteMapping(connectionId, mappingId),
		loadDraft: connectionId => store.loadDraft(connectionId),
		saveDraft: (connectionId, draft) => store.saveDraft(connectionId, draft),
		clearDraft: connectionId => store.clearDraft(connectionId),
		exportMapping: async (connectionId, mappingId) => {
			const draft = await store.getMapping(connectionId, mappingId);
			if (!draft) {
				throw new Error('Mapping not found');
			}
			const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(`${draft.name.replace(/\s+/g, '_')}_export.json`), filters: { JSON: ['json'] }, saveLabel: 'Export' });
			if (!target) {
				return false;
			}
			await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(JSON.stringify(draft, null, 2)));
			return true;
		},
		importMappingFile: async () => {
			const [file] = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { JSON: ['json'] }, openLabel: 'Import' }) ?? [];
			if (!file) {
				return undefined;
			}
			const parsed = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(file))) as Partial<IAddMappingDraft>;
			if (!parsed || !Array.isArray(parsed.indicators)) {
				throw new Error('That file is not a mapping (it has no "indicators" list).');
			}
			return { name: String(parsed.name ?? ''), description: parsed.description, mode: parsed.mode === 'countdown' ? 'countdown' : 'custom', indicators: parsed.indicators };
		},
		confirm: async (message, detail, action) => (await vscode.window.showWarningMessage(message, { modal: true, detail }, action)) === action,

		// ---- downloads
		downloads: (connectionId, filter, search) => store.getSnapshot(connectionId, filter, search),
		estimateDownload: async (connectionId, request) => runner.estimate(connectionId, await configOf(connectionId, request)),
		startDownload: async (connectionId, request, taskId) => {
			const config = await configOf(connectionId, request);
			const id = taskId ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
			void runner.run(connectionId, config, id);
			return id;
		},
		pauseDownload: async (connectionId, taskId) => {
			if (runner.isRunning(taskId)) {
				runner.stop(taskId, 'pause');
				return;
			}
			const item = (await store.getSnapshot(connectionId, 'active')).inProgress.find(i => i.id === taskId);
			if (item) {
				await store.upsertInProgress(connectionId, { ...item, state: 'paused', rightText: 'Paused' });
			}
		},
		cancelDownload: async (connectionId, taskId) => {
			if (runner.isRunning(taskId)) {
				runner.stop(taskId, 'cancel');
				return;
			}
			const item = (await store.getSnapshot(connectionId, 'active')).inProgress.find(i => i.id === taskId);
			if (item) {
				await store.finishToHistory(connectionId, { ...item, status: 'Failed', size: '-', date: new Date().toLocaleString() });
			}
		},
		deleteDownload: async (connectionId, taskId) => {
			runner.stop(taskId, 'cancel');
			for (const name of [`${taskId}.json`, ...['pop', 'completeness', 'service', 'custom'].map(p => `${taskId}.partial.${p}.json`)]) {
				await store.deleteFile(connectionId, name);
			}
			await store.removeInProgress(connectionId, taskId);
			await store.deleteFromHistory(connectionId, taskId);
		},
		exportDownload: async (connectionId, taskId, format, labelCalendar) => {
			const row = (await store.getSnapshot(connectionId, 'completed')).history.find(h => h.id === taskId);
			if (!row) {
				throw new Error('That download is not among the completed ones.');
			}
			return (await exportDownload(store, connectionId, row, format, labelCalendar)) !== undefined;
		},

		// ---- settings
		downloadSettings: async connectionId => ({ ...DEFAULT_DOWNLOAD_SETTINGS, ...(await store.readSettings(connectionId)) }),
		saveDownloadSettings: async (connectionId, settings) => {
			const clamp = (v: number, min: number, max: number, fallback: number) => Number.isFinite(v) ? Math.min(Math.max(Math.round(v), min), max) : fallback;
			const d = DEFAULT_DOWNLOAD_SETTINGS;
			await store.writeSettings(connectionId, {
				maxConcurrentChunks: clamp(settings.maxConcurrentChunks, 1, 6, d.maxConcurrentChunks),
				maxCellsPerChunk: clamp(settings.maxCellsPerChunk, 1_000, 500_000, d.maxCellsPerChunk),
				retryAttempts: clamp(settings.retryAttempts, 0, 10, d.retryAttempts),
				retryBaseDelayMs: clamp(settings.retryBaseDelayMs, 200, 60_000, d.retryBaseDelayMs),
				requestTimeoutMs: clamp(settings.requestTimeoutMs, 5_000, 600_000, d.requestTimeoutMs)
			});
		}
	};
}

export function toConnection(connection: vscode.Dhis2Connection): Connection {
	return {
		id: connection.id,
		serverUrl: connection.serverUrl,
		username: connection.username,
		displayName: connection.displayName,
		usesAccessToken: connection.usesAccessToken,
		country: connection.country,
		granted: connection.granted
	};
}
