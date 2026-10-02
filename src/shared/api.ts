/*---------------------------------------------------------------------------------------------
 *  Data Extractor: what the webview may ask of the host, and the events the host sends it. Plain data only: these
 *  cross the webview's message channel as JSON.
 *--------------------------------------------------------------------------------------------*/

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

/** The host's methods (each returns a promise; arguments and results are JSON). */
export interface ExtractorHost {
	listConnections(): Promise<Connection[]>;
	/** DataSuite's sign-in dialog: the password or token is typed there, not here. */
	signIn(): Promise<Connection | undefined>;
	requestAccess(connectionId: string): Promise<boolean>;
	/** DataSuite's own view of the connections, where the user signs out. */
	manageConnections(): Promise<void>;
	metadataStatus(connectionId: string): Promise<MetadataStatus>;
	syncMetadata(connectionId: string, force: boolean): Promise<void>;
}

/** The host's events: name -> data. */
export interface ExtractorEvents {
	/** The connections, or this extension's access to them, changed. */
	connectionsChanged: undefined;
	/** A metadata sync started, progressed or ended. */
	metadataChanged: undefined;
}
