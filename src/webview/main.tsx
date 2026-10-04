/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the webview's React app -- the sidebar (the connection, the pages, the metadata copy) and the page.
 *  Before a connection is chosen, DataSuite's connections to choose from.
 *--------------------------------------------------------------------------------------------*/

import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-ext-400.css';
import '@fontsource/ibm-plex-sans/latin-ext-500.css';
import '@fontsource/ibm-plex-sans/latin-ext-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './app.css';

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Connection, MappingMode, Preferences } from '../shared/api';
import { hostOf, plural, serverName, signedInAs, when } from './format';
import { fromNow, host, useAction, useLoad } from './hooks';
import { Downloads } from './pages/Downloads';
import { MappingEditor } from './pages/MappingEditor';
import { Mappings } from './pages/Mappings';
import { NewDownload } from './pages/NewDownload';
import { Overview } from './pages/Overview';
import { Settings } from './pages/Settings';
import { viewState } from './rpc';
import { Button, ErrorLine, Icon } from './ui';

export type Page = 'overview' | 'mappings' | 'downloads' | 'settings';
const PAGES: readonly { id: Page; label: string; icon: string }[] = [
	{ id: 'overview', label: 'Overview', icon: 'overview' },
	{ id: 'mappings', label: 'Mappings', icon: 'mappings' },
	{ id: 'downloads', label: 'Downloads', icon: 'download' },
	{ id: 'settings', label: 'Settings', icon: 'settings' }
];
interface State { connectionId?: string; page?: Page; editing?: string }

/** How the pages send the user elsewhere. */
export interface Nav {
	go(page: Page): void;
	/** The New download dialog, on a mapping when one is named. */
	newDownload(mappingId?: string): void;
	/** The New mapping dialog, on the mappings page. */
	newMapping(kind?: MappingMode): void;
	editMapping(mappingId: string): void;
}

const VERSION = '0.2.0';

function Brand() {
	return <div className="dx-brand"><span className="dx-brand__mark"><Icon name="database" size={18} /></span>Data Extractor</div>;
}

const initialsOf = (name: string) => name.split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase() || '?';

