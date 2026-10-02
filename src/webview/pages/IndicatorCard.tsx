/*---------------------------------------------------------------------------------------------
 *  Data Extractor: one indicator of a mapping -- its result name and analysis code, the DHIS2 sources it sums, and
 *  which disaggregations (category option combos) of each it includes.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useRef, useState } from 'react';
import { IAddMappingDraft, IIndicatorDraft, IIndicatorSourceDraft, SourceHit, SourceSearchResult } from '../../shared/api';
import { availableCountdownIndicators, isComplete, sourcesFor, withCocs } from '../../shared/mapping';
import { findIndicatorCategoryMismatch } from '../../core/countdown';
import { ErrorLine } from '../components';
import { host, useAction } from '../hooks';

interface Props {
	readonly connectionId: string;
	readonly draft: IAddMappingDraft;
	readonly indicator: IIndicatorDraft;
	readonly expanded: boolean;
	onExpand(): void;
	onChange(indicator: IIndicatorDraft): void;
	onClone(): void;
	onDelete(): void;
}

export function IndicatorCard({ connectionId, draft, indicator, expanded, onExpand, onChange, onClone, onDelete }: Props) {
	const complete = isComplete(indicator);
	const mismatch = findIndicatorCategoryMismatch(indicator);
	if (!expanded) {
		return (
			<div className="card indicator collapsed" onClick={onExpand} role="button">
				<span className={`dot ${complete ? 'ok' : 'todo'}`} title={complete ? 'Complete' : 'Incomplete'} />
				<span className="strong">{indicator.internalName || 'Untitled Indicator'}</span>
				<span className="muted code">{indicator.exportCode}</span>
				<span className="muted">{indicator.sources.length} source{indicator.sources.length === 1 ? '' : 's'}</span>
			</div>
		);
	}

	const set = (patch: Partial<IIndicatorDraft>) => onChange({ ...indicator, ...patch });
	const countdown = indicator.kind === 'countdown';
	const choices = availableCountdownIndicators(draft, indicator);

	return (
		<div className="card indicator expanded">
			<div className="card-head">
				<span className={`dot ${complete ? 'ok' : 'todo'}`} />
				<span className="strong">{indicator.internalName || 'Untitled Indicator'}</span>
				<div className="actions">
					<button className="plain" onClick={onClone}>Copy</button>
					<button className="plain danger" onClick={onDelete}>Delete</button>
				</div>
			</div>
			<div className="fields two">
				<label>Result Name
					{countdown ? (
						<select value={indicator.exportCode} onChange={e => {
							const choice = choices.find(c => c.id === e.target.value);
							set({ exportCode: choice?.id ?? '', internalName: choice?.title ?? '' });
						}}>
							<option value="">Choose a Countdown indicator...</option>
							{Object.entries(groupBy(choices, c => c.category)).map(([category, list]) => (
								<optgroup key={category} label={category}>{list.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</optgroup>
							))}
						</select>
					) : <input value={indicator.internalName} placeholder="e.g. ANC first visits" onChange={e => set({ internalName: e.target.value })} />}
				</label>
				<label>Analysis Code <span className="badge small">SUM</span>
					<input value={indicator.exportCode} readOnly={countdown} placeholder={countdown ? '' : 'e.g. anc1'} onChange={e => set({ exportCode: e.target.value })} />
				</label>
			</div>
			{mismatch && <div className="error-line">{mismatch}</div>}
			<SourcePicker connectionId={connectionId} onPick={sources => set({ sources: [...indicator.sources.map(s => ({ ...s, active: false })), ...sources] })} />
			<Sources indicator={indicator} onChange={sources => set({ sources })} />
		</div>
	);
}

/** Search the server's metadata for a source; picking one adds its source(s). */
function SourcePicker({ connectionId, onPick }: { connectionId: string; onPick(sources: IIndicatorSourceDraft[]): void }) {
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<SourceSearchResult>();
	const [run, error, busy, dismiss] = useAction();
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => {
		clearTimeout(timer.current);
		if (query.trim().length < 2) {
			setResults(undefined);
			return;
		}
		timer.current = setTimeout(() => void run(async () => setResults(await host.searchSources(connectionId, query.trim()))), 300);
		return () => clearTimeout(timer.current);
	}, [query, connectionId, run]);

	const pick = (hit: SourceHit) => void run(async () => {
		const cocs = hit.type === 'Data Element' ? await host.categoryOptionCombos(connectionId, hit.uid) : [];
		const resolved = hit.type === 'Indicator' ? await host.resolveIndicator(connectionId, hit.uid) : [];
		onPick(sourcesFor(hit, cocs, resolved));
		setQuery('');
		setResults(undefined);
	});

	const groups: [string, SourceHit[]][] = results ? [['Data Elements', results.dataElements], ['Indicators', results.indicators], ['Datasets', results.dataSets]] : [];
	return (
		<div className="source-picker">
			<input type="search" placeholder="Search data elements, indicators and datasets (2 letters or more)" value={query} onChange={e => setQuery(e.target.value)} />
			{busy && <span className="muted small">Searching...</span>}
			<ErrorLine error={error} onDismiss={dismiss} />
			{results && (
				<div className="dropdown">
					{groups.every(([, list]) => !list.length) && <div className="muted">Nothing matches "{query}". Has the metadata been synced?</div>}
					{groups.filter(([, list]) => list.length).map(([label, list]) => (
						<div key={label}>
							<div className="dropdown-group">{label}</div>
							{list.map(hit => (
								<button key={`${hit.type}:${hit.uid}`} className="dropdown-item" onClick={() => pick(hit)}>
									<span>{hit.name}</span>
									<span className="muted small">{hit.type === 'Indicator' ? `${hit.elementCount ?? 0} Elements` : hit.code ?? hit.uid}</span>
								</button>
							))}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

/** The indicator's sources -- chips (one per parent indicator), the table, and the active source's disaggregations. */
function Sources({ indicator, onChange }: { indicator: IIndicatorDraft; onChange(sources: IIndicatorSourceDraft[]): void }) {
	const sources = indicator.sources;
	const [showAll, setShowAll] = useState(false);
	const chips = useMemo(() => {
		const seen = new Map<string, { key: string; label: string; ids: string[] }>();
		for (const s of sources) {
			const key = s.parentIndicatorId ? `ind:${s.parentIndicatorId}` : `src:${s.id}`;
			const chip = seen.get(key) ?? { key, label: s.parentIndicatorName ?? s.sourceElement, ids: [] };
			chip.ids.push(s.id);
			seen.set(key, chip);
		}
		return [...seen.values()];
	}, [sources]);
	const active = sources.find(s => s.active) ?? sources[0];

	if (!sources.length) {
		return <div className="muted">No DHIS2 source yet: search for one above.</div>;
	}

	const update = (source: IIndicatorSourceDraft) => onChange(sources.map(s => s.id === source.id && s.parentIndicatorId === source.parentIndicatorId ? source : s));
	const real = active && active.type !== 'DataSet' && !!active.cocs?.length && !active.categoryComboIsDefault;
	const cocs = active?.cocs ?? [];
	const visible = showAll ? cocs : cocs.slice(0, 4);

	return (
		<div className="sources">
			<div className="chips">
				{chips.map(chip => (
					<span key={chip.key} className="chip">{chip.label}
						<button className="plain" title="Remove" onClick={() => onChange(sources.filter(s => !(chip.key.startsWith('ind:') ? s.parentIndicatorId === chip.key.slice(4) : s.id === chip.key.slice(4) && !s.parentIndicatorId)))}>&times;</button>
					</span>
				))}
			</div>
			<table className="table compact">
				<thead><tr><th>Source</th><th>Type</th><th>Included Categories</th></tr></thead>
				<tbody>
					{sources.map(s => (
						<tr key={`${s.parentIndicatorId ?? ''}:${s.id}`} className={s === active ? 'selected' : ''} onClick={() => onChange(sources.map(x => ({ ...x, active: x === s })))}>
							<td>{s.sourceElement}{s.origin && <span className="badge small">{s.origin === 'ai' ? 'AI' : 'Manual'}</span>}{s.parentIndicatorName && <div className="muted small">From indicator: {s.parentIndicatorName}</div>}</td>
							<td>{s.type}</td>
							<td>{s.includedCategoriesText}</td>
						</tr>
					))}
				</tbody>
			</table>
			{active && real && (
				<div className="coc-panel">
					<div className="coc-head">
						<span className="strong">Disaggregations of {active.sourceElement}</span>
						<span className="muted">{cocs.filter(c => c.checked).length} Selected</span>
						<button className="plain" onClick={() => update(withCocs(active, cocs.map(c => ({ ...c, checked: true }))))}>Auto-map all</button>
					</div>
					{visible.map(c => {
						const locked = c.name.trim().toLowerCase() === 'default';
						return (
							<label key={c.uid} className="checkbox">
								<input type="checkbox" checked={locked || c.checked} disabled={locked} onChange={e => update(withCocs(active, cocs.map(x => x.uid === c.uid ? { ...x, checked: e.target.checked } : x)))} />
								{c.name}
							</label>
						);
					})}
					{cocs.length > 4 && <button className="plain" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show ${cocs.length - 4} more`}</button>}
				</div>
			)}
			{active && !real && <div className="muted small">{active.type === 'DataSet' ? 'Datasets have no disaggregation: their reporting rate, reports received and expected are downloaded.' : active.cocs?.length ? 'Default (No Disaggregation)' : 'No category options.'}</div>}
		</div>
	);
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Record<string, T[]> {
	const out: Record<string, T[]> = {};
	for (const item of items) {
		(out[key(item)] ??= []).push(item);
	}
	return out;
}
