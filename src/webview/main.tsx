/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the webview's React app -- the sidebar (connection, pages) and the page shown.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Connection } from '../shared/api';
import { ErrorLine } from './components';
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

function App() {
	const connections = useLoad(() => host.listConnections(), [], ['connectionsChanged']);
	const saved = viewState.get<State>() ?? {};
	const [connectionId, setConnectionId] = useState(saved.connectionId);
	const [page, setPage] = useState<Page>(saved.page ?? 'dashboard');
	const [editing, setEditing] = useState<EditTarget>();
	const [run, error, , dismiss] = useAction();

	useEffect(() => viewState.set<State>({ connectionId, page }), [connectionId, page]);

	const list = connections.value ?? [];
	const connection: Connection | undefined = list.find(c => c.id === connectionId) ?? list.find(c => c.granted) ?? list[0];
	useEffect(() => { if (connection && connection.id !== connectionId) { setConnectionId(connection.id); } }, [connection, connectionId]);

	const go = (to: Page | 'new-mapping') => {
		setEditing(to === 'new-mapping' ? { kind: 'new' } : undefined);
		setPage(to === 'new-mapping' ? 'mappings' : to);
	};

	return (
		<div className="app">
			<nav className="sidebar">
				<div className="brand"><div className="brand-title">Countdown to 2030</div><div className="brand-sub">DHIS2 Data Extractor</div></div>
				{list.length > 0 && (
					<select className="connection" value={connection?.id} onChange={e => { setConnectionId(e.target.value); setEditing(undefined); }} title="DHIS2 connection">
						{list.map(c => <option key={c.id} value={c.id}>{c.displayName} ({c.serverUrl.replace(/^https?:\/\//, '')})</option>)}
					</select>
				)}
				{(['dashboard', 'mappings', 'downloads'] as Page[]).map(p => (
					<button key={p} className={`nav ${page === p ? 'on' : ''}`} disabled={!connection?.granted} onClick={() => go(p)}>{p[0].toUpperCase() + p.slice(1)}</button>
				))}
				<div className="sidebar-foot">
					<button className={`nav ${page === 'settings' ? 'on' : ''}`} disabled={!connection?.granted} onClick={() => go('settings')}>Settings</button>
					<button className="nav" onClick={() => void run(() => host.signIn())}>Sign in to another server</button>
					<button className="nav" onClick={() => void run(() => host.manageConnections())}>Manage access</button>
				</div>
			</nav>
			<main className="content">
				<ErrorLine error={error ?? connections.error} onDismiss={dismiss} />
				{!connections.value ? <p className="muted">Loading...</p>
					: !connection ? (
						<div className="empty">
							<h2>Sign in to DHIS2</h2>
							<p>The Data Extractor reads from a DHIS2 server through DataSuite. Sign in in DataSuite's dialog: it asks for a personal access token (recommended) or your password, keeps it encrypted, and never gives it to extensions.</p>
							<button onClick={() => void run(() => host.signIn())}>Sign in to DHIS2</button>
						</div>
					) : !connection.granted ? (
						<div className="empty">
							<h2>Use {connection.displayName}'s connection?</h2>
							<p>{connection.serverUrl} as {connection.username}. DataSuite asks you to let the Data Extractor read from it.</p>
							<button onClick={() => void run(() => host.requestAccess(connection.id))}>Use this connection</button>
						</div>
					) : editing ? <MappingEditor connection={connection} target={editing} done={() => setEditing(undefined)} />
						: page === 'dashboard' ? <Dashboard connection={connection} go={go} />
							: page === 'mappings' ? <Mappings connection={connection} edit={setEditing} />
								: page === 'downloads' ? <Downloads connection={connection} />
									: <Settings connection={connection} />}
			</main>
		</div>
	);
}

createRoot(document.getElementById('root')!).render(<App />);
