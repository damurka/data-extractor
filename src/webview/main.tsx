/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the webview's React app, laid out as the built-in extractor was -- the connections screen
 *  (dhis2LoginProfileView.ts) or the profile view: its sidebar (dhis2ProfileSidebar.ts) and main area.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Connection } from '../shared/api';
import { ErrorLine, Icon } from './components';
import { host, useAction, useLoad } from './hooks';
import { viewState } from './rpc';
import { Dashboard } from './pages/Dashboard';
import { Downloads } from './pages/Downloads';
import { MappingEditor } from './pages/MappingEditor';
import { EditTarget, Mappings } from './pages/Mappings';
import { Settings } from './pages/Settings';
import './styles.css';

type Page = 'dashboard' | 'mappings' | 'downloads' | 'settings';
interface State { connectionId?: string; page?: Page }

const VERSION = '0.1.0';

function Logo({ className, as: Title }: { className: string; as: 'h1' }) {
	return (
		<div className={className}>
			<div className="dhis2-login-logo-container"><div className="dhis2-suite-logo" /></div>
			<Title className={className === 'sidebar-header' ? 'app-title' : undefined}>Countdown <span>to 2030</span></Title>
			<p className={className === 'sidebar-header' ? 'app-brand' : undefined}>DHIS2 Data Extractor</p>
		</div>
	);
}

/** DataSuite's DHIS2 connections, to pick one (the built-in extractor's "Select Data Profile"). */
function Connections({ connections, choose }: { connections: Connection[]; choose: (connection: Connection) => void }) {
	const [run, error, , dismiss] = useAction();
	return (
		<div className="dhis2-login-view">
			<div className="dhis2-login-view-container">
				<div className="dhis2-profiles-wrapper">
					<div className="dhis2-profiles-top-header"><Logo className="dhis2-login-header-logo" as="h1" /></div>
					<div className="dhis2-profiles-card">
						<div className="dhis2-profiles-header">
							<div>
								<h2><span className="codicon codicon-server-environment" /><span>Select Data Profile</span></h2>
								<p>Choose a DHIS2 connection to continue. DataSuite keeps the connections and their passwords or tokens.</p>
							</div>
							<button type="button" className="dhis2-profiles-add-btn" onClick={() => void run(async () => { const c = await host.signIn(); if (c) { choose(c); } })}>
								<span className="codicon codicon-add" /><span>Add New Profile</span>
							</button>
						</div>
						<ErrorLine error={error} onDismiss={dismiss} />
						<div className="dhis2-profiles-list">
							{connections.length === 0 && <p className="dhis2-profiles-empty">No DHIS2 connection yet: add one with Add New Profile. DataSuite asks for a personal access token (recommended) or your password, keeps it encrypted, and never gives it to extensions.</p>}
							{connections.map(c => (
								<div key={c.id} className="dhis2-profile-row">
									<div className="dhis2-profile-row-left">
										<div className="dhis2-profile-avatar">{(c.displayName || c.username || '?').charAt(0).toUpperCase()}</div>
										<div className="dhis2-profile-info">
											<h3>{c.displayName}</h3>
											<div className="dhis2-profile-url-row"><span className="codicon codicon-link" /><span>{c.serverUrl}</span></div>
										</div>
									</div>
									<div className="dhis2-profile-row-actions">
										<button type="button" className="dhis2-profile-connect-btn" onClick={() => void run(async () => {
											if (c.granted || await host.requestAccess(c.id)) {
												choose(c);
											}
										})}><span>Connect</span></button>
									</div>
								</div>
							))}
						</div>
						<div className="dhis2-profiles-footer">
							<button type="button" className="dhis2-profiles-manage" onClick={() => void run(() => host.manageConnections())}>Manage extension access</button>
							<span>Version {VERSION}</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function Sidebar({ page, go, disconnect }: { page: Page; go: (page: Page) => void; disconnect: () => void }) {
	const link = (id: Page, label: string, icon: string) => (
		<a className={`nav-link${page === id ? ' active' : ''}`} href="#" onClick={e => { e.preventDefault(); go(id); }}>
			<Icon name={icon} /><span>{label}</span>
		</a>
	);
	return (
		<aside className="app-sidebar">
			<Logo className="sidebar-header" as="h1" />
			<nav className="sidebar-nav">
				{link('dashboard', 'Dashboard', 'dashboard')}
				{link('mappings', 'Mappings', 'map')}
				{link('downloads', 'Downloads', 'cloud-download')}
			</nav>
			<div className="sidebar-footer">
				{link('settings', 'Settings', 'settings-gear')}
				<button type="button" className="btn-disconnect" onClick={disconnect}><Icon name="debug-disconnect" /><span>Disconnect</span></button>
				<p className="app-version">Version {VERSION}</p>
			</div>
		</aside>
	);
}

function App() {
	const connections = useLoad(() => host.listConnections(), [], ['connectionsChanged']);
	const saved = viewState.get<State>() ?? {};
	const [connectionId, setConnectionId] = useState(saved.connectionId);
	const [page, setPage] = useState<Page>(saved.page ?? 'dashboard');
	const [editing, setEditing] = useState<EditTarget>();

	useEffect(() => viewState.set<State>({ connectionId, page }), [connectionId, page]);

	const list = connections.value ?? [];
	const connection = list.find(c => c.id === connectionId && c.granted);
	const go = (to: Page | 'new-mapping') => {
		setEditing(to === 'new-mapping' ? { kind: 'new' } : undefined);
		setPage(to === 'new-mapping' ? 'mappings' : to);
	};

	if (!connections.value) {
		return <div className="dhis2-profile-view"><main className="app-main"><ErrorLine error={connections.error} /></main></div>;
	}
	return (
		<div className={`de-root${connection ? '' : ' dhis2-login-visible'}`}>
			<Connections connections={list} choose={c => { setConnectionId(c.id); setEditing(undefined); setPage('dashboard'); }} />
			<div className="dhis2-profile-view">
				{connection && <>
					<Sidebar page={page} go={go} disconnect={() => setConnectionId(undefined)} />
					<main className="app-main">
						{editing ? <MappingEditor connection={connection} target={editing} done={() => setEditing(undefined)} />
							: page === 'dashboard' ? <Dashboard connection={connection} go={go} />
								: page === 'mappings' ? <Mappings connection={connection} edit={setEditing} />
									: page === 'downloads' ? <Downloads connection={connection} />
										: <Settings connection={connection} />}
					</main>
				</>}
			</div>
		</div>
	);
}

createRoot(document.getElementById('root')!).render(<App />);
