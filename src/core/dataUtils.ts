/*---------------------------------------------------------------------------------------------
 *  Data Extractor: operands, chunk plans, tidy tables, CSV
 *  Ported from DataSuite (workbench/services/dhis2/common/dhis2DataUtils.ts); keep the two in step until DataSuite's built-in extractor is removed.
 *--------------------------------------------------------------------------------------------*/

import { gregorianYearMonth } from './periods';
import { IAddMappingDraft, ICategoryOptionCombo, IDhis2AnalyticsResponse, IDhis2AnalyticsRow, IDhis2OrgUnitWithLevels, IDhis2Profile, IIndicatorDraft } from './types';

// ---------------------------------------------------------------------------
// Download planning
// ---------------------------------------------------------------------------

/** Data set reporting metrics, as analytics operands (`<dataSetUid>.<METRIC>`). */
export const DATA_SET_METRICS = ['REPORTING_RATE', 'ACTUAL_REPORTS', 'EXPECTED_REPORTS'] as const;

/**
 * The analytics `dx` operands a set of mapping indicators needs: a data set source becomes its
 * three reporting metrics; a data element with a real subset of category option combos checked
 * becomes one `<de>.<coc>` operand per checked combo; anything else is the plain uid (its total).
 */
export function buildDxOperands(indicators: readonly IIndicatorDraft[]): string[] {
	const operands = new Set<string>();
	for (const indicator of indicators) {
		for (const source of indicator.sources ?? []) {
			if (source.type === 'DataSet' || source.type === 'Dataset') {
				for (const metric of DATA_SET_METRICS) {
					operands.add(`${source.id}.${metric}`);
				}
				continue;
			}
			if (!source.cocs || source.cocs.length === 0) {
				operands.add(source.id);
				continue;
			}
			const checked = source.cocs.filter((coc: ICategoryOptionCombo) => coc.checked);
			const onlyDefaults = checked.length > 0 && checked.every((coc: ICategoryOptionCombo) => coc.name.trim().toLowerCase() === 'default');
			if (checked.length === 0 || checked.length === source.cocs.length || onlyDefaults) {
				operands.add(source.id);
			} else {
				for (const coc of checked) {
					operands.add(`${source.id}.${coc.uid}`);
				}
			}
		}
	}
	return Array.from(operands);
}

/** Protocol limit on dimension items per analytics URL (a longer URL starts failing with 414). */
export const MAX_ANALYTICS_URL_PARAMS = 250;

/**
 * How the download pipeline splits dx x pe into analytics requests so that each stays under
 * `maxCells` values (dx * pe * org units). Returns chunk sizes and the number of requests.
 */
export function planAnalyticsChunks(dxCount: number, peCount: number, orgUnitCount: number, maxCells: number): { dxChunkSize: number; peChunkSize: number; chunks: number } {
	if (dxCount === 0 || peCount === 0) {
		return { dxChunkSize: 0, peChunkSize: 0, chunks: 0 };
	}
	const safeCombinations = Math.max(1, Math.floor(maxCells / Math.max(1, orgUnitCount)));
	let peChunkSize = Math.min(peCount, safeCombinations);
	let dxChunkSize = Math.max(1, Math.floor(safeCombinations / peChunkSize));
	if ((peChunkSize + dxChunkSize) > MAX_ANALYTICS_URL_PARAMS) {
		peChunkSize = Math.min(peChunkSize, Math.floor(MAX_ANALYTICS_URL_PARAMS / 2));
		dxChunkSize = Math.min(dxChunkSize, Math.floor(MAX_ANALYTICS_URL_PARAMS / 2));
	}
	return { dxChunkSize, peChunkSize, chunks: Math.ceil(dxCount / dxChunkSize) * Math.ceil(peCount / peChunkSize) };
}

// ---------------------------------------------------------------------------
// Tidy rows and CSV
// ---------------------------------------------------------------------------

export type TidyValue = string | number | null;
export type TidyRow = Record<string, TidyValue>;

export interface ITidyTable {
	readonly columns: string[];
	readonly rows: TidyRow[];
}