/** One of DataSuite's connections: what it is, whether its server answers, and the way in. */
function ConnectionRow({ c, last, usedAt, asking, setAsking, open, act }: {
	c: Connection; last: boolean; usedAt: number | undefined; asking: boolean; setAsking(asking: boolean): void; open(): void; act(action: () => Promise<unknown>): void;
}) {
	const name = serverName(c);
	// Only a connection the extractor may read through can be asked whether it answers
	const test = useLoad(() => c.granted ? host.testConnection(c.id) : Promise.resolve(undefined), [c.id, c.granted]);
	const calendar = useLoad(() => c.granted ? host.calendar(c.id) : Promise.resolve(undefined), [c.id, c.granted]);
	const mappings = useLoad(() => host.listMappings(c.id), [c.id], ['mappingsChanged'], c.id);
	const expired = !!test.value?.unauthorized;
	const down = !!test.value && !test.value.ok && !expired;
	const version = test.value?.version ?? c.dhis2Version;
	const tone = expired ? 'warn' : c.granted ? 'ok' : 'info';
	const facts = [
		!c.granted ? undefined : !test.value ? 'Asking the server…' : test.value.ok ? 'Reachable' : 'Not answering right now',
		version && `DHIS2 ${version.split('.').slice(0, 2).join('.')}`,
		/^ethiop/i.test(calendar.value ?? '') ? 'Ethiopian calendar' : undefined,
		mappings.value?.length ? plural(mappings.value.length, 'mapping') : undefined,
		usedAt ? `used ${when(usedAt).replace(/^Today.*/, 'today').replace(/^Yesterday/, 'yesterday')}` : 'not used here yet'
	].filter(Boolean).join(' · ');
	return (
		<div className={`dx-connect__item${asking ? ' is-asking' : ''}`}>
			<div className="dx-connect__row">
				<span className={`dx-avatar dx-avatar--${tone}`} aria-hidden="true">
					{initialsOf(name)}
					<span className={`dx-avatar__dot${!c.granted || !test.value ? '' : test.value.ok ? ' is-ok' : ' is-warn'}`} />
				</span>
				<div className="dx-grow dx-stack" style={{ gap: 3 }}>
					<div className="dx-row dx-wrap" style={{ gap: 8 }}>
						<span style={{ fontWeight: 600, fontSize: 16 }}>{name}</span>
						{last && <span className="dx-badge dx-badge--accent dx-badge--sm" style={{ fontSize: 12 }}>Last used</span>}
						{!c.granted && <span className="dx-badge dx-badge--info dx-badge--sm" style={{ fontSize: 12, gap: 4 }}><Icon name="lock" size={11} stroke={2.4} />Asks first</span>}
					</div>
					<div className="dx-mono" style={{ fontSize: 13, color: 'var(--dx-text-2)', overflowWrap: 'anywhere' }}>
						{hostOf(c.serverUrl)}<span style={{ color: 'var(--dx-faint)' }}> · </span>{c.username}{c.usesAccessToken && <><span style={{ color: 'var(--dx-faint)' }}> · </span>access token</>}
					</div>
					<div style={{ fontSize: 13, color: expired || down ? 'var(--dx-warn)' : 'var(--dx-muted)' }} title={down ? test.value?.error : undefined}>
						{expired ? 'The server no longer accepts this sign-in. Sign in again in DataSuite to use it.' : facts}
					</div>
				</div>
				<div className="dx-row" style={{ flexShrink: 0 }}>
					{expired ? <Button label="Sign in again" size="lg" title="Opens DataSuite's sign-in dialog for this server" onClick={() => act(() => host.signIn(c.serverUrl))} />
						: c.granted ? <Button label="Connect" size="lg" variant="primary" iconAfter="arrow-right" onClick={open} />
							: <Button label="Connect…" size="lg" variant="outline" expanded={asking} onClick={() => setAsking(!asking)} />}
				</div>
			</div>
			{asking && !c.granted && (
				<div className="dx-ask" role="group" aria-label={`Allow Data Extractor to use ${name}`}>
					<div>
						<div style={{ fontWeight: 600 }}>Let Data Extractor use {name}?</div>
						<ul>
							<li>Reads data and metadata as <span className="dx-mono" style={{ fontSize: 13 }}>{c.username}</span>, with that account's access</li>
							<li>Can't change or delete anything on the server</li>
							<li>Never sees the password or token: DataSuite handles sign-in</li>
						</ul>
					</div>
					<div className="dx-row dx-wrap" style={{ justifyContent: 'flex-end', gap: 8 }}>
						<span className="dx-grow dx-muted" style={{ fontSize: 13 }}>DataSuite asks you to confirm.</span>
						<Button label="Cancel" onClick={() => setAsking(false)} />
						<Button label="Allow…" variant="primary" onClick={() => act(async () => { if (await host.requestAccess(c.id)) { open(); } })} />
					</div>
				</div>
			)}
		</div>
	);
}

