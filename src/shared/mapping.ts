/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the mapping editor's rules (the built-in extractor's dhis2ProfileAddMappingView.ts and
 *  dhis2IndicatorCard.ts), kept apart from the screens so they can be tested.
 *--------------------------------------------------------------------------------------------*/

import { COUNTDOWN_INDICATORS, findIndicatorCategoryMismatch } from '../core/countdown';
import type { IAddMappingDraft, ICategoryOptionCombo, IIndicatorDraft, IIndicatorSourceDraft, MappingMode } from '../core/types';
import type { ResolvedElement, SourceHit } from './api';

export { COUNTDOWN_INDICATORS };

export function emptyDraft(mode: MappingMode = 'countdown'): IAddMappingDraft {
	return { name: '', description: '', mode, indicators: [] };
}

export function newIndicator(mode: MappingMode): IIndicatorDraft {
	return { id: randomId(), internalName: '', exportCode: '', kind: mode, expanded: true, sources: [] };
}

/** Why the mapping cannot be saved yet, or `undefined` when it can. */
/**
 * Why the mapping cannot be saved: only a missing name. Incomplete indicators are saved as they are, to finish later;
 * a download leaves them out (completeIndicators()).
 */
export function validationError(draft: IAddMappingDraft): string | undefined {
	return draft.name?.trim() ? undefined : 'Give this mapping a name before saving.';
}

