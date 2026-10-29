/*---------------------------------------------------------------------------------------------
 *  Data Extractor: submitting a Countdown mapping to DataSuite as the country's mapping
 *--------------------------------------------------------------------------------------------*/

// Submit Mapping to DataSuite: one of this connection's Countdown mappings, with the DHIS2 level of the districts
// chosen from the server's levels, goes to DataSuite as a new version of the uploader's country's mapping, reviewed
// by the country, then globally. The sign-in and the request are Countdown Analytics' (its `submitCountryMapping`):
// this extension never holds a DataSuite token.

import * as vscode from 'vscode';
import { mappingProblems, toDataSuiteMapping } from './core/dataSuiteMapping';
import { ExtractorStore } from './store';

const COUNTDOWN_EXTENSION_ID = 'countdown.countdown-analytics';

interface ICountdownSubmitApi {
	submitCountryMapping(mappingJson: string, options?: { note?: string }): Promise<number | undefined>;
}

export function registerSubmitMapping(store: ExtractorStore): vscode.Disposable {
	return vscode.commands.registerCommand('dataExtractor.submitMapping', async () => {
		try {
			await submitMapping(store);
		} catch (error) {
			void vscode.window.showErrorMessage(`The mapping wasn't submitted: ${error instanceof Error ? error.message : String(error)}`);
		}
	});
}

async function submitMapping(store: ExtractorStore): Promise<void> {
	const connections = (await vscode.dhis2.getConnections()).filter(c => c.granted);
	if (connections.length === 0) {
		throw new Error('Connect to your DHIS2 in the Data Extractor first.');
	}
	const connection = connections.length === 1 ? connections[0]
		: (await vscode.window.showQuickPick(connections.map(c => ({ label: c.displayName, description: c.serverUrl, connection: c })), { title: 'Which DHIS2?' }))?.connection;
	if (!connection) {
		return;
	}
	const mappings = (await store.listMappings(connection.id)).filter(m => m.mode === 'countdown');
	if (mappings.length === 0) {
		throw new Error('This DHIS2 has no Countdown mapping yet: make one in the Data Extractor.');
	}
	const chosen = await vscode.window.showQuickPick(mappings.map(m => ({ label: m.name, description: `${m.mappedCount ?? 0} of ${m.indicatorsCount} mapped`, id: m.id })),
		{ title: 'Submit which mapping as the country\'s?' });
	if (!chosen) {
		return;
	}
	const draft = await store.getMapping(connection.id, chosen.id);
	if (!draft) {
		throw new Error('The mapping was not found.');
	}
	const problems = mappingProblems(draft);
	if (problems.length > 0) {
		throw new Error(problems.join(' '));
	}
	const levels = await vscode.dhis2.metadata.getOrganisationUnitLevels(connection.id);
	const level = await vscode.window.showQuickPick(levels.map(l => ({ label: `${l.level}: ${l.name}`, level: l.level })),
		{ title: 'Which DHIS2 level is the district?', placeHolder: 'The level whose organisation units are the districts' });
	if (!level) {
		return;
	}
	const note = await vscode.window.showInputBox({ title: 'A note for the reviewers (optional)', prompt: 'What this version is, or what changed' });

	const countdown = vscode.extensions.getExtension<ICountdownSubmitApi>(COUNTDOWN_EXTENSION_ID);
	if (!countdown) {
		throw new Error('Submitting needs the Countdown Analytics extension.');
	}
	const api = countdown.isActive ? countdown.exports : await countdown.activate();
	if (typeof api?.submitCountryMapping !== 'function') {
		throw new Error('This Countdown Analytics can\'t submit mappings yet: update it.');
	}
	const json = JSON.stringify(toDataSuiteMapping(draft, connection.serverUrl, level.level));
	const version = await api.submitCountryMapping(json, { note: note || undefined });
	if (version !== undefined) {
		void vscode.window.showInformationMessage(`${draft.name} was submitted to DataSuite as version ${version} of the country's mapping. The country reviews it, then it's reviewed globally.`);
	}
}
