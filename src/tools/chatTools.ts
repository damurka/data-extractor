/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the DHIS2 chat tools for connections, metadata, mappings and downloads
 *  Ported from DataSuite (contrib/dhis2/browser/tools/dhis2ChatTools.ts); same names, inputs and descriptions, so the
 *  assistant's instructions and saved prompts keep working.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { appendIndicatorSummary, IMappingIndicatorInput, IMappingSourceInput, normalizeAdminLevel, summarizeMappingChanges, summarizeReusedSources, validateIndicatorReasoning } from '../core/chatTools';
import { COUNTDOWN_INDICATORS, findIndicatorCategoryMismatch } from '../core/countdown';
import { classifyDhis2Error } from '../core/dhis2Errors';
import { validateDhis2RawPath } from '../core/dhis2Paths';
import { summarizeJson } from '../core/dataUtils';
import { parseIsoDateParts } from '../core/periods';
import { IAddMappingDraft, IDhis2DownloadHistoryRow, IDhis2DownloadInProgressItem, IIndicatorDraft, IIndicatorSourceDraft, MappingMode } from '../core/types';
import { DownloadConfig, DownloadOutcome } from '../download';
import { describeDataFile, meta, MetaRow, resolveConnection, ToolDefinition, ToolDeps, writeDataFile } from './support';

type MetadataType = 'dataElements' | 'indicators' | 'orgUnits' | 'dataSets' | 'dataElementGroups' | 'orgUnitGroups';

/** How long a search waits for DataSuite's first metadata sync before answering from the live server instead. */
const COLD_CACHE_WAIT_MS = 30_000;
/** Responses larger than this are summarised (keys, pager, first items) instead of dumped into the conversation. */
const RAW_QUERY_MAX_CHARS = 12_000;
/** Page size for list endpoints when the caller sets neither pageSize nor paging. */
const RAW_QUERY_DEFAULT_PAGE_SIZE = 50;

const notFound = (mappingId: string) => `Mapping "${mappingId}" not found. Use dhis2_getMappings to list available mappings.`;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

interface WithProfile { profileId?: string }
interface SearchMetadataInput extends WithProfile { type: MetadataType; query: string; limit?: number; offset?: number; level?: number; detail?: boolean }
interface DataElementInput extends WithProfile { dataElementUid: string }
interface DataSetInput extends WithProfile { dataSetUid: string }
interface GroupInput extends WithProfile { groupUid: string }
interface DxInput extends WithProfile { dxUid: string }
interface IndicatorInput extends WithProfile { indicatorUid: string }
interface MappingIdInput extends WithProfile { mappingId: string }
interface DownloadInstructionsInput extends MappingIdInput { startDate?: string; endDate?: string; periodType?: 'monthly' | 'yearly'; adminLevel?: string }
interface CreateMappingInput extends WithProfile { name: string; description?: string; mode: MappingMode; indicators: IMappingIndicatorInput[] }
interface UpdateMappingInput extends WithProfile { mappingId: string; name?: string; description?: string; mode?: MappingMode; indicators?: IMappingIndicatorInput[] }
interface StartDownloadInput extends WithProfile {
	mappingId?: string;
	mappingName?: string;
	mode?: MappingMode;
	indicators?: IMappingIndicatorInput[];
	startDate: string;
	endDate: string;
	periodType: 'monthly' | 'yearly';
	adminLevel: string;
	boundaryOrgUnitUid?: string;
	resumeTaskId?: string;
}
interface DownloadStatusInput extends WithProfile { taskId?: string }
interface RawQueryInput extends WithProfile { path: string; query?: Record<string, unknown> }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** One search hit: a compact line, or with `detail` the descriptive fields a mapping judgement needs. */
function formatSearchRow(type: MetadataType, row: MetaRow, detail: boolean): string[] {
	const code = row.code ? ` code ${row.code}` : '';
	if (type === 'orgUnits') {
		const out = [`- **${row.name}** \`${row.uid}\`${code}${row.level ? ` | level ${row.level}` : ''}${row.pathNames ? ` | ${row.pathNames}` : ''}`];
		if (detail && row.geometryType) {
			out.push(`  - Geometry: ${row.geometryType}`);
		}
		return out;
	}
	if (type === 'dataElementGroups') {
		const out = [`- **${row.name}** \`${row.uid}\`${code}`];
		if (detail && row.description) {
			out.push(`  - Description: ${row.description}`);
		}
		return out;
	}
	const head = `- **${row.name}** \`${row.uid}\`${code}${type === 'dataSets' && row.periodType ? ` | ${row.periodType}` : ''}${type === 'dataElements' && row.formName && row.formName !== row.name ? ` | form: ${row.formName}` : ''}`;
	if (!detail) {
		return [head];
	}
	const out = [head];
	if (row.displayName && row.displayName !== row.name) {
		out.push(`  - Display name: ${row.displayName}`);
	}
	if (row.description) {
		out.push(`  - Description: ${row.description}`);
	}
	if (type === 'dataElements') {
		out.push(`  - Disaggregation: ${row.categoryComboIsDefault ? 'none (default category combo)' : `category combo ${row.categoryComboUid ?? '?'} -- see dhis2_getCategoryOptionCombos`}`);
		if (row.groupInfo) {
			out.push(`  - Groups: ${row.groupInfo.split('\n').join('; ')}`);
		}
	}
	if (type === 'indicators') {
		if (row.numerator) {
			out.push(`  - Numerator: \`${row.numerator}\`${row.numeratorDescription ? ` -- ${row.numeratorDescription}` : ''}`);
		}
		if (row.denominator) {
			out.push(`  - Denominator: \`${row.denominator}\`${row.denominatorDescription ? ` -- ${row.denominatorDescription}` : ''}`);
		}
	}
	if (row.lastUpdated) {
		out.push(`  - Last updated: ${row.lastUpdated}`);
	}
	return out;
}

