// A page to look at the webview outside DataSuite: out/webview.js and its CSS with a stand-in for VS Code's webview API
// (acquireVsCodeApi) that answers the host's calls from sample data it keeps in memory -- mappings can be made, edited
// and deleted, downloads queued, paused and moved, settings saved -- in DataSuite's light or dark theme. Not shipped.
//
//   npm run build && node scripts/harness.mjs      then open out-harness/index.html?theme=dark&page=mappings
//
// ?theme=light|dark, ?page=connect|overview|mappings|downloads|settings, ?lang=en|fr|pt,
// ?empty=1 (a server with no mappings or downloads yet), ?calendar=ethiopian

import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const outDir = path.join(root, 'out-harness');
fs.mkdirSync(outDir, { recursive: true });

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Data Extractor (harness)</title>
<link rel="stylesheet" href="../out/webview.css">
<script>
const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const page = params.get('page') || 'overview';
const empty = params.has('empty');
// ?lang=fr: DataSuite's display language (the panel's <html lang>), which dates follow
document.documentElement.lang = params.get('lang') || 'en';

const day = 86400000, now = Date.now();
const uid = () => Math.random().toString(36).slice(2, 13);
const connections = params.has('none') ? [] : [
	{ id: 'c1', serverUrl: 'https://hiskenya.dha.go.ke', username: 'dkariuki', displayName: 'David Kariuki', usesAccessToken: true, country: 'Kenya', dhis2Version: '2.40.4', granted: true },
	{ id: 'c2', serverUrl: 'https://dhis2.moh.gov.et', username: 'analyst', displayName: 'Analyst One', usesAccessToken: false, country: 'Ethiopia', dhis2Version: '2.39.2', granted: false },
	{ id: 'c3', serverUrl: 'https://hmis.health.go.ug', username: 'analyst2', displayName: 'Analyst Two', usesAccessToken: false, country: 'Uganda', dhis2Version: '2.38.1', granted: true }
];
let preferences = { openLastUsed: params.has('openlast'), lastUsed: params.has('none') ? {} : { c1: now - 3 * 3600000 } };

