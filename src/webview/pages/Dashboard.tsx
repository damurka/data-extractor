/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the dashboard -- the metadata copy, the mappings, the downloads under way, where to go next, and the
 *  last finished downloads.
 *--------------------------------------------------------------------------------------------*/

import { Connection, IDhis2DownloadHistoryRow } from '../../shared/api';
import { ActionCard, Card, EmptyState, ErrorLine, IconButton, Icon, OpenInApp, PageHeader, StatCard } from '../components';
import { formatNumber } from '../locale';
import { fromNow, host, useAction, useLoad } from '../hooks';

export function Dashboard({ connection, go }: { connection: Connection; go: (page: 'mappings' | 'downloads' | 'new-mapping') => void }) {
	const id = connection.id;
	const recent = useLoad(() => host.downloads(id, 'completed', ''), [id], ['downloadsChanged'], id);
	const calendar = useLoad(() => host.calendar(id), [id]);
	const labels = /^ethiop/i.test(calendar.value ?? '') ? 'ethiopic' : 'gregorian';
	const status = useLoad(() => host.metadataStatus(id), [id], ['metadataChanged']);
	const mappings = useLoad(() => host.listMappings(id), [id], ['mappingsChanged'], id);
	const downloads = useLoad(() => host.downloads(id, 'active', ''), [id], ['downloadsChanged'], id);
	const [run, error, , dismiss] = useAction();
	const sync = () => void run(() => host.syncMetadata(id, true));

	const s = status.value;
	const total = s ? s.dataElements + s.categoryOptionCombos + s.organisationUnits : undefined;
	const metadataFooter: [string, string | undefined] = !s ? ['-', undefined]
		: s.syncing ? ['Syncing…', 'rotate']
			: s.error ? [`Sync failed: ${s.error}`, 'triangle-exclamation']
				: s.lastSyncedAt ? [`Synced ${fromNow(s.lastSyncedAt)}`, 'circle-check']
					: ['Not synced yet', undefined];

	const active = downloads.value?.inProgress ?? [];
	const downloading = active.filter(d => d.state === 'downloading');
	const downloadsFooter: [string, string] = downloads.error ? ['Unable to load downloads', 'triangle-exclamation']
		: downloading.length === 1 ? [`Downloading ${downloading[0].rightText}`, 'cloud-arrow-down']
			: downloading.length > 1 ? ['Downloading…', 'cloud-arrow-down']
				: active.some(d => d.state === 'paused') ? ['Paused', 'pause']
					: active.length ? ['Processing', 'rotate']
						: ['No active downloads', 'circle'];

	return (
		<>
			<PageHeader model={{
				eyebrow: connection.country ? 'DHIS2 · ' + connection.country : 'DHIS2',
				title: 'Dashboard',
				subtitle: `${connection.displayName}, as ${connection.username}. Map the indicators you need to this server's data, then download them for the Countdown analysis.`,
				actions: [{ label: s?.syncing ? 'Syncing…' : 'Sync metadata', icon: 'rotate', variant: 'secondary', onClick: sync, disabled: !!s?.syncing }]
			}} />
			<ErrorLine error={error ?? status.error ?? mappings.error} onDismiss={dismiss} />
			<div className="de-grid-3">
				<StatCard label="Metadata copy" icon="database" value={total === undefined ? '-' : formatNumber(total)} sub="Data elements, disaggregations and organisation units"
					footer={metadataFooter[0]} footerIcon={metadataFooter[1]} onClick={s?.syncing ? undefined : sync} />
				<StatCard label="Mappings" icon="diagram-project" value={mappings.value ? formatNumber(mappings.value.length) : '-'} sub="Saved"
					footer={mappings.error ? 'Unable to load mappings' : mappings.value?.length ? `Latest: ${mappings.value[0].name}` : 'No mappings yet'}
					footerIcon={mappings.error ? 'triangle-exclamation' : 'clock-rotate-left'} onClick={() => go('mappings')} />
				<StatCard label="Downloads" icon="cloud-arrow-down" value={downloads.value ? formatNumber(active.length) : '-'} sub="Running or paused"
					footer={downloadsFooter[0]} footerIcon={downloadsFooter[1]} onClick={() => go('downloads')} />
			</div>

			<h2 className="de-section">Next</h2>
			<div className="de-grid-3">
				<ActionCard icon="plus" title="New mapping" desc="Map the Countdown indicators, or your own, to this server's data elements and indicators." onClick={() => go('new-mapping')} />
				<ActionCard icon="folder-open" title="Open a mapping" desc="Change a saved mapping, copy it, or export it to share." onClick={() => go('mappings')} />
				<ActionCard icon="cloud-arrow-down" title="Download data" desc="Start a download, follow it, and export finished ones to Excel." onClick={() => go('downloads')} />
			</div>

			<Card title="Recent downloads" icon="clock-rotate-left" flush
				tools={<button type="button" className="cd-button cd-button--link" onClick={() => go('downloads')}>View all</button>}>
				<RecentDownloads rows={recent.value?.history.slice(0, 5)} exportAs={(row, format) => void run(() => host.exportDownload(id, row.id, format, labels))}
					openInApp={(row, app) => void run(() => host.openDownloadInApp(id, row.id, app, labels))} />
			</Card>
		</>
	);
}

/** The last finished downloads, each a click from its workbook. */
function RecentDownloads({ rows, exportAs, openInApp }: { rows: IDhis2DownloadHistoryRow[] | undefined; exportAs(row: IDhis2DownloadHistoryRow, format: 'EXCEL' | 'JSON'): void; openInApp(row: IDhis2DownloadHistoryRow, app: 'rmncah' | 'vaxx'): void }) {
	if (!rows) {
		return null;
	}
	if (rows.length === 0) {
		return <EmptyState title="No finished downloads yet" message="Start one from Downloads; it shows here when it is done." />;
	}
	return (
		<div className="de-list">
			{rows.map(row => (
				<div key={row.id} className="de-list__row">
					<span className="de-dot de-dot--ok"><Icon name="check" /></span>
					<div className="de-list__text">
						<div className="de-list__title">{row.mappingName}</div>
						<div className="de-list__sub">{row.startDate} to {row.endDate} &middot; {row.adminLevel.replace('LEVEL-', 'Level ')}</div>
					</div>
					<span className="de-list__meta">{row.size} &middot; {row.date}</span>
					<div className="de-row-actions">
						{row.mappingMode === 'countdown' && <OpenInApp onOpen={app => openInApp(row, app)} />}
						<IconButton icon="file-excel" title="Export to Excel" onClick={() => exportAs(row, 'EXCEL')} />
						<IconButton icon="file-code" title="Export to JSON" onClick={() => exportAs(row, 'JSON')} />
					</div>
				</div>
			))}
		</div>
	);
}
