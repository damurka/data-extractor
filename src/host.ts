/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the host's side of the webview's calls (shared/api.ts ExtractorHost), on DataSuite's DHIS2 API, the
 *  store, the line of downloads and the exporter.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { IAddMappingDraft, ICategoryOptionCombo, IDhis2DownloadHistoryRow, IIndicatorDraft } from './core/types';
import { DownloadRunner } from './download';
import { COUNTDOWN_EXTENSION, labelCalendarOf, openDownloadInApp, saveDownload } from './exporter';
import { syncMetadata } from './metadataSync';
import { DownloadQueue } from './queue';
import { DEFAULT_DOWNLOAD_SETTINGS, normalizeSettings, readSettings } from './settings';
import { Connection, DownloadRequest, ExtractorHost, ImportReview, ResolvedElement, SourceHit } from './shared/api';
import { isComplete, isNotAvailable } from './shared/mapping';
import { ExtractorStore } from './store';

export { DEFAULT_DOWNLOAD_SETTINGS };

const K = () => vscode.Dhis2MetadataKind;
const R = () => vscode.Dhis2MetadataRelation;

const isDataSet = (type: string | undefined) => type === 'DataSet' || type === 'Dataset';

/** A mapping read from a file, as far as it can be trusted: the fields a mapping has, of the kinds they are. */
export function mappingFromFile(parsed: unknown): IAddMappingDraft {
	const file = parsed as Partial<IAddMappingDraft> | undefined;
	if (!file || !Array.isArray(file.indicators)) {
		throw new Error('That file is not a mapping (it has no "indicators" list).');
	}
	const mode = file.mode === 'countdown' ? 'countdown' : 'custom';
	return {
		name: String(file.name ?? ''),
		description: typeof file.description === 'string' ? file.description : undefined,
		mode,
		sheets: Array.isArray(file.sheets) ? file.sheets.filter((s): s is string => typeof s === 'string') : undefined,
		indicators: file.indicators.filter(i => !!i && typeof i === 'object').map(i => ({ ...i, kind: mode, sources: Array.isArray(i.sources) ? i.sources : [] }))
	};
}

/**
 * A mapping from a file, checked against a server: `has(type, uid)` says whether the server has a source. Sources it
 * lacks are taken out (their indicators come in as not mapped), and named.
 */
export function reviewImport(draft: IAddMappingDraft, has: (dataSet: boolean, uid: string) => boolean): Pick<ImportReview, 'draft' | 'indicators' | 'matched' | 'notAvailable' | 'missingSources'> {
	const missingSources: { indicator: string; source: string }[] = [];
	const indicators: IIndicatorDraft[] = draft.indicators.map(indicator => {
		const kept = indicator.sources.filter(s => {
			const there = has(isDataSet(s.type), s.id);
			if (!there) {
				missingSources.push({ indicator: indicator.internalName || indicator.exportCode || 'Untitled indicator', source: s.sourceElement || s.id });
			}
			return there;
		});
		return kept.length === indicator.sources.length ? indicator : { ...indicator, sources: kept };
	});
	const lost = new Set(indicators.filter((i, n) => i !== draft.indicators[n]));
	return {
		draft: { ...draft, indicators },
		indicators: indicators.length,
		matched: indicators.filter(i => !lost.has(i) && isComplete(i)).length,
		notAvailable: indicators.filter(isNotAvailable).length,
		missingSources
	};
}

/** How long the number of a server's indicators and data sets is kept before the server is asked again. */
const COUNT_TTL_MS = 10 * 60_000;