/** Data elements as the dataset/group tools list them. */
function elementLines(rows: readonly MetaRow[], withGroups: boolean): string[] {
	const lines: string[] = [];
	for (const r of rows) {
		lines.push(`- **${r.name}**${r.displayName && r.displayName !== r.name ? ` (displayName: ${r.displayName})` : ''} (uid: \`${r.uid}\`${r.code ? `, code: ${r.code}` : ''})`);
		if (r.formName && r.formName !== r.name) {
			lines.push(`  - Form name: ${r.formName}`);
		}
		if (r.description) {
			lines.push(`  - Description: ${r.description}`);
		}
		if (withGroups && r.groupInfo) {
			lines.push(`  - Groups: ${r.groupInfo.split('\n').join('; ')}`);
		}
		if (r.lastUpdated) {
			lines.push(`  - Last updated: ${r.lastUpdated}`);
		}
	}
	return lines;
}

/** A source as the mapping editor would save it: a "Data Element" source with its category option combos looked up. */
async function buildSourceDraft(connectionId: string, src: IMappingSourceInput): Promise<IIndicatorSourceDraft> {
	const base: IIndicatorSourceDraft = { id: src.id, sourceElement: src.sourceElement, type: src.type, includedCategoriesText: src.includedCategoriesText ?? 'All Category Options', origin: 'ai' };
	if (src.type !== 'Data Element') {
		return base;
	}
	const [deRows, cocs] = await Promise.all([
		meta.get(connectionId, meta.kind().DataElement, [src.id]),
		meta.related(connectionId, meta.relation().CategoryOptionCombos, src.id)
	]);
	const isCustomSelection = !!src.cocUids && src.cocUids.length !== cocs.length;
	return {
		...base,
		includedCategoriesText: src.includedCategoriesText ?? (isCustomSelection ? 'Custom Selection' : 'All Category Options'),
		cocs: cocs.map(c => ({ uid: c.uid, name: c.name, categoryComboUid: c.categoryComboUid ?? null, checked: src.cocUids ? src.cocUids.includes(c.uid) : true })),
		categoryComboIsDefault: deRows[0]?.categoryComboIsDefault
	};
}

async function buildMappingDraft(connectionId: string, name: string, description: string | undefined, mode: MappingMode, indicators: readonly IMappingIndicatorInput[]): Promise<IAddMappingDraft> {
	return {
		name,
		description,
		mode,
		indicators: await Promise.all(indicators.map(async (ind): Promise<IIndicatorDraft> => ({
			id: randomUUID(),
			internalName: ind.internalName,
			exportCode: ind.exportCode,
			kind: mode,
			sources: await Promise.all(ind.sources.map(src => buildSourceDraft(connectionId, src)))
		})))
	};
}

async function adminLevel(connectionId: string, value: string) {
	return normalizeAdminLevel(await meta.levels(connectionId), value);
}

