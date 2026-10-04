/*---------------------------------------------------------------------------------------------
 *  Data Extractor: what the webview may ask of the host, and the events the host sends it. Plain data only: these
 *  cross the webview's message channel as JSON.
 *--------------------------------------------------------------------------------------------*/

import type { IAddMappingDraft, ICategoryOptionCombo, IDhis2DownloadHistoryRow, IDhis2DownloadInProgressItem, IMappingListItem, MappingMode, DownloadsFilter } from '../core/types';

export type { IAddMappingDraft, ICategoryOptionCombo, IDhis2DownloadHistoryRow, IDhis2DownloadInProgressItem, IIndicatorDraft, IIndicatorSourceDraft, IMappingListItem, INotAvailable, MappingMode, NotAvailableReason, DownloadsFilter } from '../core/types';

/** A DHIS2 connection (vscode.Dhis2Connection): which server, as whom -- never its credential. */
export interface Connection {
	readonly id: string;
	readonly serverUrl: string;
	readonly username: string;
	readonly displayName: string;
	readonly usesAccessToken: boolean;
	readonly country?: string;
	/** The server's DHIS2 version when signing in, e.g. `2.40.4`. */
	readonly dhis2Version?: string;
	/** Whether this extension may read through it. */
	readonly granted: boolean;
}

export interface MetadataStatus {
	readonly syncing: boolean;
	readonly lastSyncedAt?: number;
	readonly dataElements: number;
	readonly categoryOptionCombos: number;
	readonly organisationUnits: number;
	readonly error?: string;
}

/** What DataSuite's copy of the server's metadata holds, for the overview. */
export interface ServerInfo {
	readonly calendar?: string;
	readonly dataElements: number;
	/** Absent when the copy could not be counted. */
	readonly indicators?: number;
	readonly dataSets?: number;
	readonly organisationUnits: number;
	readonly levels: number;
}

/** A request sent to the server to see that it answers. */
export interface ConnectionTest {
	readonly ok: boolean;
	/** How long the server took to answer. */
	readonly ms: number;
	readonly version?: string;
	readonly error?: string;
	/** The server answered that the sign-in is not accepted (any more): only signing in again in DataSuite helps. */
	readonly unauthorized?: boolean;
}

/** What the extractor remembers across connections: which were used when, and whether to open the last one straight away. */
export interface Preferences {
	readonly openLastUsed: boolean;
	/** When each connection was last opened here (milliseconds since 1970), by its id. */
	readonly lastUsed: { readonly [connectionId: string]: number };
}

/** A search hit for an indicator's source. */
export interface SourceHit {
	readonly uid: string;
	readonly name: string;
	readonly code?: string;
	readonly type: 'Data Element' | 'Indicator' | 'DataSet';
	/** Data elements: whether they have no real disaggregation (DHIS2's default category combo). */
	readonly categoryComboIsDefault?: boolean;
	/** Indicators: how many data elements their formula uses. */
	readonly elementCount?: number;
}

export interface SourceSearchResult {
	readonly dataElements: SourceHit[];
	readonly indicators: SourceHit[];
	readonly dataSets: SourceHit[];
}

/** The sources an indicator stands for: one per data element its formula uses, with the category option combos it names checked. */
export interface ResolvedElement {
	readonly uid: string;
	readonly name: string;
	readonly categoryComboIsDefault: boolean;
	readonly cocs: ICategoryOptionCombo[];
}

export interface OrgUnitLevel {
	readonly level: number;
	readonly name: string;
	readonly count: number;
}

export interface OrgUnitHit {
	readonly uid: string;
	readonly name: string;
	readonly level?: number;
	readonly pathNames?: string;
}

/** How DataSuite runs a download's requests. */
export interface DownloadSettings {
	readonly maxConcurrentChunks: number;
	readonly maxCellsPerChunk: number;
	readonly retryAttempts: number;
	readonly retryBaseDelayMs: number;
	readonly requestTimeoutMs: number;
}

