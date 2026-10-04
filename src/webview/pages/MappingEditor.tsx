/*---------------------------------------------------------------------------------------------
 *  Data Extractor: editing a mapping -- its indicators on the left, the selected one in the middle (the DHIS2 sources
 *  it sums and the disaggregations of each), and the search for sources on the right. A Countdown mapping has
 *  Countdown's indicators, each to map or to mark as not available; a custom one has its own, grouped into the sheets
 *  of its workbook.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useRef, useState } from 'react';
import { findIndicatorCategoryMismatch, getCountdownIndicatorCategory } from '../../core/countdown';
import { Connection, IAddMappingDraft, IIndicatorDraft, IIndicatorSourceDraft, NotAvailableReason, SourceHit } from '../../shared/api';
import { COUNTDOWN_PARTS, exportCodeFor, isComplete, isNotAvailable, mappingProgress, sourcesFor, withAllCountdownIndicators, withCocs } from '../../shared/mapping';
import { plural, serverName } from '../format';
import { host, useAction } from '../hooks';
import { Banner, Bar, Button, Card, Choices, ErrorLine, Field, Icon, IconButton, KindBadge, SearchBox, Tabs } from '../ui';

type Status = 'mapped' | 'na' | 'missing';
const statusOf = (i: IIndicatorDraft): Status => isComplete(i) ? 'mapped' : isNotAvailable(i) ? 'na' : 'missing';
const isDataSet = (s: IIndicatorSourceDraft) => s.type === 'DataSet' || s.type === 'Dataset';
const hasRealCocs = (s: IIndicatorSourceDraft) => !isDataSet(s) && !!s.cocs?.length && !s.categoryComboIsDefault;
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const CATEGORY_NAMES: Record<string, string> = {
	Population_data: 'Population', Reporting_completeness: 'Reporting rates', Admin_data: 'Health system', Service_data_1: 'Service data 1', Service_data_2: 'Service data 2', Service_data_3: 'Service data 3'
};
const REASONS: readonly { value: NotAvailableReason; label: string; detail: (server: string) => string }[] = [
	{ value: 'notCollected', label: 'Not collected', detail: server => `${server} has no data for this at all.` },
	{ value: 'noMatch', label: 'No matching data', detail: () => 'Something similar is collected, but not this definition.' },
	{ value: 'other', label: 'Other reason', detail: () => 'Explain in the note.' }
];
const DEFAULT_SHEET = 'Indicators';
const categoryOf = (i: IIndicatorDraft) => getCountdownIndicatorCategory(i.exportCode) ?? 'Other';

/** A Countdown mapping's indicators in the order the list shows them: by sheet, then by Countdown's groups. */
function inListOrder(indicators: IIndicatorDraft[]): IIndicatorDraft[] {
	const categories = [...COUNTDOWN_PARTS.flatMap(p => p.categories), 'Other'];
	return categories.flatMap(category => indicators.filter(i => categoryOf(i) === category));
}

/** A custom mapping's sheets: the ones it lists, then any an indicator names, and one to begin with. */
function sheetsOf(draft: IAddMappingDraft): string[] {
	const names = [...(draft.sheets ?? [])];
	for (const i of draft.indicators) {
		if (i.sheet && !names.includes(i.sheet)) {
			names.push(i.sheet);
		}
	}
	return names.length ? names : [DEFAULT_SHEET];
}

