/*---------------------------------------------------------------------------------------------
 *  Data Extractor: what every DHIS2 chat tool shares -- which connection a call means, the wrapper that answers only
 *  inside a chat request and turns failures into advice, and writing results as CSV for R
 *  Ported from DataSuite (contrib/dhis2/browser/tools/dhis2ToolSupport.ts).
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { classifyDhis2Error } from '../core/dhis2Errors';
import { csvFileName, ITidyTable, profileLabel, resolveProfileChoice, toCsv } from '../core/dataUtils';
import { DownloadRunner } from '../download';
import { ExtractorStore } from '../store';

/** What the tools work with: the extension's own store and download runner, its log and its storage folder. */
export interface ToolDeps {
	readonly store: ExtractorStore;
	readonly runner: DownloadRunner;
	readonly log: vscode.LogOutputChannel;
	readonly storageUri: vscode.Uri;
}

/** The connection a call works with, already given to this extension. */
export interface ToolCall {
	readonly connection: vscode.Dhis2Connection;
	readonly connectionId: string;
}

export interface ToolOutput {
	readonly text: string;
	/** Rows of data the result holds, for the log line. */
	readonly rows?: number;
}

/**
 * The connection a call means: `hint` is a connection id, display name or server host; without one, the first
 * connection given to this extension (else the first there is). One the extension was not given yet is asked for --
 * DataSuite shows the user its consent dialog.
 */
export async function resolveConnection(hint: string | undefined): Promise<{ connection: vscode.Dhis2Connection; note?: string }> {
	const connections = await vscode.dhis2.getConnections();
	const ordered = [...connections.filter(c => c.granted), ...connections.filter(c => !c.granted)];
	const choice = resolveProfileChoice(ordered, hint);
	if (choice.kind === 'error') {
		throw new Error(choice.error);
	}
	const connection = ordered.find(c => c.id === choice.profile.id)!;
	if (!connection.granted && !await vscode.dhis2.requestAccess(connection.id)) {
		throw new Error(`The user did not give the Data Extractor the DHIS2 connection "${connection.displayName}" (${connection.serverUrl}).`);
	}
	return { connection, note: choice.note };
}

export interface ToolDefinition<T> {
	readonly name: string;
	/** Whether the tool reads through a connection (its input's `profileId` says which). */
	readonly usesProfile: boolean;
	/** The line chat shows while the tool runs. */
	invocationMessage(input: T): string;
	/** A confirmation for a tool that writes, or `undefined` to run without one. */
	prepare?(input: T, token: vscode.CancellationToken): Promise<vscode.PreparedToolInvocation | undefined>;
	invoke(input: T, call: ToolCall, token: vscode.CancellationToken): Promise<ToolOutput>;
}

const text = (value: string) => new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)]);

/**
 * A tool as chat runs it. Every result starts with `Profile: <name> (<server>)` (and says which connection was picked
 * when several exist); a failure becomes a result naming the likely cause and the next step; each call is logged with
 * its connection, duration, rows and error class.
 *
 * It answers only inside a chat request (`toolInvocationToken`): another extension calling vscode.lm.invokeTool on its
 * own is refused, so this extension's DHIS2 access cannot be borrowed outside a conversation the user is having.
 */
export function toLanguageModelTool<T extends { profileId?: string }>(def: ToolDefinition<T>, log: vscode.LogOutputChannel): vscode.LanguageModelTool<T> {
	return {
		prepareInvocation: async (options, token) => {
			const prepared = def.prepare ? await def.prepare(options.input, token).catch(error => {
				// Rethrown, not swallowed: no confirmation would let a write run unconfirmed
				log.warn(`[tool] ${def.name} preparation failed: ${error instanceof Error ? error.message : String(error)}`);
				throw error;
			}) : undefined;
			return { invocationMessage: def.invocationMessage(options.input), ...prepared };
		},
		invoke: async (options, token) => {
			if (!options.toolInvocationToken) {
				log.warn(`[tool] ${def.name} refused: not called from a chat request`);
				throw new Error(`${def.name} runs only inside a chat request.`);
			}
			const start = Date.now();
			let header = '';
			let connectionName = '-';
			try {
				let call: ToolCall | undefined;
				if (def.usesProfile) {
					const { connection, note } = await resolveConnection(options.input?.profileId);
					connectionName = connection.displayName;
					header = note ? `${profileLabel(connection)}\n_${note}_\n\n` : `${profileLabel(connection)}\n\n`;
					call = { connection, connectionId: connection.id };
				}
				const output = await def.invoke(options.input ?? {} as T, call!, token);
				log.info(`[tool] ${def.name} profile="${connectionName}" ${Date.now() - start}ms ok${output.rows !== undefined ? ` rows=${output.rows}` : ''} chars=${output.text.length}`);
				return text(header + output.text);
			} catch (error) {
				if (token.isCancellationRequested || error instanceof vscode.CancellationError) {
					throw error;
				}
				const message = error instanceof Error ? error.message : String(error);
				const advice = classifyDhis2Error(message);
				log.error(`[tool] ${def.name} profile="${connectionName}" ${Date.now() - start}ms error=${advice.errorClass}: ${message}`);
				return text(`${header}${def.name} failed: ${message}\n\nLikely cause: ${advice.cause}\nNext step: ${advice.nextStep}`);
			}
		}
	};
}

// ---------------------------------------------------------------------------
// Writing results for R
// ---------------------------------------------------------------------------

export interface WrittenDataFile {
	readonly uri: vscode.Uri;
	/** Absolute path with forward slashes, ready to paste into R. */
	readonly rPath: string;
	/** Where it went and why, e.g. "the active Shiny app's analysis folder". */
	readonly location: string;
}

interface ShinyTabInfo {
	readonly active?: boolean;
	readonly workspaceDir?: string;
}

