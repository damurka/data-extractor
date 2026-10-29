/*---------------------------------------------------------------------------------------------
 *  Data Extractor: a Countdown download submitted to DataSuite as the country's DHIS2 data, and the missing-data
 *  template made from what DataSuite's checks found it lacks
 *--------------------------------------------------------------------------------------------*/

// Submit Download to DataSuite: a finished Countdown download goes, as the Countdown workbook, to the country's DHIS2
// data item, with where it came from (the server, DataSuite's mapping version it matches, the periods, when). A
// download made with a mapping other than the country's one in force is flagged, not refused: the user is told how it
// differs, and the reviewers see it.
// Make Missing-Data Template: once DataSuite's checks of the DHIS2 data are in and the item's waiting days are over,
// a workbook with a row per district and month, and a column per indicator, that lacks something: the cells to fill
// are open, every other one locked (it holds DHIS2's value, which the additional data never changes).
// The sign-in and the requests are Countdown Analytics' (its exports): this extension never holds a DataSuite token.

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { IDataSuiteMappingVersion, mappingDifferences, mappingProblems, monthPeriod, toDataSuiteMapping } from './core/dataSuiteMapping';
import { IMissingCell, missingTemplateWorkbook } from './core/missingTemplate';
import { IDhis2DownloadHistoryRow } from './core/types';
import { COUNTDOWN_EXTENSION, countdownDataFolder, downloadContent, exportFileName, labelCalendarOf } from './exporter';
import { readSettings } from './settings';
import { ExtractorStore } from './store';

interface IDhis2Provenance {
	readonly source: 'dhis2';
	readonly dhis2Url: string;
	readonly mappingVersion: number | null;
	readonly mappingSha256: string | null;
	readonly mappingDifferences: readonly string[];
	readonly districtLevel: number;
	readonly startPeriod: string;
	readonly endPeriod: string;
	readonly extractedAtUtc: string;
	readonly tool: string;
}

interface ICountdownDataApi {
	myCountryMappings(): Promise<{ countryName: string; inForce: IDataSuiteMappingVersion | null }[]>;
	submitDhis2Data(filePath: string, provenance: IDhis2Provenance, options?: { note?: string }): Promise<string | undefined>;
	listDhis2Data(): Promise<{ submissionId: string; label: string; status: string }[]>;
	missingData(submissionId: string): Promise<{ versionNumber: number; availableFromUtc: string; ready: boolean; count: number; truncated: boolean; cells: readonly IMissingCell[] }>;
}

export function registerSubmitData(store: ExtractorStore): vscode.Disposable[] {
	const run = (what: string, action: () => Promise<void>) => async () => {
		try {
			await action();
		} catch (error) {
			void vscode.window.showErrorMessage(`${what}: ${error instanceof Error ? error.message : String(error)}`);
		}
	};
	return [
		vscode.commands.registerCommand('dataExtractor.submitDownload', run("The download wasn't submitted", () => submitDownload(store))),
		vscode.commands.registerCommand('dataExtractor.missingDataTemplate', run("The missing-data template wasn't made", () => missingDataTemplate())),
	];
}

async function countdownApi(): Promise<ICountdownDataApi> {
	const countdown = vscode.extensions.getExtension<ICountdownDataApi>(COUNTDOWN_EXTENSION);
	if (!countdown) {
		throw new Error('Submitting needs the Countdown Analytics extension.');
	}
	const api = countdown.isActive ? countdown.exports : await countdown.activate();
	if (typeof api?.submitDhis2Data !== 'function' || typeof api.missingData !== 'function') {
		throw new Error("This Countdown Analytics can't submit DHIS2 data yet: update it.");
	}
	return api;
}

