/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the New download dialog -- the mapping, the periods (a preset, or a range of months or years picked
 *  in the Gregorian or the Ethiopian calendar), the organisation unit level, and what the download will take.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useState } from 'react';
import { toEthiopic, toGregorian } from '../../core/ethiopicDate';
import { isEthiopianCalendar } from '../../core/periods';
import { Connection, DownloadEstimate, DownloadRequest, OrgUnitHit } from '../../shared/api';
import { ETHIOPIC_MONTHS, monthName, plural, serverName } from '../format';
import { host, useAction, useLoad } from '../hooks';
import { formatNumber } from '../locale';
import { Button, Dialog, ErrorLine, Icon, IconButton, Popover, SearchBox, Segmented } from '../ui';

type Cal = 'gregorian' | 'ethiopic';
type Preset = 'last12' | 'thisYear' | 'lastYear' | 'custom';
type Unit = 'monthly' | 'yearly';

const PRESETS: readonly { value: Preset; label: string }[] = [
	{ value: 'last12', label: 'Last 12 months' }, { value: 'thisYear', label: 'This year' }, { value: 'lastYear', label: 'Last year' }, { value: 'custom', label: 'Custom range' }
];

// A month is counted as year * 12 + month (0-11) in the calendar it is picked in.
const yearOf = (index: number) => Math.floor(index / 12);
const monthOf = (index: number) => ((index % 12) + 12) % 12;
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** This month, in a calendar (the Ethiopian year's 13th month counts with its 12th). */
function currentMonth(cal: Cal): number {
	const now = new Date();
	if (cal === 'gregorian') {
		return now.getFullYear() * 12 + now.getMonth();
	}
	const e = toEthiopic(now);
	return e.year * 12 + Math.min(e.month, 12) - 1;
}

/** The Gregorian month an Ethiopian month starts in: "Sep 2024" for Meskerem 2017. */
function startsIn(index: number): string {
	const start = toGregorian(yearOf(index), monthOf(index) + 1, 1);
	return `${monthName(start.getMonth())} ${start.getFullYear()}`;
}

const monthLabel = (index: number, cal: Cal) => cal === 'ethiopic' ? `${ETHIOPIC_MONTHS[monthOf(index)]} ${yearOf(index)}` : `${monthName(monthOf(index))} ${yearOf(index)}`;
const yearLabel = (year: number, cal: Cal) => cal === 'ethiopic' ? `${year} EC` : String(year);
/** The Gregorian months an Ethiopian year runs over: "Sep 2023 – Sep 2024". */
const yearSpan = (year: number) => `${startsIn(year * 12)} – ${monthName(8)} ${toGregorian(year, 12, 30).getFullYear()}`;

/**
 * A picked month as a date the host turns into the server's periods. On an Ethiopian-calendar server a Gregorian month
 * stands for the Ethiopian month that starts in it (which holds its 15th), so the 15th is given.
 */
function dateOf(index: number, cal: Cal, serverEthiopic: boolean, end: boolean): string {
	const year = yearOf(index), month = monthOf(index);
	if (cal === 'ethiopic') {
		return iso(toGregorian(year, month + 1, end ? 30 : 1));
	}
	if (serverEthiopic) {
		return `${year}-${pad(month + 1)}-15`;
	}
	return end ? iso(new Date(year, month + 1, 0)) : `${year}-${pad(month + 1)}-01`;
}

export function NewDownload({ connection, mappingId: initialMapping, close, started }: { connection: Connection; mappingId?: string; close(): void; started(): void }) {
	const id = connection.id;
	const mappings = useLoad(() => host.listMappings(id), [id]);
	const levels = useLoad(() => host.orgUnitLevels(id), [id]);
	const calendar = useLoad(() => host.calendar(id), [id]);
	const settings = useLoad(() => host.settings(id), [id]);
	const serverEthiopic = isEthiopianCalendar(calendar.value);

	const [mappingId, setMappingId] = useState(initialMapping ?? '');
	const [cal, setCal] = useState<Cal>('gregorian');
	const [preset, setPreset] = useState<Preset>('last12');
	const [unit, setUnit] = useState<Unit>('monthly');
	const [span, setSpan] = useState<[number, number]>(() => { const last = currentMonth('gregorian') - 1; return [last - 11, last]; });
	const [open, setOpen] = useState<'from' | 'to'>();
	const [page, setPage] = useState(0);
	const [level, setLevel] = useState(0);
	const [boundary, setBoundary] = useState<OrgUnitHit>();
	const [boundaryQuery, setBoundaryQuery] = useState('');
	const [boundaryHits, setBoundaryHits] = useState<OrgUnitHit[]>();
	const [estimate, setEstimate] = useState<DownloadEstimate>();
	const [run, error, busy, dismiss] = useAction();

	const mapping = mappings.value?.find(m => m.id === mappingId);
	const levelInfo = levels.value?.find(l => l.level === level);
	useEffect(() => { if (!mappingId && mappings.value?.length) { setMappingId(mappings.value[0].id); } }, [mappings.value, mappingId]);
	useEffect(() => { if (!level && levels.value?.length) { setLevel(levels.value[0].level); } }, [levels.value, level]);
	// What the settings say comes first: the calendar and the period type
	useEffect(() => {
		if (settings.value && calendar.value !== undefined) {
			const next: Cal = serverEthiopic && settings.value.calendar !== 'gregorian' ? 'ethiopic' : 'gregorian';
			setCal(next);
			setUnit(settings.value.periodType);
			const last = currentMonth(next) - 1;
			setSpan([last - 11, last]);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [settings.value, calendar.value]);

	const last = currentMonth(cal) - 1; // the last month that is over
	const yearStart = yearOf(last + 1) * 12;
	const [from, to]: [number, number] = preset === 'last12' ? [last - 11, last]
		: preset === 'thisYear' ? [Math.min(yearStart, last), last]
			: preset === 'lastYear' ? [yearStart - 12, yearStart - 1]
				: unit === 'yearly' && mapping?.mode === 'custom' ? [yearOf(span[0]) * 12, yearOf(span[1]) * 12 + 11] : span;
	// a Countdown download is always monthly (its population part yearly): only a custom mapping can be by year
	const customMapping = mapping?.mode === 'custom';
	const yearly = preset === 'custom' && unit === 'yearly' && customMapping;
	const periods = yearly ? yearOf(to) - yearOf(from) + 1 : to - from + 1;

	const switchCalendar = (next: Cal) => {
		// the same months, counted in the other calendar (an Ethiopian month and the Gregorian month it starts in)
		const shift = (index: number) => next === 'ethiopic'
			? (() => { const e = toEthiopic(new Date(yearOf(index), monthOf(index), 15)); return e.year * 12 + Math.min(e.month, 12) - 1; })()
			: (() => { const g = toGregorian(yearOf(index), monthOf(index) + 1, 1); return g.getFullYear() * 12 + g.getMonth(); })();
		setSpan([shift(span[0]), shift(span[1])]);
		setCal(next);
		setOpen(undefined);
	};

	const request = useMemo<DownloadRequest | undefined>(() => mappingId && level ? {
		mappingId, startDate: dateOf(from, cal, serverEthiopic, false), endDate: dateOf(to, cal, serverEthiopic, true),
		periodType: yearly ? 'yearly' : 'monthly', adminLevel: `LEVEL-${level}`, boundaryOrgUnitUid: boundary?.uid
	} : undefined, [mappingId, from, to, cal, serverEthiopic, yearly, level, boundary, mapping?.mode]);

	useEffect(() => {
		setEstimate(undefined);
		if (!request) {
			return;
		}
		const timer = setTimeout(() => void host.estimateDownload(id, request).then(setEstimate, () => setEstimate(undefined)), 300);
		return () => clearTimeout(timer);
	}, [id, request]);

	useEffect(() => {
		if (boundaryQuery.trim().length < 2) {
			setBoundaryHits(undefined);
			return;
		}
		const timer = setTimeout(() => void host.searchOrgUnits(id, boundaryQuery.trim(), level).then(setBoundaryHits, () => setBoundaryHits([])), 300);
		return () => clearTimeout(timer);
	}, [id, boundaryQuery, level]);

	const pick = (index: number) => {
		if (open === 'from') {
			setSpan([index, Math.max(span[1], index)]);
			setOpen('to');
			setPage(yearly ? page : yearOf(Math.max(span[1], index)));
		} else {
			setSpan([Math.min(span[0], index), Math.max(span[0], index)]);
			setOpen(undefined);
		}
	};
	const toggle = (which: 'from' | 'to') => {
		setOpen(open === which ? undefined : which);
		setPage(yearly ? yearOf(last) : yearOf(which === 'from' ? span[0] : span[1]));
	};

	// The popup's cells: the 12 months of a year, or 12 years ending at `page`
	const cells = Array.from({ length: 12 }, (_, i) => {
		const index = yearly ? (page - 11 + i) * 12 : page * 12 + i;
		const at = (edge: number) => yearly ? yearOf(edge) === yearOf(index) : edge === index;
		const future = yearly ? yearOf(index) > yearOf(last + 1) : index > last;
		return {
			index, future,
			label: yearly ? yearLabel(yearOf(index), cal) : cal === 'ethiopic' ? ETHIOPIC_MONTHS[i] : monthName(i),
			sub: cal === 'ethiopic' ? (yearly ? yearSpan(yearOf(index)) : startsIn(index)) : '',
			end: at(span[0]) || at(span[1]),
			inside: index > span[0] && index < span[1] && !at(span[0]) && !at(span[1])
		};
	});

	const fields = (['from', 'to'] as const).map((which, n) => {
		const index = span[n];
		return {
			which,
			title: `${which === 'from' ? 'From' : 'To'} ${yearly ? 'year' : 'month'}`,
			value: yearly ? yearLabel(yearOf(index), cal) : monthLabel(index, cal),
			sub: cal === 'ethiopic' ? (yearly ? yearSpan(yearOf(index)) : startsIn(index)) : ''
		};
	});

	const rangeText = yearly
		? `${yearLabel(yearOf(from), cal)}${periods > 1 ? ` – ${yearLabel(yearOf(to), cal)}` : ''}`
		: `${monthLabel(from, cal)}${periods > 1 ? ` – ${monthLabel(to, cal)}` : ''}${cal === 'ethiopic' ? ` EC · about ${startsIn(from)} – ${startsIn(to)}` : ''}`;
	const canStart = !!request && !busy && !!mapping && mapping.indicatorsCount > 0;
	const big = (estimate?.requests ?? 0) > 200;

	return (
		<Dialog title="New download" sub={`Choose what to fetch from ${serverName(connection)}.`} onClose={close} footer={<>
			<Button label="Cancel" size="lg" onClick={close} />
			<Button label="Start download" size="lg" variant="primary" disabled={!canStart} onClick={() => void run(async () => { await host.startDownload(id, request!); started(); })} />
		</>}>
			<ErrorLine error={error ?? mappings.error ?? levels.error} onDismiss={dismiss} />

			<label className="dx-field">
				<span className="dx-field__label--strong">Mapping</span>
				<select className="dx-select" value={mappingId} onChange={e => setMappingId(e.target.value)}>
					{!mappings.value?.length && <option value="">No mappings yet</option>}
					{mappings.value?.map(m => <option key={m.id} value={m.id}>{m.name}  ·  {m.mode === 'countdown' ? 'Countdown' : 'Custom'}, {plural(m.mappedCount ?? m.indicatorsCount, 'indicator')} mapped</option>)}
				</select>
				{mapping?.mode === 'countdown' && <span className="dx-field__hint" style={{ fontSize: 13 }}>A Countdown download is always monthly: reporting completeness and services by month, population by year, and the health-system figures once for each unit.</span>}
			</label>

			<fieldset className="dx-stack" style={{ border: 'none', margin: 0, padding: 0, minWidth: 0 }}>
				<legend className="dx-field__label--strong" style={{ padding: 0, marginBottom: 10 }}>Time range</legend>
				<div className="dx-row dx-wrap" style={{ justifyContent: 'space-between' }}>
					<div className="dx-pills">
						{PRESETS.map(p => <button key={p.value} type="button" className="dx-pill" aria-pressed={p.value === preset} onClick={() => { setPreset(p.value); setOpen(undefined); }}>{p.label}</button>)}
					</div>
					{serverEthiopic && <Segmented label="Calendar" value={cal} onChange={switchCalendar} options={[{ value: 'gregorian', label: 'Gregorian' }, { value: 'ethiopic', label: 'Ethiopian' }]} />}
				</div>

				{preset === 'custom' && (
					<div className="dx-range">
						{customMapping
							? <div className="dx-row dx-wrap">
								<span className="dx-muted" style={{ fontSize: 13 }}>Pick by</span>
								<Segmented label="Period type" value={unit} onChange={u => { setUnit(u); setOpen(undefined); }} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} />
							</div>
							: <span className="dx-muted" style={{ fontSize: 13 }}>A Countdown download is always monthly.</span>}
						<div className="dx-pair">
							{fields.map(f => (
								<Popover key={f.which} className="dx-pick" open={open === f.which} close={() => setOpen(undefined)}>
									<span className="dx-muted" style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>{f.title}</span>
									<button type="button" className="dx-pick__btn" aria-haspopup="dialog" aria-expanded={open === f.which} onClick={() => toggle(f.which)}>
										<Icon name="calendar" className="dx-muted" />
										<span className="dx-grow dx-ellipsis" style={{ fontWeight: 500 }}>{f.value}</span>
										{f.sub && <span className="dx-muted dx-nowrap" style={{ fontSize: 12 }}>{f.sub}</span>}
									</button>
									{open === f.which && (
										<div className={`dx-pick__pop${f.which === 'to' ? ' dx-pick__pop--right' : ''}`} role="dialog" aria-label={f.title}>
											<div className="dx-pick__nav">
												<IconButton icon="chevron-left" label={yearly ? 'Earlier years' : 'Previous year'} tone="bare" onClick={() => setPage(page - (yearly ? 12 : 1))} />
												<div style={{ textAlign: 'center' }}>
													<div style={{ fontWeight: 600 }}>{yearly ? `${page - 11} – ${yearLabel(page, cal)}` : yearLabel(page, cal)}</div>
													<div className="dx-muted" style={{ fontSize: 12 }}>{yearly ? 'Years' : cal === 'ethiopic' ? yearSpan(page) : `${monthName(0)} – ${monthName(11)}`}</div>
												</div>
												<IconButton icon="chevron-right" label={yearly ? 'Later years' : 'Next year'} tone="bare" onClick={() => setPage(page + (yearly ? 12 : 1))} />
											</div>
											<div className="dx-pick__grid">
												{cells.map(c => (
													<button key={c.index} type="button" className={`dx-cell${c.end ? ' dx-cell--end' : c.inside ? ' dx-cell--in' : ''}`} disabled={c.future} aria-pressed={c.end || undefined} onClick={() => pick(c.index)}>
														<span>{c.label}</span>{c.sub && <small>{c.sub}</small>}
													</button>
												))}
											</div>
											<div className="dx-pick__foot">
												<span>{`Pick the ${f.which === 'from' ? 'first' : 'last'} ${yearly ? 'year' : 'month'}`}</span>
												<Button label="Done" size="md" onClick={() => setOpen(undefined)} />
											</div>
										</div>
									)}
								</Popover>
							))}
						</div>
					</div>
				)}
				<div className="dx-muted" style={{ fontSize: 13 }}><strong style={{ color: 'var(--dx-text)' }}>{plural(periods, yearly ? 'year' : 'month')}</strong> · {rangeText}</div>
			</fieldset>

			<label className="dx-field">
				<span className="dx-field__label--strong">Organisation unit level</span>
				<select className="dx-select" value={level ? String(level) : ''} onChange={e => { setLevel(Number(e.target.value)); setBoundary(undefined); }}>
					{(levels.value ?? []).map(l => <option key={l.level} value={l.level}>Level {l.level} · {l.name} · {plural(l.count, 'unit')}</option>)}
				</select>
				<span className="dx-field__hint" style={{ fontSize: 13 }}>Values are fetched for every unit at this level.</span>
			</label>

			{levelInfo && levelInfo.count > 1 && (
				<div className="dx-field">
					<span className="dx-field__label--strong">Within <span className="dx-muted" style={{ fontWeight: 400, fontSize: 13 }}>(optional)</span></span>
					{boundary
						? <span className="dx-chip" style={{ alignSelf: 'flex-start' }}>
							<span><span style={{ color: 'var(--dx-text)', fontWeight: 500 }}>{boundary.name}</span>{boundary.pathNames && <span className="dx-muted" style={{ fontSize: 12, display: 'block' }}>{boundary.pathNames}</span>}</span>
							<IconButton icon="close" label="Remove" size="sm" tone="bare" onClick={() => setBoundary(undefined)} />
						</span>
						: <>
							<SearchBox tight value={boundaryQuery} placeholder={`Only the ${levelInfo.name.toLowerCase()} units inside one area: search for it`} onChange={setBoundaryQuery} />
							{boundaryHits && (
								<div className="dx-results">
									{boundaryHits.length === 0 && <div className="dx-empty" style={{ padding: 14 }}>Nothing matches.</div>}
									{boundaryHits.map(ou => (
										<button key={ou.uid} type="button" onClick={() => { setBoundary(ou); setBoundaryQuery(''); }}>
											<span style={{ color: 'var(--dx-text)', fontWeight: 500 }}>{ou.name}</span>
											{ou.pathNames && <span className="dx-muted" style={{ display: 'block', fontSize: 12 }}>{ou.pathNames}</span>}
										</button>
									))}
								</div>
							)}
						</>}
				</div>
			)}

			{mapping && mapping.indicatorsCount === 0 && <div className="dx-field__hint dx-field__hint--warn" style={{ fontSize: 13 }}>This mapping has no indicators yet: add some in the mapping editor first.</div>}
			{estimate && (
				<div className="dx-estimate">
					<div className="dx-estimate__grid">
						{([[estimate.dataItems, 'Data items'], [estimate.periods, 'Periods'], [estimate.organisationUnits, 'Org units']] as const).map(([n, label]) => (
							<div key={label}><div className="dx-estimate__value">{formatNumber(n)}</div><div className="dx-estimate__label">{label}</div></div>
						))}
						<div><div className={`dx-estimate__value${big ? ' dx-estimate__value--warn' : ''}`}>{formatNumber(estimate.requests)}</div><div className="dx-estimate__label">Requests</div></div>
					</div>
					{!!estimate.leftOut?.length && (
						<p style={{ color: 'var(--dx-warn)' }}>
							{`${estimate.leftOut.length} indicator${estimate.leftOut.length === 1 ? ' is' : 's are'} not mapped yet and left out: `}
							{estimate.leftOut.slice(0, 6).join(', ')}{estimate.leftOut.length > 6 ? `, and ${estimate.leftOut.length - 6} more` : ''}.
						</p>
					)}
					<p>{big
						? 'A large download: it can take a long while. You can pause it and pick it up later, and DataSuite sends more requests at once while the server keeps up and splits any the server finds too big.'
						: 'DataSuite adapts to the server as it goes: more requests at once while it answers quickly, smaller ones if it struggles. You can pause and resume at any time.'}</p>
				</div>
			)}
		</Dialog>
	);
}
