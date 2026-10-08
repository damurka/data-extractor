/*---------------------------------------------------------------------------------------------
 *  Data Extractor: a finished download as a file -- the Countdown workbook (Excel), a custom mapping's workbook (a
 *  sheet per group of indicators), or the data in JSON -- saved in the folder of the settings, or opened in a Countdown
 *  analysis app.
 *--------------------------------------------------------------------------------------------*/

import { Borders, Workbook, Worksheet } from 'exceljs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Dhis2ExportProcessor, Dhis2PeriodCalendar, IDhis2Export, IDhis2ExportItem } from './core/exportProcessor';
import { COUNTDOWN_INDICATORS, getCountdownIndicatorCategory } from './core/countdown';
import { generateDhis2Periods, isEthiopianCalendar } from './core/periods';
import { IAddMappingDraft, IDhis2DownloadHistoryRow, IDhis2OrgUnitWithLevels } from './core/types';
import { DownloadPayload } from './download';
import { ExtractorSettings } from './shared/api';
import { isNotAvailable } from './shared/mapping';
import { ExtractorStore } from './store';

export type ExportFormat = 'EXCEL' | 'JSON';

/** What a custom mapping's workbook adds beside each organisation unit. */
export interface WorkbookOptions {
	readonly parentColumns?: boolean;
	readonly codes?: boolean;
}

/** A column's name as the Countdown apps compare it: in lower case, without spaces. */
const columnKey = (code: string) => String(code).replace(/\s+/g, '').toLowerCase();

/** A sheet's name as Excel takes it: at most 31 characters, none of `[]:*?/\`, and not one already used. */
function sheetName(name: string, used: Set<string>): string {
	const base = name.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
	let candidate = base;
	for (let n = 2; used.has(candidate.toLowerCase()); n++) {
		const suffix = ` (${n})`;
		candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
	}
	used.add(candidate.toLowerCase());
	return candidate;
}

/** How many of a Countdown sheet's first columns say what a row is of (the unit, the year, the month). */
const keyColumns = (codes: readonly string[]) => {
	const keys = ['district', 'district_name', 'year', 'month', 'first_admin_level', 'country'];
	let n = 0;
	while (n < codes.length && keys.includes(columnKey(codes[n]))) {
		n++;
	}
	return n;
};

/**
 * The Countdown template's look for a sheet's three rows of headings (as in the workbooks countries fill in): the
 * codes in red on yellow, hidden; the row of instructions pale yellow, left empty; the names in white on teal, the
 * unit and the period darker than the indicators; the headings and the unit and period columns kept in view.
 */
function formatCountdownSheet(sheet: Worksheet, codes: readonly string[]): void {
	const columns = codes.length;
	const keys = keyColumns(codes);
	const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
	const thin = { style: 'thin' as const };
	const border: Partial<Borders> = { left: thin, right: thin, top: thin, bottom: { style: 'double' } };

	const codeRow = sheet.getRow(1);
	codeRow.height = 28;
	codeRow.hidden = true;
	const instructions = sheet.getRow(2);
	instructions.height = 60;
	const names = sheet.getRow(3);
	names.height = 60;
	for (let n = 1; n <= columns; n++) {
		const code = codeRow.getCell(n);
		code.font = { bold: true, color: { argb: 'FFC00000' } };
		code.fill = fill('FFFFFF00');
		code.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
		instructions.getCell(n).fill = fill('FFFFFF99');
		const name = names.getCell(n);
		name.font = { bold: true, color: { argb: 'FFFFFFFF' } };
		name.fill = fill(n <= keys ? 'FF006666' : 'FF009999');
		name.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
		name.border = border;
		const key = columnKey(codes[n - 1]);
		sheet.getColumn(n).width = key === 'year' ? 9 : key === 'month' ? 11 : 18;
	}
	sheet.views = [{ state: 'frozen', xSplit: keys, ySplit: 3 }];
}

