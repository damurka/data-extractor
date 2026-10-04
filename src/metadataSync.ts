/*---------------------------------------------------------------------------------------------
 *  Data Extractor: bringing DataSuite's copy of a server's metadata up to date -- one sync of a connection at a time.
 *  A second one started while the first is still writing fails in DataSuite ("cannot start a transaction within a
 *  transaction") and leaves the copy without its indicators and data sets, so every way of asking for a sync here
 *  (the button, the schedule of the settings) goes through this.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const running = new Map<string, Promise<void>>();

/** Whether this extension is syncing the connection's metadata now. */
export function isSyncing(connectionId: string): boolean {
	return running.has(connectionId);
}

/** Syncs a connection's metadata, or joins the sync of it already under way. */
export function syncMetadata(connectionId: string, force: boolean): Promise<void> {
	let sync = running.get(connectionId);
	if (!sync) {
		sync = (async () => {
			// one started elsewhere (DataSuite itself, another extension) is left to finish
			const status = await vscode.dhis2.metadata.getStatus(connectionId);
			if (!status.syncing) {
				await vscode.dhis2.metadata.sync(connectionId, { force });
			}
		})().finally(() => running.delete(connectionId));
		running.set(connectionId, sync);
	}
	return sync;
}