/** A connection's settings: how its downloads run, what New download shows first, and the files finished ones make. */
export interface ExtractorSettings extends DownloadSettings {
	/** Downloads that run at the same time; the rest wait their turn. */
	readonly parallelDownloads: number;
	/** The calendar periods are picked and labelled in: the server's own, or one named. */
	readonly calendar: 'server' | 'gregorian' | 'ethiopic';
	/** What a custom range picks by, to begin with. */
	readonly periodType: 'monthly' | 'yearly';
	/** Where finished downloads are saved when they are opened. */
	readonly saveFolder: string;
	/** What Open makes of a download with no analysis app to open it in. */
	readonly openAs: 'EXCEL' | 'JSON';
	/** The saved file's name: `{mapping}`, `{periods}`, `{level}` and `{date}` are filled in. */
	readonly fileName: string;
	/** A custom mapping's workbook: columns for the organisation units above each unit. */
	readonly parentColumns: boolean;
	/** A custom mapping's workbook: a column with each organisation unit's DHIS2 id. */
	readonly codes: boolean;
	/** When DataSuite's copy of the metadata is brought up to date by itself. */
	readonly metadataRefresh: 'open' | 'daily' | 'weekly' | 'manual';
}

/** The settings as they are kept: only what was changed from the defaults need be there. */
export type StoredSettings = { readonly [K in keyof ExtractorSettings]?: ExtractorSettings[K] };

export const FILE_NAME_TOKENS = ['{mapping}', '{periods}', '{level}', '{date}'] as const;

export interface DownloadRequest {
	readonly mappingId: string;
	readonly startDate: string;
	readonly endDate: string;
	readonly periodType: 'monthly' | 'yearly';
	readonly adminLevel: string;
	readonly boundaryOrgUnitUid?: string;
}

export interface DownloadEstimate {
	readonly dataItems: number;
	readonly periods: number;
	readonly firstPeriod?: string;
	readonly lastPeriod?: string;
	readonly organisationUnits: number;
	readonly requests: number;
	readonly calendar?: string;
	/** The mapping's incomplete indicators, which the download leaves out. */
	readonly leftOut?: readonly string[];
}

export interface DownloadsSnapshot {
	readonly inProgress: IDhis2DownloadInProgressItem[];
	readonly history: IDhis2DownloadHistoryRow[];
}

/** A mapping file read for importing, checked against this server before anything is changed. */
export interface ImportReview {
	readonly fileName: string;
	readonly sizeBytes: number;
	/** The mapping as it would be imported: sources this server lacks taken out. */
	readonly draft: IAddMappingDraft;
	readonly indicators: number;
	/** Indicators whose sources are all on this server. */
	readonly matched: number;
	readonly notAvailable: number;
	/** Sources the file names that this server does not have. */
	readonly missingSources: readonly { readonly indicator: string; readonly source: string }[];
	/** The mapping here with the same name, when there is one. */
	readonly existing?: { readonly id: string; readonly name: string };
}

/** The host's methods (each returns a promise; arguments and results are JSON). */
export interface ExtractorHost {
	// connections (DataSuite's)
	listConnections(): Promise<Connection[]>;
	/** DataSuite's sign-in dialog (on `serverUrl`, to sign in to it again): the password or token is typed there, not here. */
	signIn(serverUrl?: string): Promise<Connection | undefined>;
	/** DataSuite's sign-out: it asks which server, and forgets its password or token. */
	signOut(): Promise<void>;
	requestAccess(connectionId: string): Promise<boolean>;
	/** DataSuite's own view of which extensions use which connection. */
	manageConnections(): Promise<void>;
	/** Asks the server who is signed in, to see that it answers. */
	testConnection(connectionId: string): Promise<ConnectionTest>;
	preferences(): Promise<Preferences>;
	setOpenLastUsed(value: boolean): Promise<void>;
	/** Notes that a connection was opened here, now. */
	connectionUsed(connectionId: string): Promise<void>;

	// metadata (DataSuite's shared copy)
	metadataStatus(connectionId: string): Promise<MetadataStatus>;
	syncMetadata(connectionId: string, force: boolean): Promise<void>;
	serverInfo(connectionId: string): Promise<ServerInfo>;
	searchSources(connectionId: string, query: string): Promise<SourceSearchResult>;
	resolveIndicator(connectionId: string, indicatorUid: string): Promise<ResolvedElement[]>;
	categoryOptionCombos(connectionId: string, dataElementUid: string): Promise<ICategoryOptionCombo[]>;
	orgUnitLevels(connectionId: string): Promise<OrgUnitLevel[]>;
	searchOrgUnits(connectionId: string, query: string, level?: number): Promise<OrgUnitHit[]>;
	calendar(connectionId: string): Promise<string | undefined>;
	/** The data set each data element is collected in (its first, by name), by the element's uid. */
	dataSetsOfElements(connectionId: string, uids: readonly string[]): Promise<Record<string, string>>;

