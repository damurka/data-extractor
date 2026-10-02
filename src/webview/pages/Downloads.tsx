/*---------------------------------------------------------------------------------------------
 *  Data Extractor: downloads -- starting one, following it (pause, resume, cancel), and the finished ones to export.
 *--------------------------------------------------------------------------------------------*/

import { FieldSelect } from '@quire/components';
import { useEffect, useMemo, useState } from 'react';
import { Connection, DownloadEstimate, DownloadRequest, DownloadsFilter, IDhis2DownloadHistoryRow, IDhis2DownloadInProgressItem, OrgUnitHit } from '../../shared/api';
import { DateRangeCalendar } from '../calendar/DateRangeCalendar';
import { Button, Card, Column, DataTable, Dialog, EmptyState, ErrorLine, Field, Icon, IconButton, OpenInApp, PageHeader, SearchInput, SectionHeader, Segmented } from '../components';
import { formatNumber } from '../locale';
import { host, useAction, useLoad } from '../hooks';

const requestOf = (row: IDhis2DownloadHistoryRow | IDhis2DownloadInProgressItem): DownloadRequest => ({
	mappingId: row.mappingId, startDate: row.startDate, endDate: row.endDate, periodType: row.periodType === 'yearly' ? 'yearly' : 'monthly', adminLevel: row.adminLevel, boundaryOrgUnitUid: row.boundaryOrgUnitUid
});

const FILTERS: readonly { value: DownloadsFilter; label: string }[] = [
	{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }, { value: 'failed', label: 'Failed' }
];

export function Downloads({ connection }: { connection: Connection }) {
	const id = connection.id;
	const [filter, setFilter] = useState<DownloadsFilter>('all');
	const [search, setSearch] = useState('');
	const [page, setPage] = useState(0);
	const [pageSize, setPageSize] = useState(20);
	const [creating, setCreating] = useState(false);
	const calendar = useLoad(() => host.calendar(id), [id]);
	const ethiopic = /^ethiop/i.test(calendar.value ?? '');
	const [labelCalendar, setLabelCalendar] = useState<'gregorian' | 'ethiopic'>('ethiopic');
	const downloads = useLoad(() => host.downloads(id, filter, search), [id, filter, search], ['downloadsChanged'], id);
	const levels = useLoad(() => host.orgUnitLevels(id), [id]);
	const levelName = (adminLevel: string) => {
		const n = Number(adminLevel.replace('LEVEL-', ''));
		const name = levels.value?.find(l => l.level === n)?.name;
		return <span>Level {n}{name && <span className="de-muted"> &middot; {name}</span>}</span>;
	};
	const [run, error, , dismiss] = useAction();

	const inProgress = downloads.value?.inProgress ?? [];
	const history = downloads.value?.history ?? [];
	const labels = ethiopic ? labelCalendar : 'gregorian';
	const exportAs = (row: IDhis2DownloadHistoryRow, format: 'EXCEL' | 'JSON') => void run(() => host.exportDownload(id, row.id, format, labels));
	const openInApp = (row: IDhis2DownloadHistoryRow, app: 'rmncah' | 'vaxx') => void run(() => host.openDownloadInApp(id, row.id, app, labels));

	const columns: Column<IDhis2DownloadHistoryRow>[] = [
		{
			id: 'details', title: 'Download', width: '30%', render: row => {
				const ok = row.status === 'Completed';
				return (
					<div className="de-name">
						<span className={`de-dot ${ok ? 'de-dot--ok' : 'de-dot--bad'}`}><Icon name={ok ? 'check' : 'xmark'} /></span>
						<span className="de-name__text">
							<span className="de-name__title">{row.mappingName}</span>
							<span className="de-name__sub">{row.mappingMode === 'custom' ? `${row.startDate} to ${row.endDate} (${row.periodType})` : `${row.startDate} to ${row.endDate}`}</span>
						</span>
					</div>
				);
			}
		},
		{ id: 'mode', title: 'Type', width: '11%', render: row => <span className={`de-badge ${row.mappingMode === 'custom' ? 'de-badge--info' : 'de-badge--accent'}`}>{row.mappingMode === 'custom' ? 'Custom' : 'Countdown'}</span> },
		{ id: 'level', title: 'Admin level', width: '13%', render: row => levelName(row.adminLevel) },
		{ id: 'size', title: 'Size', width: '9%', align: 'right', render: row => <span className="de-num">{row.size || '-'}</span> },
		{ id: 'date', title: 'Finished', width: '12%', render: row => <span className="de-muted">{row.date || '-'}</span> },
		{
			id: 'actions', title: '', width: '22%', align: 'right', render: row => (
				<div className="de-row-actions">
					{row.status === 'Completed' && row.mappingMode === 'countdown' && <OpenInApp onOpen={app => openInApp(row, app)} />}
					{row.status === 'Completed' ? <>
						<IconButton icon="file-excel" title="Export to Excel" onClick={() => exportAs(row, 'EXCEL')} />
						<IconButton icon="file-code" title="Export to JSON" onClick={() => exportAs(row, 'JSON')} />
					</> : <IconButton icon="rotate-right" title="Try again" onClick={() => void run(() => host.startDownload(id, requestOf(row), row.id))} />}
					<IconButton icon="trash-can" title="Delete" danger onClick={() => void run(async () => {
						if (await host.confirm('Delete download?', `The downloaded data of "${row.mappingName}" is deleted from this computer.`, 'Delete')) { await host.deleteDownload(id, row.id); }
					})} />
				</div>
			)
		}
	];

	return (
		<>
			<PageHeader model={{
				eyebrow: 'Downloads',
				title: 'Downloads',
				subtitle: 'Data downloaded with a mapping, ready to export for the Countdown analysis. A download can be paused and picked up later.',
				actions: [{ label: 'New download', icon: 'plus', onClick: () => setCreating(true) }]
			}} />
			<ErrorLine error={error ?? downloads.error} onDismiss={dismiss} />

			<SectionHeader title="In progress" count={inProgress.length || undefined} description="Downloads running or paused. A paused one picks up where it stopped." />
			{inProgress.length === 0
				? <div className="cd-card de-quiet">No download is running.</div>
				: <div className="de-grid-2">
					{inProgress.map(item => <DownloadCard key={item.id} item={item}
						pause={() => void run(() => host.pauseDownload(id, item.id))}
						resume={() => void run(() => host.startDownload(id, requestOf(item), item.id))}
						cancel={() => void run(async () => { if (await host.confirm('Cancel download?', `"${item.mappingName}" stops and moves to the history as failed.`, 'Cancel Download')) { await host.cancelDownload(id, item.id); } })} />)}
				</div>}

			<SectionHeader title="History" description="Finished downloads: export them to Excel or JSON, or open a Countdown one in its analysis app.">
				{ethiopic && (
					<span className="de-inline">
						<span className="de-muted">Excel labels</span>
						<Segmented label="Excel labels" value={labelCalendar} onChange={setLabelCalendar} options={[{ value: 'ethiopic', label: 'Ethiopic' }, { value: 'gregorian', label: 'Gregorian' }]} />
					</span>
				)}
			</SectionHeader>
			<div className="de-toolbar">
				<SearchInput value={search} placeholder="Search downloads" onChange={v => { setSearch(v); setPage(0); }} />
				<Segmented label="Show" value={filter} onChange={f => { setFilter(f); setPage(0); }} options={FILTERS} />
			</div>
			{downloads.value && history.length === 0 && !search && filter === 'all'
				? <div className="cd-card"><EmptyState title="No downloads yet" message="Start one with New download: choose a mapping, the periods and the level." actionLabel="New download" onAction={() => setCreating(true)} /></div>
				: <DataTable columns={columns} rows={history} rowKey={r => r.id} page={page} pageSize={pageSize} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} empty="No download matches." />}
			{creating && <NewDownload connection={connection} ethiopic={ethiopic} close={() => setCreating(false)} />}
		</>
	);
}