export function MappingEditor({ connection, mappingId, done }: { connection: Connection; mappingId: string; done(): void }) {
	const id = connection.id;
	const server = serverName(connection);
	const [draft, setDraft] = useState<IAddMappingDraft>();
	const saved = useRef('');
	const [sel, setSel] = useState<string>();
	const [focus, setFocus] = useState<string>();
	const [filter, setFilter] = useState<'all' | 'missing' | 'na'>('all');
	const [q, setQ] = useState('');
	const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
	const [editingSource, setEditingSource] = useState<string>();
	const [cocQuery, setCocQuery] = useState('');
	const [declaring, setDeclaring] = useState(false);
	const [reason, setReason] = useState<NotAvailableReason>('notCollected');
	const [note, setNote] = useState('');
	const [editTitle, setEditTitle] = useState(false);
	const [renaming, setRenaming] = useState<string>();
	const [dragging, setDragging] = useState<string>();
	const [run, error, busy, dismiss] = useAction();

	useEffect(() => {
		void run(async () => {
			const loaded = await host.getMapping(id, mappingId);
			if (!loaded) {
				throw new Error('That mapping no longer exists.');
			}
			const clean = { ...loaded, indicators: loaded.indicators.map(({ expanded: _expanded, ...rest }) => rest as IIndicatorDraft) };
			const all = clean.mode === 'countdown' ? withAllCountdownIndicators(clean) : { ...clean, sheets: sheetsOf(clean) };
			const ready = clean.mode === 'countdown' ? { ...all, indicators: inListOrder(all.indicators) } : all;
			saved.current = JSON.stringify(ready);
			setDraft(ready);
			const first = ready.indicators.find(i => statusOf(i) === 'missing') ?? ready.indicators[0];
			setSel(first?.id);
			if (first && ready.mode === 'countdown') {
				setOpenGroups({ [categoryOf(first)]: true });
			}
		});
	}, [id, mappingId, run]);

	if (!draft) {
		return <>
			<div className="dx-head__kicker"><button type="button" className="dx-link" onClick={done}>Mappings</button></div>
			<ErrorLine error={error} />
		</>;
	}

	const countdown = draft.mode === 'countdown';
	const indicators = draft.indicators;
	const current = indicators.find(i => i.id === sel) ?? indicators[0];
	const sheets = countdown ? [] : sheetsOf(draft);
	const sheetOf = (i: IIndicatorDraft) => i.sheet && sheets.includes(i.sheet) ? i.sheet : sheets[0];
	const dirty = JSON.stringify(draft) !== saved.current;
	const progress = mappingProgress(draft);
	const needle = q.trim().toLowerCase();
	const matches = (i: IIndicatorDraft) => !needle || `${i.internalName} ${i.exportCode}`.toLowerCase().includes(needle);

	const change = (next: IAddMappingDraft) => setDraft(next);
	const updateIndicator = (indicatorId: string, fn: (i: IIndicatorDraft) => IIndicatorDraft) => change({ ...draft, indicators: indicators.map(i => i.id === indicatorId ? fn(i) : i) });
	const updateCurrent = (fn: (i: IIndicatorDraft) => IIndicatorDraft) => current && updateIndicator(current.id, fn);
	const select = (indicator: IIndicatorDraft) => {
		setSel(indicator.id);
		setDeclaring(false);
		setEditingSource(undefined);
		setCocQuery('');
		if (countdown) {
			setOpenGroups(open => ({ ...open, [categoryOf(indicator)]: true }));
		}
	};
	const step = (delta: number, only?: Status) => {
		const at = Math.max(0, indicators.findIndex(i => i.id === current?.id));
		for (let k = 1; k <= indicators.length; k++) {
			const candidate = indicators[(at + k * delta + indicators.length * k) % indicators.length];
			if (!only || statusOf(candidate) === only) {
				if (focus && countdown) { setFocus(undefined); }
				select(candidate);
				return;
			}
		}
	};

	const save = () => void run(async () => {
		if (!draft.name.trim()) {
			throw new Error('Give this mapping a name before saving.');
		}
		await host.updateMapping(id, mappingId, { ...draft, name: draft.name.trim() });
		done();
	});
	const discard = () => void run(async () => {
		if (!dirty || await host.confirm('Discard your changes?', `What you changed in "${draft.name}" since it was last saved is lost.`, 'Discard')) {
			done();
		}
	});

	// ---- the list on the left
	const parts = countdown ? COUNTDOWN_PARTS.filter(p => !focus || p.name === focus).map(part => ({
		...part,
		groups: [...part.categories, ...(part.name === 'Services' ? ['Other'] : [])].map(category => {
			const all = indicators.filter(i => categoryOf(i) === category);
			const shown = all.filter(i => (filter === 'all' || statusOf(i) === filter) && matches(i));
			const doneCount = all.filter(i => statusOf(i) !== 'missing').length;
			return { category, name: CATEGORY_NAMES[category] ?? category, all, shown, doneCount, open: filter !== 'all' || !!needle || !!openGroups[category] };
		}).filter(g => g.shown.length)
	})).filter(p => p.groups.length) : [];
	const partOf = (i: IIndicatorDraft) => COUNTDOWN_PARTS.find(p => p.categories.includes(categoryOf(i)))?.name ?? 'Services';

	const sheetTabs = countdown
		? [{ value: '', label: 'All sheets', count: indicators.length, cadence: '' }, ...COUNTDOWN_PARTS.map(p => ({ value: p.name, label: p.name, count: indicators.filter(i => partOf(i) === p.name).length, cadence: `· ${p.cadence}` }))]
		: [{ value: '', label: 'All sheets', count: indicators.length, cadence: '' }, ...sheets.map(s => ({ value: s, label: s, count: indicators.filter(i => sheetOf(i) === s).length, cadence: '' }))];

	// ---- a custom mapping's sheets and indicators
	const addSheet = () => {
		let n = sheets.length + 1, name = `Sheet ${n}`;
		while (sheets.includes(name)) { n++; name = `Sheet ${n}`; }
		change({ ...draft, sheets: [...sheets, name] });
		setRenaming(name);
		setFocus(undefined);
	};
	const renameSheet = (from: string, to: string) => {
		if (sheets.includes(to) && to !== from) {
			return;
		}
		change({ ...draft, sheets: sheets.map(s => s === from ? to : s), indicators: indicators.map(i => sheetOf(i) === from ? { ...i, sheet: to } : i) });
		setRenaming(to);
		if (focus === from) { setFocus(to); }
	};
	const removeSheet = (name: string) => {
		const rest = sheets.filter(s => s !== name);
		change({ ...draft, sheets: rest.length ? rest : [DEFAULT_SHEET] });
		setFocus(undefined);
	};
	const groupByDataSet = () => void run(async () => {
		const uids = [...new Set(indicators.map(i => i.sources.find(s => !isDataSet(s))?.id).filter((u): u is string => !!u))];
		const sets = await host.dataSetsOfElements(id, uids);
		const nameOf = (i: IIndicatorDraft) => {
			const first = i.sources[0];
			return !first ? 'No sources yet' : isDataSet(first) ? first.sourceElement : sets[first.id] ?? 'Other';
		};
		const next = indicators.map(i => ({ ...i, sheet: nameOf(i) }));
		change({ ...draft, indicators: next, sheets: [...new Set(next.map(i => i.sheet!))] });
		setFocus(undefined);
		setRenaming(undefined);
	});
	const addIndicator = () => {
		let n = 1;
		while (indicators.some(i => i.exportCode === `new_indicator_${n}`)) { n++; }
		const indicator: IIndicatorDraft = { id: newId(), internalName: 'New indicator', exportCode: `new_indicator_${n}`, kind: 'custom', sources: [], sheet: focus || (current ? sheetOf(current) : sheets[0]) };
		change({ ...draft, indicators: [...indicators, indicator] });
		setSel(indicator.id);
		setEditingSource(undefined);
	};
	const deleteCurrent = () => void run(async () => {
		if (current && (!current.sources.length || await host.confirm('Delete indicator?', `"${current.internalName || 'Untitled indicator'}" and its sources are removed from this mapping.`, 'Delete'))) {
			const rest = indicators.filter(i => i.id !== current.id);
			change({ ...draft, indicators: rest });
			setSel(rest[0]?.id);
		}
	});
	/** Puts the indicator being dragged before another, on that one's sheet; or at the end of a sheet. */
	const drop = (target: { before?: string; sheet: string }) => {
		const moved = indicators.find(i => i.id === dragging);
		setDragging(undefined);
		if (!moved || moved.id === target.before) {
			return;
		}
		const rest = indicators.filter(i => i.id !== moved.id);
		const at = target.before ? rest.findIndex(i => i.id === target.before) : rest.length;
		rest.splice(at < 0 ? rest.length : at, 0, { ...moved, sheet: target.sheet });
		change({ ...draft, indicators: rest });
	};

	// ---- the selected indicator's sources
	const setSources = (sources: IIndicatorSourceDraft[]) => updateCurrent(i => ({ ...i, sources }));
	const addHit = (hit: SourceHit) => void run(async () => {
		if (!current) {
			return;
		}
		const cocs = hit.type === 'Data Element' ? await host.categoryOptionCombos(id, hit.uid) : [];
		const resolved = hit.type === 'Indicator' ? await host.resolveIndicator(id, hit.uid) : [];
		const added = sourcesFor(hit, cocs, resolved).map(s => ({ ...s, active: false }));
		updateIndicator(current.id, i => ({ ...i, notAvailable: undefined, sources: [...i.sources, ...added.filter(a => !i.sources.some(s => s.id === a.id))] }));
		setDeclaring(false);
	});
	const isAdded = (hit: SourceHit) => !!current?.sources.some(s => s.id === hit.uid || s.parentIndicatorId === hit.uid);
	const mismatch = current && findIndicatorCategoryMismatch(current);
	const currentStatus = current ? statusOf(current) : 'missing';
	const group = current && countdown ? indicators.filter(i => categoryOf(i) === categoryOf(current)) : [];
	const naReason = REASONS.find(r => r.value === current?.notAvailable?.reason);
	const withoutSources = indicators.filter(i => !i.sources.length).length;

	return (
		<>
			<header className="dx-head">
				<div>
					<div className="dx-head__kicker"><button type="button" className="dx-link" onClick={discard}>Mappings</button> / {countdown ? 'Countdown' : 'Custom'}</div>
					<div className="dx-row dx-wrap" style={{ marginTop: 4, gap: 12 }}>
						{editTitle
							? <>
								<label>
									<span className="dx-sr">Mapping name</span>
									<input className="dx-input dx-input--title" type="text" autoFocus value={draft.name} aria-invalid={!draft.name.trim()} onChange={e => change({ ...draft, name: e.target.value })}
										onKeyDown={e => { if (e.key === 'Enter' && draft.name.trim()) { setEditTitle(false); } }} />
								</label>
								<Button label="Done" variant="inverse" disabled={!draft.name.trim()} onClick={() => setEditTitle(false)} />
							</>
							: <>
								<h1 style={{ margin: 0, fontSize: 26 }}>{draft.name}</h1>
								<IconButton icon="pencil" label="Rename mapping" tone="bare" onClick={() => setEditTitle(true)} />
							</>}
						<KindBadge mode={draft.mode} />
					</div>
				</div>
				<div className="dx-head__actions" style={{ gap: 14 }}>
					{countdown
						? <div style={{ minWidth: 200 }}>
							<div className="dx-muted" style={{ fontSize: 13, marginBottom: 6 }}>{progress.mapped} of {progress.total} mapped{progress.notAvailable ? ` · ${progress.notAvailable} not available` : ''}</div>
							<Bar pct={progress.total ? Math.round((progress.mapped + progress.notAvailable) / progress.total * 100) : 0} />
						</div>
						: <div style={{ fontSize: 13, color: withoutSources ? 'var(--dx-warn)' : 'var(--dx-muted)' }}>{plural(indicators.length, 'indicator')} · {plural(sheets.length, 'sheet')} · {withoutSources ? `${withoutSources} without sources` : 'all have sources'}</div>}
					<Button label="Discard" onClick={discard} />
					<Button label="Save mapping" variant="primary" disabled={busy || !dirty} title={dirty ? 'Save mapping' : 'Nothing has changed'} onClick={save} />
				</div>
			</header>
			<ErrorLine error={error} onDismiss={dismiss} />

			<section className="dx-card dx-sheets" aria-label="Sheets in the download">
				<div className="dx-row dx-wrap" style={{ justifyContent: 'space-between' }}>
					<div className="dx-row dx-wrap" style={{ gap: 8 }}>
						<Icon name="sheet" stroke={1.9} />
						<span style={{ fontWeight: 600 }}>Sheets in the Excel download</span>
						<span className="dx-muted" style={{ fontSize: 13 }}>· {countdown ? 'one per part of the Countdown download' : 'each group of indicators becomes its own sheet'}</span>
					</div>
					{countdown
						? <span className="dx-row dx-muted" style={{ fontSize: 12, gap: 6 }}><Icon name="lock" size={12} stroke={2.2} />Set by Countdown 2030, can't be changed</span>
						: <div className="dx-row dx-wrap" style={{ gap: 6 }}>
							<Button label="Group by data set" size="md" disabled={busy || !indicators.length} onClick={groupByDataSet} />
							<Button label="Add sheet" icon="plus" size="md" variant="dashed" onClick={addSheet} />
						</div>}
				</div>
				<div className="dx-sheets__tabs" role="tablist" aria-label="Show sheet">
					{sheetTabs.map(t => (
						<button key={t.value} type="button" role="tab" aria-selected={(focus ?? '') === t.value} onClick={() => setFocus(t.value || undefined)}>
							{t.label} <small>{t.count}</small>{t.cadence && <small>{t.cadence}</small>}
						</button>
					))}
				</div>
			</section>

			<div className="dx-panes">
				<Card label={countdown ? 'Indicators' : 'Your indicators'}>
					<div className="dx-stack" style={{ padding: 12, borderBottom: '1px solid var(--dx-border)', gap: 10 }}>
						{!countdown && <Button label="Add indicator" icon="plus" variant="dashed" size="md" block onClick={addIndicator} />}
						<SearchBox tight value={q} placeholder={countdown ? `Filter ${indicators.length} indicators` : 'Filter indicators'} label="Filter indicators" onChange={setQ} />
						{countdown && (
							<div className="dx-pills" role="tablist" aria-label="Show">
								{([['all', 'All', progress.total], ['missing', 'Not mapped', progress.missing], ['na', 'Not available', progress.notAvailable]] as const).map(([value, label, n]) => (
									<button key={value} type="button" role="tab" aria-selected={filter === value} aria-pressed={filter === value} className="dx-pill dx-pill--sm" onClick={() => setFilter(value)}>{label} {n}</button>
								))}
							</div>
						)}
					</div>
					<div className="dx-list">
						{countdown && parts.length === 0 && <div className="dx-empty">No indicators match.</div>}
						{parts.map(part => (
							<div key={part.name}>
								<div className="dx-list__part"><span>{part.name}</span><span>{part.cadence}</span></div>
								{part.groups.map(g => (
									<div key={g.category}>
										<button type="button" className="dx-group" aria-expanded={g.open} onClick={() => setOpenGroups({ ...openGroups, [g.category]: !openGroups[g.category] })}>
											<span className="dx-group__row">
												<Icon name="chevron-right" size={14} stroke={2.2} />
												<span className="dx-grow" style={{ fontWeight: 500 }}>{g.name}</span>
												<span className="dx-num" style={{ fontSize: 12, color: g.doneCount === g.all.length ? 'var(--dx-muted)' : 'var(--dx-warn)' }}>{g.doneCount}/{g.all.length}</span>
											</span>
											<Bar thin pct={g.all.length ? Math.round(g.doneCount / g.all.length * 100) : 0} warn={g.doneCount < g.all.length} />
										</button>
										{g.open && g.shown.map(i => {
											const st = statusOf(i);
											return (
												<button key={i.id} type="button" className="dx-item" aria-current={i.id === current?.id || undefined} onClick={() => select(i)}>
													<Icon name={st === 'mapped' ? 'check' : st === 'na' ? 'na' : 'missing'} size={14} stroke={st === 'mapped' ? 2.4 : 2} className={st === 'mapped' ? 'dx-ok' : st === 'na' ? 'dx-na' : 'dx-missing'} />
													<span className="dx-grow">{i.internalName || i.exportCode}</span>
													<span className={`dx-item__status${st === 'missing' ? ' dx-item__status--warn' : ''}`}>{st === 'mapped' ? plural(i.sources.length, 'source') : st === 'na' ? 'Not available' : 'Not mapped'}</span>
												</button>
											);
										})}
									</div>
								))}
							</div>
						))}
						{!countdown && sheets.filter(s => !focus || s === focus).map(sheet => {
							const all = indicators.filter(i => sheetOf(i) === sheet);
							return (
								<div key={sheet} onDragOver={e => e.preventDefault()} onDrop={() => drop({ sheet })}>
									<div className="dx-sheethead">
										<Icon name="sheet" size={14} stroke={1.9} />
										{renaming === sheet
											? <>
												<input className="dx-input dx-input--white" style={{ height: 32, fontSize: 13, fontWeight: 600 }} type="text" aria-label="Sheet name" autoFocus value={sheet} onChange={e => renameSheet(sheet, e.target.value)}
													onKeyDown={e => { if (e.key === 'Enter') { setRenaming(undefined); } }} />
												<Button label="Done" size="sm" variant="inverse" disabled={!sheet.trim()} onClick={() => setRenaming(undefined)} />
											</>
											: <>
												<span className="dx-sheethead__name dx-ellipsis">{sheet}</span>
												<span className="dx-muted" style={{ fontSize: 12 }}>{all.length}</span>
												<IconButton icon="pencil" label={`Rename sheet ${sheet}`} size="sm" tone="bare" onClick={() => setRenaming(sheet)} />
												{all.length === 0 && sheets.length > 1 && <IconButton icon="trash" label={`Delete sheet ${sheet}`} size="sm" tone="bare" onClick={() => removeSheet(sheet)} />}
											</>}
									</div>
									{all.length === 0 && <div className="dx-muted" style={{ padding: '8px 16px 14px 36px', fontSize: 13 }}>No indicators yet. Select one and choose this sheet, or add a new one.</div>}
									{all.filter(matches).map(i => (
										<button key={i.id} type="button" className="dx-item dx-item--flat" aria-current={i.id === current?.id || undefined} draggable onClick={() => select(i)}
											onDragStart={() => setDragging(i.id)} onDragEnd={() => setDragging(undefined)} onDragOver={e => e.preventDefault()}
											onDrop={e => { e.stopPropagation(); drop({ before: i.id, sheet }); }} style={{ opacity: dragging === i.id ? 0.5 : undefined }}>
											<Icon name="grip" size={14} className="dx-grip" />
											<span className="dx-grow">{i.internalName || 'Untitled indicator'}</span>
											<span className={`dx-item__status${i.sources.length ? '' : ' dx-item__status--warn'}`}>{i.sources.length ? plural(i.sources.length, 'source') : 'No sources'}</span>
										</button>
									))}
								</div>
							);
						})}
					</div>
				</Card>

				<section className="dx-card dx-detail" aria-label="Selected indicator">
					{!current && <div className="dx-empty"><strong>No indicators yet</strong>Add one on the left, then search for its sources on the right.</div>}
					{current && countdown && (
						<div className="dx-row dx-wrap" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
							<div className="dx-grow">
								<div className="dx-eyebrow">{partOf(current)} · {CATEGORY_NAMES[categoryOf(current)] ?? 'Other'} · {group.indexOf(current) + 1} of {group.length}</div>
								<h2>{current.internalName || current.exportCode}</h2>
								<p className="dx-muted" style={{ marginTop: 6 }}>Countdown sets the name and meaning (<span className="dx-mono">{current.exportCode}</span>); you choose which data in {server} feeds it.</p>
							</div>
							<div className="dx-row" style={{ gap: 6 }}>
								<IconButton icon="chevron-left" label="Previous indicator" onClick={() => step(-1)} />
								<IconButton icon="chevron-right" label="Next indicator" onClick={() => step(1)} />
								{progress.missing > 0 && <Button label="Next not mapped" size="md" variant="warn" onClick={() => step(1, 'missing')} />}
							</div>
						</div>
					)}
					{current && !countdown && (
						<div className="dx-pair" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 12 }}>
							<Field label="Indicator name">
								<input className="dx-input" style={{ fontSize: 16, fontWeight: 500 }} type="text" value={current.internalName} onChange={e => {
									const name = e.target.value;
									// the column follows the name until it is given its own
									updateCurrent(i => ({ ...i, internalName: name, exportCode: !i.exportCode || i.exportCode === exportCodeFor(i.internalName) || /^new_indicator_\d+$/.test(i.exportCode) ? exportCodeFor(name) : i.exportCode }));
								}} />
							</Field>
							<Field label="Column in the download">
								<input className="dx-input dx-input--mono" type="text" value={current.exportCode} onChange={e => { const code = e.target.value; updateCurrent(i => ({ ...i, exportCode: code })); }} />
							</Field>
							<Field label="Sheet in the download">
								<select className="dx-select" value={sheetOf(current)} onChange={e => { const sheet = e.target.value; updateCurrent(i => ({ ...i, sheet })); }}>
									{sheets.map(s => <option key={s} value={s}>{s}</option>)}
								</select>
							</Field>
						</div>
					)}
					{mismatch && <Banner tone="warn" icon="warning">{mismatch}</Banner>}

					{current && current.sources.length > 0 && <>
						<div className="dx-stack" style={{ gap: 10 }}>
							{current.sources.map((s, n) => {
								const key = `${current.id}:${s.id}:${n}`;
								return <SourceCard key={key} source={s} editing={editingSource === key} cocQuery={editingSource === key ? cocQuery : ''} setCocQuery={setCocQuery}
									edit={() => { setEditingSource(key); setCocQuery(''); }} done={() => setEditingSource(undefined)}
									change={next => setSources(current.sources.map((x, k) => k === n ? next : x))}
									remove={() => { setSources(current.sources.filter((_, k) => k !== n)); setEditingSource(undefined); }} />;
							})}
						</div>
						<div className="dx-note"><Icon name="info" />More than one source: their values are summed for each period and organisation unit. Add another from the search on the right.</div>
					</>}

					{current && current.sources.length === 0 && countdown && currentStatus === 'missing' && !declaring && (
						<div className="dx-unmapped">
							<strong>Not mapped yet</strong>
							<div>Search on the right and add the data that counts this. Downloads leave it out until then.</div>
							<div style={{ marginTop: 8 }}><Button label="Can't be mapped…" icon="na" onClick={() => { setDeclaring(true); setReason('notCollected'); setNote(''); }} /></div>
						</div>
					)}
					{current && current.sources.length === 0 && !countdown && (
						<div className="dx-unmapped dx-unmapped--plain">
							<strong>No sources yet</strong>
							<div>Search on the right for data elements, indicators or data sets, and add one or more.</div>
						</div>
					)}
					{current && declaring && currentStatus === 'missing' && (
						<form className="dx-box" onSubmit={e => { e.preventDefault(); updateCurrent(i => ({ ...i, notAvailable: { reason, note: note.trim() || undefined } })); setDeclaring(false); }}>
							<div>
								<div style={{ fontWeight: 600 }}>Mark as not available</div>
								<div className="dx-muted" style={{ marginTop: 4 }}>It counts as done for this mapping. Downloads keep its column, empty and labelled “not available”.</div>
							</div>
							<fieldset className="dx-stack" style={{ border: 'none', margin: 0, padding: 0, gap: 8 }}>
								<legend className="dx-muted" style={{ fontSize: 13, padding: 0, marginBottom: 8 }}>Why?</legend>
								<Choices name="na-reason" value={reason} onChange={setReason} options={REASONS.map(r => ({ value: r.value, label: r.label, detail: r.detail(server) }))} />
							</fieldset>
							<Field label="Note (optional)">
								<textarea className="dx-textarea" rows={2} value={note} placeholder="For example: collected on paper only since 2023" onChange={e => setNote(e.target.value)} />
							</Field>
							<div className="dx-row dx-wrap" style={{ justifyContent: 'flex-end', gap: 8 }}>
								<Button label="Cancel" onClick={() => setDeclaring(false)} />
								<Button label="Mark as not available" type="submit" variant="inverse" />
							</div>
						</form>
					)}
					{current && currentStatus === 'na' && (
						<div className="dx-box dx-box--sunken">
							<Icon name="na" size={22} className="dx-muted" />
							<div className="dx-grow">
								<div style={{ fontWeight: 600 }}>Not available in {server}</div>
								{naReason && <div style={{ marginTop: 4 }}>{naReason.label}: {naReason.detail(server)}</div>}
								{current.notAvailable?.note && <div className="dx-muted" style={{ marginTop: 6, fontStyle: 'italic' }}>“{current.notAvailable.note}”</div>}
								<div className="dx-muted" style={{ marginTop: 8, fontSize: 13 }}>Counts as done. Downloads keep its column, empty and labelled “not available”.</div>
							</div>
							<Button label="Map it instead" size="md" onClick={() => updateCurrent(i => ({ ...i, notAvailable: undefined }))} />
						</div>
					)}

					{current && !countdown && (
						<div className="dx-row dx-wrap" style={{ justifyContent: 'space-between', paddingTop: 14, borderTop: '1px solid var(--dx-border)' }}>
							<div className="dx-muted" style={{ fontSize: 13 }}>Drag indicators on the left to change the column order.</div>
							<Button label="Delete indicator" size="md" variant="danger" onClick={deleteCurrent} />
						</div>
					)}
				</section>

				<FindSources connectionId={id} server={server} disabled={!current} isAdded={isAdded} add={addHit} />
			</div>
		</>
	);
}

