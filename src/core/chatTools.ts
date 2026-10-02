/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the pure parts of the DHIS2 chat tools -- their names, the checks and summaries of a mapping the AI
 *  proposes, org unit levels, and the reporting table
 *  Ported from DataSuite (contrib/dhis2/browser/tools/dhis2ChatTools.ts, dhis2QueryTools.ts).
 *--------------------------------------------------------------------------------------------*/

import { ITidyTable, TidyRow } from './dataUtils';
import { IAddMappingDraft } from './types';

/** Every chat tool, as contributed in package.json (`contributes.languageModelTools`). */
export const DHIS2_TOOL_NAMES = [
	'dhis2_getProfiles',
	'dhis2_searchMetadata',
	'dhis2_getOrgUnitLevels',
	'dhis2_queryAnalytics',
	'dhis2_reportingCompleteness',
	'dhis2_getDataValues',
	'dhis2_getCategoryOptionCombos',
	'dhis2_getDataSetElements',
	'dhis2_getDataSetsForElement',
	'dhis2_getGroupElements',
	'dhis2_getLastDataPeriod',
	'dhis2_getIndicatorDataElements',
	'dhis2_getMappings',
	'dhis2_getMappingDetails',
	'dhis2_downloadInstructions',
	'dhis2_createMapping',
	'dhis2_updateMapping',
	'dhis2_startDownload',
	'dhis2_getDownloadStatus',
	'dhis2_getCountdownIndicators',
	'dhis2_rawQuery'
] as const;

export type Dhis2ToolName = typeof DHIS2_TOOL_NAMES[number];

// ---------------------------------------------------------------------------
// A mapping the AI proposes
// ---------------------------------------------------------------------------

export interface IMappingSourceInput {
	id: string;
	sourceElement: string;
	type: string;
	includedCategoriesText?: string;
	/** Category Option Combo uids to include for a "Data Element" source (dhis2_getCategoryOptionCombos); omitted = all of them. */
	cocUids?: string[];
}

export type MappingConfidence = 'High' | 'Medium' | 'Low';

export interface IMappingIndicatorInput {
	internalName: string;
	exportCode: string;
	sources: IMappingSourceInput[];
	/** Required judgement of the match (ADR-0022), checked here rather than only asked for in the instructions. */
	confidence: MappingConfidence;
	/** Required: why this source over the other candidates (ADR-0022). */
	reasoning: string;
}

/** Why the indicators cannot be written (a missing or invalid `confidence`, or no `reasoning`), or `undefined`. */
export function validateIndicatorReasoning(indicators: readonly IMappingIndicatorInput[] | undefined): string | undefined {
	if (!Array.isArray(indicators)) {
		return '"indicators" must be a list.';
	}
	for (const ind of indicators) {
		if (ind.confidence !== 'High' && ind.confidence !== 'Medium' && ind.confidence !== 'Low') {
			return `Indicator "${ind.internalName}" (\`${ind.exportCode}\`) is missing a valid "confidence" ("High"/"Medium"/"Low"). Every indicator requires one before a mapping can be created or updated -- if no real match was found, use "Low" and explain why in "reasoning" rather than guessing a higher confidence.`;
		}
		if (!ind.reasoning?.trim()) {
			return `Indicator "${ind.internalName}" (\`${ind.exportCode}\`) is missing "reasoning" explaining why this source was chosen over other candidates. Every indicator requires this before a mapping can be created or updated.`;
		}
	}
	return undefined;
}

/** A source used for more than this many export codes in one call is likely a reused fallback (ADR-0022). */
const REUSE_WARNING_THRESHOLD = 3;

