/*---------------------------------------------------------------------------------------------
 *  Data Extractor: a connection's settings -- the server, the calendar and periods New download shows first, how hard
 *  downloads work the server, the files finished downloads make, and the metadata copy.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { isEthiopianCalendar } from '../../core/periods';
import { Connection, ConnectionTest, ExtractorSettings, FILE_NAME_TOKENS } from '../../shared/api';
import { serverName, signedInAs } from '../format';
import { fromNow, host, useAction, useLoad } from '../hooks';
import { formatNumber } from '../locale';
import { Button, Choices, ErrorLine, Icon, PageHead, Segmented, Setting, Stepper, Switch } from '../ui';

const SECTIONS = [['connection', 'Connection'], ['periods', 'Calendar & periods'], ['downloads', 'Downloads'], ['files', 'Files'], ['metadata', 'Metadata']] as const;
const CHUNKS = [10_000, 25_000, 50_000, 100_000, 250_000];
const TIMEOUTS: readonly [number, string][] = [[30_000, '30 seconds'], [60_000, '1 minute'], [120_000, '2 minutes'], [300_000, '5 minutes'], [600_000, '10 minutes']];

export function Settings({ connection }: { connection: Connection }) {
	const id = connection.id;
	const name = serverName(connection);
	const saved = useLoad(() => host.settings(id), [id]);
	const status = useLoad(() => host.metadataStatus(id), [id], ['metadataChanged']);
	const calendar = useLoad(() => host.calendar(id), [id]);
	const apps = useLoad(() => host.analysisApps(), []);
	const [v, setV] = useState<ExtractorSettings>();
	const [test, setTest] = useState<ConnectionTest>();
	const [testing, setTesting] = useState(false);
	const [run, error, busy, dismiss] = useAction();
	useEffect(() => { if (saved.value) { setV(saved.value); } }, [saved.value]);

	if (!v || !saved.value) {
		return <><PageHead kicker="How DataSuite connects, downloads and saves" title="Settings" /><ErrorLine error={saved.error} /></>;
	}
	const put = (patch: Partial<ExtractorSettings>) => setV({ ...v, ...patch });
	const dirty = (Object.keys(v) as (keyof ExtractorSettings)[]).some(k => v[k] !== saved.value![k]);
	const save = () => void run(async () => { await host.saveSettings(id, v); saved.reload(); });
	const serverEthiopic = isEthiopianCalendar(calendar.value);
	const s = status.value;
	const items = s ? s.dataElements + s.categoryOptionCombos + s.organisationUnits : undefined;
	const today = new Date();
	const sample: Record<string, string> = { '{mapping}': 'countdown-2030-kenya', '{periods}': '2025-01_2025-09', '{level}': 'level-5', '{date}': `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}` };
	const example = `${FILE_NAME_TOKENS.reduce((text, token) => text.split(token).join(sample[token]), v.fileName || '')}.${v.openAs === 'JSON' ? 'json' : 'xlsx'}`;
	const runTest = () => { setTesting(true); void host.testConnection(id).then(setTest, () => setTest({ ok: false, ms: 0, error: 'The test could not run.' })).finally(() => setTesting(false)); };

	return (
		<>
			<PageHead kicker="How DataSuite connects, downloads and saves" title="Settings">
				{dirty
					? <>
						<span className="dx-muted" style={{ fontSize: 13 }}>Unsaved changes</span>
						<Button label="Discard" onClick={() => setV(saved.value)} />
						<Button label="Save changes" variant="primary" disabled={busy} onClick={save} />
					</>
					: <span className="dx-row dx-muted" style={{ fontSize: 13, gap: 6 }}><Icon name="check" size={14} stroke={2.4} className="dx-ok" />All changes saved</span>}
			</PageHead>
			<ErrorLine error={error} onDismiss={dismiss} />

			<div className="dx-settings">
				<nav className="dx-subnav" aria-label="Settings sections">
					{SECTIONS.map(([key, label]) => <a key={key} href={`#${key}`} onClick={e => { e.preventDefault(); document.getElementById(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{label}</a>)}
				</nav>
				<div className="dx-stack" style={{ gap: 24 }}>

					<section id="connection" className="dx-card dx-card--clip" aria-labelledby="h-connection">
						<div className="dx-card__head dx-card__head--tall">
							<div><h2 id="h-connection">Connection</h2><p>The DHIS2 server this extractor reads from, as DataSuite has it.</p></div>
						</div>
						<div className="dx-card__body dx-stack" style={{ gap: 16 }}>
							<dl className="dx-dl dx-dl--left">
								<dt>Server</dt><dd>{name}</dd>
								<dt>Address</dt><dd className="dx-mono" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{connection.serverUrl}</dd>
								<dt>Signed in as</dt><dd>{signedInAs(connection)}</dd>
								<dt>Signed in with</dt><dd>{connection.usesAccessToken ? 'A personal access token' : 'A username and password'}</dd>
								{(test?.version ?? connection.dhis2Version) && <><dt>DHIS2 version</dt><dd>{test?.version ?? connection.dhis2Version}</dd></>}
							</dl>
							<div className="dx-row dx-wrap" style={{ gap: 12 }}>
								<Button label={testing ? 'Testing…' : 'Test connection'} disabled={testing} onClick={runTest} />
								{test && (test.ok
									? <span className="dx-status dx-status--ok" style={{ whiteSpace: 'normal' }}>Connected · answered in {(test.ms / 1000).toFixed(1)} s</span>
									: <span className="dx-status dx-status--bad" style={{ whiteSpace: 'normal' }}>Not answering: {test.error}</span>)}
							</div>
						</div>
						<div className="dx-setting dx-setting--stack" style={{ borderTop: '1px solid var(--dx-border-soft)', background: 'var(--dx-sunken)' }}>
							<div className="dx-row" style={{ alignItems: 'flex-start' }}>
								<Icon name="lock" className="dx-muted" />
								<div className="dx-grow">
									<div className="dx-setting__title">Only DataSuite can change a connection</div>
									<div className="dx-setting__hint">The password or token is typed in DataSuite's own dialog, kept encrypted there, and added to each request by DataSuite. The extractor sees which server and user a connection is, never the password or token, so nothing here can edit them. To use another address, user or token, sign in again in DataSuite: that makes a new connection with its own mappings and downloads. To carry a mapping over, export it here (Mappings › ⋯ › Export to share) and import it there.</div>
								</div>
							</div>
							<div className="dx-row dx-wrap" style={{ gap: 8 }}>
								<Button label="Sign in to a server…" size="md" title="Opens DataSuite's sign-in dialog" onClick={() => void run(() => host.signIn())} />
								<Button label="Sign out…" size="md" title="Opens DataSuite's sign-out" onClick={() => void run(() => host.signOut())} />
								<Button label="Extension access…" size="md" title="Which extensions may read through each connection, in DataSuite" onClick={() => void run(() => host.manageConnections())} />
							</div>
						</div>
					</section>

					<section id="periods" className="dx-card dx-card--clip" aria-labelledby="h-periods">
						<div className="dx-card__head dx-card__head--tall"><div><h2 id="h-periods">Calendar &amp; periods</h2><p>What New download shows first. You can still change it for each download.</p></div></div>
						<div>
							{serverEthiopic
								? <div className="dx-setting dx-setting--stack">
									<fieldset className="dx-stack" style={{ border: 'none', margin: 0, padding: 0, minWidth: 0, gap: 8 }}>
										<legend style={{ fontWeight: 500, padding: 0, marginBottom: 8 }}>Calendar periods are picked and written in</legend>
										<Choices name="calendar" value={v.calendar === 'gregorian' ? 'gregorian' : 'ethiopic'} onChange={c => put({ calendar: c })} options={[
											{ value: 'ethiopic', label: 'Ethiopian', detail: `As ${name} has them: Meskerem to Nehase, with the Gregorian months beside them.` },
											{ value: 'gregorian', label: 'Gregorian', detail: 'January to December: each stands for the Ethiopian month that starts in it.' }
										]} />
									</fieldset>
								</div>
								: <Setting title="Calendar" hint={`${name} uses the Gregorian calendar, so periods are picked and written in it. (A server on the Ethiopian calendar offers both.)`}><span className="dx-muted">Gregorian</span></Setting>}
							<Setting title="A custom mapping's range is picked by" hint="Months or years, to begin with. A Countdown download is always monthly and has no such choice.">
								<Segmented label="A custom mapping's period type" value={v.periodType} onChange={periodType => put({ periodType })} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} />
							</Setting>
						</div>
					</section>

					<section id="downloads" className="dx-card dx-card--clip" aria-labelledby="h-downloads">
						<div className="dx-card__head dx-card__head--tall"><div><h2 id="h-downloads">Downloads</h2><p>How hard DataSuite works the server. Lower these if your server is shared or slow.</p></div></div>
						<div>
							<Setting title="Downloads at the same time" hint="The rest wait their turn in Downloads › In progress.">
								<Stepper label="Downloads at the same time" value={v.parallelDownloads} min={1} max={4} onChange={parallelDownloads => put({ parallelDownloads })} />
							</Setting>
							<Setting title="Most requests at once" hint="DataSuite starts at 2, sends more while the server answers quickly and fewer when it slows down, and never goes above this.">
								<Stepper label="Most requests at once" value={v.maxConcurrentChunks} min={1} max={6} onChange={maxConcurrentChunks => put({ maxConcurrentChunks })} />
							</Setting>
							<Setting title="Values per request" hint="Bigger requests mean fewer of them, but each takes longer. One the server finds too big is split.">
								<select className="dx-select" aria-label="Values per request" value={v.maxCellsPerChunk} onChange={e => put({ maxCellsPerChunk: Number(e.target.value) })}>
									{[...new Set([...CHUNKS, v.maxCellsPerChunk])].sort((a, b) => a - b).map(n => <option key={n} value={n}>{formatNumber(n)}</option>)}
								</select>
							</Setting>
							<Setting title="Wait for an answer" hint="After this, the request is split in two and tried again.">
								<select className="dx-select" aria-label="Wait for an answer" value={v.requestTimeoutMs} onChange={e => put({ requestTimeoutMs: Number(e.target.value) })}>
									{TIMEOUTS.map(([ms, label]) => <option key={ms} value={ms}>{label}</option>)}
									{!TIMEOUTS.some(([ms]) => ms === v.requestTimeoutMs) && <option value={v.requestTimeoutMs}>{Math.round(v.requestTimeoutMs / 1000)} seconds</option>}
								</select>
							</Setting>
							<Setting title="Retries before giving up" hint="Per request. A download you've paused never counts against this.">
								<Stepper label="Retries" value={v.retryAttempts} min={0} max={10} onChange={retryAttempts => put({ retryAttempts })} />
							</Setting>
						</div>
					</section>

					<section id="files" className="dx-card dx-card--clip" aria-labelledby="h-files">
						<div className="dx-card__head dx-card__head--tall"><div><h2 id="h-files">Files</h2><p>Where finished downloads go when you open them, and what they look like.</p></div></div>
						<div>
							<Setting title="Save to" hint={<span className="dx-mono" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{v.saveFolder}</span>}>
								<Button label="Change…" onClick={() => void run(async () => { const folder = await host.chooseSaveFolder(id); if (folder) { put({ saveFolder: folder }); } })} />
							</Setting>
							<Setting title="Open by default as" hint="Every download can open as either; this is the one the Open button uses.">
								<Segmented label="Default format" value={v.openAs} onChange={openAs => put({ openAs })} options={[{ value: 'EXCEL', label: 'Excel' }, { value: 'JSON', label: 'JSON' }]} />
							</Setting>
							<div className="dx-setting dx-setting--stack">
								<div><div className="dx-setting__title">Analysis apps</div><div className="dx-setting__hint">Finished Countdown downloads can open straight in these.</div></div>
								{([['R', 'RMNCAH app', 'Coverage and equity analysis', false], ['V', 'Vaccination app', 'Immunisation analysis', true]] as const).map(([initial, label, detail, info]) => (
									<div key={label} className="dx-app">
										<span className={`dx-tile-icon dx-tile-icon--lg${info ? ' dx-tile-icon--info' : ''}`}>{initial}</span>
										<div className="dx-grow" style={{ flexBasis: 200 }}><div style={{ fontWeight: 500 }}>{label}</div><div className="dx-setting__hint">{detail} · opens Countdown downloads</div></div>
										{!apps.value ? null : apps.value.installed
											? <span className="dx-status dx-status--ok">Installed</span>
											: <><span style={{ fontSize: 13, color: 'var(--dx-warn)' }}>Not installed</span><Button label="Get it…" size="md" onClick={() => void run(() => host.showAnalysisApps())} /></>}
									</div>
								))}
							</div>
							<div className="dx-setting dx-setting--stack">
								<label htmlFor="dx-file-name" className="dx-setting__title">File name</label>
								<input id="dx-file-name" className="dx-input dx-input--mono" type="text" value={v.fileName} onChange={e => put({ fileName: e.target.value })} />
								<div className="dx-row dx-wrap dx-muted" style={{ fontSize: 12, gap: 6 }}>Insert:
									{FILE_NAME_TOKENS.map(token => <button key={token} type="button" className="dx-pill dx-pill--sm dx-mono" style={{ background: 'var(--dx-surface)' }} onClick={() => put({ fileName: `${v.fileName ? `${v.fileName}_` : ''}${token}` })}>{token}</button>)}
								</div>
								<div className="dx-setting__hint">Example: <span className="dx-mono" style={{ color: 'var(--dx-text)', overflowWrap: 'anywhere' }}>{example}</span></div>
							</div>
							<Setting title="Add parent organisation units" hint="Columns for the units above each one. In a custom mapping's workbook; the Countdown workbook keeps the columns the Countdown apps read.">
								<Switch label="Add parent organisation units" checked={v.parentColumns} onChange={parentColumns => put({ parentColumns })} />
							</Setting>
							<Setting title="Add organisation unit IDs" hint="A column with each unit's DHIS2 id, beside its name. In a custom mapping's workbook.">
								<Switch label="Add organisation unit IDs" checked={v.codes} onChange={codes => put({ codes })} />
							</Setting>
						</div>
					</section>

					<section id="metadata" className="dx-card dx-card--clip" aria-labelledby="h-metadata">
						<div className="dx-card__head dx-card__head--tall"><div><h2 id="h-metadata">Metadata</h2><p>DataSuite keeps a copy of data elements, indicators and organisation units so search is instant.</p></div></div>
						<div>
							<Setting title="Refresh the copy" hint={s?.syncing ? 'Refreshing now…' : s?.error ? `The last refresh failed: ${s.error}` : s?.lastSyncedAt ? `Last refreshed ${fromNow(s.lastSyncedAt)}${items ? ` · ${formatNumber(items)} items` : ''}` : 'Not copied yet'}>
								<div className="dx-row dx-wrap" style={{ gap: 8, flexShrink: 0 }}>
									<select className="dx-select" aria-label="Refresh the copy" value={v.metadataRefresh} onChange={e => put({ metadataRefresh: e.target.value as ExtractorSettings['metadataRefresh'] })}>
										<option value="open">Each time the extractor opens</option><option value="daily">Once a day</option><option value="weekly">Once a week</option><option value="manual">Only when I ask</option>
									</select>
									<Button label={s?.syncing ? 'Refreshing…' : 'Refresh now'} disabled={!!s?.syncing} onClick={() => void run(() => host.syncMetadata(id, true))} />
								</div>
							</Setting>
						</div>
					</section>

				</div>
			</div>
		</>
	);
}