function confirmation(title: string, message: string): vscode.PreparedToolInvocation {
	return { confirmationMessages: { title, message: new vscode.MarkdownString(message) } };
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

export function chatTools(deps: ToolDeps): ToolDefinition<never>[] {
	const { store, runner } = deps;
	const K = () => meta.kind();
	const R = () => meta.relation();

	const getProfiles: ToolDefinition<WithProfile> = {
		name: 'dhis2_getProfiles',
		usesProfile: false,
		invocationMessage: () => 'Listing DHIS2 connections…',
		async invoke() {
			const connections = await vscode.dhis2.getConnections();
			if (!connections.length) {
				return { text: 'No DHIS2 connections. Ask the user to sign in to a DHIS2 server in the Data Extractor (DHIS2: Open Data Extractor).' };
			}
			const sorted = [...connections.filter(c => c.granted), ...connections.filter(c => !c.granted)];
			const lines = ['## DHIS2 Connections\n'];
			for (const c of sorted) {
				lines.push(`- **${c.displayName}** (ID: \`${c.id}\`)`);
				lines.push(`  - Server: ${c.serverUrl}`);
				lines.push(`  - Username: ${c.username}`);
				if (c.country) {
					lines.push(`  - Country: ${c.country}`);
				}
				if (c.dhis2Version) {
					lines.push(`  - DHIS2 version: ${c.dhis2Version}`);
				}
				lines.push(`  - Data Extractor access: ${c.granted ? 'given' : 'not yet (the user is asked on first use)'}`);
			}
			lines.push(`\nTools use **${sorted[0].displayName}** (\`${sorted[0].id}\`) when no profileId is given.`);
			if (sorted.some(c => c.serverUrl.trim().toLowerCase().startsWith('http://'))) {
				lines.push('Note: a connection uses plain http:// -- its credentials and data travel unencrypted.');
			}
			return { text: lines.join('\n') };
		}
	};

	const searchMetadata: ToolDefinition<SearchMetadataInput> = {
		name: 'dhis2_searchMetadata',
		usesProfile: true,
		invocationMessage: input => `Searching DHIS2 ${input.type} for "${input.query}"…`,
		async invoke(input, { connectionId }, token) {
			const limit = Math.max(1, Math.min(input.limit ?? 20, 500));
			const offset = Math.max(0, input.offset ?? 0);
			const type = input.type;

			/** Server-side search (`identifiable:token:`) for org unit groups, and for any type while the local copy is still syncing. */
			const searchLive = async (note: string | undefined) => {
				const resource: Record<MetadataType, string> = { dataElements: 'dataElements', indicators: 'indicators', dataSets: 'dataSets', dataElementGroups: 'dataElementGroups', orgUnits: 'organisationUnits', orgUnitGroups: 'organisationUnitGroups' };
				const fields = type === 'orgUnits' ? 'id,displayName,code,level,ancestors[displayName]' : type === 'dataSets' ? 'id,displayName,code,periodType' : 'id,displayName,code';
				const page = Math.floor(offset / limit) + 1;
				const response = await vscode.dhis2.read(connectionId, { path: resource[type], query: { filter: `identifiable:token:${input.query}`, fields, pageSize: limit, page, order: 'displayName:asc' } }, token) as { pager?: { total?: number }; [key: string]: unknown };
				const items = (Array.isArray(response[resource[type]]) ? response[resource[type]] : []) as { id: string; displayName?: string; code?: string; level?: number; periodType?: string; ancestors?: { displayName?: string }[] }[];
				const total = response.pager?.total ?? items.length;
				const lines: string[] = note ? [`_${note}_`, ''] : [];
				if (!items.length) {
					lines.push(`No ${type} found matching "${input.query}" on the server.`);
					return { text: lines.join('\n'), rows: 0 };
				}
				lines.push(`## ${type} matching "${input.query}" -- showing ${offset + 1}-${offset + items.length} of ${total} (searched the DHIS2 server directly)`, '');
				for (const it of items) {
					const extra = [it.code ? `code ${it.code}` : '', it.level ? `level ${it.level}` : '', it.periodType ?? '', it.ancestors?.length ? it.ancestors.map(a => a.displayName).join(' / ') : ''].filter(Boolean).join(' | ');
					lines.push(`- **${it.displayName ?? it.id}** \`${it.id}\`${extra ? ` -- ${extra}` : ''}`);
				}
				if (type === 'orgUnitGroups') {
					lines.push('', 'Use OU_GROUP-<uid> as an org unit in dhis2_queryAnalytics.');
				}
				return { text: lines.join('\n'), rows: items.length };
			};

			if (type === 'orgUnitGroups') {
				return searchLive(undefined);
			}
			const kinds: Record<Exclude<MetadataType, 'orgUnitGroups'>, vscode.Dhis2MetadataKind> = { dataElements: K().DataElement, indicators: K().Indicator, dataSets: K().DataSet, dataElementGroups: K().DataElementGroup, orgUnits: K().OrganisationUnit };
			const kind = kinds[type];
			if (kind === undefined) {
				return { text: `Unknown type "${type}". Use one of: dataElements, indicators, dataSets, dataElementGroups, orgUnits, orgUnitGroups.` };
			}
			// The first search of a kind waits for DataSuite to copy that metadata, which can take minutes on a big
			// server: answer from the live server instead if it takes too long
			const pending = meta.search(connectionId, kind, input.query, { limit, offset, level: type === 'orgUnits' ? input.level : undefined });
			pending.catch(() => { /* reported below when awaited; otherwise the live answer was used */ });
			let timer: NodeJS.Timeout | undefined;
			const result = await Promise.race([pending, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), COLD_CACHE_WAIT_MS); })]).finally(() => clearTimeout(timer));
			if (!result) {
				return searchLive('DataSuite is still copying this server\'s metadata; these results come straight from the server (name/code token match only). Retry shortly for the full search.');
			}

			if (!result.rows.length) {
				return {
					text: offset > 0 && result.total > 0
						? `No more ${type} for "${input.query}" -- all ${result.total} were already shown.`
						: `No ${type} found matching "${input.query}". Try a shorter or different term, another type, or ask the user for the name used on this server.`,
					rows: 0
				};
			}
			const lines = [
				`## ${type} matching "${input.query}" -- showing ${offset + 1}-${offset + result.rows.length} of ${result.total}`,
				'',
				...result.rows.flatMap(r => formatSearchRow(type, r, !!input.detail))
			];
			if (offset + result.rows.length < result.total) {
				lines.push('', `${result.total - offset - result.rows.length} more -- call again with offset: ${offset + result.rows.length}.`);
			}
			if (type === 'indicators') {
				lines.push('', 'dhis2_getIndicatorDataElements resolves an indicator formula to its data elements.');
			} else if (type === 'dataSets') {
				lines.push('', 'dhis2_getDataSetElements lists a data set\'s elements; dhis2_reportingCompleteness gives its reporting rates.');
			} else if (type === 'dataElementGroups') {
				lines.push('', 'dhis2_getGroupElements lists a group\'s elements.');
			}
			return { text: lines.join('\n'), rows: result.rows.length };
		}
	};

	const getCategoryOptionCombos: ToolDefinition<DataElementInput> = {
		name: 'dhis2_getCategoryOptionCombos',
		usesProfile: true,
		invocationMessage: () => 'Looking up categories…',
		async invoke(input, { connectionId }) {
			const [deRows, cocs] = await Promise.all([
				meta.get(connectionId, K().DataElement, [input.dataElementUid]),
				meta.related(connectionId, R().CategoryOptionCombos, input.dataElementUid)
			]);
			if (!deRows.length) {
				return { text: `No data element with uid \`${input.dataElementUid}\` in this server's metadata -- check the uid with dhis2_searchMetadata (uids are case-sensitive).` };
			}
			const name = deRows[0].name;
			if (deRows[0].categoryComboIsDefault) {
				return { text: `"${name}" uses the Default Category Combo -- it has no real disaggregation categories. Do not set "cocUids" for this source.` };
			}
			if (!cocs.length) {
				return { text: `No Category Option Combos found for "${name}" (uid: \`${input.dataElementUid}\`).` };
			}
			const lines = [`## Category Option Combos for "${name}"\n`, ...cocs.map(c => `- **${c.name}** (uid: \`${c.uid}\`)`)];
			lines.push(`\nPass a subset of these uids as this source's "cocUids" to restrict the mapping to just those categories, or omit "cocUids" entirely to include all ${cocs.length}.`);
			return { text: lines.join('\n') };
		}
	};

	const getDataSetElements: ToolDefinition<DataSetInput> = {
		name: 'dhis2_getDataSetElements',
		usesProfile: true,
		invocationMessage: () => 'Looking up dataset elements…',
		async invoke(input, { connectionId }) {
			const rows = await meta.related(connectionId, R().DataSetElements, input.dataSetUid);
			if (!rows.length) {
				return { text: `No data elements found for dataset uid \`${input.dataSetUid}\` -- either it has none, or the uid is wrong (double-check via dhis2_searchMetadata, type: "dataSets").` };
			}
			return { text: [`## Data Elements in dataset (uid: \`${input.dataSetUid}\`)\n`, ...elementLines(rows, true)].join('\n'), rows: rows.length };
		}
	};

	const getDataSetsForElement: ToolDefinition<DataElementInput> = {
		name: 'dhis2_getDataSetsForElement',
		usesProfile: true,
		invocationMessage: () => 'Looking up datasets for element…',
		async invoke(input, { connectionId }) {
			const rows = await meta.related(connectionId, R().DataSetsOfElement, input.dataElementUid);
			if (!rows.length) {
				return { text: `No datasets found containing data element uid \`${input.dataElementUid}\`.` };
			}
			return { text: [`## Datasets containing data element (uid: \`${input.dataElementUid}\`)\n`, ...rows.map(r => `- **${r.name}** (uid: \`${r.uid}\`${r.code ? `, code: ${r.code}` : ''})`)].join('\n'), rows: rows.length };
		}
	};

	const getGroupElements: ToolDefinition<GroupInput> = {
		name: 'dhis2_getGroupElements',
		usesProfile: true,
		invocationMessage: () => 'Looking up group elements…',
		async invoke(input, { connectionId }) {
			const rows = await meta.related(connectionId, R().GroupElements, input.groupUid);
			if (!rows.length) {
				return { text: `No data elements found for group uid \`${input.groupUid}\` -- either it has none, or the uid is wrong (double-check via dhis2_searchMetadata, type: "dataElementGroups").` };
			}
			return { text: [`## Data Elements in group (uid: \`${input.groupUid}\`)\n`, ...elementLines(rows, false)].join('\n'), rows: rows.length };
		}
	};

	const getLastDataPeriod: ToolDefinition<DxInput> = {
		name: 'dhis2_getLastDataPeriod',
		usesProfile: true,
		invocationMessage: () => 'Checking data recency…',
		async invoke(input, { connectionId }) {
			let lastPeriod: string | undefined;
			try {
				lastPeriod = await vscode.dhis2.metadata.getLastDataPeriod(connectionId, input.dxUid);
			} catch (error) {
				return { text: `Could not check data recency for uid \`${input.dxUid}\`: ${error instanceof Error ? error.message : String(error)}` };
			}
			return {
				text: lastPeriod
					? `uid \`${input.dxUid}\` last has reported data in period **${lastPeriod}**.`
					: `No reported data found for uid \`${input.dxUid}\` in the last 5 years. Check its lastUpdated: very recent suggests a newly introduced item with no data yet, an old one suggests it is genuinely abandoned.`
			};
		}
	};

	const getIndicatorDataElements: ToolDefinition<IndicatorInput> = {
		name: 'dhis2_getIndicatorDataElements',
		usesProfile: true,
		invocationMessage: () => 'Resolving indicator formula…',
		async invoke(input, { connectionId }) {
			const operands = (await meta.related(connectionId, R().IndicatorOperands, input.indicatorUid)).map(o => ({ dataElementId: o.dataElementUid ?? o.uid, cocId: o.cocUid }));
			if (!operands.length) {
				return { text: `No resolved data elements found for indicator uid \`${input.indicatorUid}\`.` };
			}
			const [[indicator], dataElements, cocs] = await Promise.all([
				meta.get(connectionId, K().Indicator, [input.indicatorUid]),
				meta.get(connectionId, K().DataElement, Array.from(new Set(operands.map(op => op.dataElementId)))),
				meta.get(connectionId, K().CategoryOptionCombo, Array.from(new Set(operands.map(op => op.cocId).filter((c): c is string => !!c))))
			]);
			const deName = new Map(dataElements.map(d => [d.uid, d.name]));
			const cocName = new Map(cocs.map(c => [c.uid, c.name]));
			const lines = [`## Data elements behind indicator ${indicator ? `"${indicator.name}" ` : ''}(uid: \`${input.indicatorUid}\`)\n`];
			for (const op of operands) {
				lines.push(`- **${deName.get(op.dataElementId) ?? op.dataElementId}** (uid: \`${op.dataElementId}\`)`);
				if (op.cocId) {
					lines.push(`  - Category Option Combo: ${cocName.get(op.cocId) ?? op.cocId} (uid: \`${op.cocId}\`)`);
				}
			}
			return { text: lines.join('\n'), rows: operands.length };
		}
	};

	const getMappings: ToolDefinition<WithProfile> = {
		name: 'dhis2_getMappings',
		usesProfile: true,
		invocationMessage: () => 'Loading mappings…',
		async invoke(_input, { connectionId }) {
			const mappings = await store.listMappings(connectionId);
			if (!mappings.length) {
				return { text: 'No mappings saved for this connection. Create one with dhis2_createMapping, or in the Data Extractor (Mappings > New Mapping).' };
			}
			const lines = [`## Saved Mappings (connection \`${connectionId}\`)\n`];
			for (const m of mappings) {
				lines.push(`- **${m.name}** (ID: \`${m.id}\`)`, `  - Mode: ${m.mode}`, `  - Indicators: ${m.indicatorsCount}`);
				if (m.description) {
					lines.push(`  - Description: ${m.description}`);
				}
				lines.push(`  - Last updated: ${new Date(m.lastUpdatedAt).toLocaleDateString()}`);
			}
			return { text: lines.join('\n'), rows: mappings.length };
		}
	};

	const getMappingDetails: ToolDefinition<MappingIdInput> = {
		name: 'dhis2_getMappingDetails',
		usesProfile: true,
		invocationMessage: () => 'Loading mapping details…',
		async invoke(input, { connectionId }) {
			const mapping = await store.getMapping(connectionId, input.mappingId);
			if (!mapping) {
				return { text: notFound(input.mappingId) };
			}
			const lines = [`## Mapping: ${mapping.name}`, `- **Mode:** ${mapping.mode}`];
			if (mapping.description) {
				lines.push(`- **Description:** ${mapping.description}`);
			}
			lines.push(`- **Indicators:** ${mapping.indicators.length}\n`);
			for (const indicator of mapping.indicators) {
				lines.push(`### ${indicator.internalName} (\`${indicator.exportCode}\`)`, `- Kind: ${indicator.kind}`, `- Sources (${indicator.sources.length}):`);
				for (const src of indicator.sources) {
					lines.push(`  - \`${src.sourceElement}\` [${src.type}]${src.active === false ? ' *(inactive)*' : ''}`);
					if (src.includedCategoriesText) {
						lines.push(`    - Disaggregations: ${src.includedCategoriesText}`);
					}
					if (src.parentIndicatorName) {
						lines.push(`    - Parent: ${src.parentIndicatorName}`);
					}
				}
			}
			return { text: lines.join('\n') };
		}
	};

	const downloadInstructions: ToolDefinition<DownloadInstructionsInput> = {
		name: 'dhis2_downloadInstructions',
		usesProfile: true,
		invocationMessage: () => 'Previewing the download…',
		async invoke(input, { connectionId }) {
			const mapping = await store.getMapping(connectionId, input.mappingId);
			if (!mapping) {
				return { text: notFound(input.mappingId) };
			}
			const lines = [`## Download preview: "${mapping.name}" (${mapping.mode}, ${mapping.indicators.length} indicator(s))`, ''];
			for (const ind of mapping.indicators) {
				const sources = ind.sources.map(src => `${src.sourceElement} [${src.type}]${src.includedCategoriesText && src.type === 'Data Element' ? ` (${src.includedCategoriesText})` : ''}`).join('; ');
				lines.push(`- \`${ind.exportCode}\` ${ind.internalName}: ${sources || '_no source_'}`);
				const mismatch = findIndicatorCategoryMismatch(ind);
				if (mismatch) {
					lines.push(`  - ⚠️ ${mismatch}`);
				}
			}
			if (input.startDate && input.endDate && input.adminLevel) {
				const level = await adminLevel(connectionId, input.adminLevel);
				const estimate = await runner.estimate(connectionId, { mappingId: input.mappingId, mappingName: mapping.name, mappingMode: mapping.mode, startDate: input.startDate, endDate: input.endDate, periodType: input.periodType ?? 'monthly', adminLevel: level.adminLevel }, mapping);
				lines.push('', `**Estimate:** ${estimate.periods} period(s) (${estimate.firstPeriod ?? '?'} to ${estimate.lastPeriod ?? '?'}${estimate.calendar && estimate.calendar !== 'gregorian' ? `, ${estimate.calendar} calendar` : ''}), ${estimate.organisationUnits} org unit(s) at ${level.adminLevel}${level.name ? ` (${level.name})` : ''}, ${estimate.dataItems} data item(s), about ${estimate.requests} analytics request(s).`);
			}
			lines.push('', '**To run it:** call dhis2_startDownload with this mappingId (the user confirms first; the tidy result is written as a CSV for R), or in the Data Extractor: Downloads -> New Download -> pick the mapping, org unit level, start/end date and period type -> Download; completed downloads can be exported to Excel from the history list.');
			return { text: lines.join('\n') };
		}
	};

	const createMapping: ToolDefinition<CreateMappingInput> = {
		name: 'dhis2_createMapping',
		usesProfile: true,
		invocationMessage: input => `Creating mapping "${input.name}"…`,
		async prepare(input) {
			const title = 'Create DHIS2 Mapping';
			const invalid = validateIndicatorReasoning(input.indicators);
			if (invalid) {
				return confirmation(title, invalid);
			}
			const { connection } = await resolveConnection(input.profileId);
			const draft = await buildMappingDraft(connection.id, input.name, input.description, input.mode, input.indicators);
			return confirmation(title, appendIndicatorSummary(summarizeMappingChanges(undefined, draft).message, input.indicators));
		},
		async invoke(input, { connectionId }) {
			const invalid = validateIndicatorReasoning(input.indicators);
			if (invalid) {
				return { text: invalid };
			}
			const draft = await buildMappingDraft(connectionId, input.name, input.description, input.mode, input.indicators);
			const { id } = await store.createMapping(connectionId, draft, { keepDraft: true });
			return { text: `Created mapping "${draft.name}" (ID: \`${id}\`) with ${draft.indicators.length} indicator(s).` };
		}
	};

	/** The draft an update writes, built the same way for the confirmation and the write so the two always agree. */
	const proposedUpdate = async (connectionId: string, input: UpdateMappingInput) => {
		const existing = await store.getMapping(connectionId, input.mappingId);
		if (!existing) {
			return undefined;
		}
		const mode = input.mode ?? existing.mode;
		const draft: IAddMappingDraft = input.indicators
			? await buildMappingDraft(connectionId, input.name ?? existing.name, input.description ?? existing.description, mode, input.indicators)
			: { ...existing, name: input.name ?? existing.name, description: input.description ?? existing.description, mode };
		return { existing, draft };
	};

	const updateMapping: ToolDefinition<UpdateMappingInput> = {
		name: 'dhis2_updateMapping',
		usesProfile: true,
		invocationMessage: () => 'Updating the mapping…',
		async prepare(input) {
			const title = 'Update DHIS2 Mapping';
			const invalid = input.indicators ? validateIndicatorReasoning(input.indicators) : undefined;
			if (invalid) {
				return confirmation(title, invalid);
			}
			const { connection } = await resolveConnection(input.profileId);
			const proposed = await proposedUpdate(connection.id, input);
			if (!proposed) {
				return confirmation(title, notFound(input.mappingId));
			}
			const { message } = summarizeMappingChanges(proposed.existing, proposed.draft);
			return confirmation(title, input.indicators ? appendIndicatorSummary(message, input.indicators) : message);
		},
		async invoke(input, { connectionId }) {
			const invalid = input.indicators ? validateIndicatorReasoning(input.indicators) : undefined;
			if (invalid) {
				return { text: invalid };
			}
			const proposed = await proposedUpdate(connectionId, input);
			if (!proposed) {
				return { text: notFound(input.mappingId) };
			}
			await store.updateMapping(connectionId, input.mappingId, proposed.draft);
			return { text: `Updated mapping "${proposed.draft.name}" (ID: \`${input.mappingId}\`) -- now ${proposed.draft.indicators.length} indicator(s).` };
		}
	};

	/** What is wrong with a download's arguments that needs no server call, or `undefined`. */
	const validateDownload = (input: StartDownloadInput): string | undefined => {
		if (!parseIsoDateParts(input.startDate ?? '') || !parseIsoDateParts(input.endDate ?? '')) {
			return `startDate and endDate must be YYYY-MM-DD (got "${input.startDate}" and "${input.endDate}").`;
		}
		if (input.startDate > input.endDate) {
			return `startDate ("${input.startDate}") is after endDate ("${input.endDate}") -- swap them and try again.`;
		}
		if (!input.mappingId && (!input.mappingName || !input.mode || !input.indicators)) {
			return 'Provide either "mappingId", or "mappingName" + "mode" + "indicators" to create a mapping inline.';
		}
		return !input.mappingId && input.indicators ? validateIndicatorReasoning(input.indicators) : undefined;
	};

	const startDownload: ToolDefinition<StartDownloadInput> = {
		name: 'dhis2_startDownload',
		usesProfile: true,
		invocationMessage: () => 'Downloading DHIS2 analytics…',
		async prepare(input) {
			// Arguments that will fail are reported by invoke, which checks everything before it writes or downloads --
			// no confirmation is needed for a call that cannot run
			if (validateDownload(input)) {
				return undefined;
			}
			const connection = await resolveConnection(input.profileId).then(r => r.connection, () => undefined);
			if (!connection) {
				return undefined;
			}
			const draft = input.mappingId
				? await store.getMapping(connection.id, input.mappingId)
				: await buildMappingDraft(connection.id, input.mappingName!, undefined, input.mode!, input.indicators!);
			const level = await adminLevel(connection.id, input.adminLevel).catch(() => undefined);
			if (!draft || !level) {
				return undefined;
			}
			const estimate = await runner.estimate(connection.id, { mappingId: input.mappingId ?? '', mappingName: draft.name, mappingMode: draft.mode, startDate: input.startDate, endDate: input.endDate, periodType: input.periodType, adminLevel: level.adminLevel, boundaryOrgUnitUid: input.boundaryOrgUnitUid }, draft);
			const lines = [
				`**Download "${draft.name}"** (${draft.mode}, ${draft.indicators.length} indicator(s), ${estimate.dataItems} data item(s))`,
				'',
				`- Dates: ${input.startDate} to ${input.endDate} -> ${estimate.periods} ${draft.mode === 'countdown' ? 'monthly' : input.periodType} period(s) (${estimate.firstPeriod ?? '?'} to ${estimate.lastPeriod ?? '?'})${estimate.calendar && estimate.calendar !== 'gregorian' ? `, ${estimate.calendar} calendar` : ''}`,
				`- Org units: ${level.adminLevel}${level.name ? ` (${level.name})` : ''}, ${input.boundaryOrgUnitUid ? `only \`${input.boundaryOrgUnitUid}\`` : `${estimate.organisationUnits} org unit(s)`}`,
				`- About ${estimate.requests} analytics request(s)${input.resumeTaskId ? ` -- resuming task \`${input.resumeTaskId}\`` : ''}`
			];
			if (!input.mappingId) {
				lines.push(`- Also **saves a new mapping** "${draft.name}" to this connection`);
				const reuse = summarizeReusedSources(input.indicators!);
				if (reuse) {
					lines.push(reuse);
				}
			}
			return confirmation('Download DHIS2 Data', lines.join('\n'));
		},
		async invoke(input, { connectionId }, token) {
			const invalid = validateDownload(input);
			if (invalid) {
				return { text: invalid };
			}
			const level = await adminLevel(connectionId, input.adminLevel);

			let mappingId = input.mappingId;
			let draft: IAddMappingDraft | undefined;
			let reuseWarning: string | undefined;
			if (!mappingId) {
				reuseWarning = summarizeReusedSources(input.indicators!);
				draft = await buildMappingDraft(connectionId, input.mappingName!, undefined, input.mode!, input.indicators!);
				mappingId = (await store.createMapping(connectionId, draft, { keepDraft: true })).id;
			} else {
				draft = await store.getMapping(connectionId, mappingId);
				if (!draft) {
					return { text: notFound(mappingId) };
				}
			}

			const config: DownloadConfig = { mappingId, mappingName: draft.name, mappingMode: draft.mode, startDate: input.startDate, endDate: input.endDate, periodType: input.periodType, adminLevel: level.adminLevel, boundaryOrgUnitUid: input.boundaryOrgUnitUid };
			// Stopping the chat request stops the download after the requests under way; its finished chunks are kept
			const taskId = input.resumeTaskId || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
			const cancelling = token.onCancellationRequested(() => runner.stop(taskId, 'cancel'));
			let outcome: DownloadOutcome;
			try {
				outcome = await runner.run(connectionId, config, taskId);
			} finally {
				cancelling.dispose();
			}

			const what = `"${draft.name}" (${input.startDate} to ${input.endDate}, ${level.adminLevel})`;
			const lines: string[] = [];
			switch (outcome.status) {
				case 'completed': {
					const tidy = outcome.tidy ?? { columns: [], rows: [] };
					lines.push(`Download completed for ${what}; task \`${taskId}\`, ${tidy.rows.length} value row(s).`);
					if (tidy.rows.length) {
						lines.push('', describeDataFile(await writeDataFile(deps.storageUri, draft.name, tidy), tidy));
					} else {
						lines.push('DHIS2 returned no values for these sources, periods and org units -- check the sources have data (dhis2_getLastDataPeriod) and the date range.');
					}
					lines.push('', 'It is also in the Data Extractor\'s Downloads, where it can be exported to Excel in the Countdown layout.');
					break;
				}
				case 'paused':
					lines.push(`Download paused for ${what} (task \`${taskId}\`); completed chunks are kept. To resume, call dhis2_startDownload again with the same arguments and resumeTaskId: "${taskId}".`);
					break;
				case 'cancelled':
					lines.push(`Download cancelled for ${what} (task \`${taskId}\`). Completed chunks are kept -- resumeTaskId: "${taskId}" continues it.`);
					break;
				default: {
					const advice = classifyDhis2Error(outcome.error ?? '');
					lines.push(`Download failed for ${what} (task \`${taskId}\`): ${outcome.error ?? 'unknown error'}\n\nLikely cause: ${advice.cause}\nNext step: ${advice.nextStep}\nCompleted chunks are kept -- retry with resumeTaskId: "${taskId}" to continue from where it stopped.`);
				}
			}
			if (reuseWarning) {
				lines.push(reuseWarning);
			}
			return { text: lines.join('\n'), rows: outcome.tidy?.rows.length ?? 0 };
		}
	};

	const getDownloadStatus: ToolDefinition<DownloadStatusInput> = {
		name: 'dhis2_getDownloadStatus',
		usesProfile: true,
		invocationMessage: () => 'Reading downloads…',
		async invoke(input, { connectionId }) {
			const snapshot = await store.getSnapshot(connectionId);
			const running = (i: IDhis2DownloadInProgressItem) => `- \`${i.id}\` "${i.mappingName}" ${i.startDate} to ${i.endDate} ${i.adminLevel}: ${runner.isRunning(i.id) ? i.state : 'paused'} ${i.progressPct}%`;
			const done = (h: IDhis2DownloadHistoryRow) => `- \`${h.id}\` "${h.mappingName}" ${h.startDate} to ${h.endDate} ${h.adminLevel}: ${h.status}${h.date ? ` (${h.date})` : ''}${h.size && h.size !== '-' ? `, ${h.size}` : ''}`;
			if (input.taskId) {
				const inProgress = snapshot.inProgress.find(i => i.id === input.taskId);
				const history = snapshot.history.find(h => h.id === input.taskId);
				return { text: inProgress ? running(inProgress) : history ? done(history) : `No download with task id \`${input.taskId}\` for this connection.` };
			}
			const lines = ['## Downloads', '', '**Running / paused**', ...(snapshot.inProgress.length ? snapshot.inProgress.map(running) : ['- none']), '', '**Recent**', ...(snapshot.history.length ? snapshot.history.slice(0, 10).map(done) : ['- none'])];
			return { text: lines.join('\n') };
		}
	};

	const getCountdownIndicators: ToolDefinition<WithProfile> = {
		name: 'dhis2_getCountdownIndicators',
		usesProfile: false,
		invocationMessage: () => 'Listing the Countdown indicators…',
		async invoke() {
			const byCategory = new Map<string, typeof COUNTDOWN_INDICATORS>();
			for (const ind of COUNTDOWN_INDICATORS) {
				byCategory.set(ind.category, [...(byCategory.get(ind.category) ?? []), ind]);
			}
			const lines = ['## Countdown to 2030 Indicator Template', '', `These are the only ${COUNTDOWN_INDICATORS.length} valid "exportCode" values for a "countdown" mapping -- use the \`id\` exactly as shown.\n`];
			for (const [category, indicators] of byCategory) {
				lines.push(`### ${category}`);
				for (const ind of indicators) {
					// Some template ids contain a space (e.g. "Population_ under_5years"): stored mappings and the Countdown
					// workbook key off the id exactly as written, so it is flagged, not renamed
					lines.push(`- \`${ind.id}\` -- ${ind.title}${/\s/.test(ind.id) ? ' (note: this id contains a space -- copy it exactly, space included)' : ''}`);
				}
				lines.push('');
			}
			return { text: lines.join('\n') };
		}
	};

	const rawQuery: ToolDefinition<RawQueryInput> = {
		name: 'dhis2_rawQuery',
		usesProfile: true,
		invocationMessage: input => `Querying DHIS2 ${input.path}…`,
		async invoke(input, { connectionId }, token) {
			const validation = validateDhis2RawPath(input.path);
			if (!validation.ok) {
				return { text: `Invalid path "${input.path}": ${validation.reason}` };
			}
			const query: Record<string, vscode.Dhis2QueryValue> = {};
			for (const [key, value] of Object.entries(input.query ?? {})) {
				if (Array.isArray(value)) {
					query[key] = value.map(String);
				} else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
					query[key] = value;
				} else if (value !== undefined && value !== null) {
					query[key] = JSON.stringify(value);
				}
			}
			const isSingleObject = /\/[A-Za-z][A-Za-z0-9]{10}$/.test(validation.path);
			if (!isSingleObject && query.pageSize === undefined && query.paging === undefined) {
				query.pageSize = RAW_QUERY_DEFAULT_PAGE_SIZE;
			}
			const result = await vscode.dhis2.read(connectionId, { path: validation.path, query }, token);
			const { text, summarized } = summarizeJson(result, RAW_QUERY_MAX_CHARS);
			const note = summarized ? '\nResponse was large and has been summarised -- narrow it with "fields", "filter" or "pageSize" for the full content.' : '';
			return { text: `GET /api/${validation.path}\n\`\`\`json\n${text}\n\`\`\`${note}` };
		}
	};

	return [
		getProfiles, searchMetadata, getCategoryOptionCombos, getDataSetElements, getDataSetsForElement, getGroupElements, getLastDataPeriod,
		getIndicatorDataElements, getMappings, getMappingDetails, downloadInstructions, createMapping, updateMapping, startDownload, getDownloadStatus,
		getCountdownIndicators, rawQuery
	] as ToolDefinition<never>[];
}
