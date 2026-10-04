/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the mappings -- how far each is, editing, downloading with one, sharing and importing -- and the
 *  dialogs that make one: a new mapping (its kind, then its name) and an imported one (the file, then a check of it
 *  against this server).
 *--------------------------------------------------------------------------------------------*/

import { useMemo, useState } from 'react';
import { Connection, IAddMappingDraft, IMappingListItem, ImportReview, MappingMode } from '../../shared/api';
import { withAllCountdownIndicators } from '../../shared/mapping';
import { formatBytes, plural, serverName, when } from '../format';
import { host, useAction, useLoad } from '../hooks';
import { formatNumber } from '../locale';
import type { Nav } from '../main';
import { Banner, Bar, Button, Card, Choices, Dialog, ErrorLine, Field, Icon, IconButton, KindBadge, Menu, MenuItem, PageHead, SearchBox, Tabs } from '../ui';

type Creating = MappingMode | 'ask' | undefined;

const KINDS: readonly { mode: MappingMode; label: string; icon: string; text: (server: string) => string; note: string }[] = [
	{
		mode: 'countdown', label: 'Countdown', icon: 'lock',
		text: server => `Starts from the Countdown 2030 indicator list. The indicators are fixed: you match each one to data elements in ${server}.`,
		note: 'Downloads come in three parts: population, reporting completeness and services.'
	},
	{
		mode: 'custom', label: 'Custom', icon: 'pencil',
		text: () => 'Starts empty. You name your own indicators and choose the data elements, indicators or data sets behind each.',
		note: 'Good for programme reviews and one-off analyses.'
	}
];

export function Mappings({ connection, nav, creating, setCreating }: { connection: Connection; nav: Nav; creating: Creating; setCreating(value: Creating): void }) {
	const id = connection.id;
	const server = serverName(connection);
	const mappings = useLoad(() => host.listMappings(id), [id], ['mappingsChanged'], id);
	const draft = useLoad(() => host.loadDraft(id), [id], ['mappingsChanged'], id);
	const [run, error, , dismiss] = useAction();
	const [tab, setTab] = useState<'all' | MappingMode>('all');
	const [search, setSearch] = useState('');
	const [importing, setImporting] = useState(false);

	const all = mappings.value ?? [];
	const rows = useMemo(() => {
		const q = search.trim().toLowerCase();
		return all.filter(m => tab === 'all' || m.mode === tab).filter(m => !q || `${m.name} ${m.description ?? ''}`.toLowerCase().includes(q));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mappings.value, search, tab]);
	const count = (mode: MappingMode) => all.filter(m => m.mode === mode).length;
	const hasDraft = !!draft.value && (draft.value.indicators.length > 0 || !!draft.value.name?.trim());

	return (
		<>
			<PageHead kicker={`What each download fetches from ${server}`} title="Mappings">
				<Button label="Import" icon="upload" haspopup="dialog" onClick={() => setImporting(true)} />
				<Button label="New mapping" icon="plus" variant="primary" onClick={() => setCreating('ask')} />
			</PageHead>
			<ErrorLine error={error ?? mappings.error} onDismiss={dismiss} />

			{hasDraft && (
				<Banner tone="warn" icon="pencil">
					<span className="dx-row dx-wrap" style={{ justifyContent: 'space-between' }}>
						<span>A mapping left unsaved earlier: <strong>{draft.value!.name?.trim() || 'Untitled'}</strong> · {plural(draft.value!.indicators.length, 'indicator')}</span>
						<span className="dx-row">
							<Button label="Discard" size="sm" onClick={() => void run(async () => {
								if (await host.confirm('Discard the unsaved mapping?', 'It is deleted.', 'Discard')) { await host.clearDraft(id); draft.reload(); }
							})} />
							<Button label="Keep and edit" size="sm" variant="primary" onClick={() => void run(async () => {
								const kept: IAddMappingDraft = { ...draft.value!, name: draft.value!.name?.trim() || 'Untitled mapping' };
								nav.editMapping((await host.createMapping(id, kept)).id);
							})} />
						</span>
					</span>
				</Banner>
			)}

			<Card label="All mappings" clip={false}>
				<div className="dx-card__head">
					<Tabs label="Kind" value={tab} onChange={setTab} options={[{ value: 'all', label: 'All', count: all.length }, { value: 'countdown', label: 'Countdown', count: count('countdown') }, { value: 'custom', label: 'Custom', count: count('custom') }]} />
					<SearchBox value={search} placeholder="Search mappings" onChange={setSearch} />
				</div>
				{mappings.value && all.length === 0
					? <div className="dx-empty"><strong>No mappings yet</strong>A mapping says which DHIS2 data make up each indicator you download.
						<div style={{ marginTop: 12 }}><Button label="New mapping" icon="plus" variant="primary" onClick={() => setCreating('ask')} /></div></div>
					: <div className="dx-scroll-narrow">
						<table className="dx-table" style={{ minWidth: 860 }}>
							<thead>
								<tr><th scope="col">Mapping</th><th scope="col">Kind</th><th scope="col" className="dx-right">Indicators</th><th scope="col" style={{ width: '24%' }}>Sources</th><th scope="col">Edited</th><th scope="col"><span className="dx-sr">Actions</span></th></tr>
							</thead>
							<tbody>
								{rows.length === 0 && <tr><td colSpan={6} className="dx-empty">No mappings match. Try another name, or clear the search.</td></tr>}
								{rows.map(m => <MappingRow key={m.id} m={m} nav={nav} act={action => void run(action)} connectionId={id} />)}
							</tbody>
						</table>
					</div>}
			</Card>

			{creating && <NewMapping connection={connection} kind={creating === 'ask' ? undefined : creating} names={all.map(m => m.name)} close={() => setCreating(undefined)}
				created={mappingId => { setCreating(undefined); nav.editMapping(mappingId); }} />}
			{importing && <ImportMapping connection={connection} names={all.map(m => m.name)} close={() => setImporting(false)} />}
		</>
	);
}

