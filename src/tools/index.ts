/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the DHIS2 chat tools (dhis2_*), contributed in package.json and registered here -- the ones
 *  DataSuite had built in, now answered by this extension through vscode.dhis2 and its own mappings and downloads.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DHIS2_TOOL_NAMES } from '../core/chatTools';
import { chatTools } from './chatTools';
import { queryTools } from './queryTools';
import { toLanguageModelTool, ToolDeps } from './support';

/** The context key the contributed tools' `when` reads: whether there is a DHIS2 connection to use. */
const HAS_CONNECTION = 'dataExtractor.hasConnection';

export function registerChatTools(deps: ToolDeps): vscode.Disposable {
	const disposables: vscode.Disposable[] = [];
	const tools = [...chatTools(deps), ...queryTools(deps)];
	for (const name of DHIS2_TOOL_NAMES) {
		const def = tools.find(t => t.name === name);
		if (!def) {
			throw new Error(`No implementation for the chat tool ${name}`);
		}
		disposables.push(vscode.lm.registerTool(name, toLanguageModelTool<{ profileId?: string }>(def as never, deps.log)));
	}

	const refresh = () => vscode.dhis2.getConnections().then(
		connections => vscode.commands.executeCommand('setContext', HAS_CONNECTION, connections.length > 0),
		() => vscode.commands.executeCommand('setContext', HAS_CONNECTION, false)
	);
	void refresh();
	disposables.push(vscode.dhis2.onDidChangeConnections(() => void refresh()));
	return vscode.Disposable.from(...disposables);
}