/** DataSuite's DHIS2 connections, to pick one. */
function Connections({ connections, preferences, choose, reloadPreferences }: { connections: Connection[]; preferences: Preferences | undefined; choose: (connection: Connection) => void; reloadPreferences(): void }) {
	const [run, error, , dismiss] = useAction();
	const [asking, setAsking] = useState<string>();
	const signIn = () => void run(async () => { const c = await host.signIn(); if (c) { choose(c); } });
	const lastUsed = preferences?.lastUsed ?? {};
	const last = connections.filter(c => lastUsed[c.id]).sort((a, b) => lastUsed[b.id] - lastUsed[a.id])[0]?.id;
	return (
		<div className="dx-connect">
			<div className="dx-connect__inner">
				<div className="dx-brand dx-brand--lg"><span className="dx-brand__mark"><Icon name="database" size={22} /></span>Data Extractor<span className="dx-brand__version">{VERSION}</span></div>
				<div className="dx-connect__top">
					<div>
						<h1>{connections.length ? 'Choose a connection' : 'Sign in to start'}</h1>
						<p>{connections.length ? 'Pick the DHIS2 server to work with. These are the servers you signed in to in DataSuite.' : 'DataSuite is not signed in to a DHIS2 server yet. You sign in in its own dialog, with a personal access token (best) or a username and password.'}</p>
					</div>
					<Button label={connections.length ? 'Sign in to another server…' : 'Sign in to a server…'} icon="plus" size="lg" variant={connections.length ? 'default' : 'primary'} title="Opens DataSuite's sign-in dialog" onClick={signIn} />
				</div>
				<ErrorLine error={error} onDismiss={dismiss} />
				{connections.length > 0 && <>
					<section className="dx-card dx-card--clip" style={{ borderRadius: 14 }} aria-label="Connections">
						{connections.map(c => <ConnectionRow key={c.id} c={c} last={c.id === last} usedAt={lastUsed[c.id]} asking={asking === c.id} setAsking={on => setAsking(on ? c.id : undefined)}
							open={() => choose(c)} act={action => void run(action)} />)}
					</section>
					<label className="dx-check-line">
						<input type="checkbox" checked={!!preferences?.openLastUsed} disabled={!preferences} onChange={e => { const value = e.target.checked; void run(async () => { await host.setOpenLastUsed(value); reloadPreferences(); }); }} />
						Open the last used server straight away next time
					</label>
				</>}
				<div className="dx-shield">
					<Icon name="shield" size={18} />
					<div>
						Data Extractor only reads from DHIS2, and never sees or changes how you sign in: DataSuite keeps the password or token. Servers marked <strong>Asks first</strong> need your OK the first time.{' '}
						<button type="button" className="dx-link" style={{ fontSize: 14, textDecoration: 'underline' }} onClick={() => void run(() => host.manageConnections())}>Manage which extensions may use a connection</button>
						{connections.length > 0 && <>{' · '}<button type="button" className="dx-link" style={{ fontSize: 14, textDecoration: 'underline' }} title="Opens DataSuite's sign-out" onClick={() => void run(() => host.signOut())}>Sign out of a server</button></>}
					</div>
				</div>
			</div>
		</div>
	);
}

