/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the mappings -- search, filter, edit, copy, export, delete -- and the unsaved draft.
 *--------------------------------------------------------------------------------------------*/

import { ChipSelect } from '@quire/components';
import { useMemo, useState } from 'react';
import { Connection, IMappingListItem } from '../../shared/api';
import { Button, Column, DataTable, EmptyState, ErrorLine, Icon, IconButton, PageHeader, SearchInput } from '../components';
import { fromNow, host, useAction, useLoad } from '../hooks';

export type EditTarget = { readonly kind: 'new' } | { readonly kind: 'draft' } | { readonly kind: 'edit'; readonly mappingId: string } | { readonly kind: 'clone'; readonly mappingId: string };

const MODES = [
	{ key: 'all', text: 'All types' },
	{ key: 'countdown', text: 'Countdown' },
	{ key: 'custom', text: 'Custom' }
];

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
	const startNew = () => void run(async () => {
		if (await leaveDraft('Overwrite existing draft?', 'You have an unsaved mapping draft. Creating a new mapping will permanently discard your current draft. Do you want to continue?', 'Yes, start new')) {
			await host.clearDraft(id);
			edit({ kind: 'new' });
		}
	});

	const rows = useMemo(() => {
		const q = search.trim().toLowerCase();
		return (mappings.value ?? [])
			.filter(m => mode === 'all' || m.mode === mode)
			.filter(m => !q || [m.name, m.id, m.description ?? '', m.mode].some(v => v.toLowerCase().includes(q)));
	}, [mappings.value, search, mode]);

	const columns: Column<IMappingListItem>[] = [
		{
			id: 'name', title: 'Mapping', width: '38%', render: m => (
				<div className="de-name">
					<span className={`de-name__icon${m.mode === 'countdown' ? ' de-name__icon--accent' : ''}`}><Icon name={m.mode === 'countdown' ? 'flag' : 'table-list'} /></span>
					<span className="de-name__text">
						<span className="de-name__title">{m.name}</span>
						<span className="de-name__sub">{m.description || `ID ${m.id}`}</span>
					</span>
				</div>
			)
		},
		{ id: 'type', title: 'Type', width: '14%', render: m => <span className={`de-badge ${m.mode === 'countdown' ? 'de-badge--accent' : 'de-badge--info'}`}>{m.mode === 'countdown' ? 'Countdown' : 'Custom'}</span> },
		{ id: 'indicators', title: 'Indicators', width: '14%', align: 'right', render: m => <span className="de-num">{m.indicatorsCount.toLocaleString()}</span> },
		{
			id: 'updated', title: 'Last updated', width: '16%', render: m => m.indicatorsCount === 0
				? <span className="de-state de-state--warn" title="Add indicators before downloading with this mapping"><Icon name="triangle-exclamation" />No indicators</span>
				: <span className="de-state"><Icon name="clock" regular />{fromNow(m.lastUpdatedAt)}</span>
		},
		{
			id: 'actions', title: '', width: '18%', align: 'right', render: m => (
				<div className="de-row-actions">
					<IconButton icon="pen" title="Edit" onClick={() => void run(async () => {
						if (await leaveDraft('Discard Draft?', 'Editing this mapping will discard your current unsaved draft. Continue?', 'Yes, Edit Mapping')) { edit({ kind: 'edit', mappingId: m.id }); }
					})} />
					<IconButton icon="copy" title="Copy" onClick={() => void run(async () => {
						if (await leaveDraft('Discard Draft?', 'Copying this mapping will discard your current unsaved draft. Continue?', 'Yes, Copy Mapping')) { edit({ kind: 'clone', mappingId: m.id }); }
					})} />
					<IconButton icon="file-export" title="Export to a JSON file" onClick={() => void run(() => host.exportMapping(id, m.id))} />
					<IconButton icon="trash-can" title="Delete" danger onClick={() => void run(async () => {
						if (await host.confirm('Delete Mapping?', 'Are you sure you want to delete this mapping? This action cannot be undone.', 'Delete')) { await host.deleteMapping(id, m.id); }
					})} />
				</div>
			)
		}
	];

	return (
		<>
			<PageHeader model={{
				eyebrow: 'Mappings',
				title: 'Mappings',
				subtitle: 'Which DHIS2 data elements, indicators and data sets make up each indicator you download.',
				actions: [{ label: 'New mapping', icon: 'plus', onClick: startNew }]
			}} />
			<ErrorLine error={error ?? mappings.error} onDismiss={dismiss} />
			{hasDraft && (
				<div className="cd-card de-draft">
					<span className="de-draft__icon"><Icon name="pen-to-square" /></span>
					<span className="de-draft__text">An unsaved draft: <strong>{draft.value!.name || 'Untitled draft'}</strong></span>
					<Button label="Resume editing" variant="primary" size="sm" onClick={() => edit({ kind: 'draft' })} />
				</div>
			)}
			<div className="de-toolbar">
				<SearchInput value={search} placeholder="Search mappings by name or ID" onChange={v => { setSearch(v); setPage(0); }} />
				<ChipSelect label="Type" options={MODES} value={mode} onChange={v => { setMode(v as typeof mode); setPage(0); }} />
			</div>
			{mappings.value && mappings.value.length === 0
				? <div className="cd-card"><EmptyState title="No mappings yet" message="A mapping says which DHIS2 data make up each indicator you download." actionLabel="New mapping" onAction={startNew} /></div>
				: <DataTable columns={columns} rows={rows} rowKey={m => m.id} page={page} pageSize={pageSize} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }}
					empty="No mapping matches the search." />}
		</>
	);
}