/** RFC 4180 CSV: a header line, then one line per row; fields with a comma, quote, newline or edge spaces are quoted. */
export function toCsv(columns: readonly string[], rows: readonly TidyRow[]): string {
	const field = (v: TidyValue | undefined): string => {
		if (v === null || v === undefined) {
			return '';
		}
		const s = String(v);
		return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	const lines = [columns.map(c => field(c)).join(',')];
	for (const row of rows) {
		lines.push(columns.map(c => field(row[c])).join(','));
	}
	return lines.join('\n') + '\n';
}

/** `<slug>_<yyyymmdd-hhmm>.csv`, local time -- e.g. `anc_1st_visit_20260927-1405.csv`. */
export function csvFileName(label: string, now: Date): string {
	const slug = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40).replace(/_+$/, '') || 'dhis2';
	const pad = (n: number) => String(n).padStart(2, '0');
	const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
	return `${slug}_${stamp}.csv`;
}

/** Numeric strings become numbers so a CSV reader types the column as numeric; blanks become null. */
function toValue(raw: string | undefined | null): TidyValue {
	if (raw === undefined || raw === null || raw.trim() === '') {
		return null;
	}
	const n = Number(raw);
	return Number.isFinite(n) ? n : raw;
}

/** Ancestor uids of `ouUid` from a `metaData.ouHierarchy` path, root first, excluding the org unit itself. */
function ancestorsFromHierarchy(path: string | undefined, ouUid: string): string[] {
	return (path ?? '').split('/').filter(uid => !!uid && uid !== ouUid);
}

/**
 * Flattens an analytics response into one row per value: `ou_uid, ou_name, level1_name..levelN_name`
 * (ancestors, from `metaData.ouHierarchy` when the request asked for hierarchyMeta), `pe, pe_name` plus the
 * Gregorian `year, month` of a yearly or monthly period (see gregorianYearMonth: on an Ethiopian-calendar server
 * `pe` stays Ethiopian), `dx_uid, dx_name`, `co_uid, co_name` when the response has a category option combo column, any
 * other dimension as `<dim>`/`<dim>_name`, and `value`.
 */
export function analyticsToTidyTable(response: IDhis2AnalyticsResponse, calendar?: string): ITidyTable {
	const headers = response.headers ?? [];
	const items = response.metaData?.items ?? {};
	const hierarchy = response.metaData?.ouHierarchy ?? {};
	const nameOf = (uid: string | undefined) => uid ? (items[uid]?.name ?? uid) : '';
	const valueIdx = headers.findIndex(h => h.name === 'value');
	const dims = headers.map((h, i) => ({ name: h.name, i })).filter(d => d.i !== valueIdx && !['numerator', 'denominator', 'factor', 'multiplier', 'divisor'].includes(d.name));
	const idx = (name: string) => headers.findIndex(h => h.name === name);
	const ouIdx = idx('ou');
	const hasCo = idx('co') >= 0;

	let depth = 0;
	if (ouIdx >= 0) {
		for (const row of response.rows ?? []) {
			depth = Math.max(depth, ancestorsFromHierarchy(hierarchy[row[ouIdx]], row[ouIdx]).length);
		}
	}
	const levelCols = Array.from({ length: depth }, (_, i) => `level${i + 1}_name`);
	const otherDims = dims.filter(d => !['ou', 'pe', 'dx', 'co'].includes(d.name));

	const columns = [
		...(ouIdx >= 0 ? ['ou_uid', 'ou_name', ...levelCols] : []),
		...(idx('pe') >= 0 ? ['pe', 'pe_name', 'year', 'month'] : []),
		...(idx('dx') >= 0 ? ['dx_uid', 'dx_name'] : []),
		...(hasCo ? ['co_uid', 'co_name'] : []),
		...otherDims.flatMap(d => [d.name, `${d.name}_name`]),
		'value',
	];

	const rows: TidyRow[] = (response.rows ?? []).map(r => {
		const row: TidyRow = {};
		if (ouIdx >= 0) {
			const ou = r[ouIdx];
			row.ou_uid = ou;
			row.ou_name = nameOf(ou);
			const ancestors = ancestorsFromHierarchy(hierarchy[ou], ou);
			levelCols.forEach((col, i) => { row[col] = ancestors[i] ? nameOf(ancestors[i]) : null; });
		}
		for (const d of ['pe', 'dx', 'co']) {
			const i = idx(d);
			if (i >= 0) {
				const key = d === 'pe' ? 'pe' : `${d}_uid`;
				row[key] = r[i];
				row[`${d}_name`] = nameOf(r[i]);
				if (d === 'pe') {
					const gregorian = gregorianYearMonth(r[i], calendar);
					row.year = gregorian?.year ?? null;
					row.month = gregorian?.month ?? null;
				}
			}
		}
		for (const d of otherDims) {
			row[d.name] = r[d.i];
			row[`${d.name}_name`] = nameOf(r[d.i]);
		}
		row.value = valueIdx >= 0 ? toValue(r[valueIdx]) : null;
		return row;
	});
	return { columns, rows };
}