// ---- the server's metadata
const AGES = ['10-14 yrs', '15-19 yrs', '20-24 yrs', '25+ yrs'];
const cocsOf = names => names.map((name, i) => ({ uid: 'coc' + name.replace(/\\W/g, '').slice(0, 8) + i, name, categoryComboUid: 'cc1', checked: true }));
const ELEMENTS = [
	['MOH 711 ANC 1st visit', ['10-14', '15-19', '20-24', '25-29', '30-34', '35-39', '40-44', '45-49', '50+'].flatMap(a => [a + ' yrs · Static', a + ' yrs · Outreach'])],
	['MOH 711 ANC 1st visit (outreach)', null], ['MOH 711 ANC 4th visit', AGES], ['MOH 711 ANC re-visits', AGES], ['MOH 711 ANC before 12 weeks', AGES],
	['MOH 711 IPTp 2nd dose', AGES], ['MOH 711 IPTp 3rd dose', AGES], ['MOH 711 Syphilis tested at ANC', AGES], ['MOH 711 HIV tested at ANC', AGES],
	['MOH 711 Skilled birth attendance', null], ['MOH 711 Facility deliveries', null], ['MOH 711 Live births', null], ['MOH 711 Caesarean sections', null],
	['MOH 711 Maternal deaths', null], ['MOH 711 Neonatal deaths', null], ['MOH 711 Low birth weight', null], ['MOH 711 PNC mother within 48 h', null],
	['MOH 710 BCG', ['Under 1 yr', 'Over 1 yr']], ['MOH 710 Penta 1', ['Under 1 yr', 'Over 1 yr']], ['MOH 710 Penta 2', ['Under 1 yr', 'Over 1 yr']], ['MOH 710 Penta 3', ['Under 1 yr', 'Over 1 yr']],
	['MOH 710 Penta 3 (outreach)', null], ['MOH 710 Measles-Rubella 1', ['Under 1 yr', 'Over 1 yr']], ['MOH 710 Measles-Rubella 2', null], ['MOH 710 OPV 1', ['Under 1 yr', 'Over 1 yr']],
	['MOH 710 OPV 3', ['Under 1 yr', 'Over 1 yr']], ['MOH 710 PCV 3', ['Under 1 yr', 'Over 1 yr']], ['MOH 710 Rota 2', ['Under 1 yr', 'Over 1 yr']],
	['MOH 705A OPD visits under 5', null], ['MOH 705B OPD visits over 5', null], ['MOH 717 IPD admissions', null],
	['Population total (projection)', null], ['Population under 1 (projection)', null], ['Population under 5 (projection)', null], ['Women 15-49 (projection)', null], ['Expected live births (projection)', null],
	['MOH 705A Malaria confirmed under 5', null], ['MOH 705A Malaria tested under 5', null]
].map(([name, cocs], i) => ({ uid: 'de' + String(i).padStart(9, '0'), name, type: 'Data Element', categoryComboIsDefault: !cocs, cocs: cocsOf(cocs || ['default']), form: (name.match(/^MOH \\d+[A-Z]?/) || ['Projections'])[0] }));
const INDICATORS = [['ANC 1st visit coverage', [0, 31 + 4]], ['Penta 3 coverage', [20, 32]], ['Skilled birth attendance rate', [9, 35]]].map(([name, els], i) => ({ uid: 'in' + String(i).padStart(9, '0'), name, type: 'Indicator', elements: els.map(n => ELEMENTS[n]) }));
const DATASETS = ['MOH 711 Integrated summary', 'MOH 710 Immunisation summary', 'MOH 705A Outpatient under 5', 'MOH 717 Service workload'].map((name, i) => ({ uid: 'ds' + String(i).padStart(9, '0'), name, type: 'DataSet' }));
const levels = [{ level: 1, name: 'Kenya', count: 1 }, { level: 2, name: 'County', count: 47 }, { level: 3, name: 'Sub-County', count: 300 }, { level: 4, name: 'Ward', count: 1450 }, { level: 5, name: 'Health Facility', count: 14000 }];
const element = name => ELEMENTS.find(e => e.name === name);
const source = (name, some) => { const e = element(name); return { id: e.uid, sourceElement: e.name, type: 'Data Element', includedCategoriesText: 'All Category Options', categoryComboIsDefault: e.categoryComboIsDefault, cocs: e.cocs.map((c, i) => ({ ...c, checked: !some || i % 4 !== 1 })), origin: 'manual' }; };
const dataSet = name => { const d = DATASETS.find(x => x.name === name); return { id: d.uid, sourceElement: d.name, type: 'DataSet', includedCategoriesText: 'N/A', cocs: [] }; };

