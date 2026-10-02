/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the mappings (dhis2ProfileMappingsView.ts) -- search, filter, edit, copy, export, delete -- and
 *  the unsaved draft.
 *--------------------------------------------------------------------------------------------*/

import { useMemo, useState } from 'react';
import { Connection, IMappingListItem } from '../../shared/api';
import { Column, DataTable, ErrorLine, Icon, PageHeader, SearchInput } from '../components';
import { fromNow, host, useAction, useLoad } from '../hooks';

export type EditTarget = { readonly kind: 'new' } | { readonly kind: 'draft' } | { readonly kind: 'edit'; readonly mappingId: string } | { readonly kind: 'clone'; readonly mappingId: string };

export function Mappings({ connection, edit }: { connection: Connection; edit: (target: EditTarget) => void }) {
	const id = connection.id;
	const mappings = useLoad(() => host.listMappings(id), [id], ['mappingsChanged'], id);
	const draft = useLoad(() => host.loadDraft(id), [id], ['mappingsChanged'], id);
	const [run, error, , dismiss] = useAction();
	const [search, setSearch] = useState('');
	const [mode, setMode] = useState<'all' | 'countdown' | 'custom'>('all');
	const [page, setPage] = useState(0);
	const [pageSize, setPageSize] = useState(20);

	const hasDraft = !!draft.value && (draft.value.indicators.length > 0 || !!draft.value.name);
	/** Starting something else replaces the draft: ask first when it has indicators. */
	const leaveDraft = async (message: string, detail: string, action: string) => !draft.value?.indicators.length || host.confirm(message, detail, action);

	const rows = useMemo(() => {
		const q = search.trim().toLowerCase();
		return (mappings.value ?? [])
			.filter(m => mode === 'all' || m.mode === mode)
			.filter(m => !q || [m.name, m.id, m.description ?? '', m.mode].some(v => v.toLowerCase().includes(q)));
	}, [mappings.value, search, mode]);

	const columns: Column<IMappingListItem>[] = [
		{
			id: 'name', title: 'Mapping Name', width: '35%', render: m => (
				<div className="cell-name-wrap">
					<div className={`mapping-icon-box ${m.mode === 'countdown' ? 'theme-primary' : 'theme-success'}`}><Icon name={m.mode === 'countdown' ? 'person' : 'table'} /></div>
					<div className="mapping-text-wrap">
						<div className="mapping-name">{m.name}</div>
						<div className="mapping-id">ID: {m.id}</div>
					</div>
				</div>
			)
		},
		{ id: 'type', title: 'Type', width: '20%', render: m => <span className={`mapping-pill ${m.mode === 'countdown' ? 'theme-primary' : 'theme-success'}`}>{m.mode === 'countdown' ? 'Countdown' : 'Custom Mapping'}</span> },
		{
			id: 'indicators', title: 'Indicators', width: '15%', render: m => (
				<div className="mapping-indicators-wrap">
					<div className="mapping-ind-text">{m.indicatorsCount} Indicators</div>
					<div className="mapping-progress-bg">
						<div className={`mapping-progress-fill ${m.indicatorsCount < 10 ? 'bg-red progress-low' : m.indicatorsCount < 25 ? 'bg-gold progress-mid' : 'bg-success progress-high'}`} />
					</div>
				</div>
			)
		},
		{
			id: 'updated', title: 'Last Updated', width: '15%', render: m => m.indicatorsCount === 0
				? <div className="mapping-sync-wrap text-error" title="Add indicators before downloading with this mapping"><Icon name="warning" /> No indicators</div>
				: <div className="mapping-sync-wrap text-success"><Icon name="pass" /> {fromNow(m.lastUpdatedAt)}</div>
		},
		{
			id: 'actions', title: 'Actions', width: '15%', align: 'right', render: m => (
				<div className="mapping-action-group">
					<button type="button" className="mapping-action-btn" title="Edit" onClick={() => void run(async () => {
						if (await leaveDraft('Discard Draft?', 'Editing this mapping will discard your current unsaved draft. Continue?', 'Yes, Edit Mapping')) { edit({ kind: 'edit', mappingId: m.id }); }
					})}><Icon name="edit" /></button>
					<button type="button" className="mapping-action-btn" title="Export JSON" onClick={() => void run(() => host.exportMapping(id, m.id))}><Icon name="cloud-download" /></button>
					<button type="button" className="mapping-action-btn" title="Clone" onClick={() => void run(async () => {
						if (await leaveDraft('Discard Draft?', 'Cloning this mapping will discard your current unsaved draft. Continue?', 'Yes, Clone Mapping')) { edit({ kind: 'clone', mappingId: m.id }); }
					})}><Icon name="copy" /></button>
					<button type="button" className="mapping-action-btn danger" title="Delete" onClick={() => void run(async () => {
						if (await host.confirm('Delete Mapping?', 'Are you sure you want to delete this mapping? This action cannot be undone.', 'Delete')) { await host.deleteMapping(id, m.id); }
					})}><Icon name="trash" /></button>
				</div>
			)
		}
	];

	return (
		<>
			<PageHeader model={{
				title: 'Mappings Manager',
				actions: [{
					label: 'New Mapping', icon: 'add', onClick: () => void run(async () => {
						if (await leaveDraft('Overwrite existing draft?', 'You have an unsaved mapping draft. Creating a new mapping will permanently discard your current draft. Do you want to continue?', 'Yes, start new')) {
							await host.clearDraft(id);
							edit({ kind: 'new' });
						}
					})
				}]
			}} />
			<ErrorLine error={error ?? mappings.error} onDismiss={dismiss} />
			<div className="mapping-scroll-area">
				{hasDraft && (
					<div className="draft-banner-wrap" style={{ display: 'flex' }}>
						<div className="draft-info">
							<Icon name="edit" />
							<span>You have an unsaved mapping draft: </span>
							<strong>{draft.value!.name || 'Untitled Draft'}</strong>
						</div>
						<div className="draft-actions">
							<button type="button" className="btn-resume-draft" onClick={() => edit({ kind: 'draft' })}>Resume Editing</button>
						</div>
					</div>
				)}
				<div className="mappings-toolbar">
					<div className="search-wrapper">
						<SearchInput value={search} placeholder="Search mappings by name or ID..." onChange={v => { setSearch(v); setPage(0); }} />
					</div>
					<div className="filters-wrapper">
						<select className="d2-input d2-select" value={mode} onChange={e => { setMode(e.target.value as typeof mode); setPage(0); }}>
							<option value="all">All Types</option>
							<option value="countdown">Countdown</option>
							<option value="custom">Custom</option>
						</select>
					</div>
				</div>
				<DataTable columns={columns} rows={rows} rowKey={m => m.id} rowClassName="mapping-row" page={page} pageSize={pageSize} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} />
			</div>
		</>
	);
}
