/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the DHIS2 chat tools that answer data questions -- org unit levels, analytics, reporting
 *  completeness, raw data values
 *  Ported from DataSuite (contrib/dhis2/browser/tools/dhis2QueryTools.ts).
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { pivotReporting } from '../core/chatTools';
import { analyticsToTidyTable, classifyDimensionItem, DHIS2_UID, formatAnalyticsTable, INamedCandidate, ITidyTable, pickNameMatch, TidyRow } from '../core/dataUtils';
import { DHIS2_PERIOD_GRAMMAR, isValidPeriodId, normalizePeriodId } from '../core/periods';
import { IDhis2AnalyticsResponse } from '../core/types';
import { describeDataFile, meta, ToolCall, ToolDefinition, ToolDeps, ToolOutput, writeDataFile } from './support';

/** Rows shown in a result table by default; the CSV always has everything. */
const DEFAULT_MAX_ROWS = 50;
const MAX_MAX_ROWS = 500;
/** Candidates listed when a name is ambiguous. */
const MAX_CANDIDATES = 6;

function clampRows(n: number | undefined, fallback = DEFAULT_MAX_ROWS): number {
	return Math.max(1, Math.min(n ?? fallback, MAX_MAX_ROWS));
}

/** An analytics query, as DataSuite's built-in tools sent it. */
export async function analyticsQuery(connectionId: string, request: { dimensions: string[]; filters: string[]; displayProperty?: string; aggregationType?: string }, token?: vscode.CancellationToken): Promise<IDhis2AnalyticsResponse> {
	return await vscode.dhis2.read(connectionId, {
		path: 'analytics',
		query: {
			dimension: request.dimensions,
			filter: request.filters.length ? request.filters : undefined,
			skipMeta: false,
			outputIdScheme: 'UID',
			includeNumDen: false,
			displayProperty: request.displayProperty,
			aggregationType: request.aggregationType,
			hierarchyMeta: true
		},
		timeoutMs: 120_000
	}, token) as IDhis2AnalyticsResponse;
}

// ---------------------------------------------------------------------------
// Resolving dx / ou / pe items given by name
// ---------------------------------------------------------------------------

interface TypedCandidate extends INamedCandidate {
	readonly type: string;
	readonly extra?: string;
}

function describeCandidate(c: TypedCandidate): string {
	return `"${c.name}" (${c.type}, \`${c.uid}\`${c.extra ? `, ${c.extra}` : ''})`;
}

/**
 * Turns the dx/ou/pe items the AI passed -- uids, DHIS2 keywords, or plain names -- into analytics ids, recording how
 * each name was resolved (`notes`) and what could not be (`problems`, e.g. an ambiguous name with its candidates).
 * Names are looked up in DataSuite's metadata copy; a unique exact match wins, a single search hit is accepted with a
 * note.
 */
class ItemResolver {
	readonly notes: string[] = [];
	readonly problems: string[] = [];

	constructor(private readonly connectionId: string) { }

	private record(query: string, match: TypedCandidate, how: 'exact' | 'onlyResult', id: string): string {
		this.notes.push(`"${query}" -> ${describeCandidate(match)}${how === 'onlyResult' ? ' -- the only search hit, not an exact name match; check it is what was meant' : ''}`);
		return id;
	}

	private ambiguous(query: string, candidates: TypedCandidate[]): void {
		this.problems.push(`"${query}" is ambiguous -- candidates: ${candidates.slice(0, MAX_CANDIDATES).map(describeCandidate).join('; ')}${candidates.length > MAX_CANDIDATES ? ` (+${candidates.length - MAX_CANDIDATES} more)` : ''}. Pass the uid you mean.`);
	}