export function createHost(store: ExtractorStore, runner: DownloadRunner, queue: DownloadQueue): ExtractorHost {
	const str = (v: unknown) => typeof v === 'string' ? v : undefined;

	/**
	 * How many of a kind the server has (its `pager.total`): DataSuite's status counts data elements, disaggregations
	 * and organisation units only. Undefined when the server does not say.
	 */
	const counts = new Map<string, { at: number; value: Promise<number | undefined> }>();
	const countOf = (connectionId: string, resource: 'indicators' | 'dataSets') => {
		const key = `${connectionId}:${resource}`;
		const cached = counts.get(key);
		if (cached && Date.now() - cached.at < COUNT_TTL_MS) {
			return cached.value;
		}
		const value = Promise.resolve(vscode.dhis2.read(connectionId, { path: resource, query: { fields: 'id', pageSize: 1, page: 1 }, timeoutMs: 30_000 }))
			.then(r => { const total = (r as { pager?: { total?: unknown } } | undefined)?.pager?.total; return typeof total === 'number' ? total : undefined; }, () => undefined);
		counts.set(key, { at: Date.now(), value });
		return value;
	};

	const toCocs = (items: readonly vscode.Dhis2MetadataItem[], checked: (uid: string) => boolean): ICategoryOptionCombo[] =>
		items.map(i => ({ uid: i.uid, name: i.name, categoryComboUid: str(i.categoryComboUid) ?? null, checked: checked(i.uid) }));

	const configOf = async (connectionId: string, request: DownloadRequest) => {
		const mapping = await store.getMapping(connectionId, request.mappingId);
		if (!mapping) {
			throw new Error('Mapping not found');
		}
		return { ...request, mappingName: mapping.name, mappingMode: mapping.mode };
	};

	const finished = async (connectionId: string, taskId: string): Promise<IDhis2DownloadHistoryRow> => {
		const row = (await store.getSnapshot(connectionId, 'completed')).history.find(h => h.id === taskId);
		if (!row) {
			throw new Error('That download is not among the finished ones.');
		}
		return row;
	};

	/** A name no mapping of the connection has yet: `name`, or `name (2)`, `name (3)`... */
	const freeName = async (connectionId: string, name: string) => {
		const taken = new Set((await store.listMappings(connectionId)).map(m => m.name.trim().toLowerCase()));
		let candidate = name;
		for (let n = 2; taken.has(candidate.trim().toLowerCase()); n++) {
			candidate = `${name} (${n})`;
		}
		return candidate;
	};

	return {
		// ---- connections
		listConnections: async () => (await vscode.dhis2.getConnections()).map(toConnection),
		signIn: async serverUrl => {
			const connection = await vscode.dhis2.signIn(typeof serverUrl === 'string' && serverUrl ? { serverUrl } : undefined);
			return connection && toConnection(connection);
		},
		signOut: async () => { await vscode.commands.executeCommand('workbench.action.dhis2.signOut'); },
		requestAccess: connectionId => Promise.resolve(vscode.dhis2.requestAccess(connectionId)),
		manageConnections: async () => { await vscode.commands.executeCommand('workbench.action.dhis2.manageExtensionAccess'); },
		testConnection: async connectionId => {
			const started = Date.now();
			try {
				const info = await vscode.dhis2.read(connectionId, { path: 'system/info', timeoutMs: 30_000 }) as { version?: unknown } | undefined;
				return { ok: true, ms: Date.now() - started, version: str(info?.version) };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, ms: Date.now() - started, error: message, unauthorized: /\b401\b|unauthori[sz]ed|not signed in|sign in again/i.test(message) };
			}
		},
		preferences: () => store.readPreferences(),
		setOpenLastUsed: value => store.updatePreferences(p => ({ ...p, openLastUsed: value === true })),
		connectionUsed: connectionId => store.updatePreferences(p => ({ ...p, lastUsed: { ...p.lastUsed, [connectionId]: Date.now() } })),

		// ---- metadata
		metadataStatus: connectionId => Promise.resolve(vscode.dhis2.metadata.getStatus(connectionId)),
		syncMetadata: (connectionId, force) => syncMetadata(connectionId, force !== false),
		serverInfo: async connectionId => {
			const md = vscode.dhis2.metadata;
			// the copy is read one call after another: its database takes one at a time
			const status = await md.getStatus(connectionId);
			const levels = await md.getOrganisationUnitLevels(connectionId);
			const calendar = await md.getCalendar(connectionId);
			const [indicators, dataSets] = await Promise.all([countOf(connectionId, 'indicators'), countOf(connectionId, 'dataSets')]);
			return { calendar, dataElements: status.dataElements, indicators, dataSets, organisationUnits: status.organisationUnits, levels: levels.length };
		},
		searchSources: async (connectionId, query) => {
			const md = vscode.dhis2.metadata;
			// one kind after another (not at once): the copy's database takes one call at a time
			const elements = await md.search(connectionId, K().DataElement, query, { limit: 50 });
			const indicators = await md.search(connectionId, K().Indicator, query, { limit: 30 });
			const dataSets = await md.search(connectionId, K().DataSet, query, { limit: 20 });
			const hit = (type: SourceHit['type']) => (i: vscode.Dhis2MetadataItem): SourceHit => ({ uid: i.uid, name: i.name, code: str(i.code), type, categoryComboIsDefault: i.categoryComboIsDefault === true });
			const withCounts: SourceHit[] = [];
			for (const i of indicators.items) {
				withCounts.push({ ...hit('Indicator')(i), elementCount: new Set((await md.getRelated(connectionId, R().IndicatorOperands, i.uid)).map(o => o.uid)).size });
			}
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
		dataSetsOfElements: async (connectionId, uids) => {
			const sets: Record<string, string> = {};
			for (const uid of uids) {
				const [first] = (await vscode.dhis2.metadata.getRelated(connectionId, R().DataSetsOfElement, uid)).map(s => s.name).sort();
				if (first) {
					sets[uid] = first;
				}
			}
			return sets;
		},

		// ---- mappings
		listMappings: connectionId => store.listMappings(connectionId),
		getMapping: (connectionId, mappingId) => store.getMapping(connectionId, mappingId),
		createMapping: (connectionId, draft) => store.createMapping(connectionId, draft),
		updateMapping: (connectionId, mappingId, draft) => store.updateMapping(connectionId, mappingId, draft),
		deleteMapping: (connectionId, mappingId) => store.deleteMapping(connectionId, mappingId),
		duplicateMapping: async (connectionId, mappingId) => {
			const draft = await store.getMapping(connectionId, mappingId);
			if (!draft) {
				throw new Error('Mapping not found');
			}
			return store.createMapping(connectionId, { ...draft, name: await freeName(connectionId, `${draft.name} (copy)`) }, { keepDraft: true });
		},
		loadDraft: connectionId => store.loadDraft(connectionId),
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
		pickImportFile: async connectionId => {
			const [file] = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { JSON: ['json'] }, openLabel: 'Import' }) ?? [];
			if (!file) {
				return undefined;
			}
			const bytes = await vscode.workspace.fs.readFile(file);
			const draft = mappingFromFile(JSON.parse(new TextDecoder().decode(bytes)));
			// Which of the file's sources this server has, asked once per kind
			const uids = (dataSet: boolean) => [...new Set(draft.indicators.flatMap(i => i.sources.filter(s => isDataSet(s.type) === dataSet).map(s => s.id)))];
			const md = vscode.dhis2.metadata;
			const known = async (kind: vscode.Dhis2MetadataKind, list: string[]) => new Set(list.length ? (await md.get(connectionId, kind, list)).map(i => i.uid) : []);
			const [elements, dataSets] = await Promise.all([known(K().DataElement, uids(false)), known(K().DataSet, uids(true))]);
			const review = reviewImport(draft, (dataSet, uid) => (dataSet ? dataSets : elements).has(uid));
			const existing = (await store.listMappings(connectionId)).find(m => m.name.trim().toLowerCase() === draft.name.trim().toLowerCase());
			return { fileName: path.basename(file.fsPath), sizeBytes: bytes.byteLength, ...review, existing: existing && { id: existing.id, name: existing.name } };
		},
		importMapping: async (connectionId, draft, name, replaceId) => {
			const clean = mappingFromFile(draft);
			if (replaceId) {
				const current = await store.getMapping(connectionId, replaceId);
				if (!current) {
					throw new Error('The mapping to replace no longer exists.');
				}
				await store.updateMapping(connectionId, replaceId, { ...clean, name: current.name });
				return { id: replaceId };
			}
			if (!name.trim()) {
				throw new Error('Give the mapping a name.');
			}
			return store.createMapping(connectionId, { ...clean, name: name.trim() }, { keepDraft: true });
		},
		confirm: async (message, detail, action) => (await vscode.window.showWarningMessage(message, { modal: true, detail }, action)) === action,

		// ---- downloads
		downloads: (connectionId, filter, search) => store.getSnapshot(connectionId, filter, search),
		estimateDownload: async (connectionId, request) => runner.estimate(connectionId, await configOf(connectionId, request)),
		startDownload: async (connectionId, request, taskId) => {
			const config = await configOf(connectionId, request);
			// how many requests it takes, to show while it waits (the download does not depend on it)
			const requests = await runner.estimate(connectionId, config).then(e => e.requests, () => undefined);
			return queue.enqueue(connectionId, config, taskId, requests);
		},
		pauseDownload: (connectionId, taskId) => queue.pause(connectionId, taskId),
		cancelDownload: (connectionId, taskId) => queue.cancel(connectionId, taskId),
		moveDownloadUp: (connectionId, taskId) => queue.moveUp(connectionId, taskId),
		pauseAllDownloads: connectionId => queue.pauseAll(connectionId),
		resumeAllDownloads: connectionId => queue.resumeAll(connectionId),
		deleteDownload: async (connectionId, taskId) => {
			runner.stop(taskId, 'cancel');
			for (const name of [`${taskId}.json`, ...['pop', 'completeness', 'service', 'custom'].flatMap(p => [`${taskId}.partial.${p}.ndjson`, `${taskId}.partial.${p}.json`])]) {
				await store.deleteFile(connectionId, name);
			}
			await store.removeInProgress(connectionId, taskId);
			await store.deleteFromHistory(connectionId, taskId);
		},
		openDownload: async (connectionId, taskId, format) => {
			const target = await saveDownload(store, connectionId, await finished(connectionId, taskId), format, await readSettings(store, connectionId));
			return vscode.env.openExternal(target);
		},
		showDownloadInFolder: async (connectionId, taskId) => {
			const settings = await readSettings(store, connectionId);
			const target = await saveDownload(store, connectionId, await finished(connectionId, taskId), settings.openAs, settings);
			await vscode.commands.executeCommand('revealFileInOS', target);
			return true;
		},
		openDownloadInApp: async (connectionId, taskId, app) => {
			const row = await finished(connectionId, taskId);
			if (row.mappingMode !== 'countdown') {
				throw new Error('Only a download made with a Countdown mapping opens in the Countdown apps: its workbook has the sheets they read.');
			}
			const connection = (await vscode.dhis2.getConnections()).find(c => c.id === connectionId);
			return openDownloadInApp(store, connectionId, connection?.serverUrl ?? '', row, app, await labelCalendarOf(connectionId, await readSettings(store, connectionId)));
		},
		analysisApps: async () => ({ installed: !!vscode.extensions.getExtension(COUNTDOWN_EXTENSION) }),
		showAnalysisApps: async () => { await vscode.commands.executeCommand('workbench.extensions.search', `@id:${COUNTDOWN_EXTENSION}`); },

		// ---- settings
		settings: connectionId => readSettings(store, connectionId),
		saveSettings: async (connectionId, settings) => {
			const next = normalizeSettings(settings);
			await store.writeSettings(connectionId, next);
			// more downloads may run at the same time now
			await queue.pump(connectionId);
			return next;
		},
		chooseSaveFolder: async connectionId => {
			const current = (await readSettings(store, connectionId)).saveFolder;
			const [folder] = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, defaultUri: vscode.Uri.file(current), openLabel: 'Save Downloads Here' }) ?? [];
			return folder?.fsPath;
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
		dhis2Version: connection.dhis2Version,
		granted: connection.granted
	};
}