/** The sidebar and the page of a connection. */
function Shell({ connection, initial, disconnect }: { connection: Connection; initial: State; disconnect: () => void }) {
	const id = connection.id;
	const [page, setPage] = useState<Page>(initial.page ?? 'overview');
	const [editing, setEditing] = useState<string | undefined>(initial.editing);
	const [download, setDownload] = useState<{ mappingId?: string }>();
	const [creatingMapping, setCreatingMapping] = useState<MappingMode | 'ask'>();
	const status = useLoad(() => host.metadataStatus(id), [id], ['metadataChanged']);
	const active = useLoad(() => host.downloads(id, 'active', ''), [id], ['downloadsChanged'], id);
	const [run, error, , dismiss] = useAction();

	useEffect(() => viewState.set<State>({ connectionId: id, page, editing }), [id, page, editing]);

	const nav: Nav = {
		go: to => { setEditing(undefined); setPage(to); },
		newDownload: mappingId => setDownload({ mappingId }),
		newMapping: kind => { setEditing(undefined); setPage('mappings'); setCreatingMapping(kind ?? 'ask'); },
		editMapping: mappingId => { setPage('mappings'); setEditing(mappingId); }
	};

	const running = (active.value?.inProgress ?? []).filter(d => d.state === 'downloading' || d.state === 'processing').length;
	const s = status.value;
	const synced = !s ? '' : s.syncing ? 'Syncing metadata…' : s.error ? 'The last metadata sync failed' : s.lastSyncedAt ? `Metadata synced ${fromNow(s.lastSyncedAt)}` : 'Metadata not synced yet';

	return (
		<div className="dx-shell">
			<aside className="dx-side">
				<Brand />
				<div className="dx-conn">
					<div className="dx-eyebrow">Connection</div>
					<div className="dx-conn__name">{serverName(connection)}</div>
					<div className="dx-conn__host">{hostOf(connection.serverUrl)}</div>
					<div className="dx-conn__foot">
						<span className="dx-status dx-status--ok dx-ellipsis" title={`Signed in as ${signedInAs(connection)}${connection.usesAccessToken ? ', with a personal access token' : ''}`}><span className="dx-muted dx-ellipsis">{connection.username}</span></span>
						<button type="button" className="dx-link" style={{ fontSize: 12 }} onClick={disconnect} title="Use another of DataSuite's connections">Switch</button>
					</div>
				</div>
				<nav className="dx-nav" aria-label="Pages">
					{PAGES.map(p => (
						<button key={p.id} type="button" className="dx-nav__item" aria-current={p.id === page ? 'page' : undefined} onClick={() => nav.go(p.id)}>
							<Icon name={p.icon} size={18} stroke={1.8} />
							<span className="dx-grow">{p.label}</span>
							{p.id === 'downloads' && running > 0 && <span className="dx-badge dx-badge--accent dx-badge--sm">{running} running</span>}
						</button>
					))}
				</nav>
				<div className="dx-side__foot">
					<span title={s?.error}>{synced}</span>
					<Button label={s?.syncing ? 'Syncing…' : 'Sync metadata'} icon="sync" size="md" block disabled={!!s?.syncing} onClick={() => void run(() => host.syncMetadata(id, true))} />
				</div>
			</aside>
			<main className={`dx-main${editing ? ' dx-main--wide' : ''}`}>
				<ErrorLine error={error} onDismiss={dismiss} />
				{editing ? <MappingEditor key={editing} connection={connection} mappingId={editing} done={() => setEditing(undefined)} />
					: page === 'overview' ? <Overview connection={connection} nav={nav} />
						: page === 'mappings' ? <Mappings connection={connection} nav={nav} creating={creatingMapping} setCreating={setCreatingMapping} />
							: page === 'downloads' ? <Downloads connection={connection} nav={nav} />
								: <Settings connection={connection} />}
			</main>
			{download && <NewDownload connection={connection} mappingId={download.mappingId} close={() => setDownload(undefined)} started={() => { setDownload(undefined); nav.go('downloads'); }} />}
		</div>
	);
}

function App() {
	const connections = useLoad(() => host.listConnections(), [], ['connectionsChanged']);
	const preferences = useLoad(() => host.preferences(), []);
	const [saved] = useState(() => viewState.get<State>() ?? {});
	const [connectionId, setConnectionId] = useState(saved.connectionId);
	/** Whether the chooser was asked for (Switch), or a connection picked: then the last used one is not opened by itself. */
	const [chosen, setChosen] = useState(!!saved.connectionId);

	useEffect(() => { if (!connectionId) { viewState.set<State>({}); } }, [connectionId]);

	const list = connections.value ?? [];
	const connection = list.find(c => c.id === connectionId && c.granted);

	// "Open the last used server straight away": once, when the extractor opens
	useEffect(() => {
		const prefs = preferences.value;
		if (chosen || !prefs || !connections.value) {
			return;
		}
		setChosen(true);
		const last = prefs.openLastUsed ? connections.value.filter(c => c.granted && prefs.lastUsed[c.id]).sort((a, b) => prefs.lastUsed[b.id] - prefs.lastUsed[a.id])[0] : undefined;
		if (last) {
			setConnectionId(last.id);
		}
	}, [chosen, preferences.value, connections.value]);
	const choose = (c: Connection) => {
		setChosen(true);
		setConnectionId(c.id);
		void host.connectionUsed(c.id).then(() => preferences.reload(), () => undefined);
	};

	// (not the chooser for a moment before the last used server opens by itself)
	if (!connections.value || (!chosen && !preferences.error)) {
		return <div className="dx-connect"><div className="dx-connect__inner"><ErrorLine error={connections.error} /></div></div>;
	}
	return connection
		? <Shell key={connection.id} connection={connection} initial={connection.id === saved.connectionId ? saved : {}} disconnect={() => setConnectionId(undefined)} />
		: <Connections connections={list} preferences={preferences.value} choose={choose} reloadPreferences={preferences.reload} />;
}

createRoot(document.getElementById('root')!).render(<App />);