/** One source of an indicator: what it is, and which of its disaggregations count. */
function SourceCard({ source, editing, cocQuery, setCocQuery, edit, done, change, remove }: {
	source: IIndicatorSourceDraft; editing: boolean; cocQuery: string; setCocQuery(value: string): void; edit(): void; done(): void; change(next: IIndicatorSourceDraft): void; remove(): void;
}) {
	const cocs = source.cocs ?? [];
	const real = hasRealCocs(source);
	const included = cocs.filter(c => c.checked);
	const needle = cocQuery.trim().toLowerCase();
	const shown = cocs.filter(c => !needle || c.name.toLowerCase().includes(needle));
	const set = (checked: (uid: string, was: boolean) => boolean) => change(withCocs(source, cocs.map(c => ({ ...c, checked: checked(c.uid, c.checked) }))));
	const shownIds = new Set(shown.map(c => c.uid));
	const summary = `${included.length} of ${cocs.length} included`;
	return (
		<div className="dx-source">
			<div className="dx-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
				<div className="dx-grow">
					<div style={{ fontWeight: 500 }}>{source.sourceElement}</div>
					<div className="dx-muted" style={{ fontSize: 12, marginTop: 2 }}>
						{isDataSet(source) ? 'Data set' : source.type || 'Data element'} · <span className="dx-mono">{source.id}</span>
						{source.parentIndicatorName && <> · from the indicator {source.parentIndicatorName}</>}
						{source.origin === 'ai' && <> · <span className="dx-badge dx-badge--info dx-badge--sm">Suggested by the assistant</span></>}
					</div>
				</div>
				<IconButton icon="close" label={`Remove ${source.sourceElement}`} size="sm" tone="quiet" onClick={remove} />
			</div>
			{!real && <div className="dx-muted" style={{ fontSize: 12 }}>{isDataSet(source) ? 'Its reporting rate, reports received and reports expected.' : 'No disaggregations: its total is used.'}</div>}
			{real && !editing && (
				<div className="dx-cocs">
					<span className="dx-muted" style={{ fontSize: 12, marginRight: 4 }}>Disaggregations</span>
					{included.slice(0, 4).map(c => <span key={c.uid} className="dx-badge dx-badge--accent" style={{ fontWeight: 400 }}>{c.name}</span>)}
					{included.length > 4 && <span className="dx-badge" style={{ fontWeight: 400 }}>+{included.length - 4} more</span>}
					{included.length < cocs.length && <span className="dx-muted" style={{ fontSize: 12 }}>{summary}</span>}
					<button type="button" className="dx-pill dx-pill--sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--dx-surface)' }} onClick={edit}><Icon name="pencil" size={12} stroke={2.2} />Edit</button>
				</div>
			)}
			{real && editing && (
				<div className="dx-source__edit">
					<div className="dx-row dx-wrap" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
						<span style={{ fontSize: 13, fontWeight: 500 }}>Which disaggregations count?</span>
						<span className="dx-muted" style={{ fontSize: 12 }}>{summary} · included values are summed</span>
					</div>
					{cocs.length > 8 && <SearchBox tight value={cocQuery} placeholder={`Filter ${cocs.length} disaggregations`} label="Filter disaggregations" onChange={setCocQuery} />}
					<div className="dx-cocs dx-cocs--scroll" role="group" aria-label="Disaggregations">
						{shown.map(c => (
							<button key={c.uid} type="button" className="dx-coc" aria-pressed={c.checked} onClick={() => set((uid, was) => uid === c.uid ? !was : was)}>
								{c.checked && <Icon name="check" size={12} stroke={2.6} />}{c.name}
							</button>
						))}
					</div>
					{included.length === 0 && <div style={{ fontSize: 12, color: 'var(--dx-warn)' }}>Include at least one, or remove this source.</div>}
					<div className="dx-row dx-wrap" style={{ justifyContent: 'flex-end', gap: 8 }}>
						<Button label={needle ? 'Exclude shown' : 'Exclude all'} size="sm" onClick={() => set((uid, was) => shownIds.has(uid) ? false : was)} />
						<Button label={needle ? 'Include shown' : 'Include all'} size="sm" onClick={() => set((uid, was) => shownIds.has(uid) ? true : was)} />
						<Button label="Done" size="sm" variant="inverse" disabled={included.length === 0} onClick={done} />
					</div>
				</div>
			)}
		</div>
	);
}