// ---- mappings
const cd = (code, name, sources, notAvailable) => ({ id: uid(), internalName: name, exportCode: code, kind: 'countdown', sources, notAvailable });
const countdownIndicators = [
	cd('Total_Population', 'Total Population', [source('Population total (projection)')]), cd('Population_under_1year', 'Population under 1 year', [source('Population under 1 (projection)')]),
	cd('Women_15_49_years', 'Total women 15-49 years', [source('Women 15-49 (projection)')]), cd('Live_births', 'Projected total Live births (Estimated live births from census)', [source('Expected live births (projection)')]),
	cd('ANC', 'ANC reporting', [dataSet('MOH 711 Integrated summary')]), cd('Vacc', 'Vaccinations reporting', [dataSet('MOH 710 Immunisation summary')]), cd('OPD', 'OPD visits reporting', [dataSet('MOH 705A Outpatient under 5')]),
	cd('BCG', 'Total number of BCG doses administered <1 year', [source('MOH 710 BCG')]), cd('Penta1', 'Total number of Pentavalent vaccination 1st dose (infants)', [source('MOH 710 Penta 1')]),
	cd('Penta3', 'Total number of Pentavalent vaccination 3rd dose (infants)', [source('MOH 710 Penta 3'), source('MOH 710 Penta 3 (outreach)')]),
	cd('Measles1', 'Total number of Measles vaccination 1st dose (infants)', [source('MOH 710 Measles-Rubella 1')]),
	cd('ANC1', 'Total number of ANC 1st visit', [source('MOH 711 ANC 1st visit', true), source('MOH 711 ANC 1st visit (outreach)')]), cd('ANC4', 'Total number of Pregnant women completing 4 ANC visits', [source('MOH 711 ANC 4th visit')]),
	cd('SBA', 'Total number of skilled birth attendance in health facilities', [source('MOH 711 Skilled birth attendance')]), cd('Instdelivery', 'Total number of deliveries in health facilities', [source('MOH 711 Facility deliveries')]),
	cd('maternal_deaths', 'Total number of maternal deaths reported', [source('MOH 711 Maternal deaths')]),
	cd('IFA90', 'Total number of pregnant women who received iron folic acid (IFA) supplementation for 90 or more days during the pregnancy', [], { reason: 'notCollected', note: 'Collected on paper only since 2023' }),
	cd('hpv1', 'Total number of children who received human papillomavirus vaccine 1', [], { reason: 'noMatch' })
];
const custom = (name, sheet, sources) => ({ id: uid(), internalName: name, exportCode: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'), kind: 'custom', sheet, sources });
const stored = empty ? {} : {
	mp_cd2030_kenya: { name: 'Countdown 2030 – Kenya', description: 'Countdown 2030 indicator list matched to MOH 711 and MOH 710', mode: 'countdown', indicators: countdownIndicators, updatedAt: now - 2 * 3600000 },
	mp_anc: {
		name: 'ANC & Immunisation', description: 'Antenatal care and child immunisation, for the quarterly review', mode: 'custom', sheets: ['Antenatal care', 'Immunisation'], updatedAt: now - 8 * day,
		indicators: [custom('ANC 1st visit', 'Antenatal care', [source('MOH 711 ANC 1st visit'), source('MOH 711 ANC 1st visit (outreach)')]), custom('ANC 4th visit', 'Antenatal care', [source('MOH 711 ANC 4th visit')]),
			custom('IPTp 2 doses', 'Antenatal care', [source('MOH 711 IPTp 2nd dose')]), custom('BCG', 'Immunisation', [source('MOH 710 BCG')]), custom('Penta 1', 'Immunisation', [source('MOH 710 Penta 1')]),
			custom('Penta 3', 'Immunisation', [source('MOH 710 Penta 3')]), custom('Measles-Rubella 1', 'Immunisation', [source('MOH 710 Measles-Rubella 1')])]
	},
	mp_malaria: { name: 'Malaria monthly', description: 'Cases, testing and commodities', mode: 'custom', sheets: ['Indicators'], updatedAt: now - 22 * day,
		indicators: [custom('Malaria confirmed under 5', 'Indicators', [source('MOH 705A Malaria confirmed under 5')]), custom('Malaria tested under 5', 'Indicators', [source('MOH 705A Malaria tested under 5')]), custom('Malaria commodities', 'Indicators', [])] }
};
const complete = i => !!i.internalName && !!i.exportCode && i.sources.length > 0;
const listMappings = id => id && id !== 'c1' ? [] : Object.entries(stored).sort((a, b) => b[1].updatedAt - a[1].updatedAt).map(([id, m]) => ({
	id, name: m.name, description: m.description, mode: m.mode, indicatorsCount: m.indicators.length, mappedCount: m.indicators.filter(complete).length,
	notAvailableCount: m.indicators.filter(i => !complete(i) && i.notAvailable && !i.sources.length).length, lastUpdatedAt: m.updatedAt
}));
const draftOf = id => { const m = stored[id]; return m && JSON.parse(JSON.stringify({ name: m.name, description: m.description, mode: m.mode, indicators: m.indicators, sheets: m.sheets })); };

// ---- downloads
const dl = (id, mappingId, startDate, endDate, level, rest) => ({ id, file: id + '.json', mappingId, mappingName: stored[mappingId].name, mappingMode: stored[mappingId].mode, startDate, endDate, periodType: 'monthly', adminLevel: 'LEVEL-' + level, ...rest });
let inProgress = empty ? [] : [
	dl('p1', 'mp_cd2030_kenya', '2025-01-01', '2025-09-30', 5, { state: 'downloading', progressPct: 62, rightText: '62%', doneRequests: 38, totalRequests: 61, etaSeconds: 240 }),
	dl('p2', 'mp_malaria', '2025-07-01', '2025-09-30', 4, { state: 'downloading', progressPct: 18, rightText: '18%', doneRequests: 5, totalRequests: 28, etaSeconds: 540 }),
	dl('p3', 'mp_anc', '2023-01-01', '2024-12-31', 4, { state: 'paused', progressPct: 30, rightText: 'Paused', doneRequests: 12, totalRequests: 40, pausedAt: now - day }),
	dl('p4', 'mp_cd2030_kenya', '2024-01-01', '2024-12-31', 3, { state: 'waiting', progressPct: 0, rightText: 'Waiting', totalRequests: 12 }),
	dl('p5', 'mp_anc', '2025-01-01', '2025-09-30', 5, { state: 'waiting', progressPct: 0, rightText: 'Waiting', totalRequests: 96 }),
	dl('p6', 'mp_malaria', '2024-01-01', '2024-12-31', 3, { state: 'waiting', progressPct: 0, rightText: 'Waiting', totalRequests: 9 })
].map(d => ({ ...d, subtitle: d.startDate + ' to ' + d.endDate }));
let history = empty ? [] : [
	dl('h1', 'mp_cd2030_kenya', '2024-01-01', '2024-12-31', 3, { status: 'Completed', size: '1.84 MB', rows: 118402, endedAt: now - 2 * 3600000 }),
	dl('h2', 'mp_anc', '2025-01-01', '2025-06-30', 5, { status: 'Completed', size: '6.40 MB', rows: 402996, endedAt: now - day }),
	dl('h3', 'mp_malaria', '2025-07-01', '2025-09-30', 3, { status: 'Failed', size: '-', error: 'Not authorised to read data set Malaria Commodities (HTTP 403)', endedAt: now - 5 * day }),
	dl('h4', 'mp_cd2030_kenya', '2023-01-01', '2023-12-31', 2, { status: 'Completed', size: '0.41 MB', rows: 27520, endedAt: now - 6 * day }),
	dl('h5', 'mp_malaria', '2025-07-01', '2025-09-30', 4, { status: 'Completed', size: '2.20 MB', rows: 141330, endedAt: now - 9 * day }),
	dl('h6', 'mp_anc', '2024-01-01', '2024-12-31', 1, { status: 'Completed', size: '0.01 MB', rows: 216, endedAt: now - 14 * day })
];
let settings = { maxConcurrentChunks: 4, maxCellsPerChunk: 50000, retryAttempts: 3, retryBaseDelayMs: 2000, requestTimeoutMs: 120000, parallelDownloads: 2, calendar: 'server', periodType: 'monthly',
	saveFolder: 'C:\\\\Users\\\\dkariuki\\\\Documents\\\\DataSuite\\\\Downloads', openAs: 'EXCEL', fileName: '{mapping}_{periods}_{level}', parentColumns: false, codes: false, metadataRefresh: 'daily' };
let metadata = { syncing: false, lastSyncedAt: now - 2 * 3600000, dataElements: 3912, categoryOptionCombos: 1390, organisationUnits: 16540 };

const emit = (name, data) => setTimeout(() => window.postMessage({ kind: 'event', name, data }, '*'), 0);
const changedMappings = () => emit('mappingsChanged', 'c1');
const changedDownloads = () => emit('downloadsChanged', 'c1');
const running = () => inProgress.filter(d => d.state === 'downloading').length;
// fills the free places from the front of the line
const pump = () => { for (const d of inProgress) { if (running() >= settings.parallelDownloads) { break; } if (d.state === 'waiting') { d.state = 'downloading'; d.rightText = d.progressPct + '%'; d.etaSeconds = 300; d.doneRequests = d.doneRequests || 0; } } changedDownloads(); };
const estimate = request => {
	const m = stored[request.mappingId];
	const months = Math.max(1, (Number(request.endDate.slice(0, 4)) - Number(request.startDate.slice(0, 4))) * 12 + Number(request.endDate.slice(5, 7)) - Number(request.startDate.slice(5, 7)) + 1);
	const periods = request.periodType === 'yearly' ? Math.ceil(months / 12) : months;
	const units = (levels.find(l => 'LEVEL-' + l.level === request.adminLevel) || levels[0]).count;
	const items = m ? m.indicators.filter(complete).reduce((n, i) => n + i.sources.length, 0) : 0;
	return { dataItems: items, periods, firstPeriod: request.startDate.slice(0, 7).replace('-', ''), lastPeriod: request.endDate.slice(0, 7).replace('-', ''), organisationUnits: units,
		requests: Math.max(1, Math.ceil(items * periods * units / settings.maxCellsPerChunk)), leftOut: m ? m.indicators.filter(i => !complete(i) && !i.notAvailable).map(i => i.internalName) : [] };
};
const note = text => console.log('[harness]', text);

const answers = {
	listConnections: () => connections,
	signIn: () => note('DataSuite sign-in dialog'), signOut: () => note('DataSuite sign-out'), requestAccess: id => { const c = connections.find(x => x.id === id); if (c) { c.granted = true; emit('connectionsChanged'); } return true; }, manageConnections: () => note('manage connections'),
	testConnection: id => new Promise(resolve => setTimeout(() => resolve(id === 'c3' ? { ok: false, ms: 300, error: 'HTTP 401 Unauthorized', unauthorized: true } : { ok: true, ms: 1800, version: id === 'c2' ? '2.39.2' : '2.40.4' }), 600)),
	preferences: () => preferences,
	setOpenLastUsed: value => { preferences = { ...preferences, openLastUsed: value }; },
	connectionUsed: id => { preferences = { ...preferences, lastUsed: { ...preferences.lastUsed, [id]: Date.now() } }; },
	metadataStatus: () => metadata,
	syncMetadata: () => { metadata = { ...metadata, syncing: true }; emit('metadataChanged'); setTimeout(() => { metadata = { ...metadata, syncing: false, lastSyncedAt: Date.now() }; emit('metadataChanged'); }, 1500); },
	serverInfo: () => ({ calendar: params.get('calendar') || 'iso8601', dataElements: metadata.dataElements, indicators: 1204, dataSets: 186, organisationUnits: metadata.organisationUnits, levels: levels.length }),
	calendar: id => id === 'c2' ? 'ethiopian' : params.get('calendar') || 'iso8601',
	orgUnitLevels: () => levels,
	searchOrgUnits: (_c, q) => ['Nairobi County', 'Nakuru County', 'Kiambu County', 'Mombasa County'].filter(n => n.toLowerCase().includes(q.toLowerCase())).map((name, i) => ({ uid: 'ou' + i, name, level: 2, pathNames: 'Kenya / ' + name })),
	searchSources: (_c, q) => {
		const words = q.toLowerCase().split(/\\s+/).filter(Boolean);
		const match = x => words.every(w => x.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').includes(w) || x.name.toLowerCase().replace(/[^a-z0-9]+/g, '').includes(w));
		return { dataElements: ELEMENTS.filter(match).map(e => ({ uid: e.uid, name: e.name, type: 'Data Element', categoryComboIsDefault: e.categoryComboIsDefault })),
			indicators: INDICATORS.filter(match).map(i => ({ uid: i.uid, name: i.name, type: 'Indicator', elementCount: i.elements.length })), dataSets: DATASETS.filter(match).map(d => ({ uid: d.uid, name: d.name, type: 'DataSet' })) };
	},
	categoryOptionCombos: (_c, id) => (ELEMENTS.find(e => e.uid === id) || { cocs: [] }).cocs.map(c => ({ ...c })),
	resolveIndicator: (_c, id) => (INDICATORS.find(i => i.uid === id) || { elements: [] }).elements.map(e => ({ uid: e.uid, name: e.name, categoryComboIsDefault: e.categoryComboIsDefault, cocs: e.cocs.map(c => ({ ...c })) })),
	dataSetsOfElements: (_c, uids) => Object.fromEntries(uids.map(u => [u, (ELEMENTS.find(e => e.uid === u) || {}).form]).filter(([, f]) => f)),

	listMappings,
	getMapping: (_c, id) => draftOf(id),
	createMapping: (_c, draft) => { const id = 'mp_' + uid(); stored[id] = { ...draft, updatedAt: Date.now() }; changedMappings(); return { id }; },
	updateMapping: (_c, id, draft) => { stored[id] = { ...draft, updatedAt: Date.now() }; changedMappings(); },
	deleteMapping: (_c, id) => { delete stored[id]; changedMappings(); },
	duplicateMapping: (_c, id) => { const copy = 'mp_' + uid(); stored[copy] = { ...draftOf(id), name: stored[id].name + ' (copy)', updatedAt: Date.now() }; changedMappings(); return { id: copy }; },
	loadDraft: () => undefined, clearDraft: () => undefined,
	exportMapping: () => { note('export mapping'); return true; },
	pickImportFile: () => {
		const draft = draftOf('mp_cd2030_kenya') || { name: 'Countdown 2030 – Kenya', mode: 'countdown', indicators: countdownIndicators };
		const lost = draft.indicators.filter(i => /^(ANC4|maternal_deaths)$/.test(i.exportCode));
		lost.forEach(i => { i.sources = []; });
		return { fileName: 'countdown-2030-kenya.mapping.json', sizeBytes: 48211, draft, indicators: draft.indicators.length, matched: draft.indicators.filter(complete).length,
			notAvailable: draft.indicators.filter(i => i.notAvailable && !i.sources.length).length, missingSources: [{ indicator: 'ANC4', source: 'MOH 711 Hb tested at ANC' }, { indicator: 'maternal_deaths', source: 'MOH 711 Iron & folic acid' }],
			existing: stored.mp_cd2030_kenya ? { id: 'mp_cd2030_kenya', name: stored.mp_cd2030_kenya.name } : undefined };
	},
	importMapping: (_c, draft, name, replaceId) => { const id = replaceId || 'mp_' + uid(); stored[id] = { ...draft, name: replaceId ? stored[replaceId].name : name, updatedAt: Date.now() }; changedMappings(); return { id }; },
	// ?ask=1 asks with the browser's own dialog; else every confirmation is a yes
	confirm: (message, detail) => params.has('ask') ? window.confirm(message + (detail ? '\\n\\n' + detail : '')) : true,

	downloads: (_c, filter) => ({ inProgress: filter === 'completed' || filter === 'failed' ? [] : inProgress,
		history: [...history].sort((a, b) => b.endedAt - a.endedAt).filter(h => filter === 'completed' ? h.status === 'Completed' : filter === 'failed' ? h.status === 'Failed' : true) }),
	estimateDownload: (_c, request) => estimate(request),
	startDownload: (_c, request, taskId) => {
		const id = taskId || 'p' + uid();
		const was = inProgress.find(d => d.id === id);
		history = history.filter(h => h.id !== id);
		const m = stored[request.mappingId];
		const item = { ...(was || {}), id, file: id + '.json', subtitle: request.startDate + ' to ' + request.endDate, ...request, mappingName: m ? m.name : 'Mapping', mappingMode: m ? m.mode : 'custom',
			state: 'waiting', rightText: 'Waiting', progressPct: was ? was.progressPct : 0, totalRequests: was ? was.totalRequests : estimate(request).requests, etaSeconds: undefined, pausedAt: undefined };
		inProgress = was ? inProgress.map(d => d.id === id ? item : d) : [...inProgress, item];
		pump();
		return id;
	},
	pauseDownload: (_c, id) => { inProgress = inProgress.map(d => d.id === id ? { ...d, state: 'paused', rightText: 'Paused', etaSeconds: undefined, pausedAt: Date.now() } : d); pump(); },
	cancelDownload: (_c, id) => {
		const d = inProgress.find(x => x.id === id);
		inProgress = inProgress.filter(x => x.id !== id);
		if (d) { history = [{ ...d, status: 'Failed', size: '-', error: 'Cancelled', endedAt: Date.now() }, ...history]; }
		pump();
	},
	moveDownloadUp: (_c, id) => {
		const at = inProgress.findIndex(d => d.id === id);
		let before = at - 1;
		while (before >= 0 && inProgress[before].state !== 'waiting') { before--; }
		if (at >= 0 && before >= 0) { const next = [...inProgress]; [next[before], next[at]] = [next[at], next[before]]; inProgress = next; }
		changedDownloads();
	},
	pauseAllDownloads: () => { inProgress = inProgress.map(d => d.state === 'paused' ? d : { ...d, state: 'paused', rightText: 'Paused', etaSeconds: undefined, pausedAt: Date.now() }); changedDownloads(); },
	resumeAllDownloads: () => { inProgress = inProgress.map(d => d.state === 'paused' ? { ...d, state: 'waiting', rightText: 'Waiting', pausedAt: undefined } : d); pump(); },
	deleteDownload: (_c, id) => { inProgress = inProgress.filter(d => d.id !== id); history = history.filter(h => h.id !== id); changedDownloads(); },
	openDownload: (_c, id, format) => { note('open ' + id + ' as ' + format); return true; },
	showDownloadInFolder: (_c, id) => { note('show ' + id + ' in folder'); return true; },
	openDownloadInApp: (_c, id, app) => { note('open ' + id + ' in ' + app); return true; },
	analysisApps: () => ({ installed: !params.has('noapps') }),
	showAnalysisApps: () => note('show the Countdown Analytics extension'),

	settings: () => settings,
	saveSettings: (_c, next) => { settings = { ...next }; pump(); return settings; },
	chooseSaveFolder: () => 'D:\\\\Data\\\\DHIS2 downloads'
};

// a running download moves on, and finishes
setInterval(() => {
	let changed = false;
	inProgress = inProgress.filter(d => {
		if (d.state !== 'downloading') { return true; }
		changed = true;
		d.doneRequests = Math.min(d.totalRequests, (d.doneRequests || 0) + 1);
		d.progressPct = Math.round(d.doneRequests / d.totalRequests * 100);
		d.rightText = d.progressPct + '%';
		d.etaSeconds = (d.totalRequests - d.doneRequests) * 4;
		if (d.doneRequests < d.totalRequests) { return true; }
		history = [{ ...d, status: 'Completed', size: (d.totalRequests * 0.03).toFixed(2) + ' MB', rows: d.totalRequests * 1900, endedAt: Date.now() }, ...history];
		return false;
	});
	if (changed) { pump(); }
}, 4000);

let viewState = page === 'connect' ? undefined : { connectionId: 'c1', page };
window.acquireVsCodeApi = () => ({
	postMessage(message) {
		if (message.kind !== 'request') return;
		const answer = answers[message.method];
		if (!answer) { console.warn('[harness] no answer for', message.method); }
		Promise.resolve().then(() => answer ? answer(...message.args) : undefined).then(
			result => setTimeout(() => window.postMessage({ kind: 'response', id: message.id, result }, '*'), 20),
			error => window.postMessage({ kind: 'response', id: message.id, error: String(error && error.message || error) }, '*'));
	},
	getState: () => viewState,
	setState: state => { viewState = state; }
});
</script>
</head>
<body class="vscode-light">
<div id="root"></div>
<script>if (theme === 'dark') { document.body.classList.remove('vscode-light'); document.body.classList.add('vscode-dark'); }</script>
<script src="../out/webview.js"></script>
</body>
</html>
`;

fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`Open ${path.join(outDir, 'index.html')}?theme=light&page=overview`);
