/*---------------------------------------------------------------------------------------------
 *  Data Extractor: downloads -- the line of them (running, paused, waiting their turn) and the finished and failed
 *  ones, to open in an analysis app, in Excel or as JSON.
 *--------------------------------------------------------------------------------------------*/

import { useMemo, useState } from 'react';
import { Connection, IDhis2DownloadHistoryRow, IDhis2DownloadInProgressItem } from '../../shared/api';
import { formatSize, levelLabel, megabytes, ordinal, periodRange, timeLeft, when } from '../format';
import { fromNow, host, useAction, useEthiopicLabels, useLoad } from '../hooks';
import { formatNumber } from '../locale';
import type { Nav } from '../main';
import { Bar, Button, Card, ErrorLine, Icon, IconButton, Menu, MenuItem, PageHead, SearchBox, Tabs } from '../ui';
import { requestOf } from './Overview';

type Filter = 'all' | 'done' | 'failed';
const PAGE = 10;

export function Downloads({ connection, nav }: { connection: Connection; nav: Nav }) {
	const id = connection.id;
	const downloads = useLoad(() => host.downloads(id, 'all', ''), [id], ['downloadsChanged'], id);
	const levels = useLoad(() => host.orgUnitLevels(id), [id]);
	const settings = useLoad(() => host.settings(id), [id]);
	const apps = useLoad(() => host.analysisApps(), []);
	const ethiopic = useEthiopicLabels(id);
	const [filter, setFilter] = useState<Filter>('all');
	const [search, setSearch] = useState('');
	const [shown, setShown] = useState(PAGE);
	const [run, error, , dismiss] = useAction();

	const queue = downloads.value?.inProgress ?? [];
	const history = downloads.value?.history ?? [];
	const finished = history.filter(h => h.status === 'Completed');
	const failed = history.filter(h => h.status === 'Failed');
	const range = (row: { startDate: string; endDate: string; periodType: string }) => periodRange(row.startDate, row.endDate, row.periodType, ethiopic);
	const level = (row: { adminLevel: string }) => levelLabel(row.adminLevel, levels.value);

	const rows = useMemo(() => {
		const needle = search.trim().toLowerCase();
		return (filter === 'done' ? finished : filter === 'failed' ? failed : history)
			.filter(r => !needle || `${r.mappingName} ${range(r)} ${r.startDate} ${r.endDate}`.toLowerCase().includes(needle));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [downloads.value, filter, search, ethiopic]);

	const count = (state: string) => queue.filter(d => d.state === state).length;
	const runningCount = count('downloading') + count('processing');
	const summary = [[runningCount, 'downloading'], [count('paused'), 'paused'], [count('waiting'), 'waiting']].filter(([n]) => n).map(([n, word]) => `${n} ${word}`).join(' · ');
	const anyActive = runningCount + count('waiting') > 0;
	const waiting = queue.filter(d => d.state === 'waiting');
	const size = finished.reduce((n, h) => n + megabytes(h.size), 0);
	const installed = !!apps.value?.installed;
	const openAs = settings.value?.openAs ?? 'EXCEL';

	return (
		<>
			<PageHead kicker={`${queue.length} in progress · ${finished.length} finished${failed.length ? ` · ${failed.length} failed` : ''} · ${formatSize(size)} on this computer`} title="Downloads">
				<Button label="New download" icon="download" variant="primary" onClick={() => nav.newDownload()} />
			</PageHead>
			<ErrorLine error={error ?? downloads.error} onDismiss={dismiss} />

			<Card label="In progress">
				<div className="dx-card__head">
					<div className="dx-row dx-wrap" style={{ alignItems: 'baseline' }}>
						<h2>In progress</h2>
						<span className="dx-muted" style={{ fontSize: 13 }}>{summary}</span>
					</div>
					<div className="dx-row dx-wrap">
						{settings.value && <span className="dx-muted" style={{ fontSize: 12 }}>{settings.value.parallelDownloads} run at a time · <button type="button" className="dx-link" style={{ fontSize: 12 }} onClick={() => nav.go('settings')}>Change</button></span>}
						{queue.length > 0 && <Button label={anyActive ? 'Pause all' : 'Resume all'} size="md" onClick={() => void run(() => anyActive ? host.pauseAllDownloads(id) : host.resumeAllDownloads(id))} />}
					</div>
				</div>
				{queue.length === 0
					? <div className="dx-empty">Nothing downloading. <button type="button" className="dx-link" style={{ fontSize: 14 }} onClick={() => nav.newDownload()}>Start a new download</button></div>
					: <div className="dx-queue">
						{queue.map(item => <QueueRow key={item.id} item={item} range={range(item)} level={level(item)} position={waiting.indexOf(item) + 1}
							pause={() => void run(() => host.pauseDownload(id, item.id))}
							resume={() => void run(() => host.startDownload(id, requestOf(item), item.id))}
							raise={() => void run(() => host.moveDownloadUp(id, item.id))}
							cancel={() => void run(async () => {
								if (await host.confirm('Cancel download?', `"${item.mappingName}" stops and moves to the history as failed. What it fetched so far is kept for a retry.`, 'Cancel Download')) { await host.cancelDownload(id, item.id); }
							})} />)}
					</div>}
			</Card>

			<Card label="History" clip={false}>
				<div className="dx-card__head">
					<Tabs label="Show" value={filter} onChange={f => { setFilter(f); setShown(PAGE); }} options={[
						{ value: 'all', label: 'All', count: history.length }, { value: 'done', label: 'Finished', count: finished.length }, { value: 'failed', label: 'Failed', count: failed.length }
					]} />
					<SearchBox value={search} placeholder="Search by mapping or period" label="Search downloads" onChange={v => { setSearch(v); setShown(PAGE); }} />
				</div>
				<div className="dx-scroll-narrow">
					<table className="dx-table" style={{ minWidth: 900 }}>
						<thead>
							<tr><th scope="col">Mapping</th><th scope="col">Periods</th><th scope="col">Level</th><th scope="col" className="dx-right">Values</th><th scope="col" className="dx-right">Size</th><th scope="col">Finished</th><th scope="col"><span className="dx-sr">Open</span></th></tr>
						</thead>
						<tbody>
							{rows.length === 0 && (
								<tr><td colSpan={7} className="dx-empty">{search.trim() ? `No downloads match “${search.trim()}”. Try a mapping name or a year.` : history.length ? 'Nothing here.' : 'No downloads have finished yet.'}</td></tr>
							)}
							{rows.slice(0, shown).map(row => <HistoryRow key={row.id} row={row} range={range(row)} level={level(row)} installed={installed} openAs={openAs}
								act={action => void run(action)} connectionId={id} />)}
						</tbody>
					</table>
				</div>
				{rows.length > 0 && (
					<div className="dx-card__foot">
						<span>{search.trim() ? `${rows.length} ${rows.length === 1 ? 'match' : 'matches'}` : rows.length > shown ? `Showing the latest ${shown} of ${rows.length}` : `Showing all ${rows.length}`}</span>
						{rows.length > shown && <Button label="Show older" size="md" onClick={() => setShown(shown + PAGE * 2)} />}
					</div>
				)}
			</Card>
		</>
	);
}

function QueueRow({ item, range, level, position, pause, resume, raise, cancel }: {
	item: IDhis2DownloadInProgressItem; range: string; level: string; position: number; pause(): void; resume(): void; raise(): void; cancel(): void;
}) {
	const running = item.state === 'downloading' || item.state === 'processing';
	const paused = item.state === 'paused';
	const waiting = item.state === 'waiting';
	const requests = item.totalRequests ? (waiting && !item.doneRequests ? `${formatNumber(item.totalRequests)} requests` : `${formatNumber(item.doneRequests ?? 0)} of ${formatNumber(item.totalRequests)} requests`) : '';
	const detail = [requests, running ? timeLeft(item.etaSeconds) : paused && item.pausedAt ? `Paused ${fromNow(item.pausedAt)}` : ''].filter(Boolean).join(' · ');
	const status = item.state === 'processing' ? (item.progressPct >= 100 ? 'Putting the data together' : 'Starting…')
		: running ? `Downloading ${item.progressPct}%` : paused ? `Paused at ${item.progressPct}%` : `Waiting · ${ordinal(position)} in line`;
	return (
		<div className="dx-qrow">
			<span className={`dx-qrow__mark${running ? ' dx-qrow__mark--run' : paused ? ' dx-qrow__mark--paused' : ''}`} aria-hidden="true">
				{running ? <Icon name="download" size={14} stroke={2.4} /> : paused ? <Icon name="pause" size={14} stroke={2.6} /> : position}
			</span>
			<div className="dx-grow">
				<div className="dx-table__name dx-ellipsis">{item.mappingName}</div>
				<div className="dx-table__sub dx-ellipsis" style={{ marginTop: 0 }}>{range} · {level}</div>
			</div>
			<div className="dx-grow">
				<Bar pct={waiting ? 0 : item.progressPct} warn={paused} />
				<div className="dx-qrow__meta">
					<span className={`dx-qrow__state${running ? ' dx-qrow__state--run' : paused ? ' dx-qrow__state--paused' : ''}`}>{status}</span>
					<span className="dx-nowrap">{detail}</span>
				</div>
			</div>
			<div className="dx-qrow__actions">
				{running && <IconButton icon="pause" label={`Pause ${item.mappingName}`} onClick={pause} />}
				{paused && <IconButton icon="play" label={`Resume ${item.mappingName}`} tone="warn" onClick={resume} />}
				{waiting && position > 1 && <IconButton icon="up" label={`Move ${item.mappingName} up the line`} onClick={raise} />}
				<IconButton icon="close" label={`Cancel ${item.mappingName}`} tone="quiet" onClick={cancel} />
			</div>
		</div>
	);
}

function HistoryRow({ row, range, level, installed, openAs, act, connectionId }: {
	row: IDhis2DownloadHistoryRow; range: string; level: string; installed: boolean; openAs: 'EXCEL' | 'JSON'; act(action: () => Promise<unknown>): void; connectionId: string;
}) {
	const ok = row.status === 'Completed';
	const countdown = row.mappingMode === 'countdown';
	const inApp = ok && countdown && installed;
	const remove = () => act(async () => {
		if (await host.confirm('Delete download?', `The downloaded data of "${row.mappingName}" is deleted from this computer.`, 'Delete')) { await host.deleteDownload(connectionId, row.id); }
	});
	const reason = !countdown ? 'Needs a Countdown mapping' : 'Needs the Countdown Analytics extension';
	return (
		<tr>
			<td>
				<div className="dx-table__name">{row.mappingName}</div>
				{!ok && row.error && <div className="dx-table__sub dx-table__sub--bad">{row.error}</div>}
			</td>
			<td className="dx-nowrap">{range}</td>
			<td>{level}</td>
			<td className="dx-right dx-num">{ok && row.rows !== undefined ? formatNumber(row.rows) : '–'}</td>
			<td className="dx-right dx-muted dx-nowrap">{ok ? row.size || '–' : '–'}</td>
			<td className="dx-muted dx-nowrap">{when(row.endedAt, row.date)}</td>
			<td>
				<div className="dx-table__actions">
					{ok ? (
						<Menu wide label={`Open ${row.mappingName}`} trigger={(open, toggle) => (
							<span className="dx-split">
								<Button size="sm" variant={inApp ? 'primary' : 'soft'} label={inApp ? 'Open in RMNCAH' : openAs === 'JSON' ? 'Open as JSON' : 'Open in Excel'}
									onClick={() => act(() => inApp ? host.openDownloadInApp(connectionId, row.id, 'rmncah') : host.openDownload(connectionId, row.id, openAs))} />
								<button type="button" className={`dx-btn dx-btn--sm ${inApp ? 'dx-btn--primary' : 'dx-btn--soft'}`} aria-label="More ways to open" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
									<Icon name="chevron-down" size={14} stroke={2.2} />
								</button>
							</span>
						)}>
							{close => <>
								<div className="dx-menu__label">Open in an app</div>
								<MenuItem lead={<span className="dx-tile-icon">R</span>} label="RMNCAH app" detail={inApp ? 'Coverage and equity analysis' : reason} disabled={!inApp}
									onClick={() => { close(); act(() => host.openDownloadInApp(connectionId, row.id, 'rmncah')); }} />
								<MenuItem lead={<span className="dx-tile-icon dx-tile-icon--info">V</span>} label="Vaccination app" detail={inApp ? 'Immunisation analysis' : reason} disabled={!inApp}
									onClick={() => { close(); act(() => host.openDownloadInApp(connectionId, row.id, 'vaxx')); }} />
								{countdown && !installed && <MenuItem icon="download" label="Get the analysis apps" onClick={() => { close(); act(() => host.showAnalysisApps()); }} />}
								<div className="dx-menu__sep" />
								<div className="dx-menu__label">Open the file</div>
								<MenuItem label="Excel (.xlsx)" onClick={() => { close(); act(() => host.openDownload(connectionId, row.id, 'EXCEL')); }} />
								<MenuItem label="JSON (.json)" onClick={() => { close(); act(() => host.openDownload(connectionId, row.id, 'JSON')); }} />
								<MenuItem label="Show in folder" onClick={() => { close(); act(() => host.showDownloadInFolder(connectionId, row.id)); }} />
								<div className="dx-menu__sep" />
								<MenuItem icon="trash" label="Delete…" danger onClick={() => { close(); remove(); }} />
							</>}
						</Menu>
					) : <>
						<Button label="Retry" size="sm" variant="soft" onClick={() => act(() => host.startDownload(connectionId, requestOf(row), row.id))} />
						<IconButton icon="trash" label={`Delete ${row.mappingName}`} size="sm" tone="quiet" onClick={remove} />
					</>}
				</div>
			</td>
		</tr>
	);
}