function DownloadCard({ item, pause, resume, cancel }: { item: IDhis2DownloadInProgressItem; pause(): void; resume(): void; cancel(): void }) {
	const downloading = item.state === 'downloading';
	const paused = item.state === 'paused';
	return (
		<Card title={item.mappingName || 'Download'} subtitle={item.subtitle} icon={downloading ? 'cloud-arrow-down' : paused ? 'pause' : 'gears'}
			tools={<>
				{downloading && <IconButton icon="pause" title="Pause" onClick={pause} />}
				{paused && <IconButton icon="play" title="Resume" onClick={resume} />}
				<IconButton icon="xmark" title="Cancel" danger onClick={cancel} />
			</>}>
			<div className="de-progress__labels">
				<span>{downloading ? 'Downloading' : paused ? 'Paused: resumes where it stopped' : 'Preparing the data'}</span>
				<strong>{item.rightText}</strong>
			</div>
			<div className={`de-progress${paused ? ' de-progress--paused' : ''}${downloading ? ' de-progress--live' : ''}`}>
				<div className="de-progress__fill" style={{ width: `${item.progressPct}%` }} />
			</div>
		</Card>
	);
}

/** The New download dialog: the mapping, the periods (the calendar range picker), the level and an optional area. */
function NewDownload({ connection, ethiopic, close }: { connection: Connection; ethiopic: boolean; close(): void }) {
	const id = connection.id;
	const mappings = useLoad(() => host.listMappings(id), [id]);
	const levels = useLoad(() => host.orgUnitLevels(id), [id]);
	const [mappingId, setMappingId] = useState('');
	const [range, setRange] = useState(() => { const end = new Date(); const start = new Date(); start.setMonth(start.getMonth() - 1); return { start, end }; });
	const [periodType, setPeriodType] = useState<'monthly' | 'yearly'>('monthly');
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


	const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	const request = useMemo<DownloadRequest | undefined>(() => mappingId && level ? {
		mappingId, startDate: iso(range.start), endDate: iso(range.end), periodType: mapping?.mode === 'custom' ? periodType : 'monthly', adminLevel: `LEVEL-${level}`, boundaryOrgUnitUid: boundary?.uid
	} : undefined, [mappingId, range, periodType, level, boundary, mapping?.mode]);
	const dateProblem = range.start > range.end ? 'The start date is after the end date.' : undefined;

	useEffect(() => {
		setEstimate(undefined);
		if (!request || dateProblem) {
			return;
		}
		const timer = setTimeout(() => void host.estimateDownload(id, request).then(setEstimate, () => setEstimate(undefined)), 300);
		return () => clearTimeout(timer);
	}, [id, request, dateProblem]);

	useEffect(() => {
		if (boundaryQuery.trim().length < 2) {
			setBoundaryHits(undefined);
			return;
		}
		const timer = setTimeout(() => void host.searchOrgUnits(id, boundaryQuery.trim(), level).then(setBoundaryHits, () => setBoundaryHits([])), 300);
		return () => clearTimeout(timer);
	}, [id, boundaryQuery, level]);

	const canStart = !!request && !dateProblem && !busy;
	return (
		<Dialog title="New download" onClose={close} size="lg" footer={<>
			<Button label="Cancel" onClick={close} />
			<Button label="Start download" icon="cloud-arrow-down" variant="primary" disabled={!canStart} onClick={() => void run(async () => { await host.startDownload(id, request!); close(); })} />
		</>}>
			<ErrorLine error={error ?? mappings.error ?? levels.error} onDismiss={dismiss} />
			<div className="de-fields">
				<FieldSelect label="Mapping" options={mappings.value?.length ? mappings.value.map(m => ({ key: m.id, text: m.name })) : [{ key: '', text: 'No mappings yet' }]} value={mappingId} onChange={setMappingId} />
				<Field label="Periods" hint={ethiopic ? 'This server uses the Ethiopian calendar.' : undefined}>
					<DateRangeCalendar value={range} onChange={setRange} system={ethiopic ? 'ethiopic' : 'gregorian'} allowToggle />
				</Field>
				<div className="de-grid-2">
					{mapping?.mode === 'custom' && (
						<FieldSelect label="Frequency" options={[{ key: 'monthly', text: 'Monthly' }, { key: 'yearly', text: 'Yearly' }]} value={periodType} onChange={v => setPeriodType(v as typeof periodType)} />
					)}
					<FieldSelect label="Admin level" options={(levels.value ?? []).map(l => ({ key: String(l.level), text: `Level ${l.level} · ${l.name}` }))} value={level ? String(level) : null}
						onChange={v => { setLevel(Number(v)); setBoundary(undefined); }} />
				</div>
				{levelInfo && levelInfo.count > 1 && (
					<Field label="Within (optional)" hint={`Only the ${levelInfo.name.toLowerCase()} units inside one area.`}>
						{boundary
							? <span className="de-chip"><span className="de-chip__text"><span className="de-chip__main">{boundary.name}</span>{boundary.pathNames && <span className="de-chip__sub">{boundary.pathNames}</span>}</span>
								<button type="button" className="de-chip__remove" onClick={() => setBoundary(undefined)} aria-label="Remove"><Icon name="xmark" /></button></span>
							: <div className="de-picker">
								<SearchInput value={boundaryQuery} placeholder={`Search for an area to limit the download to`} onChange={setBoundaryQuery} />
								{boundaryHits && (
									<div className="de-results">
										{boundaryHits.length === 0 && <div className="de-results__empty">Nothing matches.</div>}
										{boundaryHits.map(ou => (
											<button key={ou.uid} type="button" className="de-results__item" onClick={() => { setBoundary(ou); setBoundaryQuery(''); }}>
												<span className="de-list__title">{ou.name}</span>
												{ou.pathNames && <span className="de-list__sub">{ou.pathNames}</span>}
											</button>
										))}
									</div>
								)}
							</div>}
					</Field>
				)}
				{dateProblem && <p className="cd-field-hint cd-field-hint--bad">{dateProblem}</p>}
				{estimate && <>
					<div className="de-estimate">
						{([[estimate.dataItems, 'Data items'], [estimate.periods, 'Periods'], [estimate.organisationUnits, 'Org units'], [estimate.requests, 'Requests']] as const).map(([n, label]) => (
							<div key={label} className="de-estimate__cell"><div className="de-estimate__value">{formatNumber(n)}</div><div className="de-estimate__label">{label}</div></div>
						))}
					</div>
					<p className={`cd-field-hint${estimate.requests > 200 ? ' cd-field-hint--warn' : ''}`}>
						{estimate.firstPeriod && <>Periods {estimate.firstPeriod} to {estimate.lastPeriod}. </>}
						{estimate.requests > 200
							? 'A large download: it can take a long while. It can be paused and resumed, and DataSuite adapts to the server as it goes.'
							: 'DataSuite adapts to the server as it goes: more requests at once while it answers quickly, smaller ones if it struggles.'}
					</p>
				</>}
			</div>
		</Dialog>
	);
}
