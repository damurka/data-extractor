/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the mappings -- search, filter, edit, copy, export, delete -- and the unsaved draft.
 *--------------------------------------------------------------------------------------------*/

import { useMemo, useState } from 'react';
import { Connection, IMappingListItem } from '../../shared/api';
import { ErrorLine, PageHeader, Pager } from '../components';
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
	const leaveDraft = async () => !draft.value?.indicators.length || host.confirm('Overwrite existing draft?', `Your unsaved mapping "${draft.value.name || 'Untitled'}" will be discarded.`, 'Discard Draft');

	const rows = useMemo(() => {
		const q = search.trim().toLowerCase();
		return (mappings.value ?? [])
			.filter(m => mode === 'all' || m.mode === mode)
			.filter(m => !q || [m.name, m.id, m.description ?? '', m.mode].some(v => v.toLowerCase().includes(q)));
	}, [mappings.value, search, mode]);
	const shown = rows.slice(page * pageSize, (page + 1) * pageSize);

	const bar = (m: IMappingListItem) => m.indicatorsCount < 10 ? 'red' : m.indicatorsCount < 25 ? 'gold' : 'green';

	return (
		<>
			<PageHeader title="Mappings Manager" actions={[{ label: 'New Mapping', onClick: () => void run(async () => { if (await leaveDraft()) { await host.clearDraft(id); edit({ kind: 'new' }); } }) }]} />
			<ErrorLine error={error ?? mappings.error} onDismiss={dismiss} />
			{hasDraft && (
				<div className="banner">
					You have an unsaved mapping draft: <strong>{draft.value!.name || 'Untitled'}</strong>
					<button className="secondary" onClick={() => edit({ kind: 'draft' })}>Resume Editing</button>
				</div>
			)}
			<div className="toolbar">
				<input type="search" placeholder="Search mappings" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
				<select value={mode} onChange={e => { setMode(e.target.value as typeof mode); setPage(0); }}>
					<option value="all">All types</option>
					<option value="countdown">Countdown</option>
					<option value="custom">Custom</option>
				</select>
			</div>
			<table className="table">
				<thead><tr><th>Mapping Name</th><th>Type</th><th>Indicators</th><th>Last Changed</th><th /></tr></thead>
				<tbody>
					{mappings.loading && !mappings.value && <tr><td colSpan={5} className="muted">Loading...</td></tr>}
					{shown.map(m => (
						<tr key={m.id}>
							<td><div className="strong">{m.name}</div><div className="muted small">ID: {m.id}</div></td>
							<td><span className={`pill ${m.mode}`}>{m.mode === 'countdown' ? 'Countdown' : 'Custom'}</span></td>
							<td><div className="count-bar"><span>{m.indicatorsCount}</span><div className={`bar ${bar(m)}`} style={{ width: `${Math.min(100, m.indicatorsCount * 2)}%` }} /></div></td>
							<td className="muted">{fromNow(m.lastUpdatedAt)}</td>
							<td className="row-actions">
								<button className="plain" onClick={() => void run(async () => { if (await leaveDraft()) { edit({ kind: 'edit', mappingId: m.id }); } })}>Edit</button>
								<button className="plain" onClick={() => void run(async () => { if (await leaveDraft()) { edit({ kind: 'clone', mappingId: m.id }); } })}>Copy</button>
								<button className="plain" onClick={() => void run(() => host.exportMapping(id, m.id))}>Export JSON</button>
								<button className="plain danger" onClick={() => void run(async () => { if (await host.confirm(`Delete "${m.name}"?`, 'The mapping is removed; downloads made with it stay.', 'Delete')) { await host.deleteMapping(id, m.id); } })}>Delete</button>
							</td>
						</tr>
					))}
					{mappings.value && rows.length === 0 && <tr><td colSpan={5} className="muted">{mappings.value.length ? 'No mapping matches.' : 'No mappings yet: create one with New Mapping.'}</td></tr>}
				</tbody>
			</table>
			<Pager page={page} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} />
		</>
	);
}