async function writeWorkbook(sheets: readonly { readonly name: string; readonly item: IDhis2ExportItem }[], countdown = false): Promise<Uint8Array> {
	const workbook = new Workbook();
	const used = new Set<string>();
	for (const { name, item } of sheets) {
		if (!item?.dataRows?.length) {
			continue;
		}
		const sheet = workbook.addWorksheet(sheetName(name, used));
		sheet.addRow(item.headerRow1_HiddenCodes);
		if (countdown) {
			sheet.addRow([]);
		}
		sheet.addRow(item.headerRow2_VisibleNames);
		if (countdown) {
			formatCountdownSheet(sheet, item.headerRow1_HiddenCodes);
		}
		for (const row of item.dataRows) {
			sheet.addRow(row);
		}
	}
	return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/**
 * A workbook of the Countdown sheets in their order, each a row of export codes, a row of names, then the data.
 * `countdown`: the workbook the Countdown apps read. The Countdown template has a row of instructions between the
 * codes and the names, and the apps skip the two rows under the codes whatever they hold: without a second row here
 * (left empty), each sheet's first row of data was skipped as if it were the names.
 */
export function toWorkbook(structures: IDhis2Export, countdown = false): Promise<Uint8Array> {
	return writeWorkbook([
		{ name: 'Service_data', item: structures.service },
		{ name: 'Population_data', item: structures.population },
		{ name: 'Reporting_completeness', item: structures.completeness },
		{ name: 'Admin_data', item: structures.admin }
	], countdown);
}

interface IExpectedColumn { readonly code: string; readonly name: string }

const expectedOf = (category: string): IExpectedColumn[] => COUNTDOWN_INDICATORS.filter(i => i.category.startsWith(category)).map(i => ({ code: i.id, name: i.title }));

/** The columns of the Countdown template, sheet by sheet, in its order. */
export const COUNTDOWN_EXPECTED_COLUMNS: { readonly service: IExpectedColumn[]; readonly population: IExpectedColumn[]; readonly completeness: IExpectedColumn[]; readonly admin: IExpectedColumn[] } = {
	service: expectedOf('Service_data'),
	// the growth rate is the template's and not a Countdown indicator to map: the apps work it out from the total
	// population over the years where the column is empty, and refuse a workbook without the column
	population: [{ code: 'Pop_growth_rate', name: 'Annual population growth rate' }, ...expectedOf('Population_data')],
	completeness: expectedOf('Reporting_completeness').flatMap(i => [
		{ code: `${i.code}_reporting_expected`, name: 'Expected number (#)' },
		{ code: `${i.code}_reporting_received`, name: 'Received number (#)' },
		{ code: `${i.code}_reporting_rate`, name: 'Reporting completeness rate (%)' }
	]),
	admin: expectedOf('Admin_data')
};

/**
 * A sheet with every expected column, in the template's order: the ones it has with their values, the others empty.
 * What the mapping has beyond the template stays, after them. The first `keys` columns (the unit, the period) are
 * left where they are.
 */
function withColumns(item: IDhis2ExportItem, keys: number, expected: readonly IExpectedColumn[]): IDhis2ExportItem {
	const at = new Map<string, number>();
	item.headerRow1_HiddenCodes.forEach((code, n) => {
		if (n >= keys && !at.has(columnKey(code))) {
			at.set(columnKey(code), n);
		}
	});
	const taken = new Set<number>();
	const columns: { code: string; name: string; from: number }[] = [];
	for (const column of expected) {
		const from = at.get(columnKey(column.code));
		if (from === undefined) {
			columns.push({ ...column, from: -1 });
		} else {
			taken.add(from);
			columns.push({ code: item.headerRow1_HiddenCodes[from], name: item.headerRow2_VisibleNames[from], from });
		}
	}
	item.headerRow1_HiddenCodes.forEach((code, n) => {
		if (n >= keys && !taken.has(n)) {
			columns.push({ code, name: item.headerRow2_VisibleNames[n], from: n });
		}
	});
	return {
		headerRow1_HiddenCodes: [...item.headerRow1_HiddenCodes.slice(0, keys), ...columns.map(c => c.code)],
		headerRow2_VisibleNames: [...item.headerRow2_VisibleNames.slice(0, keys), ...columns.map(c => c.name)],
		dataRows: item.dataRows.map(row => [...row.slice(0, keys), ...columns.map(c => c.from < 0 ? '' : row[c.from])])
	};
}

/**
 * The Countdown workbook with every column the Countdown apps expect, whether the mapping downloads it or not: a
 * column with no indicator behind it is there and empty. The apps check for the columns by name and refuse a
 * workbook without one (an analysis of vaccines needs none of the antenatal columns filled, but all of them present),
 * so a mapping of some of the indicators gave a workbook that could not be opened.
 */
export function withExpectedColumns(structures: IDhis2Export): IDhis2Export {
	return {
		service: withColumns(structures.service, 3, COUNTDOWN_EXPECTED_COLUMNS.service),
		population: withColumns(structures.population, 2, COUNTDOWN_EXPECTED_COLUMNS.population),
		completeness: withColumns(structures.completeness, 3, COUNTDOWN_EXPECTED_COLUMNS.completeness),
		admin: withColumns(structures.admin, 3, COUNTDOWN_EXPECTED_COLUMNS.admin)
	};
}

/** Whether a data sheet has a column beside the organisation unit and the period. */
const hasColumns = (item: IDhis2ExportItem) => item.headerRow1_HiddenCodes.length > 3;

/**
 * A data sheet with columns added after the organisation unit's name: its DHIS2 id, and the units above it. The rows
 * come one organisation unit after another, each with as many rows as there are periods.
 */
export function withUnitColumns(item: IDhis2ExportItem, orgUnits: readonly IDhis2OrgUnitWithLevels[], options: WorkbookOptions): IDhis2ExportItem {
	if ((!options.codes && !options.parentColumns) || !orgUnits.length || item.dataRows.length % orgUnits.length !== 0) {
		return item;
	}
	const perUnit = item.dataRows.length / orgUnits.length;
	const levels = options.parentColumns ? Array.from({ length: Math.max(0, Math.max(...orgUnits.map(ou => ou.level)) - 1) }, (_, n) => n + 1) : [];
	const codes = [...(options.codes ? ['district_uid'] : []), ...levels.map(n => `level${n}_name`)];
	const names = [...(options.codes ? ['District ID'] : []), ...levels.map(n => `Level ${n}`)];
	const extra = (ou: IDhis2OrgUnitWithLevels) => [...(options.codes ? [ou.id] : []), ...levels.map(n => String(ou[`level${n}_name`] ?? ''))];
	return {
		headerRow1_HiddenCodes: [item.headerRow1_HiddenCodes[0], ...codes, ...item.headerRow1_HiddenCodes.slice(1)],
		headerRow2_VisibleNames: [item.headerRow2_VisibleNames[0], ...names, ...item.headerRow2_VisibleNames.slice(1)],
		dataRows: item.dataRows.map((row, i) => [row[0], ...extra(orgUnits[Math.floor(i / perUnit)]), ...row.slice(1)])
	};
}

/**
 * The Countdown workbook with its health-system indicators (Countdown's Admin_data: hospitals, health workers, beds)
 * on the Admin_data sheet, where the Countdown apps read them, instead of among the services: one value for each
 * organisation unit, its latest in the periods downloaded. The service sheet's rows come one organisation unit after
 * another, each with as many rows as there are periods, in the Admin sheet's order of units.
 */
export function withAdminColumns(structures: IDhis2Export): IDhis2Export {
	const { service, admin } = structures;
	const moved = service.headerRow1_HiddenCodes.map((code, n) => getCountdownIndicatorCategory(code) === 'Admin_data' ? n : -1).filter(n => n >= 0);
	const units = admin.dataRows.length;
	if (!moved.length || !units || service.dataRows.length % units !== 0) {
		return structures;
	}
	const perUnit = service.dataRows.length / units;
	const kept = service.headerRow1_HiddenCodes.map((_, n) => n).filter(n => !moved.includes(n));
	const latest = (unit: number, column: number) => {
		for (let row = (unit + 1) * perUnit - 1; row >= unit * perUnit; row--) {
			const value = service.dataRows[row][column];
			if (value !== '' && value !== null && value !== undefined) {
				return value;
			}
		}
		return '';
	};
	return {
		...structures,
		service: { headerRow1_HiddenCodes: kept.map(n => service.headerRow1_HiddenCodes[n]), headerRow2_VisibleNames: kept.map(n => service.headerRow2_VisibleNames[n]), dataRows: service.dataRows.map(row => kept.map(n => row[n])) },
		admin: {
			headerRow1_HiddenCodes: [...admin.headerRow1_HiddenCodes, ...moved.map(n => service.headerRow1_HiddenCodes[n])],
			headerRow2_VisibleNames: [...admin.headerRow2_VisibleNames, ...moved.map(n => service.headerRow2_VisibleNames[n])],
			dataRows: admin.dataRows.map((row, unit) => [...row, ...moved.map(n => latest(unit, n))])
		}
	};
}

/** The mapping as the workbook names its columns: an indicator marked not available says so (its column is empty). */
function forWorkbook(mapping: IAddMappingDraft): IAddMappingDraft {
	return { ...mapping, indicators: mapping.indicators.map(i => isNotAvailable(i) ? { ...i, internalName: `${i.internalName || i.exportCode} (not available)` } : i) };
}

/** A custom mapping's sheets: the ones it names, in its order, with the indicators that name none on the first. */
export function customSheetNames(mapping: IAddMappingDraft): string[] {
	const names = [...(mapping.sheets ?? [])];
	for (const i of mapping.indicators) {
		if (i.sheet && !names.includes(i.sheet)) {
			names.push(i.sheet);
		}
	}
	return names;
}

/** A download as a file's contents: its data (JSON), the Countdown workbook, or a custom mapping's workbook. */
export async function downloadContent(store: ExtractorStore, connectionId: string, item: IDhis2DownloadHistoryRow, format: ExportFormat, labelCalendar: Dhis2PeriodCalendar, options: WorkbookOptions = {}): Promise<Uint8Array> {
	const payload = JSON.parse(await store.readFile(connectionId, item.file)) as DownloadPayload;
	if (format === 'JSON') {
		return new TextEncoder().encode(JSON.stringify(payload.data, null, 2));
	}
	// The period ids in the data are in the calendar the server used when it was downloaded (kept with the
	// download; older ones ask the server): the period list must be built in the same calendar
	const serverCalendar = typeof payload.calendar === 'string' ? payload.calendar : await vscode.dhis2.metadata.getCalendar(connectionId);
	const sourceCalendar: Dhis2PeriodCalendar = isEthiopianCalendar(serverCalendar) ? 'ethiopic' : 'gregorian';
	const periods = generateDhis2Periods(item.startDate, item.endDate, item.periodType === 'yearly' ? 'yearly' : 'monthly', serverCalendar);
	const orgUnits = payload.orgUnits as IDhis2OrgUnitWithLevels[];
	const mapping = forWorkbook(payload.mappingDraft);
	const processor = new Dhis2ExportProcessor();
	const structures = (of: IAddMappingDraft) => processor.generateExcelStructures(of, payload.data, periods, orgUnits, sourceCalendar, labelCalendar);

	// The Countdown workbook is what the Countdown apps read: its sheets and columns stay as they are
	if (mapping.mode === 'countdown') {
		return toWorkbook(withExpectedColumns(withAdminColumns(structures(mapping))), true);
	}
	const names = customSheetNames(mapping);
	if (!names.length) {
		const all = structures(mapping);
		return toWorkbook({ ...all, service: withUnitColumns(all.service, orgUnits, options), completeness: withUnitColumns(all.completeness, orgUnits, options) });
	}
	const sheets: { name: string; item: IDhis2ExportItem }[] = [];
	let admin: IDhis2ExportItem | undefined;
	for (const [n, name] of names.entries()) {
		const of = structures({ ...mapping, indicators: mapping.indicators.filter(i => (i.sheet ?? (n === 0 ? name : undefined)) === name) });
		admin ??= of.admin;
		if (hasColumns(of.service)) {
			sheets.push({ name, item: withUnitColumns(of.service, orgUnits, options) });
		}
		if (hasColumns(of.completeness)) {
			sheets.push({ name: `${name} reporting`, item: withUnitColumns(of.completeness, orgUnits, options) });
		}
	}
	if (admin) {
		sheets.push({ name: 'Admin_data', item: admin });
	}
	return writeWorkbook(sheets);
}

/** The file's name in the Countdown data folder: the mapping and its dates (and period type for a custom mapping). */
export function exportFileName(item: IDhis2DownloadHistoryRow, format: ExportFormat): string {
	const periods = item.mappingMode === 'custom' ? `${item.startDate}_to_${item.endDate}_${item.periodType}` : `${item.startDate}_to_${item.endDate}`;
	return `${item.mappingName.replace(/\s+/g, '_')}_${periods}.${format === 'EXCEL' ? 'xlsx' : 'json'}`;
}

const slug = (text: string) => text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** The values a file name's tokens stand for: `{mapping}`, `{periods}`, `{level}`, `{date}`. */
export function fileNameTokens(item: Pick<IDhis2DownloadHistoryRow, 'mappingName' | 'startDate' | 'endDate' | 'periodType' | 'adminLevel'>, now: Date): Record<string, string> {
	const yearly = item.periodType === 'yearly';
	const cut = (date: string) => date.slice(0, yearly ? 4 : 7);
	const pad = (n: number) => String(n).padStart(2, '0');
	return {
		'{mapping}': slug(item.mappingName) || 'download',
		'{periods}': cut(item.startDate) === cut(item.endDate) ? cut(item.startDate) : `${cut(item.startDate)}_${cut(item.endDate)}`,
		'{level}': slug(item.adminLevel) || 'level',
		'{date}': `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
	};
}

/** A saved download's file name: the pattern of the settings with its tokens filled in, safe for any file system. */
export function fileNameFor(item: Pick<IDhis2DownloadHistoryRow, 'mappingName' | 'startDate' | 'endDate' | 'periodType' | 'adminLevel'>, format: ExportFormat, pattern: string, now = new Date()): string {
	const tokens = fileNameTokens(item, now);
	const name = Object.keys(tokens).reduce((text, token) => text.split(token).join(tokens[token]), pattern)
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
	return `${name || tokens['{mapping}']}.${format === 'EXCEL' ? 'xlsx' : 'json'}`;
}

/** The calendar a download's years and months are written in: the settings', on a server whose own is Ethiopian. */
export async function labelCalendarOf(connectionId: string, settings: Pick<ExtractorSettings, 'calendar'>): Promise<Dhis2PeriodCalendar> {
	const server = await Promise.resolve(vscode.dhis2.metadata.getCalendar(connectionId)).then(c => c, () => undefined);
	return isEthiopianCalendar(server) && settings.calendar !== 'gregorian' ? 'ethiopic' : 'gregorian';
}

/** Saves a download in the folder of the settings, under the name they give it; resolves to the file. */
export async function saveDownload(store: ExtractorStore, connectionId: string, item: IDhis2DownloadHistoryRow, format: ExportFormat, settings: ExtractorSettings): Promise<vscode.Uri> {
	const content = await downloadContent(store, connectionId, item, format, await labelCalendarOf(connectionId, settings), settings);
	const folder = vscode.Uri.file(settings.saveFolder);
	await vscode.workspace.fs.createDirectory(folder);
	const target = vscode.Uri.file(path.join(settings.saveFolder, fileNameFor(item, format, settings.fileName)));
	await vscode.workspace.fs.writeFile(target, content);
	return target;
}

/** The Countdown apps (Countdown Analytics' Shiny apps) a Countdown download opens in. */
export type CountdownApp = 'rmncah' | 'vaxx';
export const COUNTDOWN_EXTENSION = 'datasuite.countdown-analytics';

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