type Kind = 'all' | SourceHit['type'];

/** The search of the server's data elements, indicators and data sets, to add to the selected indicator. */
function FindSources({ connectionId, server, disabled, isAdded, add }: { connectionId: string; server: string; disabled: boolean; isAdded(hit: SourceHit): boolean; add(hit: SourceHit): void }) {
	const [query, setQuery] = useState('');
	const [kind, setKind] = useState<Kind>('all');
	const [hits, setHits] = useState<SourceHit[]>();
	const [failed, setFailed] = useState<string>();

	useEffect(() => {
		if (query.trim().length < 2) {
			setHits(undefined);
			return;
		}
		const timer = setTimeout(() => void host.searchSources(connectionId, query.trim()).then(
			r => { setHits([...r.dataElements, ...r.indicators, ...r.dataSets]); setFailed(undefined); },
			(e: Error) => { setHits([]); setFailed(e.message); }
		), 300);
		return () => clearTimeout(timer);
	}, [query, connectionId]);

	const count = (type: Kind) => (hits ?? []).filter(h => type === 'all' || h.type === type).length;
	const shown = useMemo(() => (hits ?? []).filter(h => kind === 'all' || h.type === kind), [hits, kind]);
	const detail = (hit: SourceHit) => hit.type === 'Data Element' ? `Data element${hit.categoryComboIsDefault ? ' · no disaggregations' : ''}`
		: hit.type === 'Indicator' ? `Indicator${hit.elementCount !== undefined ? ` · ${plural(hit.elementCount, 'data element')}` : ''}` : 'Data set · reporting rate';

	return (
		<Card label="Find sources">
			<div className="dx-stack" style={{ padding: '14px 16px', borderBottom: '1px solid var(--dx-border)', gap: 10 }}>
				<h2 style={{ fontSize: 15, fontWeight: 600 }}>Find sources</h2>
				<SearchBox tight value={query} placeholder={`Search ${server}`} label="Search data elements, indicators and data sets" onChange={setQuery} />
				{hits && <Tabs label="Kind" value={kind} onChange={setKind} options={[
					{ value: 'all', label: 'All', count: count('all') }, { value: 'Data Element', label: 'Data elements', count: count('Data Element') },
					{ value: 'Indicator', label: 'Indicators', count: count('Indicator') }, { value: 'DataSet', label: 'Data sets', count: count('DataSet') }
				]} />}
			</div>
			{failed && <div className="dx-empty" style={{ color: 'var(--dx-bad)' }}>{failed}</div>}
			{!hits && <div className="dx-empty">Type part of a name, a code or a form number to search the data elements, indicators and data sets of {server}.</div>}
			{hits && !failed && shown.length === 0 && <div className="dx-empty">Nothing on {server} matches. Try part of a name or a form number.</div>}
			<div className="dx-hits">
				{shown.map(hit => (
					<div key={`${hit.type}:${hit.uid}`} className="dx-hit">
						<div className="dx-grow">
							<div style={{ fontWeight: 500 }}>{hit.name}</div>
							<div className="dx-muted" style={{ fontSize: 12, marginTop: 2 }}>{detail(hit)}</div>
						</div>
						{isAdded(hit) ? <span className="dx-nowrap" style={{ fontSize: 13, color: 'var(--dx-accent-ink)' }}>Added</span> : <Button label="Add" size="sm" variant="soft" disabled={disabled} onClick={() => add(hit)} />}
					</div>
				))}
			</div>
		</Card>
	);
}
