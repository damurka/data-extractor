/*---------------------------------------------------------------------------------------------
 *  Data Extractor: one indicator of a mapping -- its result name and analysis code, the DHIS2 sources it sums, and which
 *  disaggregations (category option combos) of each it includes.
 *--------------------------------------------------------------------------------------------*/

import { CdCheckbox, FieldSelect } from '@quire/components';
import { useEffect, useRef, useState } from 'react';
import { findIndicatorCategoryMismatch } from '../../core/countdown';
import { IAddMappingDraft, IIndicatorDraft, IIndicatorSourceDraft, SourceHit } from '../../shared/api';
import { availableCountdownIndicators, isComplete, sourcesFor, withCocs } from '../../shared/mapping';
import { Button, Field, Icon, IconButton, SearchInput } from '../components';
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
			chips.push({ key: `i:${s.parentIndicatorId}`, title: s.parentIndicatorName, sub: `Indicator ${s.parentIndicatorId}`, remove: () => set({ sources: sources.filter(x => x.parentIndicatorId !== s.parentIndicatorId) }) });
		} else {
			chips.push({ key: `s:${s.id}`, title: s.sourceElement, sub: `${s.type || 'Data Element'} ${s.id}`, remove: () => set({ sources: sources.filter(x => x !== s) }) });
		}
	}
	const countdownOptions = availableCountdownIndicators(draft, indicator).map(c => ({ key: c.id, text: c.title }));

	return (
		<div className={`cd-card de-ind ${complete ? 'de-ind--complete' : 'de-ind--incomplete'}${indicator.expanded ? ' de-ind--open' : ''}`}>
			<div className="de-ind__head" onClick={onToggle} role="button" aria-expanded={!!indicator.expanded}>
				<Icon name={indicator.expanded ? 'chevron-down' : 'chevron-right'} className="de-ind__chev" />
				<span className="de-ind__title">{indicator.internalName || 'Untitled indicator'}</span>
				{indicator.exportCode && <span className="de-code">{indicator.exportCode}</span>}
				<span className={`de-badge ${complete ? 'de-badge--ok' : 'de-badge--warn'}`}>{complete ? 'Complete' : 'Incomplete'}</span>
				<span className="de-ind__count">{sources.length} source{sources.length === 1 ? '' : 's'}</span>
				<span className="de-row-actions" onClick={e => e.stopPropagation()}>
					<IconButton icon="copy" title="Copy this indicator" onClick={onClone} />
					<IconButton icon="trash-can" title="Delete this indicator" danger onClick={onDelete} />
				</span>
			</div>

			{indicator.expanded && (
				<div className="de-ind__body">
					<div className="de-grid-2">
						{countdown
							? <FieldSelect label="Result name" hint="The Countdown indicator this is." options={[{ key: '', text: 'Choose an indicator' }, ...countdownOptions]} value={indicator.exportCode}
								onChange={v => { const choice = availableCountdownIndicators(draft, indicator).find(c => c.id === v); set({ exportCode: choice?.id ?? '', internalName: choice?.title ?? '' }); }} />
							: <Field label="Result name" hint="The label this indicator gets in your output.">
								<input className="cd-field-input" type="text" value={indicator.internalName} onChange={e => set({ internalName: e.target.value })} />
							</Field>}
						<Field label="Analysis code" hint={countdown ? 'Fixed for a Countdown indicator. Its sources below are summed into it.' : 'The column the sources below are summed into.'}>
							<input className={`cd-field-input de-code-input${countdown ? ' de-code-input--fixed' : ''}`} type="text" value={indicator.exportCode} readOnly={countdown}
								onChange={e => set({ exportCode: e.target.value })} />
						</Field>
					</div>
					{mismatch && <p className="cd-field-hint cd-field-hint--bad">{mismatch}</p>}

					<div className="de-block">
						<div className="de-block__label">DHIS2 data</div>
						<p className="cd-field-hint">The data elements, indicators or data sets that make up this indicator's number.</p>
						{chips.length > 0 && (
							<div className="de-chips">
								{chips.map(chip => (
									<span key={chip.key} className="de-chip">
										<span className="de-chip__text"><span className="de-chip__main">{chip.title}</span><span className="de-chip__sub">{chip.sub}</span></span>
										<button type="button" className="de-chip__remove" onClick={chip.remove} title="Remove" aria-label={`Remove ${chip.title}`}><Icon name="xmark" /></button>
									</span>
								))}
							</div>
						)}
						<SourceSearch connectionId={connectionId} onError={onError} onPick={added => set({ sources: [...sources.map(s => ({ ...s, active: false })), ...added] })} />
					</div>

					<div className="de-block">
						<div className="de-block__label">Sources summed <span className="de-badge de-badge--info">{sources.length}</span></div>
						<div className="de-table-wrap de-table-wrap--bordered">
							<table className="de-table de-table--compact">
								<thead><tr><th style={{ width: '45%' }}>Source</th><th style={{ width: '15%' }}>Type</th><th>Disaggregations</th></tr></thead>
								<tbody>
									{sources.length === 0 && <tr><td className="de-table__empty" colSpan={3}>No sources yet: search above to add data elements.</td></tr>}
									{sources.map((s, i) => <SourceRow key={`${s.parentIndicatorId ?? ''}:${s.id}:${i}`} source={s} active={s === active} onActivate={() => activate(s)} />)}
								</tbody>
							</table>
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
	const summary = state === 'none' ? 'Not applicable'
		: state === 'noData' ? 'None'
			: state === 'default' ? 'All (default)'
				: selected === cocs.length ? 'All' : selected === 0 ? 'None chosen' : `${selected} of ${cocs.length}`;
	return (
		<tr className={`de-row${real ? ' de-row--clickable' : ''}${active && real ? ' de-row--active' : ''}`} onClick={real ? onActivate : undefined}>
			<td>
				<div className="de-list__title">{source.sourceElement}</div>
				<div className="de-list__sub">
					<span className="de-mono">{source.id}</span>
					{source.origin && <span className={`de-badge ${source.origin === 'ai' ? 'de-badge--accent' : 'de-badge--info'}`}>{source.origin === 'ai' ? 'AI' : 'Manual'}</span>}
					{source.parentIndicatorId && <span className="de-badge de-badge--info">From indicator {source.parentIndicatorId}</span>}
				</div>
			</td>
			<td>{source.type || 'Data Element'}</td>
			<td>
				<span className={`de-state${real && selected !== cocs.length ? ' de-state--warn' : ''}`}>
					{summary}
					{real && <Icon name={active ? 'chevron-up' : 'sliders'} className="de-state__more" />}
				</span>
				{real && active && <div className="de-list__sub">{source.includedCategoriesText}</div>}
			</td>
		</tr>
	);
}

function DisaggregationPanel({ source, showAll, setShowAll, onChange }: { source: IIndicatorSourceDraft; showAll: boolean; setShowAll(v: boolean): void; onChange(next: IIndicatorSourceDraft): void }) {
	const cocs = source.cocs ?? [];
	const visible = showAll ? cocs : cocs.slice(0, 8);
	const hidden = cocs.length - 8;
	return (
		<div className="de-disagg">
			<div className="de-disagg__head">
				<span className="de-disagg__title">Disaggregations of {source.sourceElement}</span>
				<span className="de-mono">{source.id}</span>
				<span className="de-spacer" />
				<Button label="Include all" icon="check-double" size="sm" onClick={() => onChange(withCocs(source, cocs.map(c => ({ ...c, checked: true }))))} />
			</div>
			<div className="de-disagg__list">
				{visible.map(coc => {
					const locked = coc.name.trim().toLowerCase() === 'default';
					return (
						<div key={coc.uid} className="de-disagg__item">
							<CdCheckbox label={coc.name} value={locked || coc.checked} disabled={locked}
								onChange={checked => onChange(withCocs(source, cocs.map(c => c.uid === coc.uid ? { ...c, checked } : c)))} />
							<span className="de-mono">{coc.uid}</span>
						</div>
					);
				})}
			</div>
			{hidden > 0 && <Button variant="link" label={showAll ? 'Show fewer' : `Show ${hidden} more`} onClick={() => setShowAll(!showAll)} />}
		</div>
	);
}

/** The source search box and its results. */
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
		<div className="de-picker">
			<SearchInput value={query} placeholder="Search data elements, indicators or data sets to add" onChange={setQuery} />
			{results && (
				<div className="de-results" role="listbox">
					{results.length === 0 && <div className="de-results__empty">Nothing matches.</div>}
					{results.map(hit => (
						<button key={`${hit.type}:${hit.uid}`} type="button" className="de-results__item" onClick={() => pick(hit)}>
							<span className="de-list__title">{hit.name}</span>
							<span className="de-list__sub">
								<span className={`de-badge ${hit.type === 'Indicator' ? 'de-badge--accent' : hit.type === 'DataSet' ? 'de-badge--warn' : 'de-badge--info'}`}>{hit.type}</span>
								<span className="de-mono">{hit.uid}</span>
								{hit.type === 'Indicator' && hit.elementCount !== undefined && <span>{hit.elementCount} data elements</span>}
							</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
