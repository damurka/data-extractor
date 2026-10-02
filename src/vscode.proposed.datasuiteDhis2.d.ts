/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	// DataSuite: read from DHIS2 through the user's DHIS2 connections. The credentials (a password or a personal
	// access token) stay in DataSuite: they are typed into DataSuite's own sign-in dialog, kept encrypted, and added to
	// each request by DataSuite. An extension sees which server and user a connection is, never its credential, and
	// can read only with the connections the user gave it.

	/** A DHIS2 server the user signed in to, and as whom. */
	export interface Dhis2Connection {
		readonly id: string;
		/** The server, e.g. `https://dhis2.example.org` (without `/api`). */
		readonly serverUrl: string;
		readonly username: string;
		readonly displayName: string;
		/** Whether the user signed in with a personal access token rather than a password. */
		readonly usesAccessToken: boolean;
		readonly country?: string;
		/** Whether this extension may read through the connection (see {@link dhis2.requestAccess}). */
		readonly granted: boolean;
	}

	/** A value of a query parameter. A list gives the parameter once per item (`dimension=dx:...&dimension=pe:...`). */
	export type Dhis2QueryValue = string | number | boolean | ReadonlyArray<string | number | boolean>;

	/** A read: a GET of a resource under the server's `/api/`. */
	export interface Dhis2ReadRequest {
		/** The resource under `/api/`, e.g. `analytics`, `dataElements` or `40/organisationUnits/abc123` -- not a URL. */
		readonly path: string;
		readonly query?: { readonly [name: string]: Dhis2QueryValue | undefined };
		/** At most 10 minutes; 2 minutes when not given. */
		readonly timeoutMs?: number;
	}

	export namespace dhis2 {

		/** The user's DHIS2 connections, with whether this extension was given each. */
		export function getConnections(): Thenable<Dhis2Connection[]>;

		/** Fired when a connection is added or removed, or this extension is given or loses one. */
		export const onDidChangeConnections: Event<void>;

		/**
		 * Asks the user to let this extension read through a connection, unless it already may. Resolves to whether it
		 * may now.
		 */
		export function requestAccess(connectionId: string): Thenable<boolean>;

		/**
		 * Opens DataSuite's sign-in dialog for a new connection (the user types the password or token there, not in the
		 * extension), which this extension is then given. `undefined` when the user cancels or signing in fails.
		 */
		export function signIn(options?: { readonly serverUrl?: string }): Thenable<Dhis2Connection | undefined>;

		/**
		 * Reads from the connection's server: the JSON of `GET <server>/api/<path>?<query>`, signed by DataSuite. Read
		 * only -- there is no way to change data on the server -- and resources holding the server's credentials or
		 * sessions (`apiToken`, `oauth2`, ...) are refused. Rejects when this extension was not given the connection
		 * (call {@link requestAccess} first), or when the server answers with an error.
		 */
		export function read(connectionId: string, request: Dhis2ReadRequest, token?: CancellationToken): Thenable<unknown>;

		/** How many requests a download takes, without downloading. */
		export function planAnalyticsDownload(connectionId: string, request: Dhis2AnalyticsDownloadRequest): Thenable<Dhis2AnalyticsDownloadPlan>;

		/**
		 * Downloads analytics data: DataSuite splits the request into chunks (each at most `maxCellsPerChunk` values)
		 * and adapts to the server -- more requests at once while it answers quickly, fewer when it struggles; a chunk
		 * the server finds too big (a timeout, DHIS2's "exceeded max limit") split in two and sent again; a passing
		 * failure (network, 502/503/504, 429) retried after a pause -- and reports each chunk as it finishes. Cancel
		 * with `token`; resume a download that stopped by passing the chunks already done in `skipChunks`. Rejects at
		 * once when the server refuses a request (a bad id, no permission), or when a passing failure persists.
		 */
		export function downloadAnalytics(connectionId: string, request: Dhis2AnalyticsDownloadRequest, options?: Dhis2AnalyticsDownloadOptions, token?: CancellationToken): Thenable<Dhis2AnalyticsDownloadResult>;
	}

	// --- Analytics downloads

	/** One value: data item, period, organisation unit. */
	export interface Dhis2AnalyticsRow {
		readonly dx: string;
		readonly pe: string;
		readonly ou: string;
		/** Absent when the server has the cell but no number for it. */
		readonly value?: number;
	}

	/** How a download runs (DataSuite's defaults when not given; each is kept within bounds). */
	export interface Dhis2DownloadSettings {
		/** The most chunks requested at once: 1 to 6. DataSuite starts with 2 and grows while the server keeps up (to 4 when not given). */
		readonly maxConcurrentChunks?: number;
		/** Values (data items x periods x organisation units) per request (default 50 000). Lower for a weak server. */
		readonly maxCellsPerChunk?: number;
		/** Times a failed chunk is tried again, waiting `retryBaseDelayMs`, then twice that, ... (default 3). */
		readonly retryAttempts?: number;
		readonly retryBaseDelayMs?: number;
		/** Per request, at most 10 minutes (default 2). */
		readonly requestTimeoutMs?: number;
	}

	export interface Dhis2AnalyticsDownloadRequest {
		/** `dx`: data elements (`uid` or `uid.cocUid`), indicators, datasets (`uid.REPORTING_RATE`, ...). */
		readonly dataItems: readonly string[];
		/** `pe`: period ids (`202601`, `2026`, `2026Q1`) or relative periods (`LAST_12_MONTHS`). */
		readonly periods: readonly string[];
		/**
		 * `ou`: organisation unit uids or keywords (`LEVEL-3`, `USER_ORGUNIT`, `OU_GROUP-<uid>`). A `LEVEL-n` keyword
		 * counts as every unit at that level when sizing the chunks; other keywords count as one.
		 */
		readonly organisationUnits: readonly string[];
		/** Chunks already downloaded (their `index`): a download resumed after it stopped. */
		readonly skipChunks?: readonly number[];
		readonly settings?: Dhis2DownloadSettings;
	}

	export interface Dhis2AnalyticsDownloadPlan {
		readonly totalChunks: number;
		/** How many organisation units the `ou` items stand for. */
		readonly organisationUnits: number;
	}

	export interface Dhis2AnalyticsChunk {
		/** Its place in the download's chunks (for `skipChunks`). */
		readonly index: number;
		readonly totalChunks: number;
		readonly rows: readonly Dhis2AnalyticsRow[];
	}

	export interface Dhis2AnalyticsProgress {
		/** Chunks done, the skipped ones included. */
		readonly completedChunks: number;
		readonly totalChunks: number;
	}

	export interface Dhis2AnalyticsDownloadOptions {
		onProgress?(progress: Dhis2AnalyticsProgress): void;
		/** Each chunk's rows as it finishes (in any order when several run at once): to save progress as it goes. */
		onChunk?(chunk: Dhis2AnalyticsChunk): void;
		/** Whether the result carries all the rows (default true; false when `onChunk` keeps them). */
		readonly keepRows?: boolean;
	}

	export interface Dhis2AnalyticsDownloadResult {
		readonly totalChunks: number;
		/** Every chunk's rows (not the skipped ones'), unless `keepRows` was false. */
		readonly rows: readonly Dhis2AnalyticsRow[];
	}

	// --- The built-in extractor's saved work, for the extension that takes its place: read once, to carry it over.
	// Only DataSuite's own extensions may read it, and only for connections given them.

	/** A mapping the built-in extractor saved: `mapping` is its definition as the extractor stored it. */
	export interface Dhis2BuiltInMapping {
		readonly id: string;
		readonly name: string;
		readonly description?: string;
		/** `countdown` or `custom`. */
		readonly mode: string;
		/** When it was last changed (milliseconds since 1970). */
		readonly updatedAt: number;
		readonly mapping: unknown;
	}

	export interface Dhis2BuiltInExtractorData {
		readonly mappings: readonly Dhis2BuiltInMapping[];
		/** The mapping being written when the extractor was last closed. */
		readonly draft?: unknown;
		/** Downloads that had not finished (as the extractor stored them). */
		readonly downloadsInProgress: readonly unknown[];
		/** Finished and failed downloads (as the extractor stored them). */
		readonly downloadsHistory: readonly unknown[];
		/** The download files among them, for {@link dhis2.builtInExtractor.readFile}. */
		readonly downloadFiles: readonly string[];
		/** The connection's download settings, when they were changed from the defaults. */
		readonly downloadSettings?: Dhis2DownloadSettings;
	}

	export namespace dhis2.builtInExtractor {

		export function readData(connectionId: string): Thenable<Dhis2BuiltInExtractorData>;

		/** A download file (`<id>.json`, or a `<id>.partial.<phase>.json` checkpoint), as text. */
		export function readFile(connectionId: string, fileName: string): Thenable<string>;
	}

	// --- Metadata: DataSuite keeps a local copy of each server's metadata (data elements, indicators, datasets,
	// groups, organisation units, category option combos), searched by name and description, shared by every
	// extension given the connection. Every call needs the connection given (see dhis2.requestAccess).

	export enum Dhis2MetadataKind {
		DataElement = 1,
		Indicator = 2,
		DataSet = 3,
		DataElementGroup = 4,
		OrganisationUnit = 5,
		CategoryOptionCombo = 6
	}

	/** Metadata reached from one item. */
	export enum Dhis2MetadataRelation {
		/** The data elements of a dataset. */
		DataSetElements = 1,
		/** The datasets a data element belongs to. */
		DataSetsOfElement = 2,
		/** The data elements of a data element group. */
		GroupElements = 3,
		/** The category option combos of a data element. */
		CategoryOptionCombos = 4,
		/** The ancestors of an organisation unit. */
		OrganisationUnitAncestors = 5,
		/** The data elements (and category option combos) an indicator's numerator and denominator use. */
		IndicatorOperands = 6
	}

	/**
	 * A metadata item as DataSuite keeps it: its `uid` and `name`, and the fields of its kind -- `code`,
	 * `displayName`, `shortName`, `description`, `lastUpdated`; data elements also `formName`, `categoryComboUid`,
	 * `categoryComboIsDefault`, `groupInfo`; indicators `numerator`, `denominator` and their descriptions; datasets
	 * `periodType`; organisation units `parentUid`, `path`, `pathNames`, `level`; an indicator's operands
	 * `dataElementUid` and `cocUid`.
	 */
	export interface Dhis2MetadataItem {
		readonly uid: string;
		readonly name: string;
		readonly [field: string]: unknown;
	}

	export interface Dhis2MetadataSearchResult {
		readonly items: Dhis2MetadataItem[];
		/** All the matches, before `limit` and `offset`. */
		readonly total: number;
	}

	export interface Dhis2MetadataSearchOptions {
		readonly limit?: number;
		readonly offset?: number;
		/** Organisation units only: only this level. */
		readonly level?: number;
	}

	export interface Dhis2MetadataStatus {
		readonly syncing: boolean;
		/** When the last sync completed (milliseconds since 1970); absent when DataSuite has no copy yet. */
		readonly lastSyncedAt?: number;
		readonly dataElements: number;
		readonly categoryOptionCombos: number;
		readonly organisationUnits: number;
		/** Why the last sync failed. */
		readonly error?: string;
	}

	export interface Dhis2OrganisationUnitLevel {
		readonly uid: string;
		readonly name: string;
		readonly level: number;
		/** Organisation units at this level. */
		readonly count: number;
	}

	export interface Dhis2OrganisationUnitColumn {
		readonly level: number;
		/** As the server names the level. */
		readonly name: string;
		/** The field of {@link Dhis2OrganisationUnitRow} holding it. */
		readonly field: string;
	}

	/** An organisation unit with the names of its ancestors (`level1_name`, `level2_name`, ...). */
	export interface Dhis2OrganisationUnitRow {
		readonly id: string;
		readonly name: string;
		readonly level: number;
		readonly [field: string]: string | number | undefined;
	}

	export interface Dhis2OrganisationUnitTable {
		/** One column per level down to the one asked for. */
		readonly columns: readonly Dhis2OrganisationUnitColumn[];
		readonly rows: readonly Dhis2OrganisationUnitRow[];
	}

	export namespace dhis2.metadata {

		export function getStatus(connectionId: string): Thenable<Dhis2MetadataStatus>;

		/** Fired when a metadata sync starts, progresses or ends. */
		export const onDidChangeStatus: Event<void>;

		/** Brings DataSuite's copy of the server's metadata up to date (all of it again when `force`). */
		export function sync(connectionId: string, options?: { readonly force?: boolean }): Thenable<void>;

		/** Searches names, codes and descriptions; organisation units also by their ancestors' names. */
		export function search(connectionId: string, kind: Dhis2MetadataKind, query: string, options?: Dhis2MetadataSearchOptions): Thenable<Dhis2MetadataSearchResult>;

		/** The items with these uids, in the order given (unknown uids are left out). */
		export function get(connectionId: string, kind: Dhis2MetadataKind, uids: readonly string[]): Thenable<Dhis2MetadataItem[]>;

		/** The items related to one: see {@link Dhis2MetadataRelation}. */
		export function getRelated(connectionId: string, relation: Dhis2MetadataRelation, uid: string): Thenable<Dhis2MetadataItem[]>;

		export function getOrganisationUnitLevels(connectionId: string): Thenable<Dhis2OrganisationUnitLevel[]>;

		/** The organisation units at `level`, or just the one whose uid is `only`. */
		export function getOrganisationUnits(connectionId: string, level: number, options?: { readonly only?: string }): Thenable<Dhis2OrganisationUnitTable>;

		/** The latest period with data for a data element or indicator, e.g. `202609`, looked up on the server. */
		export function getLastDataPeriod(connectionId: string, uid: string): Thenable<string | undefined>;

		/** The server's calendar, e.g. `gregorian` or `ethiopian`. */
		export function getCalendar(connectionId: string): Thenable<string | undefined>;
	}
}
