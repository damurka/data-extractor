/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the dashboard (dhis2DashboardView.ts) -- the metadata copy, the mappings, the downloads under way,
 *  and where to go next.
 *--------------------------------------------------------------------------------------------*/

import { Connection } from '../../shared/api';
import { ActionCard, ErrorLine, HeaderModel, Icon, PageHeader, StatCard } from '../components';
import { fromNow, host, useAction, useLoad } from '../hooks';

export function dashboardHeader(connection: Connection, sync: () => void, syncing: boolean): HeaderModel {
	return {
		title: connection.country ?? 'Dashboard',
		meta: [
			{ icon: 'link', text: connection.serverUrl },
			{ icon: 'account', text: connection.username },
			{ icon: 'globe', text: connection.displayName }
		],
		actions: [{ label: 'Sync Meta', icon: 'sync', variant: 'primary', onClick: sync, disabled: syncing }]
	};
}

export function Dashboard({ connection, go }: { connection: Connection; go: (page: 'mappings' | 'downloads' | 'new-mapping') => void }) {
	const id = connection.id;
	const status = useLoad(() => host.metadataStatus(id), [id], ['metadataChanged']);
	const mappings = useLoad(() => host.listMappings(id), [id], ['mappingsChanged'], id);
	const downloads = useLoad(() => host.downloads(id, 'active', ''), [id], ['downloadsChanged'], id);
	const [run, error, , dismiss] = useAction();
	const sync = () => void run(() => host.syncMetadata(id, true));

	const s = status.value;
	const total = s ? s.dataElements + s.categoryOptionCombos + s.organisationUnits : undefined;
	const metadataFooter: [string, string | undefined] = !s ? ['-', undefined]
		: s.syncing ? ['Syncing…', 'sync']
			: s.error ? [`Sync failed: ${s.error}`, 'error']
				: s.lastSyncedAt ? [`Synced ${fromNow(s.lastSyncedAt)}`, 'check-all']
					: ['Not synced yet', undefined];

	const active = downloads.value?.inProgress ?? [];
	const downloading = active.filter(d => d.state === 'downloading');
	const downloadsFooter: [string, string] = downloads.error ? ['Unable to load downloads', 'error']
		: downloading.length === 1 ? [`Downloading ${downloading[0].rightText}`, 'cloud-download']
			: downloading.length > 1 ? ['Downloading…', 'cloud-download']
				: active.some(d => d.state === 'paused') ? ['Paused', 'debug-pause']
					: active.length ? ['Processing', 'sync']
						: ['No active downloads', 'circle-outline'];

	return (
		<>
			<PageHeader model={dashboardHeader(connection, sync, !!s?.syncing)} />
			<ErrorLine error={error ?? status.error ?? mappings.error} onDismiss={dismiss} />
			<div className="dashboard-scroll-area">
				<section>
					<div className="grid-3-col">
						<StatCard theme="red" label="Metadata Cache" icon="database" value={total ?? '-'} sub="Objects cached"
							footer={metadataFooter[0]} footerIcon={metadataFooter[1]} onClick={s?.syncing ? undefined : sync} />
						<StatCard theme="gold" label="Active Mappings" icon="map" value={mappings.value?.length ?? '-'} sub="Saved configurations"
							footer={mappings.error ? 'Unable to load mappings' : mappings.value?.length ? `Recent: ${mappings.value[0].name}` : 'No mappings yet'}
							footerIcon={mappings.error ? 'error' : 'refresh'} />
						<StatCard theme="teal" label="Downloads Queue" icon="cloud-download" value={downloads.value ? active.length : '-'}
							footer={downloadsFooter[0]} footerIcon={downloadsFooter[1]} />
					</div>
				</section>
				<section>
					<h3 className="d2-section-label"><Icon name="zap" className="text-brand-gold" /> Quick Actions</h3>
					<div className="grid-3-col">
						<ActionCard theme="teal" icon="add" title="Create New Mapping" desc="Start a new workflow from scratch. Define sources and destinations." onClick={() => go('new-mapping')} />
						<ActionCard theme="red" icon="folder-opened" title="Open Existing" desc="Load previously saved configuration files to resume work." onClick={() => go('mappings')} />
						<ActionCard theme="gold" icon="history" title="View Downloads" desc="Manage exported files, view logs and access completed data." onClick={() => go('downloads')} />
					</div>
				</section>
			</div>
		</>
	);
}