async function submitDownload(store: ExtractorStore): Promise<void> {
	const connections = (await vscode.dhis2.getConnections()).filter(c => c.granted);
	if (connections.length === 0) {
		throw new Error('Connect to your DHIS2 in the Data Extractor first.');
	}
	const connection = connections.length === 1 ? connections[0]
		: (await vscode.window.showQuickPick(connections.map(c => ({ label: c.displayName, description: c.serverUrl, connection: c })), { title: 'Which DHIS2?' }))?.connection;
	if (!connection) {
		return;
	}
	const downloads = (await store.getSnapshot(connection.id, 'completed')).history.filter(h => h.status === 'Completed' && h.mappingMode === 'countdown');
	if (downloads.length === 0) {
		throw new Error('This DHIS2 has no finished Countdown download: download the data with the country\'s Countdown mapping first.');
	}
	const row = (await vscode.window.showQuickPick(downloads.map(d => ({ label: d.mappingName, description: `${d.startDate} to ${d.endDate}`, detail: d.date, row: d })),
		{ title: 'Submit which download as the country\'s DHIS2 data?' }))?.row;
	if (!row) {
		return;
	}
	const draft = await store.getMapping(connection.id, row.mappingId);
	if (!draft) {
		throw new Error(`${row.mappingName}, the mapping it was downloaded with, is no longer here.`);
	}
	const problems = mappingProblems(draft);
	if (problems.length > 0) {
		throw new Error(problems.join(' '));
	}
	const api = await countdownApi();
	const level = Number(/(\d+)$/.exec(row.adminLevel)?.[1] ?? NaN);
	const local = toDataSuiteMapping(draft, connection.serverUrl, level);
	const sameServer = (u: string) => u.replace(/\/+$/, '').toLowerCase() === local.dhis2Url.toLowerCase();
	const inForce = (await api.myCountryMappings()).map(m => m.inForce).find(v => v && sameServer(v.dhis2Url)) ?? null;
	const differences = inForce ? mappingDifferences(local, inForce) : ['DataSuite has no approved mapping for this DHIS2'];
	if (differences.length > 0) {
		const go = await vscode.window.showWarningMessage(
			inForce ? `${row.mappingName} isn't the country's mapping in DataSuite (version ${inForce.number}): ${differences.join('; ')}.` : `${differences[0]}.`,
			{ modal: true, detail: 'The reviewers will see this with the data. Submit it anyway?' }, 'Submit Anyway');
		if (!go) {
			return;
		}
	}
	const note = await vscode.window.showInputBox({ title: 'A note for the reviewers (optional)', prompt: 'What this download is, or what changed' });

	const folder = countdownDataFolder(connection.serverUrl);
	const target = path.join(folder, exportFileName(row, 'EXCEL'));
	await vscode.workspace.fs.createDirectory(vscode.Uri.file(folder));
	const settings = await readSettings(store, connection.id);
	await vscode.workspace.fs.writeFile(vscode.Uri.file(target), await downloadContent(store, connection.id, row, 'EXCEL', await labelCalendarOf(connection.id, settings)));
	const id = await api.submitDhis2Data(target, provenanceOf(row, local.dhis2Url, level, inForce, differences), { note: note || undefined });
	if (id) {
		void vscode.window.showInformationMessage(`${path.basename(target)} was submitted to DataSuite as the country's DHIS2 data. Its checks and review start now.`);
	}
}

function provenanceOf(row: IDhis2DownloadHistoryRow, dhis2Url: string, level: number, inForce: IDataSuiteMappingVersion | null, differences: readonly string[]): IDhis2Provenance {
	const extension = vscode.extensions.getExtension('datasuite.data-extractor');
	return {
		source: 'dhis2',
		dhis2Url,
		mappingVersion: inForce?.number ?? null,
		mappingSha256: inForce?.sha256 ?? null,
		mappingDifferences: differences,
		districtLevel: level,
		startPeriod: monthPeriod(row.startDate),
		endPeriod: monthPeriod(row.endDate),
		extractedAtUtc: new Date(row.endedAt ?? Date.now()).toISOString(),
		tool: `Data Extractor ${extension?.packageJSON?.version ?? ''}`.trim(),
	};
}

async function missingDataTemplate(): Promise<void> {
	const api = await countdownApi();
	const submissions = await api.listDhis2Data();
	if (submissions.length === 0) {
		throw new Error('No DHIS2 data of your country is in DataSuite yet: submit a Countdown download first.');
	}
	const chosen = submissions.length === 1 ? submissions[0]
		: (await vscode.window.showQuickPick(submissions.map(s => ({ label: s.label, description: s.status, submission: s })), { title: 'The missing-data template of which DHIS2 data?' }))?.submission;
	if (!chosen) {
		return;
	}
	const missing = await api.missingData(chosen.submissionId);
	if (!missing.ready) {
		void vscode.window.showInformationMessage(`The missing-data template can be made from ${new Date(missing.availableFromUtc).toLocaleString()}: late DHIS2 reporting has until then to come in.`);
		return;
	}
	if (missing.count === 0) {
		void vscode.window.showInformationMessage('DataSuite\'s checks found nothing missing in this DHIS2 data: there is no template to fill.');
		return;
	}
	const target = await vscode.window.showSaveDialog({
		title: 'Save the missing-data template',
		defaultUri: vscode.Uri.file(path.join(os.homedir(), 'Documents', `Missing data - ${chosen.label.split(' · ')[0]} v${missing.versionNumber}.xlsx`)),
		filters: { 'Excel workbook': ['xlsx'] },
	});
	if (!target) {
		return;
	}
	await vscode.workspace.fs.writeFile(target, await missingTemplateWorkbook(chosen.submissionId, missing.versionNumber, missing.cells));
	const shown = missing.truncated ? ` It holds the first ${missing.cells.length.toLocaleString()} of ${missing.count.toLocaleString()} empty cells.` : '';
	const open = await vscode.window.showInformationMessage(`The missing-data template is saved.${shown} Fill the open cells, then submit it as the additional data.`, 'Show in Folder');
	if (open) {
		await vscode.commands.executeCommand('revealFileInOS', target);
	}
}
