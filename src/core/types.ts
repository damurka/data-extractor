/*---------------------------------------------------------------------------------------------
 *  Data Extractor: mappings, downloads and the analytics rows
 *  Ported from DataSuite (platform/dhis2/common/dhis2ProfileStorageService.ts, dhis2Metadata.ts, dhis2.ts); keep the two in step until DataSuite's built-in extractor is removed.
 *--------------------------------------------------------------------------------------------*/

export interface ICategoryOptionCombo {
	uid: string;
	name: string;
	categoryComboUid: string | null;
	checked: boolean; // Tracks if the user has included this specific disaggregation
}

export interface IIndicatorSourceDraft {
	id: string;
	sourceElement: string;
	type: string;
	includedCategoriesText: string;
	active?: boolean;
	cocs?: ICategoryOptionCombo[];
	/** Whether this source's Category Combo is DHIS2's own Default Category Combo (see CONTEXT.md, ADR-0015) -- undefined for sources saved before this field existed, or for a `DataSet` source (no single Category Combo applies). Never inferred from `cocs` names. */
	categoryComboIsDefault?: boolean;
	parentIndicatorId?: string;
	parentIndicatorName?: string;
	/** Who set this specific source -- 'ai' when a chat tool (dhis2_createMapping/dhis2_updateMapping) wrote it, 'manual' when a human picked it in the Add/Edit Mapping view. Undefined for mappings saved before this field existed. */
	origin?: 'ai' | 'manual';
}

export interface IIndicatorDraft {
	id: string;

	internalName: string;
	exportCode: string;
	kind: MappingMode;

	expanded?: boolean;

	sources: IIndicatorSourceDraft[];

	/** The server has no data for this indicator: it counts as done, and a download keeps its column, empty. */
	notAvailable?: INotAvailable;
	/** A custom mapping's sheet (of the Excel workbook) this indicator's column is on. */
	sheet?: string;
}

export type NotAvailableReason = 'notCollected' | 'noMatch' | 'other';

export interface INotAvailable {
	reason: NotAvailableReason;
	note?: string;
}

export interface IIndicatorCocDraft {
	cocUid: string;
	cocName: string;
	exportCode: string;
	include: boolean;
}

export interface IAddMappingDraft {
	name: string;
	description?: string;
	mode: MappingMode;
	indicators: IIndicatorDraft[];
	/** A custom mapping's sheets, in the workbook's order (each indicator names its own: IIndicatorDraft.sheet). */
	sheets?: string[];
}

export interface IMappingListItem {
	id: string;                 // your Mp_ANC_01 etc (or generated UID)
	name: string;
	description?: string | null;
	mode: MappingMode;
	indicatorsCount: number;
	/** Indicators with everything a download needs. */
	mappedCount?: number;
	/** Indicators marked as not available on this server. */
	notAvailableCount?: number;
	lastUpdatedAt: number;    // epoch ms
}
export type DownloadsFilter = 'all' | 'active' | 'completed' | 'failed';
/** `waiting`: in line behind the downloads running now (settings: how many run at the same time). */
export type DownloadState = 'downloading' | 'processing' | 'paused' | 'waiting';
export type DownloadStatus = 'Completed' | 'Failed';

export interface IDhis2DownloadInProgressItem {
	id: string;
	file: string;
	subtitle: string;
	progressPct: number;
	rightText: string;
	state: DownloadState;
	mappingId: string;
	mappingName: string;
	mappingMode: MappingMode;
	startDate: string;
	endDate: string;
	periodType: string;
	adminLevel: string;
	/** The sub-region org unit this download was scoped to, if any -- preserved so a restart keeps the same scoping. */
	boundaryOrgUnitUid?: string;
	/** Requests answered so far, and all of them. */
	doneRequests?: number;
	totalRequests?: number;
	/** Seconds the rest is expected to take, from how the requests answered so far went. */
	etaSeconds?: number;
	/** When it was paused (milliseconds since 1970). */
	pausedAt?: number;
}

export interface IDhis2DownloadHistoryRow {
	id: string;
	file: string;
	status: DownloadStatus;

	mappingId: string;
	mappingName: string;
	mappingMode: MappingMode;
	startDate: string;
	endDate: string;
	periodType: string;
	adminLevel: string;
	/** The sub-region org unit this download was scoped to, if any -- preserved so a restart keeps the same scoping. */
	boundaryOrgUnitUid?: string;

	date?: string;
	size?: string;
	/** Values downloaded. */
	rows?: number;
	/** When it ended (milliseconds since 1970). */
	endedAt?: number;
	/** Why it failed. */
	error?: string;
}

export interface IDhis2DownloadsSnapshot {
	inProgress: IDhis2DownloadInProgressItem[];
	history: IDhis2DownloadHistoryRow[];
}

export interface IDhis2StorageChangeEvent {
	profileId: string;
}

export interface IExcelSheetData {
	headerRow1_HiddenCodes: string[];
	headerRow2_VisibleNames: string[];
	dataRows: (string | number | null)[][];
}

export interface IExcelExportData {
	service: IExcelSheetData;
	population: IExcelSheetData;
	completeness: IExcelSheetData;
	admin: IExcelSheetData;
}

export type MappingMode = 'countdown' | 'custom';

export interface IDhis2AnalyticsRow {
	dx: string;    // Data Element or DataSet UID (+ optional COC or metric)
	pe: string;    // Period (e.g., "2026" or "202601")
	ou: string;    // Organisation Unit UID
	value: number | null; // The actual numeric value
}

export interface IOrgUnitHeader {
	level: number;
	name: string;
	column: string;
}

export interface IDhis2OrgUnitWithLevels {
	id: string;
	name: string;
	level: number;
	level1_name?: string;
	level2_name?: string;
	level3_name?: string;
	level4_name?: string;
	level5_name?: string;
	[dynamicAncestorLevel: string]: string | number | undefined;
}

export interface IOrgUnitAncestorRow {
	headers: IOrgUnitHeader[];
	rows: IDhis2OrgUnitWithLevels[];
}

export type Dhis2AnalyticsRow = string[];

export interface IDhis2AnalyticsResponse {
	headers: Array<{
		name: string;
		column: string;
		valueType: string;
		type: string;
		hidden: boolean;
		meta: boolean;
	}>;
	metaData: {
		items: Record<string, { name: string }>;
		dimensions: Record<string, string[]>;
		/** Only with hierarchyMeta=true: org unit uid -> ancestor uid path, e.g. "/ImspTQPwCqd/O6uvpzGd5pu" (excluding the org unit itself). */
		ouHierarchy?: Record<string, string>;
	};
	width?: number;
	height?: number;
	rows: Dhis2AnalyticsRow[];
}

/** A DHIS2 connection as the ported code needs it (DataSuite's IDhis2Profile, vscode.Dhis2Connection). */
export interface IDhis2Profile {
	readonly id: string;
	readonly serverUrl: string;
	readonly username: string;
	readonly displayName: string;
	readonly country?: string;
	/** Not known for a connection (DataSuite keeps it): the choice falls back to the order given. */
	readonly lastUsedAt?: number;
}
