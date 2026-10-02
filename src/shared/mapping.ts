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
export function validationError(draft: IAddMappingDraft): string | undefined {
	if (!draft.name?.trim()) {
		return 'Give this mapping a name before saving.';
	}
	for (const indicator of draft.indicators) {
		if (!indicator.internalName?.trim() || !indicator.exportCode?.trim() || !indicator.sources?.length) {
			return `"${indicator.internalName?.trim() || 'Untitled Indicator'}" is missing a Result Name, Analysis Code, or DHIS2 Data Mapping.`;
		}
		const mismatch = findIndicatorCategoryMismatch(indicator);
		if (mismatch) {
			return mismatch;
		}
	}
	return undefined;
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