function MappingRow({ m, nav, act, connectionId }: { m: IMappingListItem; nav: Nav; act(action: () => Promise<unknown>): void; connectionId: string }) {
	const mapped = m.mappedCount ?? m.indicatorsCount;
	const na = m.notAvailableCount ?? 0;
	const missing = Math.max(0, m.indicatorsCount - mapped - na);
	const status = m.indicatorsCount === 0 ? 'No indicators yet' : `${missing ? `${missing} not mapped` : 'All mapped'}${na ? ` · ${na} not available` : ''}`;
	return (
		<tr>
			<td>
				<div className="dx-table__name">{m.name}</div>
				{m.description && <div className="dx-table__sub dx-ellipsis" style={{ maxWidth: 380 }}>{m.description}</div>}
			</td>
			<td><KindBadge mode={m.mode} /></td>
			<td className="dx-right dx-num">{formatNumber(m.indicatorsCount)}</td>
			<td>
				<Bar pct={m.indicatorsCount ? Math.round((mapped + na) / m.indicatorsCount * 100) : 0} warn={missing > 0} />
				<div style={{ fontSize: 12, marginTop: 6, color: missing || !m.indicatorsCount ? 'var(--dx-warn)' : 'var(--dx-muted)' }}>{status}</div>
			</td>
			<td className="dx-muted dx-nowrap">{when(m.lastUpdatedAt)}</td>
			<td>
				<div className="dx-table__actions">
					<Button label="Edit" size="sm" variant="soft" onClick={() => nav.editMapping(m.id)} />
					<Button label="Download" size="sm" disabled={mapped === 0} title={mapped === 0 ? 'Map at least one indicator first' : `Download with ${m.name}`} onClick={() => nav.newDownload(m.id)} />
					<Menu label={`More actions for ${m.name}`} trigger={(open, toggle) => <IconButton icon="dots" label={`More actions for ${m.name}`} size="sm" tone="quiet" expanded={open} haspopup="menu" onClick={toggle} />}>
						{close => <>
							<MenuItem icon="share" label="Export to share" detail="Saves a .json file" onClick={() => { close(); act(() => host.exportMapping(connectionId, m.id)); }} />
							<MenuItem icon="copy" label="Duplicate" onClick={() => { close(); act(() => host.duplicateMapping(connectionId, m.id)); }} />
							<div className="dx-menu__sep" />
							<MenuItem icon="trash" label="Delete…" danger onClick={() => {
								close();
								act(async () => {
									if (await host.confirm('Delete mapping?', `"${m.name}" is deleted. Downloads made with it are kept.`, 'Delete')) { await host.deleteMapping(connectionId, m.id); }
								});
							}} />
						</>}
					</Menu>
				</div>
			</td>
		</tr>
	);
}

