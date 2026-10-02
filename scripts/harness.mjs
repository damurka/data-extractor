// A page to look at the webview outside DataSuite: out/webview.js and its CSS with a stand-in for VS Code's webview API
// (acquireVsCodeApi) that answers the host's calls from sample data, in VS Code's light or dark colours. Not shipped.
//
//   npm run build && node scripts/harness.mjs      then open out-harness/index.html?theme=dark&page=mappings
//
// ?theme=light|dark, ?page=connect|dashboard|mappings|downloads|settings

import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const outDir = path.join(root, 'out-harness');
fs.mkdirSync(outDir, { recursive: true });

// The few VS Code colours the page reads, as a light and a dark theme give them
const THEMES = {
	light: {
		foreground: '#3b3b3b', descriptionForeground: '#717171', 'editor-background': '#ffffff', 'sideBar-background': '#f8f8f8',
		'editorWidget-background': '#f8f8f8', 'list-hoverBackground': '#f2f2f2', 'panel-border': '#e5e5e5', 'widget-border': '#e5e5e5',
		focusBorder: '#005fb8', 'button-background': '#005fb8', 'button-foreground': '#ffffff', 'button-hoverBackground': '#0258a8',
		'button-secondaryBackground': '#e5e5e5', 'button-secondaryForeground': '#3b3b3b', 'textLink-foreground': '#005fb8', 'input-placeholderForeground': '#767676'
	},
	dark: {
		foreground: '#cccccc', descriptionForeground: '#9d9d9d', 'editor-background': '#1f1f1f', 'sideBar-background': '#181818',
		'editorWidget-background': '#202020', 'list-hoverBackground': '#2a2d2e', 'panel-border': '#2b2b2b', 'widget-border': '#313131',
		focusBorder: '#0078d4', 'button-background': '#0078d4', 'button-foreground': '#ffffff', 'button-hoverBackground': '#026ec1',
		'button-secondaryBackground': '#313131', 'button-secondaryForeground': '#cccccc', 'textLink-foreground': '#4daafc', 'input-placeholderForeground': '#989898'
	}
};

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Data Extractor (harness)</title>
<link rel="stylesheet" href="../out/webview.css">
<style id="vscode-theme"></style>
<script>
const THEMES = ${JSON.stringify(THEMES)};
const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.getElementById('vscode-theme').textContent = ':root{' + Object.entries(THEMES[theme]).map(([k, v]) => '--vscode-' + k + ':' + v).join(';') + '}';
const page = params.get('page') || 'dashboard';

const day = 86400000, now = Date.now();
const connections = [
	{ id: 'c1', serverUrl: 'https://hiskenya.dha.go.ke', username: 'dkariuki', displayName: 'HIS Kenya', usesAccessToken: true, country: 'Kenya', granted: true },
	{ id: 'c2', serverUrl: 'https://dhis2.moh.gov.et', username: 'analyst', displayName: 'Ethiopia MOH', usesAccessToken: false, country: 'Ethiopia', granted: false }
];
const mappings = [
	{ id: 'mp_cd2030_kenya', name: 'Countdown 2030 - Kenya', description: 'RMNCAH and immunisation indicators for the Countdown analysis', mode: 'countdown', indicatorsCount: 38, lastUpdatedAt: now - 2 * 3600000 },
	{ id: 'mp_anc', name: 'ANC & Immunisation', description: 'Monthly ANC visits, Penta and measles doses', mode: 'custom', indicatorsCount: 12, lastUpdatedAt: now - 3 * day },
	{ id: 'mp_malaria', name: 'Malaria monthly', description: null, mode: 'custom', indicatorsCount: 0, lastUpdatedAt: now - 20 * day }
];
const cocs = ['<1 year', '1-4 years', '5-14 years', '15-24 years', '25+ years', 'Male', 'Female', 'Fixed', 'Outreach', 'default'].map((name, i) => ({ uid: 'coc' + String(i).padStart(8, '0'), name, categoryComboUid: 'cc1', checked: i % 3 !== 1 }));
const mapping = {
	name: 'ANC & Immunisation', description: 'Monthly ANC visits, Penta and measles doses', mode: 'custom',
	indicators: [
		{ id: 'i1', internalName: 'ANC 1st visit', exportCode: 'anc1', kind: 'custom', sources: [
			{ id: 'Ac7Wvh4fJ1v', sourceElement: 'MOH 711 ANC 1st visit', type: 'Data Element', includedCategoriesText: '7 of 10 age groups', cocs, categoryComboIsDefault: false, origin: 'manual', active: true },
			{ id: 'Bq5tQh3dK9p', sourceElement: 'MOH 711 ANC 1st visit (outreach)', type: 'Data Element', includedCategoriesText: 'All', cocs: [], categoryComboIsDefault: true, origin: 'ai' }
		] },
		{ id: 'i2', internalName: 'Penta 3', exportCode: 'penta3', kind: 'custom', sources: [{ id: 'Pq1', sourceElement: 'MOH 710 DPT/HepB/Hib 3', type: 'Data Element', includedCategoriesText: 'All', cocs: [], categoryComboIsDefault: true }] },
		{ id: 'i3', internalName: '', exportCode: '', kind: 'custom', sources: [] }
	]
};
const history = [
	{ id: 'h1', file: 'h1.json', status: 'Completed', mappingId: 'mp_cd2030_kenya', mappingName: 'Countdown 2030 - Kenya', mappingMode: 'countdown', startDate: '2024-01-01', endDate: '2024-12-31', periodType: 'monthly', adminLevel: 'LEVEL-3', date: 'Today, 09:12', size: '1.84 MB' },
	{ id: 'h2', file: 'h2.json', status: 'Completed', mappingId: 'mp_anc', mappingName: 'ANC & Immunisation', mappingMode: 'custom', startDate: '2025-01-01', endDate: '2025-06-30', periodType: 'monthly', adminLevel: 'LEVEL-5', date: 'Yesterday', size: '6.40 MB' },
	{ id: 'h3', file: 'h3.json', status: 'Failed', mappingId: 'mp_malaria', mappingName: 'Malaria monthly', mappingMode: 'custom', startDate: '2025-07-01', endDate: '2025-09-30', periodType: 'monthly', adminLevel: 'LEVEL-3', date: '29 Sep', size: '-' }
];
const inProgress = [
	{ id: 'p1', file: 'p1.json', subtitle: '2025-01-01 to 2025-09-30', progressPct: 62, rightText: '62%', state: 'downloading', mappingId: 'mp_cd2030_kenya', mappingName: 'Countdown 2030 - Kenya', mappingMode: 'countdown', startDate: '2025-01-01', endDate: '2025-09-30', periodType: 'monthly', adminLevel: 'LEVEL-5' },
	{ id: 'p2', file: 'p2.json', subtitle: '2023-01-01 to 2024-12-31', progressPct: 30, rightText: 'Paused', state: 'paused', mappingId: 'mp_anc', mappingName: 'ANC & Immunisation', mappingMode: 'custom', startDate: '2023-01-01', endDate: '2024-12-31', periodType: 'monthly', adminLevel: 'LEVEL-4' }
];
const levels = [{ level: 1, name: 'Kenya', count: 1 }, { level: 2, name: 'County', count: 47 }, { level: 3, name: 'Sub-County', count: 300 }, { level: 4, name: 'Ward', count: 1450 }, { level: 5, name: 'Health Facility', count: 14000 }];