	// mappings
	listMappings(connectionId: string): Promise<IMappingListItem[]>;
	getMapping(connectionId: string, mappingId: string): Promise<IAddMappingDraft | undefined>;
	createMapping(connectionId: string, draft: IAddMappingDraft): Promise<{ id: string }>;
	updateMapping(connectionId: string, mappingId: string, draft: IAddMappingDraft): Promise<void>;
	deleteMapping(connectionId: string, mappingId: string): Promise<void>;
	/** A copy of a mapping, named after it. */
	duplicateMapping(connectionId: string, mappingId: string): Promise<{ id: string }>;
	/** A mapping left unsaved by an earlier version (which kept a draft as it was written). */
	loadDraft(connectionId: string): Promise<IAddMappingDraft | undefined>;
	clearDraft(connectionId: string): Promise<void>;
	/** Saves a mapping as JSON where the user chooses. */
	exportMapping(connectionId: string, mappingId: string): Promise<boolean>;
	/** A mapping file the user picks, checked against this server; `undefined` when they cancel. */
	pickImportFile(connectionId: string): Promise<ImportReview | undefined>;
	/** Imports a reviewed mapping: as a new one called `name`, or over the mapping `replaceId`. */
	importMapping(connectionId: string, draft: IAddMappingDraft, name: string, replaceId?: string): Promise<{ id: string }>;
	/** Asks the user to confirm (a modal dialog). */
	confirm(message: string, detail: string | undefined, action: string): Promise<boolean>;

	// downloads
	downloads(connectionId: string, filter: DownloadsFilter, search: string): Promise<DownloadsSnapshot>;
	estimateDownload(connectionId: string, request: DownloadRequest): Promise<DownloadEstimate>;
	/** Puts a download in line (or, with `taskId`, a paused or failed one back in it); it starts when its turn comes. */
	startDownload(connectionId: string, request: DownloadRequest, taskId?: string): Promise<string>;
	pauseDownload(connectionId: string, taskId: string): Promise<void>;
	cancelDownload(connectionId: string, taskId: string): Promise<void>;
	/** Moves a waiting download one place up the line. */
	moveDownloadUp(connectionId: string, taskId: string): Promise<void>;
	pauseAllDownloads(connectionId: string): Promise<void>;
	resumeAllDownloads(connectionId: string): Promise<void>;
	deleteDownload(connectionId: string, taskId: string): Promise<void>;
	/** Saves a finished download in the folder of the settings (as Excel or JSON) and opens it. */
	openDownload(connectionId: string, taskId: string, format: 'EXCEL' | 'JSON'): Promise<boolean>;
	/** Saves a finished download in the folder of the settings and shows it there. */
	showDownloadInFolder(connectionId: string, taskId: string): Promise<boolean>;
	/** Opens a Countdown download in the RMNCAH or Vaccination app (Countdown Analytics); `true` once the app opened it. */
	openDownloadInApp(connectionId: string, taskId: string, app: 'rmncah' | 'vaxx'): Promise<boolean>;
	/** Whether the Countdown analysis apps (the Countdown Analytics extension) are installed. */
	analysisApps(): Promise<{ readonly installed: boolean }>;
	/** Shows the Countdown Analytics extension, to install it. */
	showAnalysisApps(): Promise<void>;

	// settings
	settings(connectionId: string): Promise<ExtractorSettings>;
	saveSettings(connectionId: string, settings: ExtractorSettings): Promise<ExtractorSettings>;
	/** Asks for the folder finished downloads are saved in; `undefined` when the user cancels. */
	chooseSaveFolder(connectionId: string): Promise<string | undefined>;
}

/** The host's events: name -> data. */
export interface ExtractorEvents {
	/** The connections, or this extension's access to them, changed. */
	connectionsChanged: undefined;
	/** A metadata sync started, progressed or ended. */
	metadataChanged: undefined;
	/** A connection's mappings or draft changed. */
	mappingsChanged: string;
	/** A connection's downloads changed. */
	downloadsChanged: string;
}

export const MAPPING_MODES: readonly MappingMode[] = ['countdown', 'custom'];
