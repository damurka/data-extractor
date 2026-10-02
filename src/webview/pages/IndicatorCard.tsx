/*---------------------------------------------------------------------------------------------
 *  Data Extractor: one indicator of a mapping (dhis2IndicatorCard.ts) -- its result name and analysis code, the DHIS2
 *  sources it sums, and which disaggregations (category option combos) of each it includes.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from 'react';
import { findIndicatorCategoryMismatch } from '../../core/countdown';
import { IAddMappingDraft, IIndicatorDraft, IIndicatorSourceDraft, SourceHit } from '../../shared/api';
import { availableCountdownIndicators, isComplete, sourcesFor, withCocs } from '../../shared/mapping';
import { Icon } from '../components';
import { host, useAction } from '../hooks';

interface Props {
	readonly connectionId: string;
	readonly draft: IAddMappingDraft;
	readonly indicator: IIndicatorDraft;
	onChange(indicator: IIndicatorDraft): void;
	onToggle(): void;
	onClone(): void;
	onDelete(): void;
	onError(error: string): void;
}

type Disaggregation = 'none' | 'noData' | 'default' | 'real';

function disaggregationOf(source: IIndicatorSourceDraft): Disaggregation {
	return source.type === 'DataSet' || source.type === 'Dataset' ? 'none'
		: !source.cocs?.length ? 'noData'
			: source.categoryComboIsDefault ? 'default'
				: 'real';
}

function dotFor(name: string): string {
	const lower = name.toLowerCase();
	return lower.includes('female') ? 'bg-pink-400' : lower.includes('male') ? 'bg-blue-400' : 'bg-brand-teal';
}

export function IndicatorCard({ connectionId, draft, indicator, onChange, onToggle, onClone, onDelete, onError }: Props) {
	const complete = isComplete(indicator);
	const countdown = indicator.kind === 'countdown';
	const set = (patch: Partial<IIndicatorDraft>) => onChange({ ...indicator, ...patch });
	const sources = indicator.sources;
	const active = sources.find(s => s.active) ?? sources[0];
	const [showAll, setShowAll] = useState(false);
	const mismatch = findIndicatorCategoryMismatch(indicator);

	const activate = (source: IIndicatorSourceDraft) => {
		const wasActive = source === active;
		setShowAll(false);
		set({ sources: sources.map(s => ({ ...s, active: !wasActive && s === source })) });
	};
	const updateSource = (source: IIndicatorSourceDraft, next: IIndicatorSourceDraft) => set({ sources: sources.map(s => s === source ? next : s) });

	// One chip per source, sources from the same indicator sharing one
	const chips: { key: string; title: string; sub: string; remove: () => void }[] = [];
	const seen = new Set<string>();
	for (const s of sources) {
		if (s.parentIndicatorId && s.parentIndicatorName) {
			if (seen.has(s.parentIndicatorId)) {
				continue;
			}
			seen.add(s.parentIndicatorId);
			chips.push({ key: `i:${s.parentIndicatorId}`, title: s.parentIndicatorName, sub: `Indicator: ${s.parentIndicatorId}`, remove: () => set({ sources: sources.filter(x => x.parentIndicatorId !== s.parentIndicatorId) }) });
		} else {
			chips.push({ key: `s:${s.id}`, title: s.sourceElement, sub: `${s.type || 'Data Element'}: ${s.id}`, remove: () => set({ sources: sources.filter(x => x !== s) }) });
		}
	}

	return (
		<div className="indicator-card-modern">
			<div className="ic-header" onClick={onToggle}>
				<div className="ic-header-left">
					<Icon name="gripper" className="ic-drag-icon" />
					<div className="ic-title-wrap">
						<Icon name={indicator.expanded ? 'chevron-down' : 'chevron-right'} className="ic-expand-icon" />
						<span className="ic-title">{indicator.internalName || 'Untitled Indicator'}</span>
						{!indicator.expanded && <>
							<span className={`ic-status-dot ${complete ? 'ic-status-complete' : 'ic-status-incomplete'}`} title={complete ? 'Complete' : 'Missing required fields'} />
							{indicator.exportCode && <span className="ic-summary-code">{indicator.exportCode}</span>}
						</>}
					</div>
				</div>
				<div className="ic-header-actions">
					<button type="button" className="d2-btn--icon" title="Clone" onClick={e => { e.stopPropagation(); onClone(); }}><Icon name="copy" /></button>
					<button type="button" className="d2-btn--icon" title="Delete" onClick={e => { e.stopPropagation(); onDelete(); }}><Icon name="trash" /></button>
				</div>
			</div>

			{indicator.expanded && (
				<div className="ic-body">
					<div className="ic-grid-2">
						<div className="d2-form-group">
							<label className="ic-label">Result Name</label>
							<p className="ic-field-hint">The label this indicator gets in your output.</p>
							{countdown ? (
								<select className="d2-input d2-select" value={indicator.exportCode} onChange={e => {
									const choice = availableCountdownIndicators(draft, indicator).find(c => c.id === e.target.value);
									set({ exportCode: choice?.id ?? '', internalName: choice?.title ?? '' });
								}}>
									<option value="">Select mapping indicator...</option>
									{availableCountdownIndicators(draft, indicator).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
								</select>
							) : <input className="d2-input" type="text" value={indicator.internalName} onChange={e => set({ internalName: e.target.value })} />}
						</div>
						<div className="d2-form-group">
							<div className="ic-label-wrap">
								<label className="ic-label">Analysis Code</label>
								<span className="ic-badge-sum" title="All sources below will be summed into this code">SUM</span>
							</div>
							<p className="ic-field-hint">The code DHIS2 uses to identify this value in analytics queries.</p>
							<div className="ic-code-relative">
								<span className="ic-code-prefix">CODE:</span>
								<input className={`d2-input ic-input-code${countdown ? ' ic-input-readonly' : ''}`} type="text" value={indicator.exportCode} readOnly={countdown}
									title={countdown ? 'Target Export Code is fixed for Countdown indicators' : undefined} onChange={e => set({ exportCode: e.target.value })} />
								<Icon name="symbol-numeric" className="ic-code-suffix" />
							</div>
						</div>
					</div>
					{mismatch && <p className="ic-field-hint text-error">{mismatch}</p>}

					<div className="ic-source-group">
						<div className="ic-label-wrap ic-justify-between"><label className="ic-label">DHIS2 Data Mapping</label></div>
						<p className="ic-field-hint">Which DHIS2 data elements, indicators, or datasets feed this indicator's number.</p>
						<div className="ic-tags-container">
							<div className="ic-tags-wrap">
								{chips.map(chip => (
									<div key={chip.key} className="ic-chip">
										<div className="ic-chip-text"><span className="ic-chip-main">{chip.title}</span><span className="ic-chip-sub">{chip.sub}</span></div>
										<button type="button" className="ic-chip-close" onClick={chip.remove}><Icon name="close" /></button>
									</div>
								))}
							</div>
							<SourceSearch connectionId={connectionId} onError={onError} onPick={added => set({ sources: [...sources.map(s => ({ ...s, active: false })), ...added] })} />
						</div>
					</div>

					<div className="ic-resolved-container">
						<div className="ic-resolved-card">
							<div className="ic-resolved-header">
								<div className="ic-resolved-title-wrap">
									<span className="ic-resolved-title">Resolved Data Sources</span>
									<span className="ic-resolved-subtitle">→ Summing to Target Code</span>
								</div>
								<span className="ic-badge-sources">{sources.length} Sources Aggregating</span>
							</div>
							<div className="ic-table-wrap">
								<table className="ic-table">
									<thead><tr>
										<th className="ic-th ic-th-source">Source Element</th>
										<th className="ic-th ic-th-type">Type</th>
										<th className="ic-th ic-th-categories">Included Categories (Disaggregation)</th>
									</tr></thead>
									<tbody>
										{sources.length === 0 && <tr><td className="ic-empty-cell" colSpan={3}>No sources added yet. Use the search box above to add Data Elements.</td></tr>}
										{sources.map((s, i) => <SourceRow key={`${s.parentIndicatorId ?? ''}:${s.id}:${i}`} source={s} active={s === active} onActivate={() => activate(s)} />)}
									</tbody>
								</table>
							</div>
						</div>
						{active && disaggregationOf(active) === 'real' && (
							<DisaggregationPanel source={active} showAll={showAll} setShowAll={setShowAll} onChange={next => updateSource(active, next)} />
						)}
					</div>
				</div>
			)}
		</div>
	);
}

function SourceRow({ source, active, onActivate }: { source: IIndicatorSourceDraft; active: boolean; onActivate(): void }) {
	const state = disaggregationOf(source);
	const real = state === 'real';
	const cocs = source.cocs ?? [];
	const selected = cocs.filter(c => c.checked).length;
	return (
		<tr className={`ic-tr${active ? ' ic-tr-active' : ''}`} onClick={onActivate}>
			<td className="ic-td">
				<div className="ic-name-wrap">
					<span className="ic-name-main">{source.sourceElement}</span>
					<div className="ic-name-sub-wrap">
						<span className="ic-name-sub">{source.id}</span>
						{source.origin && <span className={`ic-origin-badge ic-origin-${source.origin}`}>{source.origin === 'ai' ? 'AI' : 'Manual'}</span>}
						{source.parentIndicatorId && <span className="ic-from-indicator-badge"><span className="ic-from-prefix">From Indicator: </span><span className="ic-from-id">{source.parentIndicatorId}</span></span>}
					</div>
				</div>
			</td>
			<td className="ic-td ic-td-top">{source.type || 'Data Element'}</td>
			<td className="ic-td">
				<div className={`ic-selector-card${active && real ? ' ic-selector-active' : ''}`} onClick={e => { e.stopPropagation(); onActivate(); }}>
					<div className={`ic-selector-left${active && real ? ' ic-flex-wrap' : ''}`}>
						{state === 'none' && <><span className="ic-dot ic-dot-muted" /><span className="ic-sel-main">N/A</span></>}
						{state === 'noData' && <><span className="ic-dot ic-dot-muted" /><span className="ic-sel-main">No Category Options</span></>}
						{state === 'default' && <><span className="ic-dot ic-dot-muted" /><span className="ic-sel-main">All Category Options</span><span className="ic-sel-sub">(Default)</span></>}
						{real && active && <>
							<span className="ic-dot bg-amber-500" />
							<span className="ic-sel-main-amber ic-dynamic-main-text">{source.includedCategoriesText}</span>
							<span className="ic-sel-pill ic-dynamic-pill-text">{selected === cocs.length ? 'All Selected' : selected ? `${selected} Selected` : 'None Selected'}</span>
						</>}
						{real && !active && (selected === cocs.length ? <><span className="ic-dot bg-brand-teal" /><span className="ic-sel-main">All Category Options</span></>
							: selected === 0 ? <><span className="ic-dot ic-dot-muted" /><span className="ic-sel-main">No Category Options</span></>
								: <><span className="ic-dot bg-amber-500" /><span className="ic-sel-main-amber">Custom Selection</span><span className="ic-sel-sub">({selected}/{cocs.length} Selected)</span></>)}
					</div>
					{real && <Icon name={active ? 'chevron-up' : 'settings-gear'} className={active ? 'ic-sel-icon-active' : 'ic-sel-icon'} />}
				</div>
			</td>
		</tr>
	);
}

function DisaggregationPanel({ source, showAll, setShowAll, onChange }: { source: IIndicatorSourceDraft; showAll: boolean; setShowAll(v: boolean): void; onChange(next: IIndicatorSourceDraft): void }) {
	const cocs = source.cocs ?? [];
	const visible = showAll ? cocs : cocs.slice(0, 4);
	const hidden = cocs.length - 4;
	return (
		<div className="ic-disagg-panel">
			<div className="ic-disagg-border" />
			<div className="ic-disagg-header">
				<div className="ic-disagg-h-left">
					<span className="ic-disagg-title">Disaggregation: {source.sourceElement}</span>
					<span className="ic-disagg-badge">{source.id}</span>
				</div>
				<button type="button" className="ic-btn-automap" onClick={() => onChange(withCocs(source, cocs.map(c => ({ ...c, checked: true }))))}><Icon name="refresh" /> Auto-map all</button>
			</div>
			<table className="ic-disagg-table">
				<thead><tr>
					<th className="ic-disagg-th ic-disagg-th-coc">Category Option Combo</th>
					<th className="ic-disagg-th ic-disagg-th-id">COC ID<span className="ic-disagg-th-sub">(Appends to Target Export)</span></th>
					<th className="ic-disagg-th ic-text-center ic-disagg-th-include">Include</th>
				</tr></thead>
				<tbody>
					{visible.map(coc => {
						const locked = coc.name.trim().toLowerCase() === 'default';
						return (
							<tr key={coc.uid} className={`ic-disagg-tr${locked ? ' ic-coc-locked' : ''}`}>
								<td className="ic-disagg-td ic-flex-row">
									<span className={`ic-dot ${dotFor(coc.name)}`} />{coc.name}
									{locked && <Icon name="lock" className="ic-coc-lock-icon" />}
								</td>
								<td className="ic-disagg-td"><span className="ic-mono">{coc.uid}</span></td>
								<td className="ic-disagg-td ic-text-center">
									<input className="ic-checkbox" type="checkbox" checked={locked || coc.checked} disabled={locked}
										onChange={e => onChange(withCocs(source, cocs.map(c => c.uid === coc.uid ? { ...c, checked: e.target.checked } : c)))} />
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			{hidden > 0 && (
				<div className="ic-disagg-footer">
					<button type="button" className="ic-disagg-more" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show less combinations' : `Show ${hidden} more combinations`}</button>
				</div>
			)}
		</div>
	);
}

/** The source search box and its results (search-results-list), inside the card's tags container. */
function SourceSearch({ connectionId, onPick, onError }: { connectionId: string; onPick(sources: IIndicatorSourceDraft[]): void; onError(error: string): void }) {
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<SourceHit[]>();
	const [run, error] = useAction();
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => { if (error) { onError(error); } }, [error, onError]);

	useEffect(() => {
		clearTimeout(timer.current);
		if (query.trim().length < 2) {
			setResults(undefined);
			return;
		}
		timer.current = setTimeout(() => void run(async () => {
			const r = await host.searchSources(connectionId, query.trim());
			setResults([...r.dataElements, ...r.indicators, ...r.dataSets]);
		}), 300);
		return () => clearTimeout(timer.current);
	}, [query, connectionId, run]);

	const pick = (hit: SourceHit) => void run(async () => {
		const cocs = hit.type === 'Data Element' ? await host.categoryOptionCombos(connectionId, hit.uid) : [];
		const resolved = hit.type === 'Indicator' ? await host.resolveIndicator(connectionId, hit.uid) : [];
		onPick(sourcesFor(hit, cocs, resolved));
		setQuery('');
		setResults(undefined);
	});

	return (
		<div className="d2-search">
			<Icon name="search" className="d2-search-icon" />
			<input className="d2-search-input" type="text" placeholder="Search and add Data Elements, Indicators or DataSets..." value={query} onChange={e => setQuery(e.target.value)} />
			{results && (
				<div className="search-results-list">
					{results.length === 0 && <div className="search-result-item no-select"><div className="res-top-row"><span className="res-name">No results found</span></div><div className="res-bottom-row" /></div>}
					{results.map(hit => (
						<div key={`${hit.type}:${hit.uid}`} className="search-result-item" onClick={() => pick(hit)}>
							<div className="res-top-row"><span className="res-name">{hit.name}</span></div>
							<div className="res-bottom-row">
								<span className={`res-type-badge ${hit.type === 'Indicator' ? 'badge-indicator' : hit.type === 'DataSet' ? 'badge-dataset' : 'badge-de'}`}>{hit.type}</span>
								<span className="res-id">{hit.uid}</span>
								{hit.type === 'Indicator' && hit.elementCount !== undefined && <span className="res-count-badge">{hit.elementCount} Elements</span>}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