	async dx(items: readonly string[]): Promise<string[]> {
		const K = meta.kind();
		const out: string[] = [];
		for (const raw of items) {
			const item = classifyDimensionItem(raw, 'dx');
			if (item.kind === 'id') {
				out.push(item.value);
				continue;
			}
			if (item.kind !== 'name') {
				this.problems.push(`"${raw}" is not a data item.`);
				continue;
			}
			let candidates: TypedCandidate[];
			if (item.metric) {
				const ds = await meta.search(this.connectionId, K.DataSet, item.name, { limit: 10 });
				candidates = ds.rows.map(r => ({ ...r, type: 'data set' }));
			} else {
				const [ind, de] = await Promise.all([
					meta.search(this.connectionId, K.Indicator, item.name, { limit: 10 }),
					meta.search(this.connectionId, K.DataElement, item.name, { limit: 10 })
				]);
				candidates = [...ind.rows.map(r => ({ ...r, type: 'indicator' })), ...de.rows.map(r => ({ ...r, type: 'data element' }))];
			}
			const pick = pickNameMatch(item.name, candidates);
			if (pick.kind === 'match') {
				out.push(this.record(raw, pick.match, pick.how, item.metric ? `${pick.match.uid}.${item.metric}` : pick.match.uid));
			} else if (pick.kind === 'ambiguous') {
				this.ambiguous(raw, pick.candidates);
			} else {
				this.problems.push(`No ${item.metric ? 'data set' : 'indicator or data element'} named "${item.name}" -- find it with dhis2_searchMetadata.`);
			}
		}
		return out;
	}

	async ou(items: readonly string[]): Promise<string[]> {
		const out: string[] = [];
		for (const raw of items) {
			const item = classifyDimensionItem(raw, 'ou');
			switch (item.kind) {
				case 'id':
					out.push(item.value);
					break;
				case 'levelNumber':
					out.push(`LEVEL-${item.level}`);
					break;
				case 'levelName': {
					const levels = await meta.levels(this.connectionId);
					const level = levels.find(l => l.name.trim().toLowerCase() === item.name.toLowerCase());
					if (level) {
						this.notes.push(`"${raw}" -> LEVEL-${level.level} (${level.name})`);
						out.push(`LEVEL-${level.level}`);
					} else {
						this.problems.push(`No org unit level named "${item.name}". Levels: ${levels.map(l => `${l.level} = ${l.name}`).join(', ')}.`);
					}
					break;
				}
				case 'groupName': {
					const response = await vscode.dhis2.read(this.connectionId, { path: 'organisationUnitGroups', query: { filter: `identifiable:token:${item.name}`, fields: 'id,displayName,code', pageSize: 20 } }) as { organisationUnitGroups?: { id: string; displayName?: string; code?: string }[] };
					const candidates: TypedCandidate[] = (response.organisationUnitGroups ?? []).map(g => ({ uid: g.id, name: g.displayName ?? g.id, code: g.code, type: 'org unit group' }));
					const pick = pickNameMatch(item.name, candidates);
					if (pick.kind === 'match') {
						out.push(this.record(raw, pick.match, pick.how, `OU_GROUP-${pick.match.uid}`));
					} else if (pick.kind === 'ambiguous') {
						this.ambiguous(raw, pick.candidates);
					} else {
						this.problems.push(`No org unit group named "${item.name}" -- try dhis2_searchMetadata type orgUnitGroups.`);
					}
					break;
				}
				default: {
					const result = await meta.search(this.connectionId, meta.kind().OrganisationUnit, item.name, { limit: 10 });
					const candidates: TypedCandidate[] = result.rows.map(r => ({ ...r, type: `org unit, level ${r.level ?? '?'}`, extra: r.pathNames }));
					const pick = pickNameMatch(item.name, candidates);
					if (pick.kind === 'match') {
						out.push(this.record(raw, pick.match, pick.how, pick.match.uid));
					} else if (pick.kind === 'ambiguous') {
						this.ambiguous(raw, pick.candidates);
					} else {
						this.problems.push(`No org unit named "${item.name}" -- find it with dhis2_searchMetadata type orgUnits.`);
					}
				}
			}
		}
		return out;
	}

	pe(items: readonly string[]): string[] {
		const out: string[] = [];
		for (const raw of items) {
			const pe = normalizePeriodId(raw);
			if (isValidPeriodId(pe)) {
				out.push(pe);
				if (pe !== raw.trim()) {
					this.notes.push(`period "${raw}" -> ${pe}`);
				}
			} else {
				this.problems.push(`"${raw}" is not a DHIS2 period. ${DHIS2_PERIOD_GRAMMAR}`);
			}
		}
		return out;
	}

