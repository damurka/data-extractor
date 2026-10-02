/*---------------------------------------------------------------------------------------------
 *  Data Extractor: map indicators and download routine data from DHIS2.
 *
 *  Everything DHIS2 goes through DataSuite's API (vscode.dhis2, proposal datasuiteDhis2): the connections and their
 *  credentials are DataSuite's -- signed in to in DataSuite's dialog, signed with in DataSuite -- and this extension
 *  reads with the ones the user gives it.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Connection, ExtractorEvents, ExtractorHost } from './shared/api';
import { RpcEvent } from './shared/rpc';
import { ExtractorPanel } from './panel';

export function activate(context: vscode.ExtensionContext): void {
	const events = new vscode.EventEmitter<RpcEvent>();
	const fire = <K extends keyof ExtractorEvents>(name: K, data: ExtractorEvents[K]) => events.fire({ kind: 'event', name, data });

	context.subscriptions.push(
		events,
		vscode.dhis2.onDidChangeConnections(() => fire('connectionsChanged', undefined)),
		vscode.dhis2.metadata.onDidChangeStatus(() => fire('metadataChanged', undefined))
	);

	const host: ExtractorHost = {
		listConnections: async () => (await vscode.dhis2.getConnections()).map(toConnection),
		signIn: async () => {
			const connection = await vscode.dhis2.signIn();
			return connection && toConnection(connection);
		},
		requestAccess: async connectionId => vscode.dhis2.requestAccess(connectionId),
		manageConnections: async () => { await vscode.commands.executeCommand('workbench.action.dhis2.manageExtensionAccess'); },
		metadataStatus: async connectionId => vscode.dhis2.metadata.getStatus(connectionId),
		syncMetadata: async (connectionId, force) => vscode.dhis2.metadata.sync(connectionId, { force })
	};

	context.subscriptions.push(vscode.commands.registerCommand('dataExtractor.open', () => {
		ExtractorPanel.show(context, host, events.event);
	}));
}

export function deactivate(): void {
	// nothing to release: the panel and listeners are in the context's subscriptions
}

function toConnection(connection: vscode.Dhis2Connection): Connection {
	return {
		id: connection.id,
		serverUrl: connection.serverUrl,
		username: connection.username,
		displayName: connection.displayName,
		usesAccessToken: connection.usesAccessToken,
		country: connection.country,
		granted: connection.granted
	};
}