const taken = (name: string, names: readonly string[]) => names.some(n => n.trim().toLowerCase() === name.trim().toLowerCase());

/** A new mapping, in two steps: what kind, then its name. */
function NewMapping({ connection, kind: initialKind, names, close, created }: { connection: Connection; kind?: MappingMode; names: readonly string[]; close(): void; created(mappingId: string): void }) {
	const server = serverName(connection);
	const [kind, setKind] = useState<MappingMode | undefined>(initialKind);
	const [step, setStep] = useState<1 | 2>(initialKind ? 2 : 1);
	const [name, setName] = useState(initialKind === 'countdown' ? `Countdown 2030 – ${connection.country || server}` : '');
	const [description, setDescription] = useState('');
	const [touched, setTouched] = useState(false);
	const [run, error, busy, dismiss] = useAction();

	const chosen = KINDS.find(k => k.mode === kind);
	const empty = !name.trim();
	const duplicate = !empty && taken(name, names);
	const bad = (touched && empty) || duplicate;
	const next = () => {
		if (kind) {
			setStep(2);
			if (!name && kind === 'countdown') { setName(`Countdown 2030 – ${connection.country || server}`); }
		}
	};
	const create = () => {
		setTouched(true);
		if (empty || duplicate || !kind) {
			return;
		}
		void run(async () => {
			const base: IAddMappingDraft = { name: name.trim(), description: description.trim() || undefined, mode: kind, indicators: [] };
			created((await host.createMapping(connection.id, kind === 'countdown' ? withAllCountdownIndicators(base) : { ...base, sheets: ['Indicators'] })).id);
		});
	};

	return (
		<Dialog wide kicker={`Step ${step} of 2 · ${step === 1 ? 'Kind' : 'Name'}`} title={step === 1 ? 'What kind of mapping?' : 'Name your mapping'} onClose={close} splitFooter={step === 2}
			footer={step === 1 ? <>
				<Button label="Cancel" size="lg" onClick={close} />
				<Button label="Next" size="lg" variant="primary" iconAfter="chevron-right" disabled={!kind} onClick={next} />
			</> : <>
				<Button label="Back" size="lg" icon="chevron-left" onClick={() => setStep(1)} />
				<Button label="Create mapping" size="lg" variant="primary" disabled={busy} onClick={create} />
			</>}>
			<div className="dx-steps" aria-hidden="true"><span className="is-on" /><span className={step === 2 ? 'is-on' : undefined} /></div>
			<ErrorLine error={error} onDismiss={dismiss} />
			{step === 1 && (
				<div className="dx-kinds" role="radiogroup" aria-label="Kind of mapping">
					{KINDS.map(k => (
						<button key={k.mode} type="button" role="radio" aria-checked={k.mode === kind} className="dx-kind" onClick={() => setKind(k.mode)} onDoubleClick={next}>
							<span className="dx-kind__head">
								<span className={`dx-tile-icon dx-tile-icon--lg${k.mode === 'custom' ? ' dx-tile-icon--info' : ''}`}><Icon name={k.icon} size={18} stroke={1.8} /></span>
								<span className="dx-grow">{k.label}</span>
								{k.mode === kind && <Icon name="check-circle" size={20} stroke={2.4} className="dx-ok" />}
							</span>
							<span style={{ color: 'var(--dx-text-2)', lineHeight: 1.5 }}>{k.text(server)}</span>
							<span className="dx-muted" style={{ fontSize: 13 }}>{k.note}</span>
						</button>
					))}
				</div>
			)}
			{step === 2 && chosen && <>
				<div className="dx-note" style={{ alignItems: 'center' }}>
					<span className={`dx-tile-icon dx-tile-icon--lg${chosen.mode === 'custom' ? ' dx-tile-icon--info' : ''}`}><Icon name={chosen.icon} stroke={1.8} /></span>
					<span className="dx-grow"><span style={{ display: 'block', fontWeight: 600, color: 'var(--dx-text)', fontSize: 14 }}>{chosen.label} mapping</span>{chosen.note}</span>
					<Button label="Change" size="md" onClick={() => setStep(1)} />
				</div>
				<Field label="Name" bad={bad} hint={duplicate ? 'A mapping with this name already exists. Pick another name.' : touched && empty ? 'Give the mapping a name.' : 'Shown in Mappings and New download, and used in file names. You can rename it later.'}>
					<input className="dx-input dx-input--white dx-input--lg" type="text" autoFocus value={name} aria-invalid={bad} placeholder={kind === 'countdown' ? 'e.g. Countdown 2030 – Kenya 2026' : 'e.g. Nutrition quarterly'}
						onChange={e => { setName(e.target.value); setTouched(true); }} onKeyDown={e => { if (e.key === 'Enter') { create(); } }} />
				</Field>
				<Field label={<>Description <span style={{ fontSize: 12 }}>(optional)</span></>}>
					<textarea className="dx-textarea dx-input--white" rows={3} value={description} placeholder="What it's for, who uses it" onChange={e => setDescription(e.target.value)} />
				</Field>
			</>}
		</Dialog>
	);
}

