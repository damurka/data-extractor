/*---------------------------------------------------------------------------------------------
 *  Data Extractor: a connection's settings -- how its downloads run, what New download shows first, the files finished
 *  downloads make, and when the metadata copy is refreshed -- with their defaults and bounds.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';
import { DownloadSettings, ExtractorSettings, StoredSettings } from './shared/api';
import { ExtractorStore } from './store';

/** maxConcurrentChunks is the most DataSuite may use: it starts lower and grows while the server keeps up. */
export const DEFAULT_DOWNLOAD_SETTINGS: DownloadSettings = { maxConcurrentChunks: 4, maxCellsPerChunk: 50_000, retryAttempts: 3, retryBaseDelayMs: 2000, requestTimeoutMs: 120_000 };

export const DEFAULT_FILE_NAME = '{mapping}_{periods}_{level}';

/** Where finished downloads are saved unless the settings say otherwise: Documents/DataSuite/Downloads. */
export function defaultSaveFolder(): string {
	return path.join(os.homedir(), 'Documents', 'DataSuite', 'Downloads');
}

export function defaultSettings(): ExtractorSettings {
	return {
		...DEFAULT_DOWNLOAD_SETTINGS,
		parallelDownloads: 2,
		calendar: 'server',
		periodType: 'monthly',
		saveFolder: defaultSaveFolder(),
		openAs: 'EXCEL',
		fileName: DEFAULT_FILE_NAME,
		parentColumns: false,
		codes: false,
		metadataRefresh: 'daily'
	};
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => allowed.includes(value as T) ? value as T : fallback;
const clamp = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : fallback;

/** Settings with every value present and within its bounds; what is missing or out of them takes the default. */
export function normalizeSettings(input: StoredSettings | undefined): ExtractorSettings {
	const d = defaultSettings();
	const s = input ?? {};
	return {
		maxConcurrentChunks: clamp(s.maxConcurrentChunks, 1, 6, d.maxConcurrentChunks),
		maxCellsPerChunk: clamp(s.maxCellsPerChunk, 1_000, 500_000, d.maxCellsPerChunk),
		retryAttempts: clamp(s.retryAttempts, 0, 10, d.retryAttempts),
		retryBaseDelayMs: clamp(s.retryBaseDelayMs, 200, 60_000, d.retryBaseDelayMs),
		requestTimeoutMs: clamp(s.requestTimeoutMs, 5_000, 600_000, d.requestTimeoutMs),
		parallelDownloads: clamp(s.parallelDownloads, 1, 4, d.parallelDownloads),
		calendar: oneOf(s.calendar, ['server', 'gregorian', 'ethiopic'], d.calendar),
		periodType: oneOf(s.periodType, ['monthly', 'yearly'], d.periodType),
		saveFolder: typeof s.saveFolder === 'string' && s.saveFolder.trim() ? s.saveFolder.trim() : d.saveFolder,
		openAs: oneOf(s.openAs, ['EXCEL', 'JSON'], d.openAs),
		fileName: typeof s.fileName === 'string' && s.fileName.trim() ? s.fileName.trim() : d.fileName,
		parentColumns: s.parentColumns === true,
		codes: s.codes === true,
		metadataRefresh: oneOf(s.metadataRefresh, ['open', 'daily', 'weekly', 'manual'], d.metadataRefresh)
	};
}

export async function readSettings(store: ExtractorStore, connectionId: string): Promise<ExtractorSettings> {
	return normalizeSettings(await store.readSettings(connectionId));
}

/** Whether the metadata copy is due a refresh: by the setting, and when it was last synced. */
export function metadataRefreshDue(refresh: ExtractorSettings['metadataRefresh'], lastSyncedAt: number | undefined, now: number, opening: boolean): boolean {
	if (lastSyncedAt === undefined) {
		return refresh !== 'manual';
	}
	const age = now - lastSyncedAt;
	return refresh === 'open' ? opening : refresh === 'daily' ? age > 86_400_000 : refresh === 'weekly' ? age > 7 * 86_400_000 : false;
}
