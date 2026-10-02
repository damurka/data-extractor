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
export async function exportDownload(store: ExtractorStore, connectionId: string, item: IDhis2DownloadHistoryRow, format: ExportFormat, labelCalendar: Dhis2PeriodCalendar): Promise<vscode.Uri | undefined> {
	const payload = JSON.parse(await store.readFile(connectionId, item.file)) as DownloadPayload;

	let content: Uint8Array;
	if (format === 'JSON') {
		content = new TextEncoder().encode(JSON.stringify(payload.data, null, 2));
	} else {
		// The period ids in the data are in the calendar the server used when it was downloaded (kept with the
		// download; older ones ask the server): the period list must be built in the same calendar
		const serverCalendar = typeof payload.calendar === 'string' ? payload.calendar : await vscode.dhis2.metadata.getCalendar(connectionId);
		const sourceCalendar: Dhis2PeriodCalendar = isEthiopianCalendar(serverCalendar) ? 'ethiopic' : 'gregorian';
		const periods = generateDhis2Periods(item.startDate, item.endDate, item.periodType === 'yearly' ? 'yearly' : 'monthly', serverCalendar);
		const structures = new Dhis2ExportProcessor().generateExcelStructures(payload.mappingDraft, payload.data, periods, payload.orgUnits as never, sourceCalendar, labelCalendar);
		content = await toWorkbook(structures);
	}

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
