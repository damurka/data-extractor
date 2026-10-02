/*---------------------------------------------------------------------------------------------
 *  Data Extractor: how downloads run against this server (dhis2ProfileSettingsView.ts) -- requests at once, values
 *  per request, retries, timeout.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { Connection, DownloadSettings } from '../../shared/api';
import { ErrorLine, Icon, PageHeader } from '../components';
import { host, useAction, useLoad } from '../hooks';

const FIELDS: { key: keyof DownloadSettings; label: string; hint: string; min: number; max: number }[] = [
	{ key: 'maxConcurrentChunks', label: 'Max Concurrent Chunks', hint: 'The most pieces of a download run at once. DataSuite starts with 2 and adds more while the server answers quickly, fewer when it struggles. Lower it for a fragile server. Default: 4.', min: 1, max: 6 },
	{ key: 'maxCellsPerChunk', label: 'Max Cells per Request', hint: 'How much data each request asks for at first. A request the server finds too big is split automatically. Default: 50000.', min: 1_000, max: 500_000 },
	{ key: 'retryAttempts', label: 'Retry Attempts', hint: 'How many times a failed request is retried before the download fails. Default: 3.', min: 0, max: 10 },
	{ key: 'retryBaseDelayMs', label: 'Retry Delay (ms)', hint: 'How long to wait before the first retry; doubles each attempt after that. Default: 2000.', min: 200, max: 60_000 },
	{ key: 'requestTimeoutMs', label: 'Request Timeout (ms)', hint: 'How long to wait for a single request before giving up on it. Default: 120000.', min: 5_000, max: 600_000 }
];

export function Settings({ connection }: { connection: Connection }) {
	const id = connection.id;
	const saved = useLoad(() => host.downloadSettings(id), [id]);
	const [values, setValues] = useState<DownloadSettings>();
	const [run, error, busy, dismiss] = useAction();
	const [message, setMessage] = useState<string>();
	useEffect(() => { if (saved.value) { setValues(saved.value); } }, [saved.value]);

	return (
		<>
			<PageHeader model={{ title: 'Download Settings', meta: [{ icon: 'link', text: connection.serverUrl }] }} />
			<ErrorLine error={error ?? saved.error} onDismiss={dismiss} />
			<div className="settings-scroll-area">
				{values && (
					<div className="settings-card">
						<div className="sidebar-section-label text-red"><Icon name="settings-gear" /><h3>Server Tuning</h3></div>
						<p className="settings-section-desc">These control how downloads talk to this specific server -- adjust them if downloads are slow, timing out, or overwhelming the server. Saving here only affects this connection.</p>
						{FIELDS.map(f => (
							<div key={f.key} className="d2-form-group">
								<label className="d2-label">{f.label}</label>
								<input className="d2-input" type="number" min={f.min} max={f.max} step={1} value={values[f.key]} onChange={e => { setMessage(undefined); setValues({ ...values, [f.key]: Number(e.target.value) }); }} />
								<p className="settings-field-hint">{f.hint}</p>
							</div>
						))}
						<button type="button" className="d2-btn d2-btn--primary" disabled={busy} onClick={() => void run(async () => { await host.saveDownloadSettings(id, values); saved.reload(); setMessage('Download settings saved.'); })}>
							<Icon name="save" /><span>Save Settings</span>
						</button>
						{message && <p className="settings-field-hint">{message}</p>}
					</div>
				)}
			</div>
		</>
	);
}
