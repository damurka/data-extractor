/*---------------------------------------------------------------------------------------------
 *  Data Extractor: how downloads run against this server -- requests at once, values per request, retries, timeout.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { Connection, DownloadSettings } from '../../shared/api';
import { ErrorLine, PageHeader } from '../components';
import { host, useAction, useLoad } from '../hooks';

const FIELDS: { key: keyof DownloadSettings; label: string; help: string; min: number; max: number }[] = [
	{ key: 'maxConcurrentChunks', label: 'Requests at once', help: '1 is gentlest on the server; up to 6.', min: 1, max: 6 },
	{ key: 'maxCellsPerChunk', label: 'Values per request', help: 'Data items x periods x organisation units in one request. Lower it for a slow or weak server.', min: 1_000, max: 500_000 },
	{ key: 'retryAttempts', label: 'Retries of a failed request', help: 'Each waits twice as long as the one before.', min: 0, max: 10 },
	{ key: 'retryBaseDelayMs', label: 'First retry after (ms)', help: '', min: 200, max: 60_000 },
	{ key: 'requestTimeoutMs', label: 'Request timeout (ms)', help: 'Analytics on a large server can take minutes; at most 10.', min: 5_000, max: 600_000 }
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
			<PageHeader title="Download Settings" meta={`Server tuning for ${connection.serverUrl}`} />
			<ErrorLine error={error ?? saved.error} onDismiss={dismiss} />
			{values && (
				<div className="fields settings">
					{FIELDS.map(f => (
						<label key={f.key}>{f.label}
							<input type="number" min={f.min} max={f.max} value={values[f.key]} onChange={e => setValues({ ...values, [f.key]: Number(e.target.value) })} />
							{f.help && <span className="muted small">{f.help}</span>}
						</label>
					))}
					<div className="actions">
						<button disabled={busy} onClick={() => void run(async () => { await host.saveDownloadSettings(id, values); saved.reload(); setMessage('Download settings saved.'); })}>Save</button>
						{message && <span className="muted">{message}</span>}
					</div>
				</div>
			)}
		</>
	);
}
