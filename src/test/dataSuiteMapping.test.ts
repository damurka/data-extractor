/*---------------------------------------------------------------------------------------------
 *  Data Extractor: a Countdown mapping as DataSuite keeps it
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mappingProblems, toDataSuiteMapping } from '../core/dataSuiteMapping';
import { IAddMappingDraft } from '../core/types';

const draft: IAddMappingDraft = {
	name: 'Kenya',
	mode: 'countdown',
	indicators: [
		{
			id: 'i1', internalName: 'Penta 1', exportCode: 'penta1 ', kind: 'countdown',
			sources: [{ id: 'Bc3dE4fG5hI', sourceElement: 'Penta 1 doses', type: 'Data Element', includedCategoriesText: '', cocs: [
				{ uid: 'Aa1bB2cC3dD', name: '<1y', categoryComboUid: null, checked: true },
				{ uid: 'Zz9yY8xX7wV', name: '>1y', categoryComboUid: null, checked: false },
			] }],
		},
		{ id: 'i2', internalName: 'Completeness', exportCode: 'reporting', kind: 'countdown', sources: [{ id: 'Ds1aB2cD3eF', sourceElement: 'MOH 711', type: 'Dataset', includedCategoriesText: 'N/A' }] },
		{ id: 'i3', internalName: 'IPD', exportCode: 'ipd', kind: 'countdown', sources: [], notAvailable: { reason: 'notCollected' } },
	],
};

test('a Countdown mapping becomes the country\'s mapping: codes, sources with their chosen combos, what isn\'t available', () => {
	const mapping = toDataSuiteMapping(draft, 'https://hiskenya.example.org/', 3);

	assert.equal(mapping.dhis2Url, 'https://hiskenya.example.org');
	assert.equal(mapping.districtLevel, 3);
	assert.deepEqual(mapping.indicators[0], { code: 'penta1', sources: [{ uid: 'Bc3dE4fG5hI', type: 'DataElement', name: 'Penta 1 doses', categoryOptionCombos: ['Aa1bB2cC3dD'] }], notAvailable: null });
	assert.equal(mapping.indicators[1].sources[0].type, 'DataSet');
	assert.deepEqual(mapping.indicators[2], { code: 'ipd', sources: [], notAvailable: 'Not collected in this DHIS2' });
});

test('only a complete Countdown mapping goes to DataSuite', () => {
	assert.deepEqual(mappingProblems(draft), []);
	assert.match(mappingProblems({ ...draft, mode: 'custom' })[0], /Countdown mapping/);
	const unmapped = { ...draft, indicators: [{ ...draft.indicators[0], sources: [] }] };
	assert.match(mappingProblems(unmapped)[0], /no DHIS2 source/);
});
