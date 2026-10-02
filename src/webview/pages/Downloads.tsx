/*---------------------------------------------------------------------------------------------
 *  Data Extractor: downloads (dhis2ProfileDownloadsView.ts) -- starting one, following it (pause, resume, cancel),
 *  and the finished ones to export.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useRef, useState } from 'react';
import { Connection, DownloadEstimate, DownloadRequest, DownloadsFilter, IDhis2DownloadHistoryRow, IDhis2DownloadInProgressItem, OrgUnitHit } from '../../shared/api';
import { CalendarRangePicker } from '../calendar/calendarRangePicker';
import { Column, DataTable, ErrorLine, Icon, PageHeader, SearchInput } from '../components';
import { host, useAction, useLoad } from '../hooks';

const requestOf = (row: IDhis2DownloadHistoryRow | IDhis2DownloadInProgressItem): DownloadRequest => ({
	mappingId: row.mappingId, startDate: row.startDate, endDate: row.endDate, periodType: row.periodType === 'yearly' ? 'yearly' : 'monthly', adminLevel: row.adminLevel, boundaryOrgUnitUid: row.boundaryOrgUnitUid
});

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
	const [run, error, , dismiss] = useAction();

	const inProgress = downloads.value?.inProgress ?? [];
	const history = downloads.value?.history ?? [];
	const exportAs = (row: IDhis2DownloadHistoryRow, format: 'EXCEL' | 'JSON') => void run(() => host.exportDownload(id, row.id, format, ethiopic ? labelCalendar : 'gregorian'));

	const columns: Column<IDhis2DownloadHistoryRow>[] = [
		{
			id: 'details', title: 'Download Context', width: '35%', render: row => {
				const ok = row.status === 'Completed';
				return (
					<div className="cell-filename-wrap">
						<Icon name={ok ? 'check' : 'error'} className={`cell-status-icon ${ok ? 'text-success' : 'text-error'}`} />
						<div className="cell-text-block">
							<div className="cell-title">{row.mappingName}</div>
							<div className="text-muted cell-subtitle">{row.mappingMode === 'custom' ? `${row.startDate} to ${row.endDate} (${row.periodType})` : `${row.startDate} to ${row.endDate}`}</div>
						</div>
					</div>
				);
			}
		},
		{ id: 'mode', title: 'Mode', width: '10%', render: row => <span>{row.mappingMode === 'custom' ? 'Custom' : 'Countdown'}</span> },
		{ id: 'level', title: 'Admin', width: '10%', render: row => <span>{row.adminLevel}</span> },
		{ id: 'size', title: 'Size', width: '10%', render: row => <span>{row.size || '-'}</span> },
		{ id: 'date', title: 'Date', width: '15%', render: row => <span>{row.date || '-'}</span> },
		{ id: 'status', title: 'Status', width: '10%', render: row => <span className={`status-pill ${row.status === 'Completed' ? 'success' : 'error'}`}>{row.status}</span> },
		{
			id: 'actions', title: 'Actions', width: '10%', align: 'right', render: row => (
				<div className="mapping-action-group">
					{row.status === 'Completed' ? <>
						<button type="button" className="mapping-action-btn" title="Export to Excel" onClick={() => exportAs(row, 'EXCEL')}><Icon name="table" /></button>
						<button type="button" className="mapping-action-btn" title="Export to JSON" onClick={() => exportAs(row, 'JSON')}><Icon name="json" /></button>
					</> : (
						<button type="button" className="mapping-action-btn" title="Retry Download" onClick={() => void run(() => host.startDownload(id, requestOf(row), row.id))}><Icon name="refresh" /></button>
					)}
					<button type="button" className="mapping-action-btn" title="Delete" onClick={() => void run(async () => {
						if (await host.confirm('Delete download?', `The downloaded data of "${row.mappingName}" is deleted from this computer.`, 'Delete')) { await host.deleteDownload(id, row.id); }
					})}><Icon name="trash" /></button>
				</div>
			)
		}
	];

	return (
		<>
			<PageHeader model={{ title: 'Downloads Manager', actions: [{ label: 'New Download Task', icon: 'add', onClick: () => setCreating(true) }] }} />
			<ErrorLine error={error ?? downloads.error} onDismiss={dismiss} />
			<div className="downloads-scroll-area">
				<div className="downloads-toolbar">
					<div className="filter-segmented-group">
						{(['all', 'active', 'completed', 'failed'] as DownloadsFilter[]).map(f => (
							<button key={f} type="button" className={`filter-btn${filter === f ? ' active' : ''}`} onClick={() => { setFilter(f); setPage(0); }}>{f[0].toUpperCase() + f.slice(1)}</button>
						))}
					</div>
					<div className="search-wrapper-compact">
						<SearchInput value={search} placeholder="Search files..." onChange={v => { setSearch(v); setPage(0); }} />
					</div>
				</div>

				<section>
					<h3 className="d2-section-label">In Progress</h3>
					<div className="downloads-in-progress-list">
						{inProgress.length === 0 && <div className="downloads-empty-state">No active downloads.</div>}
						{inProgress.map(item => <DownloadCard key={item.id} item={item}
							pause={() => void run(() => host.pauseDownload(id, item.id))}
							resume={() => void run(() => host.startDownload(id, requestOf(item), item.id))}
							cancel={() => void run(async () => { if (await host.confirm('Cancel download?', `"${item.mappingName}" stops and moves to the history as failed.`, 'Cancel Download')) { await host.cancelDownload(id, item.id); } })} />)}
					</div>
				</section>

				<section>
					<div className="d2-section-header-row">
						<h3 className="d2-section-label">Recent History</h3>
						<div className="export-calendar-toggle">
							{ethiopic && <>
								<span className="export-calendar-toggle-label">Excel labels:</span>
								{(['ethiopic', 'gregorian'] as const).map(mode => (
									<button key={mode} type="button" className={`export-calendar-toggle-btn${labelCalendar === mode ? ' active' : ''}`} onClick={() => setLabelCalendar(mode)}>{mode === 'ethiopic' ? 'Ethiopic' : 'Gregorian'}</button>
								))}
							</>}
						</div>
					</div>
					<DataTable columns={columns} rows={history} rowKey={r => r.id} sticky={false} page={page} pageSize={pageSize} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} />
				</section>
			</div>
			{creating && <NewDownload connection={connection} ethiopic={ethiopic} close={() => setCreating(false)} />}
		</>
	);
}

function DownloadCard({ item, pause, resume, cancel }: { item: IDhis2DownloadInProgressItem; pause(): void; resume(): void; cancel(): void }) {
	const downloading = item.state === 'downloading';
	const paused = item.state === 'paused';
	const theme = downloading ? 'red' : 'green';
	return (
		<div className={`download-card theme-${theme}`}>
			<div className="card-decoration-circle pos-top" />
			<div className="card-decoration-circle pos-bottom" />
			<div className="card-content-inner">
				<div className="card-header-row">
					<div className="card-header-left">
						<div className="card-icon-box-blur"><Icon name={downloading ? 'cloud-download' : paused ? 'debug-pause' : 'server-process'} className="card-icon-box-glyph" /></div>
						<div className="card-info-block">
							<h4 className="card-file-name">{item.mappingName || 'Download Task'}</h4>
							<p className="card-file-sub">{item.subtitle}</p>
						</div>
					</div>
					<div className="card-action-group">
						{downloading && <button type="button" className="card-action-circle-btn" title="Pause" onClick={pause}><Icon name="debug-pause" className="card-action-icon" /></button>}
						{paused && <button type="button" className="card-action-circle-btn" title="Resume" onClick={resume}><Icon name="debug-start" className="card-action-icon" /></button>}
						<button type="button" className="card-action-circle-btn" title="Cancel" onClick={cancel}><Icon name="close" className="card-action-icon" /></button>
					</div>
				</div>
				<div className="card-progress-area">
					<div className="card-progress-labels">
						<span>{downloading ? 'Downloading...' : paused ? 'Paused' : 'Processing data structures...'}</span>
						<span className="bold">{item.rightText}</span>
					</div>
					<div className="card-progress-track-blur">
						<div className={`card-progress-fill fill-${theme}`} style={{ width: `${item.progressPct}%` }}>{downloading && <div className="fill-pulse-overlay" />}</div>
					</div>
				</div>
			</div>
		</div>
	);
}

/** The New Download dialog ("Configure Download Task"), with the original calendar range picker. */
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
	const pickerHost = useRef<HTMLDivElement>(null);

	const mapping = mappings.value?.find(m => m.id === mappingId);
	const levelInfo = levels.value?.find(l => l.level === level);
	useEffect(() => { if (!mappingId && mappings.value?.length) { setMappingId(mappings.value[0].id); } }, [mappings.value, mappingId]);
	useEffect(() => { if (!level && levels.value?.length) { setLevel(levels.value[0].level); } }, [levels.value, level]);

	// The picker is the built-in extractor's own widget (plain DOM), mounted once
	useEffect(() => {
		if (!pickerHost.current) {
			return;
		}
		const picker = new CalendarRangePicker(pickerHost.current, {
			mode: ethiopic ? 'ethiopic' : 'gregorian',
			startDate: range.start,
			endDate: range.end,
			allowToggle: true,
			onRangeChange: r => setRange({ start: r.start, end: r.end })
		});
		return () => { picker.dispose(); pickerHost.current?.replaceChildren(); };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ethiopic]);

	const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	const request = useMemo<DownloadRequest | undefined>(() => mappingId && level ? {
		mappingId, startDate: iso(range.start), endDate: iso(range.end), periodType: mapping?.mode === 'custom' ? periodType : 'monthly', adminLevel: `LEVEL-${level}`, boundaryOrgUnitUid: boundary?.uid
	} : undefined, [mappingId, range, periodType, level, boundary, mapping?.mode]);
	const dateProblem = range.start > range.end ? 'Start Date cannot be after End Date.' : undefined;

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
		<div className="dl-modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) { close(); } }}>
			<div className="dl-modal">
				<h2 className="dl-modal-title">Configure Download Task</h2>
				<p className="dl-modal-subtitle">Select the mapping and configure parameters to pull data.</p>
				<ErrorLine error={error ?? mappings.error ?? levels.error} onDismiss={dismiss} />

				<div className="d2-form-group">
					<label>Mapping Configuration</label>
					<select className="d2-input d2-select" value={mappingId} onChange={e => setMappingId(e.target.value)}>
						{!mappings.value?.length && <option value="">No mappings available</option>}
						{mappings.value?.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
					</select>
				</div>

				<div className="d2-form-group">
					<label>Date Range (Start &amp; End)</label>
					<div className="dl-calendar-wrapper" ref={pickerHost} />
				</div>

				{mapping?.mode === 'custom' && (
					<div className="d2-form-group">
						<label>Frequency</label>
						<select className="d2-input d2-select" value={periodType} onChange={e => setPeriodType(e.target.value as typeof periodType)}>
							<option value="monthly">Monthly</option>
							<option value="yearly">Yearly</option>
						</select>
					</div>
				)}

				<div className="d2-form-group">
					<label>Admin Level</label>
					<select className="d2-input d2-select" value={level} onChange={e => { setLevel(Number(e.target.value)); setBoundary(undefined); }}>
						{levels.value?.map(l => <option key={l.level} value={l.level}>Level {l.level} ({l.name})</option>)}
					</select>
				</div>

				{levelInfo && levelInfo.count > 1 && (
					<div className="d2-form-group">
						<label>Sub-region (optional)</label>
						<div className="dl-boundary-picker">
							{!boundary && <div><SearchInput value={boundaryQuery} placeholder={`Search for a ${levelInfo.name} to limit the download to...`} onChange={setBoundaryQuery} /></div>}
							<div className="dl-boundary-chip-host">
								{boundary && (
									<div className="ic-chip">
										<span className="ic-chip-main">{boundary.name}</span>
										<button type="button" className="ic-chip-close" onClick={() => setBoundary(undefined)}><Icon name="close" /></button>
									</div>
								)}
							</div>
							{!boundary && boundaryHits && (
								<div className="search-results-list">
									{boundaryHits.length === 0 && <div className="search-result-item no-select">No matching org units found</div>}
									{boundaryHits.map(ou => (
										<div key={ou.uid} className="search-result-item" onClick={() => { setBoundary(ou); setBoundaryQuery(''); }}>
											<div className="res-top-row"><span className="res-name">{ou.name}</span></div>
											{ou.pathNames && <div className="res-bottom-row"><span className="res-id">{ou.pathNames}</span></div>}
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				)}

				{dateProblem && <p className="dl-modal-subtitle text-error">{dateProblem}</p>}
				{estimate && (
					<p className="dl-modal-subtitle">
						{estimate.dataItems} data items &times; {estimate.periods} periods ({estimate.firstPeriod} to {estimate.lastPeriod}) &times; {estimate.organisationUnits.toLocaleString()} organisation units: {estimate.requests} request{estimate.requests === 1 ? '' : 's'} to the server.
					</p>
				)}

				<div className="dl-modal-actions">
					<button type="button" className="btn-cancel-plain" onClick={close}>Cancel</button>
					<button type="button" className={`btn-save-red${canStart ? '' : ' is-disabled'}`} disabled={!canStart} onClick={() => void run(async () => { await host.startDownload(id, request!); close(); })}>Start Download</button>
				</div>
			</div>
		</div>
	);
}
