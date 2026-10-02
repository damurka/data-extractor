/*---------------------------------------------------------------------------------------------
 *  Data Extractor: how downloads run against this server -- requests at once, values per request, retries, timeout.
 *--------------------------------------------------------------------------------------------*/

import { FieldNumber } from '@quire/components';
import { useEffect, useState } from 'react';
import { Connection, DownloadSettings } from '../../shared/api';
import { Banner, Button, Card, ErrorLine, PageHeader } from '../components';
import { host, useAction, useLoad } from '../hooks';

const FIELDS: { key: keyof DownloadSettings; label: string; hint: string; min: number; max: number; unit?: string }[] = [
	{ key: 'maxConcurrentChunks', label: 'Requests at once (at most)', hint: 'DataSuite starts with 2 and adds more while the server answers quickly, fewer when it struggles. Lower it for a fragile server. Default: 4.', min: 1, max: 6 },
	{ key: 'maxCellsPerChunk', label: 'Values per request', hint: 'How much data each request asks for at first. A request the server finds too big is split automatically. Default: 50000.', min: 1_000, max: 500_000 },
	{ key: 'retryAttempts', label: 'Retries', hint: 'How many times a request that failed in passing is tried again before the download fails. Default: 3.', min: 0, max: 10 },
	{ key: 'retryBaseDelayMs', label: 'First retry after', hint: 'Doubles with each retry. Default: 2000 ms.', min: 200, max: 60_000, unit: 'ms' },
	{ key: 'requestTimeoutMs', label: 'Request timeout', hint: 'How long one request may take before it is split or tried again. Default: 120000 ms.', min: 5_000, max: 600_000, unit: 'ms' }
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
			<PageHeader model={{
				eyebrow: 'This server',
				title: 'Download settings',
				subtitle: `How downloads talk to ${connection.serverUrl.replace(/^https?:\/\//, '')}. Change them if downloads are slow, time out, or load the server too much; they apply to this connection only.`
			}} />
			<ErrorLine error={error ?? saved.error} onDismiss={dismiss} />
			{message && <Banner status="success" text={message} />}
			{values && (
				<Card title="Server tuning" icon="sliders" className="de-narrow">
					<div className="de-fields">
						{FIELDS.map(f => (
							<FieldNumber key={f.key} label={f.label} hint={f.hint} min={f.min} max={f.max} step={1} unit={f.unit} value={values[f.key]}
								onChange={v => { setMessage(undefined); setValues({ ...values, [f.key]: v }); }} />
						))}
					</div>
					<div className="de-card-actions">
						<Button label="Save settings" icon="floppy-disk" variant="primary" disabled={busy} onClick={() => void run(async () => {
							await host.saveDownloadSettings(id, values);
							saved.reload();
							setMessage('Download settings saved.');
						})} />
					</div>
				</Card>
			)}
		</>
	);
}
