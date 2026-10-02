/*---------------------------------------------------------------------------------------------
 *  Data Extractor: a finished download saved where the user chooses -- as the Countdown workbook (Excel) or as the
 *  data in JSON.
 *--------------------------------------------------------------------------------------------*/

import { Workbook } from 'exceljs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Dhis2ExportProcessor, Dhis2PeriodCalendar, IDhis2Export, IDhis2ExportItem } from './core/exportProcessor';
import { generateDhis2Periods, isEthiopianCalendar } from './core/periods';
import { IDhis2DownloadHistoryRow } from './core/types';
import { DownloadPayload } from './download';
import { ExtractorStore } from './store';

export type ExportFormat = 'EXCEL' | 'JSON';

/** The workbook: the Countdown sheets in their order, each a row of export codes, a row of names, then the data. */
export async function toWorkbook(structures: IDhis2Export): Promise<Uint8Array> {
	const workbook = new Workbook();
	const addSheet = (name: string, item: IDhis2ExportItem) => {
		if (!item?.dataRows?.length) {
			return;
		}
		const sheet = workbook.addWorksheet(name);
		sheet.addRow(item.headerRow1_HiddenCodes);
		sheet.addRow(item.headerRow2_VisibleNames);
		for (const row of item.dataRows) {
			sheet.addRow(row);
		}
	};
	addSheet('Service_data', structures.service);
	addSheet('Population_data', structures.population);
	addSheet('Reporting_completeness', structures.completeness);
	addSheet('Admin_data', structures.admin);
	return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** The file's name: the mapping and its dates (and period type for a custom mapping). */
export function exportFileName(item: IDhis2DownloadHistoryRow, format: ExportFormat): string {
	const periods = item.mappingMode === 'custom' ? `${item.startDate}_to_${item.endDate}_${item.periodType}` : `${item.startDate}_to_${item.endDate}`;
	return `${item.mappingName.replace(/\s+/g, '_')}_${periods}.${format === 'EXCEL' ? 'xlsx' : 'json'}`;
}

/**
 * Asks where to save the download, writes it, and offers to open it or show it in its folder. `labelCalendar` is the
 * calendar the years and months are written in. Resolves to the saved file, or `undefined` when the user cancels.
 */
/** A download as a file's contents: its data (JSON), or the Countdown workbook (Excel). */
async function downloadContent(store: ExtractorStore, connectionId: string, item: IDhis2DownloadHistoryRow, format: ExportFormat, labelCalendar: Dhis2PeriodCalendar): Promise<Uint8Array> {
	const payload = JSON.parse(await store.readFile(connectionId, item.file)) as DownloadPayload;
	if (format === 'JSON') {
		return new TextEncoder().encode(JSON.stringify(payload.data, null, 2));
	}
	// The period ids in the data are in the calendar the server used when it was downloaded (kept with the
	// download; older ones ask the server): the period list must be built in the same calendar
	const serverCalendar = typeof payload.calendar === 'string' ? payload.calendar : await vscode.dhis2.metadata.getCalendar(connectionId);
	const sourceCalendar: Dhis2PeriodCalendar = isEthiopianCalendar(serverCalendar) ? 'ethiopic' : 'gregorian';
	const periods = generateDhis2Periods(item.startDate, item.endDate, item.periodType === 'yearly' ? 'yearly' : 'monthly', serverCalendar);
	const structures = new Dhis2ExportProcessor().generateExcelStructures(payload.mappingDraft, payload.data, periods, payload.orgUnits as never, sourceCalendar, labelCalendar);
	return toWorkbook(structures);
}

/** The Countdown apps (Countdown Analytics' Shiny apps) a Countdown download opens in. */
export type CountdownApp = 'rmncah' | 'vaxx';
const COUNTDOWN_EXTENSION = 'datasuite.countdown-analytics';

/**
 * Opens a Countdown download in the RMNCAH or Vaccination app: its workbook is written to the Countdown data folder
 * (`dataExtractor.countdownDataFolder`, by default Documents/Countdown data/<server>), where the app keeps its saved
 * dataset and workspace next to it, and the app opens it as it opens any Countdown workbook.
 */
export async function openDownloadInApp(store: ExtractorStore, connectionId: string, serverUrl: string, item: IDhis2DownloadHistoryRow, app: CountdownApp, labelCalendar: Dhis2PeriodCalendar): Promise<boolean> {
	if (!vscode.extensions.getExtension(COUNTDOWN_EXTENSION)) {
		const choice = await vscode.window.showWarningMessage('Opening a download in the Countdown apps needs the Countdown Analytics extension.', 'Show Extension');
		if (choice) {
			await vscode.commands.executeCommand('workbench.extensions.search', `@id:${COUNTDOWN_EXTENSION}`);
		}
		return false;
	}
	const configured = vscode.workspace.getConfiguration('dataExtractor').get<string>('countdownDataFolder');
	let host = 'dhis2';
	try {
		host = new URL(serverUrl).host.replace(/[^\w.-]+/g, '_');
	} catch {
		// not a URL: the default name
	}
	const folder = configured?.trim() || path.join(os.homedir(), 'Documents', 'Countdown data', host);
	const target = path.join(folder, exportFileName(item, 'EXCEL'));
	await vscode.workspace.fs.createDirectory(vscode.Uri.file(folder));
	await vscode.workspace.fs.writeFile(vscode.Uri.file(target), await downloadContent(store, connectionId, item, 'EXCEL', labelCalendar));
	const opened = await vscode.commands.executeCommand<{ tabId: string } | { error: string } | undefined>('datasuite.shinyApps.open', `${COUNTDOWN_EXTENSION}#${app}`, target);
	if (!opened || 'error' in opened) {
		const name = app === 'rmncah' ? 'RMNCAH' : 'Vaccination';
		void vscode.window.showErrorMessage(`Could not open ${path.basename(target)} in ${name}: ${opened && 'error' in opened ? opened.error : 'DataSuite did not open the app.'}`);
		return false;
	}
	return true;
}

export async function exportDownload(store: ExtractorStore, connectionId: string, item: IDhis2DownloadHistoryRow, format: ExportFormat, labelCalendar: Dhis2PeriodCalendar): Promise<vscode.Uri | undefined> {
	const content = await downloadContent(store, connectionId, item, format, labelCalendar);

	const target = await vscode.window.showSaveDialog({
		defaultUri: vscode.Uri.file(path.join(os.homedir(), 'Downloads', exportFileName(item, format))),
		filters: format === 'EXCEL' ? { 'Excel workbook': ['xlsx'] } : { JSON: ['json'] },
		saveLabel: 'Export'
	});
	if (!target) {
		return undefined;
	}
	await vscode.workspace.fs.writeFile(target, content);

	void vscode.window.showInformationMessage(`Exported ${path.basename(target.fsPath)}`, 'Open', 'Show in Folder').then(choice => {
		if (choice === 'Open') {
			void vscode.env.openExternal(target);
		} else if (choice === 'Show in Folder') {
			void vscode.commands.executeCommand('revealFileInOS', target);
		}
	});
	return target;
}
