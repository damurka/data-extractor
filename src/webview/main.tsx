/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the webview's React app.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Connection, ExtractorHost, MetadataStatus } from '../shared/api';
import { hostProxy, onHostEvent } from './rpc';
import './styles.css';

const host = hostProxy<ExtractorHost>();

function useConnections(): [Connection[] | undefined, string | undefined] {
	const [connections, setConnections] = useState<Connection[]>();
	const [error, setError] = useState<string>();
	const load = useCallback(() => host.listConnections().then(setConnections, (e: Error) => setError(e.message)), []);
	useEffect(() => { void load(); return onHostEvent('connectionsChanged', () => void load()); }, [load]);
	return [connections, error];
}

function MetadataLine({ connection }: { connection: Connection }) {
	const [status, setStatus] = useState<MetadataStatus>();
	const [error, setError] = useState<string>();
	const load = useCallback(() => host.metadataStatus(connection.id).then(setStatus, (e: Error) => setError(e.message)), [connection.id]);
	useEffect(() => { void load(); return onHostEvent('metadataChanged', () => void load()); }, [load]);

	if (error) {
		return <p className="error">{error}</p>;
	}
	if (!status) {
		return <p className="muted">Reading the metadata status...</p>;
	}
	const sync = (force: boolean) => host.syncMetadata(connection.id, force).catch((e: Error) => setError(e.message));
	return (
		<p className="muted">
			{status.syncing ? 'Syncing metadata...'
				: status.lastSyncedAt ? `Metadata from ${new Date(status.lastSyncedAt).toLocaleString()}: ${status.dataElements.toLocaleString()} data elements, ${status.organisationUnits.toLocaleString()} organisation units`
					: 'No metadata yet.'}
			{!status.syncing && <button className="link" onClick={() => void sync(!!status.lastSyncedAt)}>{status.lastSyncedAt ? 'Sync again' : 'Sync now'}</button>}
			{status.error && <span className="error"> {status.error}</span>}
		</p>
	);
}

function App() {
	const [connections, error] = useConnections();

	return (
		<main>
			<header>
				<h1>Data Extractor</h1>
				<div className="actions">
					<button onClick={() => void host.signIn()}>Sign in to DHIS2</button>
					<button className="secondary" onClick={() => void host.manageConnections()}>Manage access</button>
				</div>
			</header>
			{error && <p className="error">{error}</p>}
			{connections === undefined ? <p className="muted">Loading...</p>
				: connections.length === 0 ? <p>No DHIS2 connection yet. Sign in to a DHIS2 server to start: DataSuite asks for the password or access token and keeps it.</p>
					: (
						<ul className="connections">
							{connections.map(c => (
								<li key={c.id}>
									<div className="title">{c.displayName} <span className="muted">({c.username})</span></div>
									<div className="muted">{c.serverUrl}{c.usesAccessToken ? ' - access token' : ''}</div>
									{c.granted ? <MetadataLine connection={c} />
										: <button onClick={() => void host.requestAccess(c.id)}>Use this connection</button>}
								</li>
							))}
						</ul>
					)}
		</main>
	);
}

createRoot(document.getElementById('root')!).render(<App />);