const answers = {
	listConnections: () => connections,
	metadataStatus: () => ({ syncing: false, lastSyncedAt: now - 2 * 3600000, dataElements: 3912, categoryOptionCombos: 1204, organisationUnits: 16540 }),
	listMappings: () => mappings,
	loadDraft: () => ({ name: 'Maternal deaths', mode: 'custom', indicators: [{ id: 'd1', internalName: 'Maternal deaths', exportCode: 'mdeaths', kind: 'custom', sources: [] }] }),
	getMapping: () => mapping,
	downloads: (_c, filter) => ({ inProgress: filter === 'completed' || filter === 'failed' ? [] : inProgress, history: history.filter(h => filter === 'completed' ? h.status === 'Completed' : filter === 'failed' ? h.status === 'Failed' : true) }),
	calendar: () => 'iso8601',
	orgUnitLevels: () => levels,
	downloadSettings: () => ({ maxConcurrentChunks: 4, maxCellsPerChunk: 50000, retryAttempts: 3, retryBaseDelayMs: 2000, requestTimeoutMs: 120000 }),
	estimateDownload: () => ({ dataItems: 64, periods: 9, firstPeriod: '202501', lastPeriod: '202509', organisationUnits: 14000, requests: 162 }),
	searchSources: () => ({ dataElements: [{ uid: 'Ac7Wvh4fJ1v', name: 'MOH 711 ANC 1st visit', type: 'Data Element' }, { uid: 'Zx1', name: 'MOH 711 ANC 4th visit', type: 'Data Element' }], indicators: [{ uid: 'In1', name: 'ANC 1st visit coverage', type: 'Indicator', elementCount: 2 }], dataSets: [{ uid: 'Ds1', name: 'MOH 711 Integrated summary', type: 'DataSet' }] }),
	searchOrgUnits: () => [{ uid: 'ou1', name: 'Nairobi County', level: 2, pathNames: 'Kenya / Nairobi County' }],
	confirm: () => true
};

window.acquireVsCodeApi = () => ({
	postMessage(message) {
		if (message.kind !== 'request') return;
		const answer = answers[message.method];
		setTimeout(() => window.postMessage({ kind: 'response', id: message.id, result: answer ? answer(...message.args) : undefined }, '*'), 20);
	},
	getState: () => page === 'connect' ? undefined : { connectionId: 'c1', page },
	setState: () => { }
});
</script>
</head>
<body>
<div id="root"></div>
<script>if (theme === 'dark') document.body.classList.add('vscode-dark'); else document.body.classList.add('vscode-light');</script>
<script src="../out/webview.js"></script>
</body>
</html>
`;

fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`Open ${path.join(outDir, 'index.html')}?theme=light&page=dashboard`);