/** Rows shown in a result's CSV preview. */
const PREVIEW_ROWS = 5;

/**
 * Writes a result as tidy CSV where R can read it: the active Shiny app's analysis folder (`<app>.shiny-workspace/
 * dhis2/`) when an app tab is active, else `<first workspace folder>/data/dhis2/`, else this extension's storage
 * (`exports/`) when no folder is open.
 */
export async function writeDataFile(storageUri: vscode.Uri, label: string, table: ITidyTable): Promise<WrittenDataFile> {
	let target: { folder: vscode.Uri; location: string } | undefined;
	try {
		const tabs = await vscode.commands.executeCommand<ShinyTabInfo[]>('datasuite.shinyApps.listTabs');
		const active = Array.isArray(tabs) ? tabs.find(t => t.active && t.workspaceDir) : undefined;
		if (active?.workspaceDir) {
			target = { folder: vscode.Uri.file(path.join(active.workspaceDir, 'dhis2')), location: "the active Shiny app's analysis folder" };
		}
	} catch {
		// no Shiny apps in this DataSuite, or no app open
	}
	const root = vscode.workspace.workspaceFolders?.[0];
	target ??= root
		? { folder: vscode.Uri.joinPath(root.uri, 'data', 'dhis2'), location: 'the workspace data folder' }
		: { folder: vscode.Uri.joinPath(storageUri, 'exports'), location: "the Data Extractor's storage folder (no workspace folder is open)" };
	const uri = vscode.Uri.joinPath(target.folder, csvFileName(label, new Date()));
	await vscode.workspace.fs.createDirectory(target.folder);
	await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(toCsv(table.columns, table.rows)));
	const rPath = (uri.scheme === 'file' ? uri.fsPath : uri.toString()).replace(/\\/g, '/');
	return { uri, rPath, location: target.location };
}

/** The CSV part of a tool result: path, row count, a short preview, and the R line to load it. */
export function describeDataFile(file: WrittenDataFile, table: ITidyTable): string {
	const preview = toCsv(table.columns, table.rows.slice(0, PREVIEW_ROWS)).trimEnd();
	return [
		`Full result: ${table.rows.length} rows x ${table.columns.length} columns written to \`${file.rPath}\` (${file.location}).`,
		`Columns: ${table.columns.join(', ')}`,
		'Preview:',
		'```csv',
		preview,
		'```',
		'Load in R (runR):',
		'```r',
		`df <- readr::read_csv("${file.rPath.replace(/"/g, '\\"')}", show_col_types = FALSE)`,
		'```',
	].join('\n');
}

// ---------------------------------------------------------------------------
// Metadata items
// ---------------------------------------------------------------------------

/** A metadata field as a string, or `undefined`. */
export function str(value: unknown): string | undefined {
	return typeof value === 'string' && value ? value : undefined;
}

/** A metadata item with the fields the tools read (DataSuite keeps more; absent ones are `undefined`). */
export interface MetaRow {
	readonly uid: string;
	readonly name: string;
	readonly code?: string;
	readonly displayName?: string;
	readonly shortName?: string;
	readonly formName?: string;
	readonly description?: string;
	readonly lastUpdated?: string;
	readonly categoryComboUid?: string;
	readonly categoryComboIsDefault?: boolean;
	readonly groupInfo?: string;
	readonly numerator?: string;
	readonly numeratorDescription?: string;
	readonly denominator?: string;
	readonly denominatorDescription?: string;
	readonly periodType?: string;
	readonly level?: number;
	readonly pathNames?: string;
	readonly geometryType?: string;
	readonly dataElementUid?: string;
	readonly cocUid?: string;
}

export function metaRow(item: vscode.Dhis2MetadataItem): MetaRow {
	return {
		uid: item.uid,
		name: item.name,
		code: str(item.code),
		displayName: str(item.displayName),
		shortName: str(item.shortName),
		formName: str(item.formName),
		description: str(item.description),
		lastUpdated: str(item.lastUpdated),
		categoryComboUid: str(item.categoryComboUid),
		categoryComboIsDefault: typeof item.categoryComboIsDefault === 'boolean' ? item.categoryComboIsDefault : undefined,
		groupInfo: str(item.groupInfo),
		numerator: str(item.numerator),
		numeratorDescription: str(item.numeratorDescription),
		denominator: str(item.denominator),
		denominatorDescription: str(item.denominatorDescription),
		periodType: str(item.periodType),
		level: typeof item.level === 'number' ? item.level : undefined,
		pathNames: str(item.pathNames),
		geometryType: str(item.geometryType),
		dataElementUid: str(item.dataElementUid),
		cocUid: str(item.cocUid)
	};
}

/** The tools' metadata calls, as rows. */
export const meta = {
	kind: () => vscode.Dhis2MetadataKind,
	relation: () => vscode.Dhis2MetadataRelation,
	search: async (connectionId: string, kind: vscode.Dhis2MetadataKind, query: string, options?: vscode.Dhis2MetadataSearchOptions) => {
		const result = await vscode.dhis2.metadata.search(connectionId, kind, query, options);
		return { rows: result.items.map(metaRow), total: result.total };
	},
	get: async (connectionId: string, kind: vscode.Dhis2MetadataKind, uids: readonly string[]) => uids.length ? (await vscode.dhis2.metadata.get(connectionId, kind, uids)).map(metaRow) : [],
	related: async (connectionId: string, relation: vscode.Dhis2MetadataRelation, uid: string) => (await vscode.dhis2.metadata.getRelated(connectionId, relation, uid)).map(metaRow),
	levels: (connectionId: string) => vscode.dhis2.metadata.getOrganisationUnitLevels(connectionId).then(levels => levels.map(l => ({ level: l.level, name: l.name, count: l.count })))
};