	/** A `dim:item;item` filter/dimension string with its dx/ou/pe items resolved; other dimensions pass through. */
	async dimensionString(spec: string): Promise<string | undefined> {
		const at = spec.indexOf(':');
		if (at <= 0) {
			this.problems.push(`Filter "${spec}" must look like "pe:2024" or "ou:LEVEL-2".`);
			return undefined;
		}
		const dim = spec.slice(0, at).trim();
		const items = spec.slice(at + 1).split(';').map(s => s.trim()).filter(Boolean);
		const resolved = dim === 'dx' ? await this.dx(items) : dim === 'ou' ? await this.ou(items) : dim === 'pe' ? this.pe(items) : items;
		return resolved.length ? `${dim}:${resolved.join(';')}` : undefined;
	}
}

function problemResult(resolver: ItemResolver): ToolOutput {
	const lines = ['Nothing was queried -- some items need fixing first:', ...resolver.problems.map(p => `- ${p}`)];
	if (resolver.notes.length) {
		lines.push('', 'Resolved so far:', ...resolver.notes.map(n => `- ${n}`));
	}
	return { text: lines.join('\n'), rows: 0 };
}

function notesBlock(resolver: ItemResolver): string[] {
	return resolver.notes.length ? ['Resolved:', ...resolver.notes.map(n => `- ${n}`), ''] : [];
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

interface GetOrgUnitLevelsInput { profileId?: string }

interface QueryAnalyticsInput {
	profileId?: string;
	dx: string[];
	pe?: string[];
	ou?: string[];
	filters?: string[];
	displayProperty?: 'NAME' | 'SHORTNAME';
	aggregationType?: string;
	saveAs?: string;
	maxRows?: number;
}

interface ReportingCompletenessInput {
	profileId?: string;
	dataSet: string;
	pe: string[];
	ou?: string[];
	level?: string | number;
	byPeriod?: boolean;
	maxRows?: number;
}

interface GetDataValuesInput {
	profileId?: string;
	dataSet?: string;
	dataElements?: string[];
	periods?: string[];
	startDate?: string;
	endDate?: string;
	orgUnits: string[];
	children?: boolean;
	maxRows?: number;
}

interface RawDataValue {
	dataElement: string;
	period: string;
	orgUnit: string;
	categoryOptionCombo?: string;
	attributeOptionCombo?: string;
	value?: string;
	storedBy?: string;
	lastUpdated?: string;
	comment?: string;
}

export function queryTools(deps: ToolDeps): ToolDefinition<never>[] {

	const getOrgUnitLevels: ToolDefinition<GetOrgUnitLevelsInput> = {
		name: 'dhis2_getOrgUnitLevels',
		usesProfile: true,
		invocationMessage: () => 'Reading org unit levels…',
		async invoke(_input, { connectionId }) {
			const levels = await meta.levels(connectionId);
			if (!levels.length) {
				return { text: 'No org unit levels are known for this server yet.', rows: 0 };
			}
			const lines = ['| Level | Name | Org units | Use as |', '| ---: | --- | ---: | --- |'];
			for (const l of [...levels].sort((a, b) => a.level - b.level)) {
				lines.push(`| ${l.level} | ${l.name} | ${l.count ?? 0} | \`LEVEL-${l.level}\` |`);
			}
			return { text: lines.join('\n'), rows: levels.length };
		}
	};

	const queryAnalyticsTool: ToolDefinition<QueryAnalyticsInput> = {
		name: 'dhis2_queryAnalytics',
		usesProfile: true,
		invocationMessage: () => 'Querying DHIS2 analytics…',
		async invoke(input, { connectionId }: ToolCall, token) {
			const resolver = new ItemResolver(connectionId);
			const dx = await resolver.dx(input.dx ?? []);
			const filters: string[] = [];
			for (const f of input.filters ?? []) {
				const resolved = await resolver.dimensionString(f);
				if (resolved) {
					filters.push(resolved);
				}
			}
			const peFiltered = filters.some(f => f.startsWith('pe:'));
			const ouFiltered = filters.some(f => f.startsWith('ou:'));
			const pe = resolver.pe(input.pe ?? []);
			const ou = await resolver.ou(input.ou?.length ? input.ou : (ouFiltered ? [] : ['USER_ORGUNIT']));

			if (!dx.length && !resolver.problems.length) {
				resolver.problems.push('dx is empty -- give at least one data element, indicator or data set metric.');
			}
			if (!pe.length && !peFiltered && !resolver.problems.length) {
				resolver.problems.push(`No period given. ${DHIS2_PERIOD_GRAMMAR}`);
			}
			if (resolver.problems.length) {
				return problemResult(resolver);
			}

			const dimensions = [`dx:${dx.join(';')}`];
			if (pe.length) {
				dimensions.push(`pe:${pe.join(';')}`);
			}
			if (ou.length) {
				dimensions.push(`ou:${ou.join(';')}`);
			}
			const response = await analyticsQuery(connectionId, { dimensions, filters, displayProperty: input.displayProperty, aggregationType: input.aggregationType }, token);
			const tidy = analyticsToTidyTable(response, await vscode.dhis2.metadata.getCalendar(connectionId));
			const query = `dimension=${dimensions.join(' & dimension=')}${filters.length ? ` & filter=${filters.join(' & filter=')}` : ''}`;
			const lines = [...notesBlock(resolver)];

			if (!tidy.rows.length) {
				lines.push('No values: DHIS2 returns no row where nothing was reported. Check the periods and org units, whether the item has data at all (dhis2_getLastDataPeriod), and that the server\'s analytics tables were generated after the data was entered.', '', `Query: ${query}`);
				return { text: lines.join('\n'), rows: 0 };
			}

			const { markdown, omitted } = formatAnalyticsTable(tidy, clampRows(input.maxRows));
			lines.push(markdown);
			if (omitted > 0) {
				lines.push('', `${omitted} more row(s) not shown -- all ${tidy.rows.length} are in the CSV below.`);
			}
			const label = input.saveAs || String(tidy.rows[0].dx_name ?? 'dhis2_analytics');
			const file = await writeDataFile(deps.storageUri, label, tidy);
			lines.push('', describeDataFile(file, tidy), '', `Query: ${query}`);
			return { text: lines.join('\n'), rows: tidy.rows.length };
		}
	};

	const reportingCompleteness: ToolDefinition<ReportingCompletenessInput> = {
		name: 'dhis2_reportingCompleteness',
		usesProfile: true,
		invocationMessage: input => `Querying reporting rates for ${input.dataSet}…`,
		async invoke(input, { connectionId }, token) {
			const resolver = new ItemResolver(connectionId);
			const K = meta.kind();
			let dataSetUid: string | undefined;
			let dataSetName = input.dataSet;
			if (DHIS2_UID.test(input.dataSet.trim())) {
				dataSetUid = input.dataSet.trim();
				dataSetName = (await meta.get(connectionId, K.DataSet, [dataSetUid]))[0]?.name ?? dataSetUid;
			} else {
				const found = await meta.search(connectionId, K.DataSet, input.dataSet, { limit: 10 });
				const pick = pickNameMatch(input.dataSet, found.rows);
				if (pick.kind === 'match') {
					dataSetUid = pick.match.uid;
					dataSetName = pick.match.name;
					resolver.notes.push(`"${input.dataSet}" -> data set "${pick.match.name}" (\`${pick.match.uid}\`)${pick.how === 'onlyResult' ? ' -- the only search hit; check it is the right form' : ''}`);
				} else if (pick.kind === 'ambiguous') {
					resolver.problems.push(`Data set "${input.dataSet}" is ambiguous -- candidates: ${pick.candidates.slice(0, MAX_CANDIDATES).map(d => `"${d.name}" (\`${d.uid}\`${d.periodType ? `, ${d.periodType}` : ''})`).join('; ')}.`);
				} else {
					resolver.problems.push(`No data set named "${input.dataSet}" -- find it with dhis2_searchMetadata type dataSets.`);
				}
			}
			const pe = resolver.pe(input.pe ?? []);
			const ou = await resolver.ou(input.ou?.length ? input.ou : ['USER_ORGUNIT']);
			if (input.level !== undefined && input.level !== '') {
				ou.push(...await resolver.ou([typeof input.level === 'number' || /^\d+$/.test(String(input.level)) ? `LEVEL-${input.level}` : String(input.level).replace(/^(?!LEVEL[-_ ])/i, 'LEVEL-')]));
			}
			if (!pe.length && !resolver.problems.length) {
				resolver.problems.push(`No period given. ${DHIS2_PERIOD_GRAMMAR}`);
			}
			if (resolver.problems.length || !dataSetUid) {
				return problemResult(resolver);
			}

			const metrics = ['EXPECTED_REPORTS', 'ACTUAL_REPORTS', 'REPORTING_RATE'];
			const dimensions = [`dx:${metrics.map(m => `${dataSetUid}.${m}`).join(';')}`, `ou:${ou.join(';')}`];
			const filters: string[] = [];
			if (input.byPeriod) {
				dimensions.push(`pe:${pe.join(';')}`);
			} else {
				filters.push(`pe:${pe.join(';')}`);
			}
			const response = await analyticsQuery(connectionId, { dimensions, filters }, token);
			const tidy = analyticsToTidyTable(response, await vscode.dhis2.metadata.getCalendar(connectionId));
			const table = pivotReporting(tidy, dataSetUid, !!input.byPeriod);
			const lines = [...notesBlock(resolver), `## Reporting completeness: ${dataSetName} (${pe.join(', ')})`, ''];

			if (!table.rows.length) {
				lines.push('No reporting data: the data set may not be assigned to these org units, the periods may not match its period type, or analytics tables may be out of date.');
				return { text: lines.join('\n'), rows: 0 };
			}

			const expected = table.rows.reduce((sum, r) => sum + (typeof r.expected === 'number' ? r.expected : 0), 0);
			const actual = table.rows.reduce((sum, r) => sum + (typeof r.actual === 'number' ? r.actual : 0), 0);
			lines.push(`Overall: ${actual} of ${expected} expected reports received (${expected ? (actual / expected * 100).toFixed(1) : '-'}%), ${Math.max(0, expected - actual)} missing, across ${table.rows.length} row(s).`, '');

			const maxRows = clampRows(input.maxRows);
			lines.push('| Org unit |' + (input.byPeriod ? ' Period |' : '') + ' Expected | Received | Rate % | Missing |', '| --- |' + (input.byPeriod ? ' --- |' : '') + ' ---: | ---: | ---: | ---: |');
			for (const r of table.rows.slice(0, maxRows)) {
				lines.push(`| ${r.ou_name} |${input.byPeriod ? ` ${r.pe_name} |` : ''} ${r.expected ?? ''} | ${r.actual ?? ''} | ${r.rate ?? ''} | ${r.missing ?? ''} |`);
			}
			if (table.rows.length > maxRows) {
				lines.push('', `${table.rows.length - maxRows} more row(s) in the CSV.`);
			}
			const silent = table.rows.filter(r => typeof r.expected === 'number' && r.expected > 0 && !r.actual);
			if (silent.length) {
				const names = silent.slice(0, 50).map(r => `${r.ou_name}${input.byPeriod ? ` (${r.pe_name})` : ''}`);
				lines.push('', `**Sent no reports (${silent.length}):** ${names.join(', ')}${silent.length > 50 ? ', ...' : ''}`);
			}
			const file = await writeDataFile(deps.storageUri, `${dataSetName}_reporting`, table);
			lines.push('', describeDataFile(file, table));
			return { text: lines.join('\n'), rows: table.rows.length };
		}
	};

	const getDataValues: ToolDefinition<GetDataValuesInput> = {
		name: 'dhis2_getDataValues',
		usesProfile: true,
		invocationMessage: () => 'Reading DHIS2 data values…',
		async invoke(input, { connectionId }, token) {
			const K = meta.kind();
			const resolver = new ItemResolver(connectionId);
			const query: Record<string, vscode.Dhis2QueryValue> = {};
			if (input.dataSet) {
				const [ds] = await resolver.dx([`${input.dataSet}.REPORTING_RATE`]);
				if (ds) {
					query.dataSet = ds.replace(/\.REPORTING_RATE$/, '');
				}
			}
			const dataElements: string[] = [];
			if (input.dataElements?.length) {
				for (const item of input.dataElements) {
					const cls = classifyDimensionItem(item, 'dx');
					if (cls.kind === 'id') {
						dataElements.push(cls.value);
						continue;
					}
					const found = await meta.search(connectionId, K.DataElement, item, { limit: 10 });
					const pick = pickNameMatch(item, found.rows);
					if (pick.kind === 'match') {
						resolver.notes.push(`"${item}" -> data element "${pick.match.name}" (\`${pick.match.uid}\`)`);
						dataElements.push(pick.match.uid);
					} else if (pick.kind === 'ambiguous') {
						resolver.problems.push(`"${item}" is ambiguous -- candidates: ${pick.candidates.slice(0, MAX_CANDIDATES).map(d => `"${d.name}" (\`${d.uid}\`)`).join('; ')}.`);
					} else {
						resolver.problems.push(`No data element named "${item}".`);
					}
				}
				query.dataElement = dataElements;
			}
			const orgUnits = await resolver.ou(input.orgUnits ?? []);
			query.orgUnit = orgUnits;
			if (input.periods?.length) {
				query.period = resolver.pe(input.periods);
			} else if (input.startDate && input.endDate) {
				query.startDate = input.startDate;
				query.endDate = input.endDate;
			} else {
				resolver.problems.push('Give periods, or startDate and endDate.');
			}
			if (!query.dataSet && !dataElements.length && !resolver.problems.length) {
				resolver.problems.push('Give a dataSet and/or dataElements.');
			}
			if (!orgUnits.length && !resolver.problems.length) {
				resolver.problems.push('Give at least one org unit.');
			}
			if (resolver.problems.length) {
				return problemResult(resolver);
			}
			if (input.children) {
				query.children = true;
			}

			const response = await vscode.dhis2.read(connectionId, { path: 'dataValueSets', query }, token) as { dataValues?: RawDataValue[] };
			const values = response.dataValues ?? [];
			const lines = [...notesBlock(resolver)];
			if (!values.length) {
				lines.push('No data values stored for these items, org units and periods.');
				return { text: lines.join('\n'), rows: 0 };
			}

			const uniq = (xs: (string | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => !!x)));
			const [des, cocs, ous] = await Promise.all([
				meta.get(connectionId, K.DataElement, uniq(values.map(v => v.dataElement))),
				meta.get(connectionId, K.CategoryOptionCombo, uniq(values.flatMap(v => [v.categoryOptionCombo, v.attributeOptionCombo]))),
				meta.get(connectionId, K.OrganisationUnit, uniq(values.map(v => v.orgUnit)))
			]);
			const deName = new Map(des.map(d => [d.uid, d.name]));
			const cocName = new Map(cocs.map(c => [c.uid, c.name]));
			const ouById = new Map(ous.map(o => [o.uid, o]));

			const rows: TidyRow[] = values.map(v => {
				const ou = ouById.get(v.orgUnit);
				const n = Number(v.value);
				return {
					ou_uid: v.orgUnit, ou_name: ou?.name ?? v.orgUnit, ou_path: ou?.pathNames ?? null,
					pe: v.period,
					dx_uid: v.dataElement, dx_name: deName.get(v.dataElement) ?? v.dataElement,
					coc_uid: v.categoryOptionCombo ?? null, coc_name: v.categoryOptionCombo ? (cocName.get(v.categoryOptionCombo) ?? v.categoryOptionCombo) : null,
					aoc_uid: v.attributeOptionCombo ?? null,
					value: v.value === undefined || v.value === '' ? null : Number.isFinite(n) ? n : v.value,
					stored_by: v.storedBy ?? null, last_updated: v.lastUpdated ?? null, comment: v.comment ?? null
				};
			});
			rows.sort((a, b) => String(a.dx_name).localeCompare(String(b.dx_name)) || String(a.ou_name).localeCompare(String(b.ou_name)) || String(a.pe).localeCompare(String(b.pe)) || String(a.coc_name ?? '').localeCompare(String(b.coc_name ?? '')));
			const table: ITidyTable = { columns: ['ou_uid', 'ou_name', 'ou_path', 'pe', 'dx_uid', 'dx_name', 'coc_uid', 'coc_name', 'aoc_uid', 'value', 'stored_by', 'last_updated', 'comment'], rows };

			const maxRows = clampRows(input.maxRows);
			lines.push('| Data element | Category | Org unit | Period | Value |', '| --- | --- | --- | --- | ---: |');
			for (const r of rows.slice(0, maxRows)) {
				lines.push(`| ${r.dx_name} | ${r.coc_name && r.coc_name !== 'default' ? r.coc_name : ''} | ${r.ou_name} | ${r.pe} | ${r.value ?? ''} |`);
			}
			if (rows.length > maxRows) {
				lines.push('', `${rows.length - maxRows} more value(s) not shown -- all ${rows.length} are in the CSV.`);
			}
			const file = await writeDataFile(deps.storageUri, `${input.dataSet ?? input.dataElements?.[0] ?? 'data'}_values`, table);
			lines.push('', describeDataFile(file, table));
			return { text: lines.join('\n'), rows: rows.length };
		}
	};

	return [getOrgUnitLevels, queryAnalyticsTool, reportingCompleteness, getDataValues] as ToolDefinition<never>[];
}
