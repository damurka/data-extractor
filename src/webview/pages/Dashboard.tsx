/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the dashboard -- the metadata copy, the mappings, the downloads under way, and where to go next.
 *--------------------------------------------------------------------------------------------*/

import { Connection } from '../../shared/api';
import { ErrorLine, PageHeader, StatCard } from '../components';
import { fromNow, host, useAction, useLoad } from '../hooks';

export function Dashboard({ connection, go }: { connection: Connection; go: (page: 'mappings' | 'downloads' | 'new-mapping') => void }) {
	const id = connection.id;
	const status = useLoad(() => host.metadataStatus(id), [id], ['metadataChanged']);
	const mappings = useLoad(() => host.listMappings(id), [id], ['mappingsChanged'], id);
	const downloads = useLoad(() => host.downloads(id, 'active', ''), [id], ['downloadsChanged'], id);
	const [run, error, , dismiss] = useAction();

	const s = status.value;
	const total = s ? s.dataElements + s.categoryOptionCombos + s.organisationUnits : 0;
	const active = downloads.value?.inProgress ?? [];
	const first = active[0];

	return (
		<>
			<PageHeader
				title={connection.country ?? 'Dashboard'}
				meta={<>{connection.serverUrl} &middot; {connection.username} &middot; {connection.displayName}</>}
				actions={[{ label: 'Sync Metadata', onClick: () => void run(() => host.syncMetadata(id, true)), disabled: s?.syncing }]}
			/>
			<ErrorLine error={error ?? status.error ?? mappings.error ?? downloads.error} onDismiss={dismiss} />
			<div className="stat-grid">
				<StatCard theme="red" label="Metadata Cache" value={s ? total.toLocaleString() : '...'}
					footer={!s ? '' : s.syncing ? 'Syncing...' : s.error ? `Sync failed: ${s.error}` : s.lastSyncedAt ? `Synced ${fromNow(s.lastSyncedAt)}` : 'Not synced yet'}
					onClick={s?.syncing ? undefined : () => void run(() => host.syncMetadata(id, true))} />
				<StatCard theme="gold" label="Active Mappings" value={mappings.value?.length ?? '...'}
					footer={mappings.value?.length ? `Recent: ${mappings.value[0].name}` : 'No mappings yet'} />
				<StatCard theme="teal" label="Downloads Queue" value={downloads.value ? active.length : '...'}
					footer={!first ? 'No active downloads' : first.state === 'downloading' ? `Downloading ${first.progressPct}%` : first.state === 'paused' ? 'Paused' : 'Processing'} />
			</div>
			<h3>Quick Actions</h3>
			<div className="action-grid">
				<button className="action-card" onClick={() => go('new-mapping')}><strong>Create New Mapping</strong><span className="muted">Map indicators to this server's data elements, indicators and datasets</span></button>
				<button className="action-card" onClick={() => go('mappings')}><strong>Open Existing</strong><span className="muted">Edit, copy or export a mapping</span></button>
				<button className="action-card" onClick={() => go('downloads')}><strong>View Downloads</strong><span className="muted">Start a download, follow it, export to Excel</span></button>
			</div>
		</>
	);
}