/** Escapes a value for a Markdown table cell. */
function cell(v: TidyValue | undefined): string {
	if (v === null || v === undefined) {
		return '';
	}
	return String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * A compact Markdown table of an analytics result with names (not uids) from `metaData.items`:
 * one column per dimension present plus Value, sorted by data item, org unit, period. At most
 * `maxRows` rows are shown; the returned `omitted` says how many were left out.
 */
export function formatAnalyticsTable(table: ITidyTable, maxRows: number): { markdown: string; shown: number; omitted: number } {
	const has = (c: string) => table.columns.includes(c);
	const cols: { key: string; title: string }[] = [];
	if (has('dx_name')) { cols.push({ key: 'dx_name', title: 'Data' }); }
	if (has('ou_name')) { cols.push({ key: 'ou_name', title: 'Org unit' }); }
	if (has('pe_name')) { cols.push({ key: 'pe_name', title: 'Period' }); }
	if (has('co_name')) { cols.push({ key: 'co_name', title: 'Category' }); }
	for (const c of table.columns) {
		if (c.endsWith('_name') && !['dx_name', 'ou_name', 'pe_name', 'co_name'].includes(c) && !/^level\d+_name$/.test(c)) {
			cols.push({ key: c, title: c.slice(0, -5) });
		}
	}
	cols.push({ key: 'value', title: 'Value' });

	const sorted = table.rows.slice().sort((a, b) =>
		String(a.dx_name ?? '').localeCompare(String(b.dx_name ?? '')) ||
		String(a.ou_name ?? '').localeCompare(String(b.ou_name ?? '')) ||
		String(a.pe ?? '').localeCompare(String(b.pe ?? '')));
	const shown = sorted.slice(0, Math.max(0, maxRows));
	const lines = [
		`| ${cols.map(c => c.title).join(' | ')} |`,
		`| ${cols.map(c => c.key === 'value' ? '---:' : '---').join(' | ')} |`,
		...shown.map(r => `| ${cols.map(c => cell(r[c.key])).join(' | ')} |`),
	];
	return { markdown: lines.join('\n'), shown: shown.length, omitted: sorted.length - shown.length };
}

/**
 * Tidy rows for a mapping download: one row per org unit x period x export code, summing every
 * source operand mapped to that code (as the Excel export does), with the org unit's ancestor
 * names per level, and the Gregorian `year, month` of each period (`pe` is the server's own id, Ethiopian on an
 * Ethiopian-calendar server). Data set sources produce `<code>_reporting_rate/_received/_expected` rows.
 */
export function buildTidyDownloadRows(mappingDraft: IAddMappingDraft, rawRows: readonly IDhis2AnalyticsRow[], orgUnits: readonly IDhis2OrgUnitWithLevels[], calendar?: string): ITidyTable {
	const targets = new Map<string, { code: string; name: string }[]>();
	const add = (operand: string, code: string, name: string) => {
		const list = targets.get(operand) ?? [];
		list.push({ code, name });
		targets.set(operand, list);
	};
	for (const ind of mappingDraft.indicators) {
		if (!ind.exportCode) {
			continue;
		}
		const name = ind.internalName || ind.exportCode;
		for (const src of ind.sources ?? []) {
			if (src.type === 'DataSet' || src.type === 'Dataset') {
				add(`${src.id}.REPORTING_RATE`, `${ind.exportCode}_reporting_rate`, `${name} - reporting rate (%)`);
				add(`${src.id}.ACTUAL_REPORTS`, `${ind.exportCode}_reporting_received`, `${name} - reports received`);
				add(`${src.id}.EXPECTED_REPORTS`, `${ind.exportCode}_reporting_expected`, `${name} - reports expected`);
				continue;
			}
			const checked = (src.cocs ?? []).filter(c => c.checked);
			if (checked.length === 0 || checked.length === src.cocs?.length || src.categoryComboIsDefault) {
				add(src.id, ind.exportCode, name);
			} else {
				for (const coc of checked) {
					add(`${src.id}.${coc.uid}`, ind.exportCode, name);
				}
			}
		}
	}

	const ouById = new Map(orgUnits.map(ou => [ou.id, ou]));
	let depth = 0;
	for (const ou of orgUnits) {
		depth = Math.max(depth, Number(ou.level) || 0);
	}
	const levelCols = Array.from({ length: Math.max(0, depth - 1) }, (_, i) => `level${i + 1}_name`);

	const sums = new Map<string, TidyRow>();
	for (const r of rawRows) {
		for (const t of targets.get(r.dx) ?? []) {
			const key = `${r.ou}\u0000${r.pe}\u0000${t.code}`;
			let row = sums.get(key);
			if (!row) {
				const ou = ouById.get(r.ou);
				row = { ou_uid: r.ou, ou_name: ou?.name ?? r.ou };
				for (const col of levelCols) {
					const v = ou?.[col];
					row[col] = typeof v === 'string' ? v : null;
				}
				row.pe = r.pe;
				const gregorian = gregorianYearMonth(r.pe, calendar);
				row.year = gregorian?.year ?? null;
				row.month = gregorian?.month ?? null;
				row.dx_uid = t.code;
				row.dx_name = t.name;
				row.value = null;
				sums.set(key, row);
			}
			if (r.value !== null) {
				row.value = (typeof row.value === 'number' ? row.value : 0) + r.value;
			}
		}
	}
	const rows = Array.from(sums.values()).sort((a, b) =>
		String(a.dx_uid).localeCompare(String(b.dx_uid)) || String(a.ou_name).localeCompare(String(b.ou_name)) || String(a.pe).localeCompare(String(b.pe)));
	return { columns: ['ou_uid', 'ou_name', ...levelCols, 'pe', 'year', 'month', 'dx_uid', 'dx_name', 'value'], rows };
}

// ---------------------------------------------------------------------------
// Dimension items (dx / ou) given by name or uid
// ---------------------------------------------------------------------------

export const DHIS2_UID = /^[A-Za-z][A-Za-z0-9]{10}$/;

const OU_KEYWORDS = new Set(['USER_ORGUNIT', 'USER_ORGUNIT_CHILDREN', 'USER_ORGUNIT_GRANDCHILDREN']);
const DX_OPERAND = /^[A-Za-z][A-Za-z0-9]{10}\.([A-Za-z][A-Za-z0-9]{10}|\*|REPORTING_RATE|REPORTING_RATE_ON_TIME|ACTUAL_REPORTS|ACTUAL_REPORTS_ON_TIME|EXPECTED_REPORTS)(\.([A-Za-z][A-Za-z0-9]{10}|\*))?$/;
const DS_METRIC_SUFFIX = /^(.+)\.(REPORTING_RATE|REPORTING_RATE_ON_TIME|ACTUAL_REPORTS|ACTUAL_REPORTS_ON_TIME|EXPECTED_REPORTS)$/;

export type Dhis2DimensionItem =
	| { readonly kind: 'id'; readonly value: string }
	| { readonly kind: 'levelNumber'; readonly level: number }
	| { readonly kind: 'levelName'; readonly name: string }
	| { readonly kind: 'groupName'; readonly name: string }
	| { readonly kind: 'name'; readonly name: string; readonly metric?: string };

/**
 * What a dx/ou item the AI passed is: already an id DHIS2 understands (uid, `uid.coc`,
 * `uid.REPORTING_RATE`, `LEVEL-<uid>`, `OU_GROUP-<uid>`, `DE_GROUP-<uid>`, USER_ORGUNIT...),
 * a level by number or name, an org unit group by name, or a name to look up.
 */
export function classifyDimensionItem(raw: string, dimension: 'dx' | 'ou'): Dhis2DimensionItem {
	const item = raw.trim();
	if (DHIS2_UID.test(item)) {
		return { kind: 'id', value: item };
	}
	if (dimension === 'ou') {
		if (OU_KEYWORDS.has(item.toUpperCase())) {
			return { kind: 'id', value: item.toUpperCase() };
		}
		let m = /^LEVEL[-_ ](.+)$/i.exec(item);
		if (m) {
			const v = m[1].trim();
			if (/^\d+$/.test(v)) {
				return { kind: 'levelNumber', level: Number(v) };
			}
			return DHIS2_UID.test(v) ? { kind: 'id', value: `LEVEL-${v}` } : { kind: 'levelName', name: v };
		}
		m = /^OU_GROUP[-_ ](.+)$/i.exec(item);
		if (m) {
			const v = m[1].trim();
			return DHIS2_UID.test(v) ? { kind: 'id', value: `OU_GROUP-${v}` } : { kind: 'groupName', name: v };
		}
		return { kind: 'name', name: item };
	}
	if (DX_OPERAND.test(item) || /^(DE_GROUP|IN_GROUP)-[A-Za-z][A-Za-z0-9]{10}$/.test(item)) {
		return { kind: 'id', value: item };
	}
	const metric = DS_METRIC_SUFFIX.exec(item);
	if (metric) {
		return { kind: 'name', name: metric[1].trim(), metric: metric[2] };
	}
	return { kind: 'name', name: item };
}

export interface INamedCandidate {
	readonly uid: string;
	readonly name: string;
	readonly displayName?: string | null;
	readonly shortName?: string | null;
	readonly code?: string | null;
	readonly formName?: string | null;
}

export type NameMatch<T> =
	| { readonly kind: 'match'; readonly match: T; readonly how: 'exact' | 'onlyResult' }
	| { readonly kind: 'ambiguous'; readonly candidates: T[] }
	| { readonly kind: 'none' };

/**
 * Picks the candidate a name refers to: a case-insensitive exact match on name, display name,
 * short name, form name or code wins if it is unique; a single search result is accepted as-is;
 * otherwise the name is ambiguous (the caller should ask, not guess).
 */
export function pickNameMatch<T extends INamedCandidate>(query: string, candidates: readonly T[]): NameMatch<T> {
	const q = query.trim().toLowerCase();
	const exact = candidates.filter(c => [c.name, c.displayName, c.shortName, c.formName, c.code].some(v => !!v && v.trim().toLowerCase() === q));
	const unique = Array.from(new Map(exact.map(c => [c.uid, c])).values());
	if (unique.length === 1) {
		return { kind: 'match', match: unique[0], how: 'exact' };
	}
	if (unique.length > 1) {
		return { kind: 'ambiguous', candidates: unique };
	}
	if (candidates.length === 1) {
		return { kind: 'match', match: candidates[0], how: 'onlyResult' };
	}
	if (candidates.length === 0) {
		return { kind: 'none' };
	}
	return { kind: 'ambiguous', candidates: candidates.slice() };
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export type ProfileChoice = { readonly kind: 'ok'; readonly profile: IDhis2Profile; readonly note?: string } | { readonly kind: 'error'; readonly error: string };

function hostOf(serverUrl: string): string {
	try {
		return new URL(serverUrl).host || serverUrl;
	} catch {
		return serverUrl;
	}
}

/** `Profile: Kenya MOH (hiskenya.dha.go.ke)` -- the line every DHIS2 tool result starts with. */
export function profileLabel(profile: IDhis2Profile): string {
	return `Profile: ${profile.displayName} (${hostOf(profile.serverUrl)})`;
}

function listProfiles(profiles: readonly IDhis2Profile[]): string {
	return profiles.map(p => `"${p.displayName}" (id \`${p.id}\`, ${hostOf(p.serverUrl)})`).join('; ');
}

/**
 * The profile a tool call means: `hint` may be a profile id, display name, or server host (case-
 * insensitive). Without a hint the most recently used profile is chosen, and when several exist
 * the note says which one and lists the others. An unknown hint is an error listing the valid
 * profiles -- never a silent fallback to a different server.
 */
export function resolveProfileChoice(profiles: readonly IDhis2Profile[], hint: string | undefined): ProfileChoice {
	if (!profiles.length) {
		return { kind: 'error', error: 'No DHIS2 connections found. Ask the user to sign in to a DHIS2 server in the Data Extractor (DHIS2: Open Data Extractor) first.' };
	}
	const sorted = profiles.slice().sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
	const h = hint?.trim();
	if (h) {
		const lower = h.toLowerCase();
		const found = sorted.find(p => p.id === h)
			?? sorted.find(p => p.displayName.trim().toLowerCase() === lower)
			?? sorted.find(p => hostOf(p.serverUrl).toLowerCase() === lower || p.serverUrl.toLowerCase().replace(/\/+$/, '') === lower.replace(/\/+$/, ''));
		if (!found) {
			return { kind: 'error', error: `No DHIS2 profile matches "${h}". Valid profiles: ${listProfiles(sorted)}.` };
		}
		return { kind: 'ok', profile: found };
	}
	if (sorted.length === 1) {
		return { kind: 'ok', profile: sorted[0] };
	}
	return { kind: 'ok', profile: sorted[0], note: `Several DHIS2 profiles exist; used the most recently used one. Others: ${listProfiles(sorted.slice(1))} -- pass profileId to use another.` };
}

// ---------------------------------------------------------------------------
// Raw query output
// ---------------------------------------------------------------------------

/**
 * Compact JSON for a raw API response, summarised when it is larger than `maxChars`: top-level
 * keys (with array sizes), the pager, and the first `maxItems` items of each array.
 */
export function summarizeJson(value: unknown, maxChars: number, maxItems = 10): { text: string; summarized: boolean } {
	const compact = JSON.stringify(value);
	if (compact === undefined) {
		return { text: 'null', summarized: false };
	}
	if (compact.length <= maxChars) {
		return { text: compact, summarized: false };
	}
	if (Array.isArray(value)) {
		const head = JSON.stringify(value.slice(0, maxItems));
		return { text: `Array of ${value.length} items; first ${Math.min(maxItems, value.length)}:\n${truncate(head, maxChars)}`, summarized: true };
	}
	if (value && typeof value === 'object') {
		const obj = value as Record<string, unknown>;
		const lines: string[] = [];
		const shape = Object.entries(obj).map(([k, v]) => Array.isArray(v) ? `${k}: array(${v.length})` : v && typeof v === 'object' ? `${k}: object` : `${k}: ${JSON.stringify(v)}`.slice(0, 120));
		lines.push(`Top-level keys: ${shape.join(', ')}`);
		if (obj.pager) {
			lines.push(`pager: ${JSON.stringify(obj.pager)}`);
		}
		const budget = Math.max(500, Math.floor(maxChars / Math.max(1, Object.values(obj).filter(Array.isArray).length)));
		for (const [k, v] of Object.entries(obj)) {
			if (Array.isArray(v)) {
				lines.push(`${k} (first ${Math.min(maxItems, v.length)} of ${v.length}): ${truncate(JSON.stringify(v.slice(0, maxItems)), budget)}`);
			}
		}
		return { text: lines.join('\n'), summarized: true };
	}
	return { text: truncate(compact, maxChars), summarized: true };
}

function truncate(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max)}... [truncated]` : s;
}