/** What an indicator still lacks before a download can use it, in a few words; undefined when it is complete. */
export function incompleteReason(indicator: IIndicatorDraft): string | undefined {
	const missing = [
		!indicator.internalName?.trim() && 'a result name',
		!indicator.exportCode?.trim() && 'an analysis code',
		!indicator.sources?.length && 'DHIS2 data'
	].filter((m): m is string => !!m);
	if (missing.length) {
		return `Needs ${missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`}.`;
	}
	return findIndicatorCategoryMismatch(indicator) ?? undefined;
}

/**
 * The mapping with only the indicators a download keeps -- the complete ones (what it fetches) and the ones marked not
 * available (their columns, empty) -- and the names of those left out.
 */
export function completeIndicators(draft: IAddMappingDraft): { readonly mapping: IAddMappingDraft; readonly leftOut: readonly string[] } {
	const kept = (i: IIndicatorDraft) => isComplete(i) || (isNotAvailable(i) && !!i.exportCode?.trim());
	return {
		mapping: { ...draft, indicators: draft.indicators.filter(kept) },
		leftOut: draft.indicators.filter(i => !kept(i)).map(i => i.internalName?.trim() || i.exportCode?.trim() || 'Untitled indicator')
	};
}

/** Whether an indicator is marked as not available on the server (and has no sources: giving it one maps it instead). */
export function isNotAvailable(indicator: IIndicatorDraft): boolean {
	return !!indicator.notAvailable && !indicator.sources?.length;
}

/** Whether nothing is left to do for an indicator: it is complete, or marked not available. */
export function isDone(indicator: IIndicatorDraft): boolean {
	return isComplete(indicator) || isNotAvailable(indicator);
}

/** How far a mapping is: its indicators, the complete ones, the ones marked not available, and the rest. */
export function mappingProgress(draft: Pick<IAddMappingDraft, 'indicators'>): { readonly total: number; readonly mapped: number; readonly notAvailable: number; readonly missing: number } {
	const indicators = draft.indicators ?? [];
	const mapped = indicators.filter(isComplete).length;
	const notAvailable = indicators.filter(i => !isComplete(i) && isNotAvailable(i)).length;
	return { total: indicators.length, mapped, notAvailable, missing: indicators.length - mapped - notAvailable };
}

/** The sheets of the Countdown workbook, with the Countdown categories on each and how often each has a value. */
export const COUNTDOWN_PARTS: readonly { readonly name: string; readonly cadence: string; readonly categories: readonly string[] }[] = [
	{ name: 'Population', cadence: 'yearly', categories: ['Population_data'] },
	{ name: 'Reporting completeness', cadence: 'monthly', categories: ['Reporting_completeness'] },
	{ name: 'Services', cadence: 'monthly', categories: ['Service_data_1', 'Service_data_2', 'Service_data_3'] },
	{ name: 'Admin', cadence: 'one value per unit', categories: ['Admin_data'] }
];

/**
 * A Countdown mapping with every Countdown indicator, in Countdown's order: the ones it has, and an empty one (not
 * mapped yet) for each it lacks. An indicator whose code is not Countdown's is kept at the end.
 */
export function withAllCountdownIndicators(draft: IAddMappingDraft): IAddMappingDraft {
	const byCode = new Map(draft.indicators.map(i => [i.exportCode, i]));
	const known = new Set(COUNTDOWN_INDICATORS.map(c => c.id));
	return {
		...draft,
		indicators: [
			...COUNTDOWN_INDICATORS.map(c => byCode.get(c.id) ?? { id: randomId(), internalName: c.title, exportCode: c.id, kind: 'countdown' as const, sources: [] }),
			...draft.indicators.filter(i => !known.has(i.exportCode))
		]
	};
}

/** A column's code from an indicator's name: `ANC 1st visit` -> `anc_1st_visit`. */
export function exportCodeFor(name: string): string {
	return name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** What a source's chosen category option combos say, in a word or three. */
export function categoryText(source: Pick<IIndicatorSourceDraft, 'cocs' | 'categoryComboIsDefault'>): string {
	if (!source.cocs || source.cocs.length === 0) {
		return 'No Category Options';
	}
	if (source.categoryComboIsDefault) {
		return 'Default (No Disaggregation)';
	}
	const selected = source.cocs.filter(c => c.checked).length;
	return selected === source.cocs.length ? 'All Category Options' : selected === 0 ? 'None Selected' : 'Custom Selection';
}

/** A source with its combos changed, its text following. */
export function withCocs(source: IIndicatorSourceDraft, cocs: ICategoryOptionCombo[]): IIndicatorSourceDraft {
	const next = { ...source, cocs };
	return { ...next, includedCategoriesText: categoryText(next) };
}

/** The sources a search hit adds: a data element with all its combos, a dataset, or an indicator's data elements. */
export function sourcesFor(hit: SourceHit, cocs: ICategoryOptionCombo[], resolved: ResolvedElement[]): IIndicatorSourceDraft[] {
	if (hit.type === 'DataSet') {
		return [{ id: hit.uid, sourceElement: hit.name, type: 'DataSet', includedCategoriesText: 'N/A', active: false, cocs: [], origin: 'manual' }];
	}
	if (hit.type === 'Data Element') {
		return [withCocs({ id: hit.uid, sourceElement: hit.name, type: 'Data Element', includedCategoriesText: '', active: false, categoryComboIsDefault: hit.categoryComboIsDefault, origin: 'manual' }, cocs)];
	}
	return resolved.map((element, index) => withCocs({
		id: element.uid,
		sourceElement: element.name,
		type: 'Data Element',
		includedCategoriesText: '',
		active: index === 0,
		categoryComboIsDefault: element.categoryComboIsDefault,
		parentIndicatorId: hit.uid,
		parentIndicatorName: hit.name,
		origin: 'manual'
	}, element.cocs));
}

/** Countdown indicators not used by another indicator of the mapping (the one being edited may keep its own). */
export function availableCountdownIndicators(draft: IAddMappingDraft, editing: IIndicatorDraft): typeof COUNTDOWN_INDICATORS {
	const used = new Set(draft.indicators.filter(i => i.id !== editing.id).map(i => i.exportCode));
	return COUNTDOWN_INDICATORS.filter(c => !used.has(c.id));
}

/** Whether an indicator has everything it needs. */
export function isComplete(indicator: IIndicatorDraft): boolean {
	return !!indicator.internalName?.trim() && !!indicator.exportCode?.trim() && indicator.sources.length > 0 && !findIndicatorCategoryMismatch(indicator);
}

function randomId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
