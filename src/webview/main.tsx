/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the webview's React app, laid out as the Countdown apps are (datasuite.ui's app shell): the brand,
 *  the top bar (breadcrumb, the connection, Disconnect), the sidebar (@quire/components' Sidebar, which switches the
 *  pages) and the page. Before a connection is chosen, the connections.
 *--------------------------------------------------------------------------------------------*/

import './host';
import { HeaderBreadcrumb, NavSection, setActiveTab, Sidebar, useActiveTab } from '@quire/components';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Connection } from '../shared/api';
import mark from './assets/countdown-mark.png';
import { Button, EmptyState, ErrorLine, fa, Icon } from './components';
import { host, useAction, useLoad } from './hooks';
import { viewState } from './rpc';
import { Dashboard } from './pages/Dashboard';
import { Downloads } from './pages/Downloads';
import { MappingEditor } from './pages/MappingEditor';
import { EditTarget, Mappings } from './pages/Mappings';
import { Settings } from './pages/Settings';
import './styles.css';
import './layout.css';

type Page = 'dashboard' | 'mappings' | 'downloads' | 'settings';
const PAGES: readonly Page[] = ['dashboard', 'mappings', 'downloads', 'settings'];
interface State { connectionId?: string; page?: Page }

const VERSION = '0.1.1';
const DOCS = 'https://datasuite.damurka.com/en/docs/';

const SECTIONS: NavSection[] = [
	{
		label: 'Data Extractor',
		items: [
			{ key: 'dashboard', tabName: 'dashboard', label: 'Dashboard', icon: fa('gauge-high') },
			{ key: 'mappings', tabName: 'mappings', label: 'Mappings', icon: fa('diagram-project') },
			{ key: 'downloads', tabName: 'downloads', label: 'Downloads', icon: fa('cloud-arrow-down') },
		]
	},
	{
		label: 'This server',
		items: [{ key: 'settings', tabName: 'settings', label: 'Download settings', icon: fa('sliders') }]
	}
];

/** The breadcrumb's sections: every page under "Data Extractor" (the sidebar's sections are only how it groups them). */
const CRUMBS: NavSection[] = [{ label: 'Data Extractor', items: SECTIONS.flatMap(section => section.items) }];

const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/+$/, '');

function Brand({ sub }: { sub: string }) {
	return (
		<div className="cd-shell__brand cd-brand">
			<img className="cd-brand__mark" src={mark} alt="" width={36} height={36} />
			<div>
				<span className="cd-brand__name">Data Extractor</span>
				<span className="cd-brand__version">{sub}</span>
			</div>
		</div>
	);
}

/** DataSuite's DHIS2 connections, to pick one. */
function Connections({ connections, choose }: { connections: Connection[]; choose: (connection: Connection) => void }) {
	const [run, error, , dismiss] = useAction();
	const signIn = () => void run(async () => { const c = await host.signIn(); if (c) { choose(c); } });
	return (
		<div className="de-connect">
			<div className="de-connect__inner">
				<div className="de-connect__brand"><Brand sub={`Countdown 2030 · DHIS2 · v${VERSION}`} /></div>
				<div className="cd-page-header">
					<div className="cd-page-heading">
						<span className="cd-page-eyebrow">DHIS2</span>
						<h1>Choose a connection</h1>
						<p className="cd-page-subtitle">The DHIS2 server to map and download from. DataSuite keeps the connections and their passwords or tokens; this extension never sees them.</p>
					</div>
					<div className="right-buttons">
						<button type="button" className="cd-hdr-btn cd-hdr-btn--primary" onClick={signIn}><Icon name="plus" /><span className="cd-hdr-btn__label">Add connection</span></button>
					</div>
				</div>
				<ErrorLine error={error} onDismiss={dismiss} />
				<div className="cd-card de-connect__list">
					{connections.length === 0 && (
						<EmptyState title="No DHIS2 connection yet" actionLabel="Add connection" onAction={signIn}
							message="Sign in to a DHIS2 server in DataSuite's dialog: a personal access token is recommended. DataSuite keeps it encrypted and never gives it to extensions." />
					)}
					{connections.map(c => (
						<div key={c.id} className="de-connect__row">
							<span className="de-connect__avatar">{(c.country || c.displayName || c.username || '?').charAt(0).toUpperCase()}</span>
							<span className="de-connect__info">
								<span className="de-connect__name">{c.country || c.displayName}</span>
								<span className="de-connect__url">{hostOf(c.serverUrl)} &middot; {c.username}{c.usesAccessToken ? ' · access token' : ''}</span>
							</span>
							{!c.granted && <span className="de-badge de-badge--info">Asks first</span>}
							<Button label="Connect" variant="primary" size="sm" onClick={() => void run(async () => {
								if (c.granted || await host.requestAccess(c.id)) {
									choose(c);
								}
							})} />
						</div>
					))}
				</div>
				<div className="de-connect__foot">
					<Button label="Manage extension access" variant="link" onClick={() => void run(() => host.manageConnections())} />
					<span>Data Extractor {VERSION}</span>
				</div>
			</div>
		</div>
	);
}

