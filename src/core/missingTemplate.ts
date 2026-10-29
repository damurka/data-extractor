/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the missing-data template's layout -- what the country's DHIS2 data lacks, to fill in
 *--------------------------------------------------------------------------------------------*/

import { Workbook } from 'exceljs';
import { COUNTDOWN_INDICATORS } from './countdown';

/** One empty cell DataSuite's checks found in the DHIS2 data: an indicator, for a district, in a month. */
export interface IMissingCell {
	readonly indicator: string;
	readonly district: string;
	readonly year: number;
	readonly month: number;
}

/** The template: a column per indicator that lacks something, a row per district and month that lacks something, and in
 * each row the indicators to fill (`open`); every other cell holds DHIS2's value and stays as it is. */
export interface IMissingLayout {
	readonly indicators: readonly string[];
	readonly rows: readonly { readonly district: string; readonly year: number; readonly month: number; readonly open: ReadonlySet<string> }[];
}

export function missingLayout(cells: readonly IMissingCell[]): IMissingLayout {
	const indicators = [...new Set(cells.map(c => c.indicator))].sort();
	const rows = new Map<string, { district: string; year: number; month: number; open: Set<string> }>();
	for (const cell of cells) {
		const key = `${cell.district}\u0000${cell.year}\u0000${cell.month}`;
		let row = rows.get(key);
		if (!row) {
			row = { district: cell.district, year: cell.year, month: cell.month, open: new Set() };
			rows.set(key, row);
		}
		row.open.add(cell.indicator);
	}
	const ordered = [...rows.values()].sort((a, b) => a.district.localeCompare(b.district) || a.year - b.year || a.month - b.month);
	return { indicators, rows: ordered };
}

/** The template DataSuite's additional data check reads: "Missing data" (row 1 the codes, row 2 the names, then a row per
 * district and month; only the cells to fill are unlocked) and "About" (which DHIS2 data, and which version, it fills). */
export async function missingTemplateWorkbook(submissionId: string, versionNumber: number, cells: readonly IMissingCell[]): Promise<Uint8Array> {
	const layout = missingLayout(cells);
	const title = (code: string) => COUNTDOWN_INDICATORS.find(i => i.id.toLowerCase() === code.toLowerCase())?.title ?? code;
	const workbook = new Workbook();
	const sheet = workbook.addWorksheet('Missing data', { views: [{ state: 'frozen', xSplit: 3, ySplit: 2 }] });
	sheet.addRow(['district', 'year', 'month', ...layout.indicators]);
	sheet.addRow(['District', 'Year', 'Month', ...layout.indicators.map(title)]);
	for (const n of [1, 2]) {
		sheet.getRow(n).font = { bold: n === 2 };
	}
	const closed = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E5E5' } } as const;
	for (const row of layout.rows) {
		const added = sheet.addRow([row.district, row.year, row.month]);
		layout.indicators.forEach((code, n) => {
			const cell = added.getCell(4 + n);
			if (row.open.has(code)) {
				cell.protection = { locked: false };
			} else {
				cell.fill = closed;
			}
		});
	}
	sheet.columns.forEach((column, n) => { column.width = n === 0 ? 24 : n < 3 ? 8 : 16; });
	await sheet.protect('', { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true });
	const about = workbook.addWorksheet('About');
	about.addRows([
		['dhis2SubmissionId', submissionId],
		['dhis2Version', versionNumber],
		['madeAtUtc', new Date().toISOString()],
		['cells', cells.length],
	]);
	about.getColumn(1).width = 20;
	about.getColumn(2).width = 40;
	return new Uint8Array(await workbook.xlsx.writeBuffer());
}