/** A mapping someone shared, in two steps: the file, then what it holds and how it comes in. */
function ImportMapping({ connection, names, close }: { connection: Connection; names: readonly string[]; close(): void }) {
	const id = connection.id;
	const server = serverName(connection);
	const [review, setReview] = useState<ImportReview>();
	const [mode, setMode] = useState<'new' | 'replace'>('new');
	const [name, setName] = useState('');
	const [run, error, busy, dismiss] = useAction();

	const choose = () => void run(async () => {
		const picked = await host.pickImportFile(id);
		if (picked) {
			setReview(picked);
			setMode('new');
			setName(picked.existing ? `${picked.draft.name} (shared)` : picked.draft.name);
		}
	});
	const asNew = mode === 'new';
	const nameBad = asNew && (!name.trim() || taken(name, names));
	const doImport = () => void run(async () => {
		await host.importMapping(id, review!.draft, name, asNew ? undefined : review!.existing?.id);
		close();
	});
	const lost = review ? [...new Set(review.missingSources.map(m => m.source))] : [];
	const unmapped = review ? review.indicators - review.matched - review.notAvailable : 0;

	return (
		<Dialog kicker={`Step ${review ? 2 : 1} of 2`} title={review ? 'Check before importing' : 'Import a shared mapping'} onClose={close} splitFooter={!!review}
			footer={review ? <>
				<Button label="Cancel" size="lg" onClick={close} />
				<Button label={asNew ? 'Import mapping' : 'Replace and import'} size="lg" variant={asNew ? 'primary' : 'danger-solid'} disabled={nameBad || busy} onClick={doImport} />
			</> : <Button label="Cancel" size="lg" onClick={close} />}>
			<ErrorLine error={error} onDismiss={dismiss} />
			{!review && <>
				<div className="dx-drop">
					<span className="dx-tile-icon dx-tile-icon--info" style={{ width: 48, height: 48, borderRadius: 12 }}><Icon name="upload" /></span>
					<div style={{ fontWeight: 600 }}>Choose a mapping file</div>
					<div className="dx-muted" style={{ maxWidth: 420 }}>A .json file someone exported from DataSuite with Mappings › ⋯ › Export to share.</div>
					<div style={{ marginTop: 6 }}><Button label="Choose file…" size="lg" variant="primary" disabled={busy} onClick={choose} /></div>
				</div>
				<div className="dx-muted" style={{ fontSize: 13 }}>Nothing is changed until you review and confirm on the next step. The file holds the mapping only, never data or passwords.</div>
			</>}
			{review && <>
				<div className="dx-note" style={{ alignItems: 'center' }}>
					<Icon name="file" size={28} stroke={1.6} />
					<div className="dx-grow">
						<div className="dx-mono" style={{ fontSize: 13, fontWeight: 500, color: 'var(--dx-text)', overflowWrap: 'anywhere' }}>{review.fileName}</div>
						<div style={{ fontSize: 12 }}>{formatBytes(review.sizeBytes)}</div>
					</div>
					<Button label="Other file" size="md" disabled={busy} onClick={choose} />
				</div>

				<div className="dx-checks">
					<div style={{ fontSize: 13, fontWeight: 500, color: 'var(--dx-text-2)', marginBottom: 6 }}>What's in it</div>
					<div className="dx-row" style={{ padding: '8px 0' }}><KindBadge mode={review.draft.mode} /><span>{review.draft.name || 'Untitled mapping'} · {plural(review.indicators, 'indicator')}</span></div>
					{review.matched > 0 && <div className="dx-check"><Icon name="check" stroke={2.4} /><span>{plural(review.matched, 'indicator')} matched to sources on {server}</span></div>}
					{review.notAvailable > 0 && <div className="dx-check"><Icon name="check" stroke={2.4} /><span>{review.notAvailable} kept as not available, with {review.notAvailable === 1 ? 'its reason' : 'their reasons'}</span></div>}
					{lost.length > 0 && (
						<div className="dx-check dx-check--warn"><Icon name="warning" /><span>{plural(lost.length, 'source')} {lost.length === 1 ? 'is' : 'are'} not on {server}. Indicators left without one come in as not mapped. <span className="dx-muted">({lost.slice(0, 6).join(', ')}{lost.length > 6 ? `, and ${lost.length - 6} more` : ''})</span></span></div>
					)}
					{unmapped > 0 && <div className="dx-check dx-check--warn"><Icon name="missing" /><span>{plural(unmapped, 'indicator')} not mapped yet</span></div>}
				</div>

				{review.existing
					? <fieldset className="dx-stack" style={{ border: 'none', margin: 0, padding: 0, minWidth: 0, gap: 8 }}>
						<legend style={{ fontSize: 13, fontWeight: 500, color: 'var(--dx-text-2)', padding: 0, marginBottom: 8 }}>You already have “{review.existing.name}”</legend>
						<Choices name="import-mode" value={mode} onChange={setMode} options={[
							{ value: 'new', label: 'Import as a new mapping', detail: 'Keeps yours as it is. Good for comparing the two.' },
							{ value: 'replace', label: 'Replace mine', detail: 'Your mapping is overwritten with the shared one. Past downloads are kept.' }
						]} />
					</fieldset>
					: null}
				{asNew && (
					<Field label="Name for the imported mapping" bad={nameBad} hint={nameBad ? (!name.trim() ? 'Give the mapping a name.' : 'A mapping with this name already exists.') : undefined}>
						<input className="dx-input dx-input--white" type="text" value={name} aria-invalid={nameBad} onChange={e => setName(e.target.value)} />
					</Field>
				)}
			</>}
		</Dialog>
	);
}
