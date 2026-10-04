/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the overview -- how many mappings and downloads there are and what needs attention, the latest
 *  downloads, and the server. Until the first download is made, the three steps to it instead.
 *--------------------------------------------------------------------------------------------*/

import { Fragment } from 'react';
import { Connection, IDhis2DownloadHistoryRow } from '../../shared/api';
import { formatSize, levelLabel, megabytes, periodRange, plural, serverName, signedInAs, when } from '../format';
import { fromNow, host, useAction, useLoad } from '../hooks';
import { formatNumber } from '../locale';
import type { Nav } from '../main';
import { Button, Card, ErrorLine, Icon, PageHead } from '../ui';

export const requestOf = (row: Pick<IDhis2DownloadHistoryRow, 'mappingId' | 'startDate' | 'endDate' | 'periodType' | 'adminLevel' | 'boundaryOrgUnitUid'>) => ({
	mappingId: row.mappingId, startDate: row.startDate, endDate: row.endDate, periodType: row.periodType === 'yearly' ? 'yearly' as const : 'monthly' as const,
	adminLevel: row.adminLevel, boundaryOrgUnitUid: row.boundaryOrgUnitUid
});

export function Overview({ connection, nav }: { connection: Connection; nav: Nav }) {
	const id = connection.id;
	const mappings = useLoad(() => host.listMappings(id), [id], ['mappingsChanged'], id);
	const downloads = useLoad(() => host.downloads(id, 'all', ''), [id], ['downloadsChanged'], id);
	const status = useLoad(() => host.metadataStatus(id), [id], ['metadataChanged']);
	const info = useLoad(() => host.serverInfo(id), [id], ['metadataChanged']);
	const levels = useLoad(() => host.orgUnitLevels(id), [id]);
	const test = useLoad(() => host.testConnection(id), [id]);
	const apps = useLoad(() => host.analysisApps(), []);
	const [run, error, , dismiss] = useAction();

	const list = mappings.value ?? [];
	const inProgress = downloads.value?.inProgress ?? [];
	const history = downloads.value?.history ?? [];
	const name = serverName(connection);
	const version = test.value?.version ?? connection.dhis2Version;
	const loaded = !!mappings.value && !!downloads.value;
	const firstRun = loaded && (list.length === 0 || (history.length === 0 && inProgress.length === 0));

	const server = (
		<Card title="DHIS2 server" tools={<button type="button" className="dx-link" onClick={() => nav.go('settings')}>Settings</button>}>
			<div className="dx-server">
				<div>
					<div className="dx-server__name">{name}</div>
					<div className="dx-conn__host">{connection.serverUrl}</div>
					<div style={{ marginTop: 4 }}>
						{!test.value ? <span className="dx-status dx-status--muted">Asking the server…</span>
							: test.value.ok ? <span className="dx-status dx-status--ok">Connected · answered in {(test.value.ms / 1000).toFixed(1)} s</span>
								: <span className="dx-status dx-status--bad" title={test.value.error}>Not answering</span>}
					</div>
				</div>
				<dl className="dx-dl">
					{version && <><dt>DHIS2 version</dt><dd>{version}</dd></>}
					{info.value?.calendar && <><dt>Calendar</dt><dd style={{ textTransform: 'capitalize' }}>{info.value.calendar === 'iso8601' ? 'Gregorian' : info.value.calendar}</dd></>}
					<dt>Signed in as</dt><dd>{signedInAs(connection)}{connection.usesAccessToken ? ' · access token' : ''}</dd>
					{info.value && <>
						<dt>Data elements</dt><dd>{formatNumber(info.value.dataElements)}</dd>
						{info.value.indicators !== undefined && <><dt>Indicators</dt><dd>{formatNumber(info.value.indicators)}</dd></>}
						{info.value.dataSets !== undefined && <><dt>Data sets</dt><dd>{formatNumber(info.value.dataSets)}</dd></>}
						<dt>Organisation units</dt><dd>{formatNumber(info.value.organisationUnits)} in {plural(info.value.levels, 'level')}</dd>
					</>}
					{(levels.value ?? []).map(l => <Fragment key={l.level}><dt className="dx-dl__sub">Level {l.level} · {l.name}</dt><dd className="dx-dl__sub">{formatNumber(l.count)}</dd></Fragment>)}
				</dl>
			</div>
		</Card>
	);

	if (firstRun) {
		const hasMapping = list.length > 0;
		const items = status.value ? status.value.dataElements + status.value.categoryOptionCombos + status.value.organisationUnits : undefined;
		const done = hasMapping ? 2 : 1;
		return (
			<>
				<PageHead kicker={`${name} · connected · ${hasMapping ? 'no downloads yet' : 'no mappings yet'}`} title="Overview">
					<Button label="New mapping" onClick={() => nav.newMapping()} />
					<Button label="New download" icon="download" variant="primary" disabled={!hasMapping} onClick={() => nav.newDownload()} />
				</PageHead>
				<ErrorLine error={error ?? mappings.error ?? downloads.error} onDismiss={dismiss} />
				<div className="dx-split-cols">
					<section className="dx-card dx-card--clip" aria-label="Getting started">
						<div className="dx-card__head dx-card__head--tall">
							<div>
								<h2>Get your first data in three steps</h2>
								<p>Your mappings and downloads show here once the first download finishes.</p>
							</div>
							<div className="dx-row" style={{ minWidth: 200 }}>
								<div className="dx-grow"><div className="dx-bar"><span style={{ width: `${Math.round(done / 3 * 100)}%` }} /></div></div>
								<span className="dx-nowrap" style={{ fontSize: 13 }}>{done} of 3 done</span>
							</div>
						</div>
						<ol className="dx-steplist">
							<li className="dx-step dx-step--done">
								<span className="dx-step__mark" aria-hidden="true"><Icon name="check" size={18} stroke={2.4} /></span>
								<div>
									<div className="dx-step__title"><span className="dx-sr">Done: </span>Connect to a DHIS2 server</div>
									<div className="dx-step__text">Connected to {name}.{items ? ` Metadata copied: ${formatNumber(items)} items.` : ''}</div>
								</div>
								<button type="button" className="dx-link" onClick={() => nav.go('settings')}>Details</button>
							</li>
							<li className={`dx-step ${hasMapping ? 'dx-step--done' : 'dx-step--now'}`}>
								<span className="dx-step__mark" aria-hidden="true">{hasMapping ? <Icon name="check" size={18} stroke={2.4} /> : 2}</span>
								<div>
									<div className="dx-step__title">{hasMapping && <span className="dx-sr">Done: </span>}Create a mapping</div>
									<div className="dx-step__text">{hasMapping ? plural(list.length, 'mapping') + ' so far.' : 'Say which indicators to fetch. Start from the Countdown 2030 list, or build your own.'}</div>
								</div>
								{hasMapping
									? <button type="button" className="dx-link" onClick={() => nav.go('mappings')}>Open</button>
									: <div className="dx-row dx-wrap">
										<Button label="Countdown mapping" icon="lock" variant="primary" onClick={() => nav.newMapping('countdown')} />
										<Button label="Custom mapping" onClick={() => nav.newMapping('custom')} />
									</div>}
							</li>
							<li className={`dx-step${hasMapping ? ' dx-step--now' : ''}`}>
								<span className="dx-step__mark" aria-hidden="true">3</span>
								<div>
									<div className="dx-step__title">Run your first download</div>
									<div className="dx-step__text">Pick periods and an organisation unit level. You can open the result in Excel, RMNCAH or Vaccination.</div>
								</div>
								{hasMapping ? <Button label="New download" icon="download" variant="primary" onClick={() => nav.newDownload()} /> : <span className="dx-muted dx-nowrap" style={{ fontSize: 13 }}>After step 2</span>}
							</li>
						</ol>
					</section>
					{server}
				</div>
			</>
		);
	}

	const countdown = list.filter(m => m.mode === 'countdown').length;
	const notMapped = list.reduce((n, m) => n + Math.max(0, m.indicatorsCount - (m.mappedCount ?? m.indicatorsCount) - (m.notAvailableCount ?? 0)), 0);
	const count = (state: string) => inProgress.filter(d => d.state === state).length;
	const queue = [[count('downloading') + count('processing'), 'downloading'], [count('paused'), 'paused'], [count('waiting'), 'waiting']].filter(([n]) => n).map(([n, word]) => `${n} ${word}`).join(' · ');
	const finished = history.filter(h => h.status === 'Completed');
	const failed = history.filter(h => h.status === 'Failed');
	const size = finished.reduce((n, h) => n + megabytes(h.size), 0);
	const latest = history.slice(0, 5);

	return (
		<>
			<PageHead kicker={`${name}${status.value?.lastSyncedAt ? ` · metadata synced ${fromNow(status.value.lastSyncedAt)}` : ''}`} title="Overview">
				<Button label="New mapping" onClick={() => nav.newMapping()} />
				<Button label="New download" icon="download" variant="primary" onClick={() => nav.newDownload()} />
			</PageHead>
			<ErrorLine error={error ?? mappings.error ?? downloads.error} onDismiss={dismiss} />

			<div className="dx-tiles">
				<Tile label="Mappings" value={formatNumber(list.length)} sub={`${countdown} Countdown · ${list.length - countdown} Custom`} onClick={() => nav.go('mappings')}
					flag={notMapped ? { tone: 'warn', text: `${plural(notMapped, 'indicator')} not mapped` } : undefined} />
				<Tile label="In progress" value={formatNumber(inProgress.length)} sub={queue || 'Nothing downloading'} onClick={() => nav.go('downloads')} />
				<Tile label="Download history" value={formatNumber(history.length)} sub={`${finished.length} finished · ${formatSize(size)} on this computer`} onClick={() => nav.go('downloads')}
					flag={failed.length ? { tone: 'bad', text: `${failed.length} failed: ${failed[0].mappingName}` } : undefined} />
				<Tile label="DHIS2 server" value={test.value && !test.value.ok ? 'Not answering' : 'Connected'} sub={`${name}${version ? ` · version ${version.split('.').slice(0, 2).join('.')}` : ''}`} onClick={() => nav.go('settings')} />
			</div>

			<div className="dx-split-cols">
				<Card title="Latest downloads" tools={<button type="button" className="dx-link" onClick={() => nav.go('downloads')}>All downloads</button>}>
					<div className="dx-scroll-x">
						<table className="dx-table">
							<thead>
								<tr><th scope="col">Mapping</th><th scope="col">Periods</th><th scope="col">Level</th><th scope="col">Status</th><th scope="col">Finished</th><th scope="col"><span className="dx-sr">Open</span></th></tr>
							</thead>
							<tbody>
								{latest.length === 0 && <tr><td colSpan={6} className="dx-empty">No downloads have finished yet. Finished and failed downloads are listed here.</td></tr>}
								{latest.map(row => {
									const ok = row.status === 'Completed';
									const inApp = ok && row.mappingMode === 'countdown' && apps.value?.installed;
									return (
										<tr key={row.id}>
											<td className="dx-table__name">{row.mappingName}</td>
											<td className="dx-nowrap">{periodRange(row.startDate, row.endDate, row.periodType)}</td>
											<td>{levelLabel(row.adminLevel, levels.value)}</td>
											<td><span className={`dx-status ${ok ? 'dx-status--ok' : 'dx-status--bad'}`} title={row.error}>{ok ? 'Finished' : 'Failed'}</span></td>
											<td className="dx-muted dx-nowrap">{when(row.endedAt, row.date)}</td>
											<td className="dx-right dx-nowrap">
												{!ok ? <Button label="Retry" size="sm" onClick={() => void run(() => host.startDownload(id, requestOf(row), row.id))} />
													: inApp ? <Button label="Open in RMNCAH" size="sm" variant="primary" onClick={() => void run(() => host.openDownloadInApp(id, row.id, 'rmncah'))} />
														: <Button label="Open in Excel" size="sm" variant="soft" onClick={() => void run(() => host.openDownload(id, row.id, 'EXCEL'))} />}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</Card>
				{server}
			</div>
		</>
	);
}

function Tile({ label, value, sub, flag, onClick }: { label: string; value: string; sub: string; flag?: { tone: 'warn' | 'bad'; text: string }; onClick: () => void }) {
	return (
		<button type="button" className="dx-tile" onClick={onClick}>
			<span className="dx-tile__label">{label}<Icon name="chevron-right" size={14} /></span>
			<span className="dx-tile__value">{value}</span>
			<span className="dx-tile__sub">{sub}</span>
			{flag && <span className={`dx-status dx-status--${flag.tone}`}>{flag.text}</span>}
		</button>
	);
}
