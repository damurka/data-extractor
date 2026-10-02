/*---------------------------------------------------------------------------------------------
 *  Data Extractor: map indicators and download routine data from DHIS2.
 *
 *  Everything DHIS2 goes through DataSuite's API (vscode.dhis2, proposal datasuiteDhis2): the connections and their
 *  credentials are DataSuite's -- signed in to in DataSuite's dialog, signed with in DataSuite -- and this extension
 *  reads with the ones the user gives it.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DownloadRunner } from './download';
import { createHost } from './host';
import { migrateBuiltInExtractor } from './migrate';
import { ExtractorPanel } from './panel';
import { ExtractorEvents } from './shared/api';
import { RpcEvent } from './shared/rpc';
import { ExtractorStore } from './store';
import { registerChatTools } from './tools';

export function activate(context: vscode.ExtensionContext): void {
	const log = vscode.window.createOutputChannel('Data Extractor', { log: true });
	const store = new ExtractorStore(context.globalStorageUri.fsPath);
	const runner = new DownloadRunner(store, log);
	const events = new vscode.EventEmitter<RpcEvent>();
	const fire = <K extends keyof ExtractorEvents>(name: K, data: ExtractorEvents[K]) => events.fire({ kind: 'event', name, data });

	// The built-in extractor's work carried over, and downloads that were running when DataSuite closed paused,
	// for every connection this extension has -- now, and whenever it gets another
	const prepare = async () => {
		await migrateBuiltInExtractor(store, log);
		for (const connection of await vscode.dhis2.getConnections().then(cs => cs.filter(c => c.granted), () => [])) {
			await runner.reconcile(connection.id).catch(error => log.warn(`Could not check unfinished downloads: ${error}`));
		}
	};
	void prepare();

	context.subscriptions.push(
		log,
		store,
		events,
		vscode.dhis2.onDidChangeConnections(() => {
			fire('connectionsChanged', undefined);
			void prepare();
		}),
		vscode.dhis2.metadata.onDidChangeStatus(() => fire('metadataChanged', undefined)),
		store.onDidChangeMappings(connectionId => fire('mappingsChanged', connectionId)),
		store.onDidChangeDownloads(connectionId => fire('downloadsChanged', connectionId)),
		vscode.commands.registerCommand('dataExtractor.open', () => {
			ExtractorPanel.show(context, createHost(store, runner), events.event);
		}),
		registerChatTools({ store, runner, log, storageUri: context.globalStorageUri })
	);
}

export function deactivate(): void {
	// The panel, listeners and channels are in the context's subscriptions; a running download stops with the extension
	// host, and is paused (resumable) the next time
}
