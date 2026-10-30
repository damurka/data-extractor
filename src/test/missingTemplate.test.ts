/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the missing-data template, and a download's mapping against DataSuite's
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mappingDifferences, monthPeriod, IDataSuiteMapping } from '../core/dataSuiteMapping';
import { Workbook } from 'exceljs';
import { missingLayout, missingTemplateWorkbook } from '../core/missingTemplate';

describe('missingLayout', () => {
	it('is a column per indicator and a row per district and month that lack something', () => {
		const layout = missingLayout([
			{ indicator: 'penta1', district: 'Nairobi', year: 2025, month: 3 },
			{ indicator: 'anc1', district: 'Nairobi', year: 2025, month: 3 },
			{ indicator: 'anc1', district: 'Kisumu', year: 2025, month: 4 },
			{ indicator: 'anc1', district: 'Kisumu', year: 2025, month: 1 },
		]);
		assert.deepStrictEqual(layout.indicators, ['anc1', 'penta1']);
		assert.deepStrictEqual(layout.rows.map(r => [r.district, r.month, [...r.open].sort()]), [
			['Kisumu', 1, ['anc1']], ['Kisumu', 4, ['anc1']], ['Nairobi', 3, ['anc1', 'penta1']],
		]);
	});
});

describe('mappingDifferences', () => {
	const local: IDataSuiteMapping = {
		dhis2Url: 'https://hiskenya.example.org/', districtLevel: 3,
		indicators: [
			{ code: 'anc1', sources: [{ uid: 'a', type: 'DataElement', name: null, categoryOptionCombos: ['x', 'y'] }, { uid: 'b', type: 'DataElement', name: null, categoryOptionCombos: [] }], notAvailable: null },
			{ code: 'ipd', sources: [], notAvailable: 'Not collected' },
		],
	};
	const version = { number: 2, sha256: 's', dhis2Url: 'https://HISKENYA.example.org', districtLevel: 3, indicators: [
		{ code: 'ANC1', sources: [{ uid: 'b', type: 'DataElement', name: 'B', categoryOptionCombos: [] }, { uid: 'a', type: 'DataElement', name: 'A', categoryOptionCombos: ['y', 'x'] }], notAvailable: null },
		{ code: 'ipd', sources: [], notAvailable: 'Not collected in this DHIS2' },
	] };

	it('is none for the same mapping, whatever the order, case or names', () => {
		assert.deepStrictEqual(mappingDifferences(local, version), []);
	});

	it('names what differs', () => {
		const other = { ...version, districtLevel: 2, indicators: [{ ...version.indicators[0], sources: [version.indicators[0].sources[0]] }] };
		const differences = mappingDifferences(local, other);
		assert.strictEqual(differences.length, 2);
		assert.match(differences[0], /level 2/);
		assert.match(differences[1], /2 indicator\(s\).*anc1, ipd/);
	});
});

describe('monthPeriod', () => {
	it('is the DHIS2 month of a date', () => {
		assert.strictEqual(monthPeriod('2025-09-30'), '202509');
		assert.strictEqual(monthPeriod('2025W3'), '2025W3');
	});
});

describe('missingTemplateWorkbook', () => {
	it('opens only the cells to fill, and says which DHIS2 data it fills', async () => {
		const bytes = await missingTemplateWorkbook('sub-1', 3, [
			{ indicator: 'anc1', district: 'Nairobi', year: 2025, month: 3 },
			{ indicator: 'penta1', district: 'Kisumu', year: 2025, month: 4 },
		]);
		const workbook = new Workbook();
		await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
		const sheet = workbook.getWorksheet('Missing data')!;
		assert.deepStrictEqual((sheet.getRow(1).values as unknown[]).slice(1), ['district', 'year', 'month', 'anc1', 'penta1']);
		assert.deepStrictEqual((sheet.getRow(3).values as unknown[]).slice(1, 4), ['Kisumu', 2025, 4]);
		assert.notStrictEqual(sheet.getRow(3).getCell(4).protection?.locked, false, 'Kisumu has anc1: locked, as cells are unless unlocked');
		assert.strictEqual(sheet.getRow(3).getCell(5).protection?.locked, false, 'Kisumu lacks penta1');
		assert.strictEqual(sheet.getRow(4).getCell(4).protection?.locked, false, 'Nairobi lacks anc1');
		const about = workbook.getWorksheet('About')!;
		assert.deepStrictEqual([about.getCell('B1').value, about.getCell('B2').value], ['sub-1', 3]);
	});
});
