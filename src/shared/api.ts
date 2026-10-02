/*---------------------------------------------------------------------------------------------
 *  Data Extractor: what the webview may ask of the host, and the events the host sends it. Plain data only: these
 *  cross the webview's message channel as JSON.
 *--------------------------------------------------------------------------------------------*/

import type { IAddMappingDraft, ICategoryOptionCombo, IDhis2DownloadHistoryRow, IDhis2DownloadInProgressItem, IMappingListItem, MappingMode, DownloadsFilter } from '../core/types';

export type { IAddMappingDraft, ICategoryOptionCombo, IDhis2DownloadHistoryRow, IDhis2DownloadInProgressItem, IIndicatorDraft, IIndicatorSourceDraft, IMappingListItem, MappingMode, DownloadsFilter } from '../core/types';

/** A DHIS2 connection (vscode.Dhis2Connection): which server, as whom -- never its credential. */
export interface Connection {
	readonly id: string;
	readonly serverUrl: string;
	readonly username: string;
	readonly displayName: string;
	readonly usesAccessToken: boolean;
	readonly country?: string;
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

export interface DownloadSettings {
	readonly maxConcurrentChunks: number;
	readonly maxCellsPerChunk: number;
	readonly retryAttempts: number;
	readonly retryBaseDelayMs: number;
	readonly requestTimeoutMs: number;
}

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
}

export interface DownloadsSnapshot {
	readonly inProgress: IDhis2DownloadInProgressItem[];
	readonly history: IDhis2DownloadHistoryRow[];
}

/** The host's methods (each returns a promise; arguments and results are JSON). */
export interface ExtractorHost {
	// connections (DataSuite's)
	listConnections(): Promise<Connection[]>;
	/** DataSuite's sign-in dialog: the password or token is typed there, not here. */
	signIn(): Promise<Connection | undefined>;
	requestAccess(connectionId: string): Promise<boolean>;
	/** DataSuite's own view of which extensions use which connection. */
	manageConnections(): Promise<void>;

	// metadata (DataSuite's shared copy)
	metadataStatus(connectionId: string): Promise<MetadataStatus>;
	syncMetadata(connectionId: string, force: boolean): Promise<void>;
	searchSources(connectionId: string, query: string): Promise<SourceSearchResult>;
	resolveIndicator(connectionId: string, indicatorUid: string): Promise<ResolvedElement[]>;
	categoryOptionCombos(connectionId: string, dataElementUid: string): Promise<ICategoryOptionCombo[]>;
	orgUnitLevels(connectionId: string): Promise<OrgUnitLevel[]>;
	searchOrgUnits(connectionId: string, query: string, level?: number): Promise<OrgUnitHit[]>;
	calendar(connectionId: string): Promise<string | undefined>;

	// mappings
	listMappings(connectionId: string): Promise<IMappingListItem[]>;
	getMapping(connectionId: string, mappingId: string): Promise<IAddMappingDraft | undefined>;
	createMapping(connectionId: string, draft: IAddMappingDraft): Promise<{ id: string }>;
	updateMapping(connectionId: string, mappingId: string, draft: IAddMappingDraft): Promise<void>;
	deleteMapping(connectionId: string, mappingId: string): Promise<void>;
	loadDraft(connectionId: string): Promise<IAddMappingDraft | undefined>;
	saveDraft(connectionId: string, draft: IAddMappingDraft): Promise<void>;
	clearDraft(connectionId: string): Promise<void>;
	/** Saves a mapping as JSON where the user chooses. */
	exportMapping(connectionId: string, mappingId: string): Promise<boolean>;
	/** A mapping read from a JSON file the user picks. */
	importMappingFile(): Promise<IAddMappingDraft | undefined>;
	/** Asks the user to confirm (a modal dialog). */
	confirm(message: string, detail: string | undefined, action: string): Promise<boolean>;

	// downloads
	downloads(connectionId: string, filter: DownloadsFilter, search: string): Promise<DownloadsSnapshot>;
	estimateDownload(connectionId: string, request: DownloadRequest): Promise<DownloadEstimate>;
	/** Starts (or, with `taskId`, resumes or retries) a download; resolves when it is under way. */
	startDownload(connectionId: string, request: DownloadRequest, taskId?: string): Promise<string>;
	pauseDownload(connectionId: string, taskId: string): Promise<void>;
	cancelDownload(connectionId: string, taskId: string): Promise<void>;
	deleteDownload(connectionId: string, taskId: string): Promise<void>;
	exportDownload(connectionId: string, taskId: string, format: 'EXCEL' | 'JSON', labelCalendar: 'gregorian' | 'ethiopic'): Promise<boolean>;
	/** Opens a Countdown download in the RMNCAH or Vaccination app (Countdown Analytics); `true` once the app opened it. */
	openDownloadInApp(connectionId: string, taskId: string, app: 'rmncah' | 'vaxx', labelCalendar: 'gregorian' | 'ethiopic'): Promise<boolean>;

	// settings
	downloadSettings(connectionId: string): Promise<DownloadSettings>;
	saveDownloadSettings(connectionId: string, settings: DownloadSettings): Promise<void>;
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