/** The app shell around a connection's pages. */
function Shell({ connection, initialPage, disconnect }: { connection: Connection; initialPage: Page; disconnect: () => void }) {
	const tab = useActiveTab();
	const page: Page = (PAGES as readonly string[]).includes(tab) ? tab as Page : initialPage;
	const [editing, setEditing] = useState<EditTarget>();
	/** What the next page opens on (a new mapping, from the dashboard); another page from the sidebar opens on its list. */
	const nextEditing = useRef<EditTarget>(undefined);

	useEffect(() => viewState.set<State>({ connectionId: connection.id, page }), [connection.id, page]);
	useEffect(() => {
		setEditing(nextEditing.current);
		nextEditing.current = undefined;
	}, [page]);

	const go = (to: Page | 'new-mapping') => {
		const target: Page = to === 'new-mapping' ? 'mappings' : to;
		const edit: EditTarget | undefined = to === 'new-mapping' ? { kind: 'new' } : undefined;
		if (target === page) {
			setEditing(edit);
		} else {
			nextEditing.current = edit;
			setActiveTab(target);
		}
	};

	return (
		<div className="cd-shell">
			<header className="cd-shell__header">
				<Brand sub={hostOf(connection.serverUrl)} />
				<nav className="cd-navbar" aria-label="Data Extractor">
					<span className="cd-header-crumb"><HeaderBreadcrumb sections={CRUMBS} /></span>
					<span className="cd-header-right de-header-right">
						<span className="cd-dataset-pill de-connection-pill" title={`Connected to ${connection.serverUrl} as ${connection.username}`}>
							<span className="cd-dataset-pill__dot" />
							<span className="cd-dataset-pill__country">{connection.country || connection.displayName}</span>
							<span className="cd-dataset-pill__file">{connection.username}</span>
						</span>
						<button type="button" className="cd-hdr-btn cd-hdr-btn--outline" onClick={disconnect} title="Choose another connection">
							<Icon name="right-from-bracket" /><span className="cd-hdr-btn__label">Disconnect</span>
						</button>
					</span>
				</nav>
			</header>
			<aside className="cd-shell__sidebar de-sidebar">
				<Sidebar sections={SECTIONS} initialTab={initialPage} docsLabel="Help" docsHref={DOCS} />
			</aside>
			<div className="cd-shell__content">
				<main className="cd-shell__page">
					{editing ? <MappingEditor connection={connection} target={editing} done={() => setEditing(undefined)} />
						: page === 'dashboard' ? <Dashboard connection={connection} go={go} />
							: page === 'mappings' ? <Mappings connection={connection} edit={setEditing} />
								: page === 'downloads' ? <Downloads connection={connection} />
									: <Settings connection={connection} />}
				</main>
			</div>
		</div>
	);
}

function App() {
	const connections = useLoad(() => host.listConnections(), [], ['connectionsChanged']);
	const saved = viewState.get<State>() ?? {};
	const [connectionId, setConnectionId] = useState(saved.connectionId);
	const [initialPage, setInitialPage] = useState<Page>(saved.page ?? 'dashboard');

	useEffect(() => { if (!connectionId) { viewState.set<State>({}); } }, [connectionId]);

	const list = connections.value ?? [];
	const connection = list.find(c => c.id === connectionId && c.granted);

	if (!connections.value) {
		return <div className="de-connect"><div className="de-connect__inner"><ErrorLine error={connections.error} /></div></div>;
	}
	return connection
		? <Shell key={connection.id} connection={connection} initialPage={initialPage} disconnect={() => setConnectionId(undefined)} />
		: <Connections connections={list} choose={c => { setInitialPage('dashboard'); setConnectionId(c.id); }} />;
}

document.body.classList.add('cd-theme-extractor');
createRoot(document.getElementById('root')!).render(<App />);