/** A warning naming every source reused beyond the threshold, or `undefined` -- a check that does not trust the AI's own confidence. */
export function summarizeReusedSources(indicators: readonly IMappingIndicatorInput[]): string | undefined {
	const codesBySourceId = new Map<string, Set<string>>();
	const nameBySourceId = new Map<string, string>();
	for (const ind of indicators) {
		for (const src of ind.sources) {
			const codes = codesBySourceId.get(src.id) ?? new Set<string>();
			codes.add(ind.exportCode);
			codesBySourceId.set(src.id, codes);
			nameBySourceId.set(src.id, src.sourceElement);
		}
	}
	const warnings: string[] = [];
	for (const [sourceId, codes] of codesBySourceId) {
		if (codes.size > REUSE_WARNING_THRESHOLD) {
			warnings.push(`- **${nameBySourceId.get(sourceId)}** (\`${sourceId}\`) is the source for ${codes.size} different export codes: ${Array.from(codes).join(', ')} -- verify each is a genuine match rather than a reused fallback.`);
		}
	}
	return warnings.length ? ['', '⚠️ **Possible reused fallback source(s):**', ...warnings].join('\n') : undefined;
}

/** Each indicator's confidence and reasoning, for the confirmation the user sees. */
export function summarizeIndicatorConfidence(indicators: readonly IMappingIndicatorInput[]): string {
	return ['', '**Confidence:**', ...indicators.map(ind => `- *${ind.internalName}* (\`${ind.exportCode}\`): **${ind.confidence}** -- ${ind.reasoning}`)].join('\n');
}

/** A confirmation message with the confidence summary and any reuse warning after it. */
export function appendIndicatorSummary(baseMessage: string, indicators: readonly IMappingIndicatorInput[]): string {
	return [baseMessage, summarizeIndicatorConfidence(indicators), summarizeReusedSources(indicators)].filter(part => !!part).join('\n');
}

/**
 * What writing `proposed` changes, for the confirmation: indicators matched by export code, their sources by id. A
 * source a person picked (`origin: 'manual'`) being dropped is called out -- the AI replacing a human's choice.
 */
export function summarizeMappingChanges(existing: IAddMappingDraft | undefined, proposed: IAddMappingDraft): { message: string; overwritesManual: boolean } {
	const lines: string[] = [];
	let overwritesManual = false;

	if (!existing) {
		lines.push(`**Create mapping "${proposed.name}"**`, '');
		for (const ind of proposed.indicators) {
			lines.push(`- Add indicator *${ind.internalName}* (\`${ind.exportCode}\`) with ${ind.sources.length} source(s) (AI)`);
		}
		return { message: lines.join('\n'), overwritesManual: false };
	}

	lines.push(`**Update mapping "${existing.name}"**`, '');
	const existingByCode = new Map(existing.indicators.map(ind => [ind.exportCode, ind]));
	const proposedByCode = new Map(proposed.indicators.map(ind => [ind.exportCode, ind]));

	for (const [code, proposedInd] of proposedByCode) {
		const existingInd = existingByCode.get(code);
		if (!existingInd) {
			lines.push(`- Add indicator *${proposedInd.internalName}* (\`${code}\`) with ${proposedInd.sources.length} source(s) (AI)`);
			continue;
		}
		const existingSourcesById = new Map(existingInd.sources.map(src => [src.id, src]));
		const proposedSourcesById = new Map(proposedInd.sources.map(src => [src.id, src]));
		for (const [id, src] of proposedSourcesById) {
			if (!existingSourcesById.has(id)) {
				lines.push(`- Add data element *${src.sourceElement}* to *${proposedInd.internalName}* (AI)`);
			}
		}
		for (const [id, src] of existingSourcesById) {
			if (!proposedSourcesById.has(id)) {
				const manual = src.origin === 'manual';
				overwritesManual ||= manual;
				lines.push(`- ${manual ? '⚠️ Replace' : 'Remove'} *${src.sourceElement}* from *${proposedInd.internalName}*${manual ? ' -- currently set **manually**' : ''}`);
			}
		}
	}
	for (const [code, existingInd] of existingByCode) {
		if (!proposedByCode.has(code)) {
			lines.push(`- Remove indicator *${existingInd.internalName}* (\`${code}\`)`);
		}
	}

	if (lines.length === 2) {
		lines.push('_No indicator/source changes -- only name, description, or mode may change._');
	}
	if (overwritesManual) {
		lines.push('', '⚠️ *This overwrites at least one manually-set mapping.*');
	}
	return { message: lines.join('\n'), overwritesManual };
}

