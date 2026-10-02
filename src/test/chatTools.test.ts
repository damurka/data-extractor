/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the pure parts of the DHIS2 chat tools
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { DHIS2_TOOL_NAMES, IMappingIndicatorInput, normalizeAdminLevel, pivotReporting, summarizeMappingChanges, summarizeReusedSources, validateIndicatorReasoning } from '../core/chatTools';
import { classifyDhis2Error } from '../core/dhis2Errors';
import { validateDhis2RawPath } from '../core/dhis2Paths';
import { IAddMappingDraft } from '../core/types';

const indicator = (exportCode: string, sourceIds: string[], extra?: Partial<IMappingIndicatorInput>): IMappingIndicatorInput => ({
	internalName: exportCode,
	exportCode,
	sources: sourceIds.map(id => ({ id, sourceElement: `Element ${id}`, type: 'Data Element' })),
	confidence: 'High',
	reasoning: 'name and disaggregation match',
	...extra
});

test('package.json contributes exactly the tools the extension registers', () => {
	const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
	const contributed = (pkg.contributes.languageModelTools as { name: string; toolReferenceName: string; inputSchema: unknown }[]);
	assert.deepEqual(contributed.map(t => t.name).sort(), [...DHIS2_TOOL_NAMES].sort());
	for (const t of contributed) {
		assert.equal(t.toolReferenceName, t.name);
		assert.ok(t.inputSchema, `${t.name} has an input schema`);
	}
});

test('a mapping is refused without confidence or reasoning on every indicator', () => {
	assert.equal(validateIndicatorReasoning([indicator('anc1', ['a'])]), undefined);
	assert.match(validateIndicatorReasoning([indicator('anc1', ['a'], { confidence: 'Sure' as never })])!, /missing a valid "confidence"/);
	assert.match(validateIndicatorReasoning([indicator('anc1', ['a'], { reasoning: '  ' })])!, /missing "reasoning"/);
	assert.match(validateIndicatorReasoning(undefined)!, /must be a list/);
});

test('a source reused for more than three export codes is flagged', () => {
	assert.equal(summarizeReusedSources(['a', 'b', 'c'].map(code => indicator(code, ['x']))), undefined);
	const warning = summarizeReusedSources(['a', 'b', 'c', 'd'].map(code => indicator(code, ['x'])));
	assert.match(warning!, /Element x\*\* \(`x`\) is the source for 4 different export codes: a, b, c, d/);
});

test('the change summary calls out replacing a source a person picked', () => {
	const source = (id: string, origin: 'ai' | 'manual') => ({ id, sourceElement: `Element ${id}`, type: 'Data Element', includedCategoriesText: 'All', origin });
	const existing: IAddMappingDraft = { name: 'M', mode: 'custom', indicators: [{ id: '1', internalName: 'ANC 1', exportCode: 'anc1', kind: 'custom', sources: [source('a', 'manual')] }] };
	const proposed: IAddMappingDraft = { name: 'M', mode: 'custom', indicators: [{ id: '2', internalName: 'ANC 1', exportCode: 'anc1', kind: 'custom', sources: [source('b', 'ai')] }] };
	const { message, overwritesManual } = summarizeMappingChanges(existing, proposed);
	assert.ok(overwritesManual);
	assert.match(message, /Add data element \*Element b\* to \*ANC 1\*/);
	assert.match(message, /⚠️ Replace \*Element a\* from \*ANC 1\* -- currently set \*\*manually\*\*/);
	assert.match(summarizeMappingChanges(undefined, proposed).message, /\*\*Create mapping "M"\*\*/);
});

test('an org unit level by number, LEVEL-n or name', () => {
	const levels = [{ level: 1, name: 'Kenya' }, { level: 2, name: 'County' }];
	assert.deepEqual(normalizeAdminLevel(levels, 'LEVEL-2'), { adminLevel: 'LEVEL-2', level: 2, name: 'County' });
	assert.deepEqual(normalizeAdminLevel(levels, 2), { adminLevel: 'LEVEL-2', level: 2, name: 'County' });
	assert.deepEqual(normalizeAdminLevel(levels, 'county'), { adminLevel: 'LEVEL-2', level: 2, name: 'County' });
	assert.throws(() => normalizeAdminLevel(levels, 'Ward'), /Valid levels: LEVEL-1 \(Kenya\), LEVEL-2 \(County\)/);
	assert.deepEqual(normalizeAdminLevel([], '4'), { adminLevel: 'LEVEL-4', level: 4, name: undefined });
});

test('reporting completeness: one row per org unit, the rate worked out when DHIS2 gives none, lowest first', () => {
	const ds = 'abcdefghijk';
	const row = (ou: string, metric: string, value: number | null) => ({ ou_uid: ou, ou_name: `OU ${ou}`, dx_uid: `${ds}.${metric}`, pe: '2024', value });
	const table = pivotReporting({
		columns: ['ou_uid', 'ou_name', 'dx_uid', 'pe', 'value'],
		rows: [row('a', 'EXPECTED_REPORTS', 12), row('a', 'ACTUAL_REPORTS', 12), row('a', 'REPORTING_RATE', 100), row('b', 'EXPECTED_REPORTS', 12), row('b', 'ACTUAL_REPORTS', 6)]
	}, ds, false);
	assert.deepEqual(table.rows.map(r => [r.ou_uid, r.rate, r.missing]), [['b', 50, 6], ['a', 100, 0]]);
});

test('raw query paths stay under /api/', () => {
	assert.deepEqual(validateDhis2RawPath('/api/organisationUnitGroups/'), { ok: true, path: 'organisationUnitGroups' });
	for (const bad of ['', 'https://evil.example/api', 'a/../apiToken', 'a%2e%2e/b', 'a?b=1', 'a//b', 'a\\b']) {
		assert.equal(validateDhis2RawPath(bad).ok, false, bad);
	}
});

test('failures are explained', () => {
	assert.equal(classifyDhis2Error('DHIS2 request timed out.').errorClass, 'timeout');
	assert.equal(classifyDhis2Error('Not authorised: this DHIS2 user does not have access to this resource (HTTP 403).').errorClass, 'forbidden');
	assert.equal(classifyDhis2Error('The user did not give the Data Extractor the DHIS2 connection "Kenya".').errorClass, 'forbidden');
	assert.equal(classifyDhis2Error('No DHIS2 connections found. Ask the user to sign in.').errorClass, 'noProfile');
	assert.equal(classifyDhis2Error('DHIS2 server error (HTTP 503).').errorClass, 'server');
});
