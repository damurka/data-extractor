/*---------------------------------------------------------------------------------------------
 *  Data Extractor: a Countdown mapping as DataSuite keeps it (the country's DHIS2 mapping, outside the cycles)
 *--------------------------------------------------------------------------------------------*/

import { IAddMappingDraft, IIndicatorDraft } from './types';

/** What DataSuite's SubmitCountryMappingCommand takes as `mappingJson`: the DHIS2 server, the organisation unit level
 * of the districts, and each Countdown indicator's DHIS2 sources -- or why it isn't available. */
export interface IDataSuiteMapping {
	readonly dhis2Url: string;
	readonly districtLevel: number;
	readonly indicators: readonly {
		readonly code: string;
		readonly sources: readonly { readonly uid: string; readonly type: string; readonly name: string | null; readonly categoryOptionCombos: readonly string[] }[];
		readonly notAvailable: string | null;
	}[];
}

const NOT_AVAILABLE_REASONS: Record<string, string> = {
	notCollected: 'Not collected in this DHIS2',
	noMatch: 'No matching data element in this DHIS2',
	other: 'Not available',
};

/** The DataSuite type of an extractor source ("Data Element", "Dataset"...). */
function sourceType(type: string): string {
	switch (type.replace(/\s+/g, '').toLowerCase()) {
		case 'dataelement': return 'DataElement';
		case 'dataset': return 'DataSet';
		case 'programindicator': return 'ProgramIndicator';
		case 'indicator': return 'Indicator';
		default: return type;
	}
}

/** Why a Countdown mapping can't go to DataSuite as it is; none when it can. */
export function mappingProblems(draft: IAddMappingDraft): string[] {
	const problems: string[] = [];
	if (draft.mode !== 'countdown') {
		problems.push('Only a Countdown mapping is the country\'s mapping: a custom one stays in the Data Extractor.');
	}
	for (const indicator of draft.indicators) {
		const label = indicator.internalName || indicator.exportCode || 'An indicator';
		if (!indicator.exportCode?.trim()) {
			problems.push(`${label} has no Countdown code.`);
		} else if (!indicator.notAvailable && indicator.sources.length === 0) {
			problems.push(`${label} has no DHIS2 source: map it, or mark it not available.`);
		}
	}
	return problems;
}

/** The mapping as DataSuite keeps it, for `serverUrl`, with `districtLevel` the DHIS2 level of the districts. Every
 * source counts (as a download uses them all), with the category option combos chosen for it. */
export function toDataSuiteMapping(draft: IAddMappingDraft, serverUrl: string, districtLevel: number): IDataSuiteMapping {
	return {
		dhis2Url: serverUrl.replace(/\/+$/, ''),
		districtLevel,
		indicators: draft.indicators.map((indicator: IIndicatorDraft) => indicator.notAvailable
			? {
				code: indicator.exportCode.trim(),
				sources: [],
				notAvailable: (indicator.notAvailable.note?.trim() || NOT_AVAILABLE_REASONS[indicator.notAvailable.reason] || 'Not available'),
			}
			: {
				code: indicator.exportCode.trim(),
				sources: indicator.sources.map(source => ({
					uid: source.id,
					type: sourceType(source.type),
					name: source.sourceElement || null,
					categoryOptionCombos: (source.cocs ?? []).filter(c => c.checked).map(c => c.uid),
				})),
				notAvailable: null,
			}),
	};
}
