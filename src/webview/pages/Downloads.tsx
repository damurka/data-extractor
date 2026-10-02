/*---------------------------------------------------------------------------------------------
 *  Data Extractor: downloads -- starting one, following it (pause, resume, cancel), and the finished ones to export.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useState } from 'react';
import { Connection, DownloadEstimate, DownloadRequest, DownloadsFilter, IDhis2DownloadHistoryRow, OrgUnitHit } from '../../shared/api';
import { ErrorLine, PageHeader, Pager, ProgressBar } from '../components';
import { host, useAction, useLoad } from '../hooks';

export function Downloads({ connection }: { connection: Connection }) {
	const id = connection.id;
	const [filter, setFilter] = useState<DownloadsFilter>('all');
	const [search, setSearch] = useState('');
	const [page, setPage] = useState(0);
	const [pageSize, setPageSize] = useState(20);
	const [creating, setCreating] = useState(false);
	const [labelCalendar, setLabelCalendar] = useState<'gregorian' | 'ethiopic'>('gregorian');
	const downloads = useLoad(() => host.downloads(id, filter, search), [id, filter, search], ['downloadsChanged'], id);
	const calendar = useLoad(() => host.calendar(id), [id]);
	const [run, error, , dismiss] = useAction();
	const ethiopian = /^ethiop/i.test(calendar.value ?? '');
	useEffect(() => { if (ethiopian) { setLabelCalendar('ethiopic'); } }, [ethiopian]);

	const inProgress = downloads.value?.inProgress ?? [];
	const history = downloads.value?.history ?? [];
	const shown = history.slice(page * pageSize, (page + 1) * pageSize);
	const requestOf = (row: IDhis2DownloadHistoryRow | typeof inProgress[number]): DownloadRequest => ({
		mappingId: row.mappingId, startDate: row.startDate, endDate: row.endDate, periodType: row.periodType === 'yearly' ? 'yearly' : 'monthly', adminLevel: row.adminLevel, boundaryOrgUnitUid: row.boundaryOrgUnitUid
	});

	return (
		<>
			<PageHeader title="Downloads Manager" actions={[{ label: 'New Download Task', onClick: () => setCreating(true) }]} />
			<ErrorLine error={error ?? downloads.error} onDismiss={dismiss} />
			{creating && <NewDownload connection={connection} close={() => setCreating(false)} />}
			<div className="toolbar">
				<div className="segmented">
					{(['all', 'active', 'completed', 'failed'] as DownloadsFilter[]).map(f => (
						<button key={f} className={filter === f ? 'on' : ''} onClick={() => { setFilter(f); setPage(0); }}>{f[0].toUpperCase() + f.slice(1)}</button>
					))}
				</div>
				<input type="search" placeholder="Search downloads" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
				{ethiopian && (
					<label className="inline">Excel labels
						<select value={labelCalendar} onChange={e => setLabelCalendar(e.target.value as typeof labelCalendar)}>
							<option value="ethiopic">Ethiopic</option>
							<option value="gregorian">Gregorian</option>
						</select>
					</label>
				)}
			</div>

			{inProgress.length > 0 && <h3>In Progress</h3>}
			{inProgress.map(item => (
				<div key={item.id} className="card download">
					<div className="card-head">
						<span className="strong">{item.mappingName}</span>
						<span className="muted">{item.subtitle}</span>
						<span className="muted">{item.state === 'paused' ? 'Paused' : item.state === 'processing' ? 'Processing...' : `${item.progressPct}%`}</span>
						<div className="actions">
							{item.state === 'downloading' && <button className="secondary" onClick={() => void run(() => host.pauseDownload(id, item.id))}>Pause</button>}
							{item.state === 'paused' && <button onClick={() => void run(() => host.startDownload(id, requestOf(item), item.id))}>Resume</button>}
							<button className="plain danger" onClick={() => void run(async () => { if (await host.confirm(`Cancel the download of "${item.mappingName}"?`, 'What was downloaded so far is kept until you delete the download.', 'Cancel Download')) { await host.cancelDownload(id, item.id); } })}>Cancel</button>
						</div>
					</div>
					<ProgressBar pct={item.progressPct} />
				</div>
			))}

			<h3>Recent History</h3>
			<table className="table">
				<thead><tr><th>Download</th><th>Mode</th><th>Level</th><th>Size</th><th>Date</th><th>Status</th><th /></tr></thead>
				<tbody>
					{shown.map(row => (
						<tr key={row.id}>
							<td><div className="strong">{row.mappingName}</div><div className="muted small">{row.startDate} to {row.endDate}{row.mappingMode === 'custom' ? `, ${row.periodType}` : ''}</div></td>
							<td><span className={`pill ${row.mappingMode}`}>{row.mappingMode === 'countdown' ? 'Countdown' : 'Custom'}</span></td>
							<td>{row.adminLevel.replace('LEVEL-', 'Level ')}</td>
							<td>{row.size ?? '-'}</td>
							<td className="muted">{row.date ?? '-'}</td>
							<td><span className={`pill ${row.status === 'Completed' ? 'ok' : 'failed'}`}>{row.status}</span></td>
							<td className="row-actions">
								{row.status === 'Completed' ? <>
									<button className="plain" onClick={() => void run(() => host.exportDownload(id, row.id, 'EXCEL', labelCalendar))}>Excel</button>
									<button className="plain" onClick={() => void run(() => host.exportDownload(id, row.id, 'JSON', labelCalendar))}>JSON</button>
								</> : <button className="plain" onClick={() => void run(() => host.startDownload(id, requestOf(row), row.id))}>Retry</button>}
								<button className="plain danger" onClick={() => void run(async () => { if (await host.confirm(`Delete this download of "${row.mappingName}"?`, 'Its data is deleted from this computer.', 'Delete')) { await host.deleteDownload(id, row.id); } })}>Delete</button>
							</td>
						</tr>
					))}
					{downloads.value && history.length === 0 && <tr><td colSpan={7} className="muted">No downloads {filter === 'all' ? 'yet' : 'here'}.</td></tr>}
				</tbody>
			</table>
			<Pager page={page} pageSize={pageSize} total={history.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} />
		</>
	);
}

/** The form for a new download: which mapping, which dates, which organisation units -- with what it will take. */
function NewDownload({ connection, close }: { connection: Connection; close(): void }) {
	const id = connection.id;
	const mappings = useLoad(() => host.listMappings(id), [id]);
	const levels = useLoad(() => host.orgUnitLevels(id), [id]);
	const today = new Date();
	const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	const [mappingId, setMappingId] = useState('');
	const [startDate, setStartDate] = useState(iso(new Date(today.getFullYear(), today.getMonth() - 1, today.getDate())));
	const [endDate, setEndDate] = useState(iso(today));
	const [periodType, setPeriodType] = useState<'monthly' | 'yearly'>('monthly');
	const [level, setLevel] = useState(0);
	const [boundary, setBoundary] = useState<OrgUnitHit>();
	const [boundaryQuery, setBoundaryQuery] = useState('');
	const [boundaryHits, setBoundaryHits] = useState<OrgUnitHit[]>([]);
	const [estimate, setEstimate] = useState<DownloadEstimate>();
	const [run, error, busy, dismiss] = useAction();

	const mapping = mappings.value?.find(m => m.id === mappingId);
	const levelInfo = levels.value?.find(l => l.level === level);
	useEffect(() => { if (!mappingId && mappings.value?.length) { setMappingId(mappings.value[0].id); } }, [mappings.value, mappingId]);
	useEffect(() => { if (!level && levels.value?.length) { setLevel(levels.value[Math.min(2, levels.value.length - 1)].level); } }, [levels.value, level]);

	const request = useMemo<DownloadRequest | undefined>(() => mappingId && level ? { mappingId, startDate, endDate, periodType, adminLevel: `LEVEL-${level}`, boundaryOrgUnitUid: boundary?.uid } : undefined, [mappingId, startDate, endDate, periodType, level, boundary]);
	const dateProblem = !startDate || !endDate ? 'Choose both dates.' : startDate > endDate ? 'The start is after the end.' : undefined;

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
			setBoundaryHits([]);
			return;
		}
		const timer = setTimeout(() => void host.searchOrgUnits(id, boundaryQuery.trim(), level).then(setBoundaryHits, () => setBoundaryHits([])), 300);
		return () => clearTimeout(timer);
	}, [id, boundaryQuery, level]);

	return (
		<div className="card modal">
			<div className="card-head"><span className="strong">New Download Task</span><div className="actions"><button className="plain" onClick={close}>&times;</button></div></div>
			<ErrorLine error={error ?? mappings.error ?? levels.error} onDismiss={dismiss} />
			{mappings.value && !mappings.value.length ? <p>No mapping yet: create one in Mappings first.</p> : (
				<div className="fields">
					<label>Mapping
						<select value={mappingId} onChange={e => setMappingId(e.target.value)}>
							{mappings.value?.map(m => <option key={m.id} value={m.id}>{m.name} ({m.mode === 'countdown' ? 'Countdown' : 'Custom'}, {m.indicatorsCount} indicators)</option>)}
						</select>
					</label>
					<div className="fields two">
						<label>From<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
						<label>To<input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></label>
					</div>
					{mapping?.mode === 'custom' && (
						<label>Frequency
							<select value={periodType} onChange={e => setPeriodType(e.target.value as typeof periodType)}>
								<option value="monthly">Monthly</option>
								<option value="yearly">Yearly</option>
							</select>
						</label>
					)}
					<label>Admin Level
						<select value={level} onChange={e => { setLevel(Number(e.target.value)); setBoundary(undefined); }}>
							{levels.value?.map(l => <option key={l.level} value={l.level}>Level {l.level} ({l.name}, {l.count.toLocaleString()})</option>)}
						</select>
					</label>
					{levelInfo && levelInfo.count > 1 && (
						<label>Sub-region (optional)
							{boundary ? (
								<span className="chip">{boundary.name}{boundary.pathNames ? ` (${boundary.pathNames})` : ''}<button className="plain" onClick={() => setBoundary(undefined)}>&times;</button></span>
							) : <input type="search" placeholder={`Only one ${levelInfo.name}: type its name`} value={boundaryQuery} onChange={e => setBoundaryQuery(e.target.value)} />}
							{!boundary && boundaryHits.length > 0 && (
								<div className="dropdown">
									{boundaryHits.map(h => <button key={h.uid} className="dropdown-item" onClick={() => { setBoundary(h); setBoundaryQuery(''); }}><span>{h.name}</span><span className="muted small">{h.pathNames}</span></button>)}
								</div>
							)}
						</label>
					)}
					{dateProblem && <div className="error-line">{dateProblem}</div>}
					{estimate && (
						<p className="muted">
							{estimate.dataItems} data items &times; {estimate.periods} periods ({estimate.firstPeriod} to {estimate.lastPeriod}) &times; {estimate.organisationUnits.toLocaleString()} organisation units: {estimate.requests} request{estimate.requests === 1 ? '' : 's'} to the server{estimate.calendar && estimate.calendar !== 'iso8601' ? `, ${estimate.calendar} calendar` : ''}.
						</p>
					)}
					<div className="actions">
						<button className="secondary" onClick={close}>Cancel</button>
						<button disabled={!request || !!dateProblem || busy} onClick={() => void run(async () => { await host.startDownload(id, request!); close(); })}>Start Download</button>
					</div>
				</div>
			)}
		</div>
	);
}