// ---------------------------------------------------------------------------
// Org unit levels
// ---------------------------------------------------------------------------

export interface ILevelInfo {
	readonly level: number;
	readonly name: string;
}

/** An org unit level given as `LEVEL-3`, `3` or a level name ("District"), as `LEVEL-n`; throws listing the levels otherwise. */
export function normalizeAdminLevel(levels: readonly ILevelInfo[], value: string | number): { adminLevel: string; level: number; name: string | undefined } {
	const v = String(value).trim();
	const m = /^(?:LEVEL[-_ ]?)?(\d+)$/i.exec(v);
	const found = m ? levels.find(l => l.level === Number(m[1])) : levels.find(l => l.name.trim().toLowerCase() === v.replace(/^LEVEL[-_ ]/i, '').toLowerCase());
	if (found) {
		return { adminLevel: `LEVEL-${found.level}`, level: found.level, name: found.name };
	}
	if (m && !levels.length) {
		return { adminLevel: `LEVEL-${m[1]}`, level: Number(m[1]), name: undefined };
	}
	throw new Error(`Unknown org unit level "${value}". Valid levels: ${levels.map(l => `LEVEL-${l.level} (${l.name})`).join(', ') || 'none known yet'}.`);
}

// ---------------------------------------------------------------------------
// Reporting completeness
// ---------------------------------------------------------------------------

/** One row per org unit (and period): expected, actual, rate and missing reports, lowest rate first. */
export function pivotReporting(tidy: ITidyTable, dataSetUid: string, byPeriod: boolean): ITidyTable {
	const levelCols = tidy.columns.filter(c => /^level\d+_name$/.test(c));
	const rows = new Map<string, TidyRow>();
	for (const r of tidy.rows) {
		const key = `${r.ou_uid}|${byPeriod ? r.pe : ''}`;
		let row = rows.get(key);
		if (!row) {
			row = { ou_uid: r.ou_uid, ou_name: r.ou_name };
			for (const c of levelCols) {
				row[c] = r[c];
			}
			if (byPeriod) {
				row.pe = r.pe;
				row.pe_name = r.pe_name;
			}
			row.expected = null;
			row.actual = null;
			row.rate = null;
			rows.set(key, row);
		}
		const metric = String(r.dx_uid ?? '').slice(dataSetUid.length + 1);
		const value = typeof r.value === 'number' ? r.value : null;
		if (metric === 'EXPECTED_REPORTS') {
			row.expected = value;
		} else if (metric === 'ACTUAL_REPORTS') {
			row.actual = value;
		} else if (metric === 'REPORTING_RATE') {
			row.rate = value === null ? null : Math.round(value * 10) / 10;
		}
	}
	const out = Array.from(rows.values());
	for (const row of out) {
		const expected = typeof row.expected === 'number' ? row.expected : 0;
		const actual = typeof row.actual === 'number' ? row.actual : 0;
		row.missing = Math.max(0, expected - actual);
		if (row.rate === null && expected > 0) {
			row.rate = Math.round(actual / expected * 1000) / 10;
		}
	}
	out.sort((a, b) => (Number(a.rate ?? -1) - Number(b.rate ?? -1)) || String(a.ou_name).localeCompare(String(b.ou_name)));
	return { columns: ['ou_uid', 'ou_name', ...levelCols, ...(byPeriod ? ['pe', 'pe_name'] : []), 'expected', 'actual', 'rate', 'missing'], rows: out };
}
