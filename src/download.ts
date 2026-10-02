/*---------------------------------------------------------------------------------------------
 *  Data Extractor: running a mapping's download -- through DataSuite's analytics download (vscode.dhis2.
 *  downloadAnalytics), which splits it into requests, retries them and reports each one -- and keeping its result.
 *
 *  A Countdown mapping downloads in three parts (population yearly, reporting completeness and services monthly), a
 *  custom one in one. Each part keeps a checkpoint (`<id>.partial.<part>.json`: the rows so far and the chunks they
 *  came from), so a paused download resumes where it stopped -- also one the built-in extractor left unfinished (its
 *  checkpoints say how many chunks were done in order; DataSuite plans the chunks in the same order).
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { findIndicatorCategoryMismatch, getCountdownIndicatorCategory } from './core/countdown';
import { buildDxOperands, buildTidyDownloadRows, ITidyTable } from './core/dataUtils';
import { Dhis2ExportProcessor } from './core/exportProcessor';
import { generateDhis2Periods } from './core/periods';
import { IAddMappingDraft, IDhis2AnalyticsRow, IIndicatorDraft, MappingMode } from './core/types';
import { ExtractorStore } from './store';

export interface DownloadConfig {
	readonly mappingId: string;
	readonly mappingName: string;
	readonly mappingMode: MappingMode;
	/** YYYY-MM-DD */
	readonly startDate: string;
	readonly endDate: string;
	readonly periodType: 'monthly' | 'yearly';
	/** `LEVEL-n` */
	readonly adminLevel: string;
	/** Only the organisation units at `adminLevel` under this one, instead of the whole country. */
	readonly boundaryOrgUnitUid?: string;
}

export type DownloadStatus = 'completed' | 'failed' | 'paused' | 'cancelled';

export interface DownloadOutcome {
	readonly taskId: string;
	readonly status: DownloadStatus;
	readonly error?: string;
	/** Completed: one row per organisation unit x period x export code. */
	readonly tidy?: ITidyTable;
	readonly size?: string;
}

/** What a finished download keeps (`<id>.json`): the mapping as it was, the organisation units, the data by export code. */
export interface DownloadPayload {
	readonly mappingDraft: IAddMappingDraft;
	readonly orgUnits: unknown[];
	readonly data: ReturnType<Dhis2ExportProcessor['aggregateDataByExportCode']>;
	readonly calendar?: string;
}

interface Part {
	readonly name: 'pop' | 'completeness' | 'service' | 'custom';
	readonly dataItems: string[];
	readonly periods: string[];
}

/** A part's checkpoint: its rows so far and the chunks they came from (the built-in extractor's: how many chunks, in order). */
interface Checkpoint {
	rows: IDhis2AnalyticsRow[];
	completedChunks: number[] | number;
}

export class DownloadRunner {

	/** The downloads running now, and how to stop each. */
	private readonly running = new Map<string, { source: vscode.CancellationTokenSource; stop?: 'pause' | 'cancel' }>();
	private readonly processor = new Dhis2ExportProcessor();

	constructor(private readonly store: ExtractorStore, private readonly log: vscode.LogOutputChannel) { }

	isRunning(taskId: string): boolean {
		return this.running.has(taskId);
	}

	/** Stops a running download after the requests under way: paused keeps its checkpoints to resume from. */
	stop(taskId: string, how: 'pause' | 'cancel'): void {
		const run = this.running.get(taskId);
		if (run) {
			run.stop = how;
			run.source.cancel();
		}
	}

	/** Downloads that were running when DataSuite last closed: nothing runs them now, so they are paused. */
	async reconcile(connectionId: string): Promise<void> {
		const { inProgress } = await this.store.getSnapshot(connectionId, 'active');
		for (const item of inProgress) {
			if (item.state !== 'paused' && !this.running.has(item.id)) {
				await this.store.upsertInProgress(connectionId, { ...item, state: 'paused', rightText: 'Paused' });
			}
		}
	}

	/** Runs (or resumes, with `existingTaskId`) a mapping's download. */
	async run(connectionId: string, config: DownloadConfig, existingTaskId?: string): Promise<DownloadOutcome> {
		const taskId = existingTaskId || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
		const file = `${taskId}.json`;
		const subtitle = `${config.startDate} to ${config.endDate}`;
		const row = { id: taskId, file, subtitle, ...config };
		const source = new vscode.CancellationTokenSource();
		const run: { source: vscode.CancellationTokenSource; stop?: 'pause' | 'cancel' } = { source };
		this.running.set(taskId, run);
		let progressPct = 0;

		try {
			const mapping = await this.store.getMapping(connectionId, config.mappingId);
			if (!mapping) {
				throw new Error('Mapping not found');
			}
			for (const indicator of mapping.indicators) {
				const mismatch = findIndicatorCategoryMismatch(indicator);
				if (mismatch) {
					throw new Error(mismatch);
				}
			}
			const settings = await this.store.readSettings(connectionId);

			await this.store.deleteFromHistory(connectionId, taskId);
			await this.store.upsertInProgress(connectionId, { ...row, progressPct: 0, rightText: 'Processing...', state: 'processing' });

			const calendar = await vscode.dhis2.metadata.getCalendar(connectionId);
			const organisationUnits = [config.boundaryOrgUnitUid ?? config.adminLevel];
			const parts = this.partsOf(mapping, config, calendar).filter(p => p.dataItems.length && p.periods.length);

			// The whole download's progress: every part's chunks
			const plans = await Promise.all(parts.map(p => vscode.dhis2.planAnalyticsDownload(connectionId, { dataItems: p.dataItems, periods: p.periods, organisationUnits, settings })));
			const totalChunks = plans.reduce((sum, p) => sum + p.totalChunks, 0);
			let chunksBefore = 0;

			const rows: IDhis2AnalyticsRow[] = [];
			for (const [i, part] of parts.entries()) {
				const checkpointFile = `${taskId}.partial.${part.name}.json`;
				const checkpoint = await this.loadCheckpoint(connectionId, checkpointFile);
				const done = new Set<number>(Array.isArray(checkpoint.completedChunks) ? checkpoint.completedChunks : Array.from({ length: checkpoint.completedChunks }, (_, k) => k));
				const partRows = checkpoint.rows;
				let saving = Promise.resolve();

				await vscode.dhis2.downloadAnalytics(connectionId, { dataItems: part.dataItems, periods: part.periods, organisationUnits, skipChunks: [...done], settings }, {
					keepRows: false,
					onChunk: chunk => {
						for (const r of chunk.rows) {
							partRows.push({ dx: r.dx, pe: r.pe, ou: r.ou, value: r.value ?? null });
						}
						done.add(chunk.index);
						const snapshot: Checkpoint = { rows: partRows, completedChunks: [...done] };
						saving = saving.then(() => this.store.writeFile(connectionId, checkpointFile, JSON.stringify(snapshot)));
					},
					onProgress: p => {
						const pct = totalChunks ? Math.round(((chunksBefore + p.completedChunks) / totalChunks) * 100) : 0;
						if (pct !== progressPct) {
							progressPct = pct;
							void this.store.upsertInProgress(connectionId, { ...row, progressPct: pct, rightText: `${pct}%`, state: 'downloading' });
						}
					}
				}, source.token);
				await saving;
				chunksBefore += plans[i].totalChunks;
				for (const r of partRows) {
					rows.push(r);
				}
				await this.store.deleteFile(connectionId, checkpointFile);
			}

			await this.store.upsertInProgress(connectionId, { ...row, progressPct: 100, rightText: 'Processing...', state: 'processing' });
			const level = parseInt(config.adminLevel.replace('LEVEL-', ''), 10);
			const orgUnits = (await vscode.dhis2.metadata.getOrganisationUnits(connectionId, level, { only: config.boundaryOrgUnitUid })).rows as unknown as Parameters<Dhis2ExportProcessor['aggregateDataByExportCode']>[2];
			const data = this.processor.aggregateDataByExportCode(mapping, rows, orgUnits);
			const tidy = buildTidyDownloadRows(mapping, rows, orgUnits, calendar);

			const payload: DownloadPayload = { mappingDraft: mapping, orgUnits, data, calendar };
			const text = JSON.stringify(payload, null, 2);
			await this.store.writeFile(connectionId, file, text);
			const size = `${(Buffer.byteLength(text) / 1048576).toFixed(2)} MB`;
			await this.store.finishToHistory(connectionId, { ...row, status: 'Completed', size, date: new Date().toLocaleString() });
			this.log.info(`Download "${config.mappingName}" (${subtitle}) completed: ${rows.length} values, ${size}`);
			return { taskId, status: 'completed', tidy, size };

		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (run.stop === 'pause') {
				await this.store.upsertInProgress(connectionId, { ...row, progressPct, rightText: 'Paused', state: 'paused' });
				this.log.info(`Download "${config.mappingName}" paused at ${progressPct}%`);
				return { taskId, status: 'paused' };
			}
			const cancelled = run.stop === 'cancel';
			await this.store.finishToHistory(connectionId, { ...row, status: 'Failed', size: '-', date: new Date().toLocaleString() });
			if (cancelled) {
				this.log.info(`Download "${config.mappingName}" cancelled`);
				return { taskId, status: 'cancelled', error: 'Download cancelled' };
			}
			this.log.error(`Download "${config.mappingName}" failed: ${message}`);
			void vscode.window.showErrorMessage(`Download failed for "${config.mappingName}": ${message}`);
			return { taskId, status: 'failed', error: message };
		} finally {
			this.running.delete(taskId);
			source.dispose();
		}
	}

	/** What a download would fetch, without fetching: its data items, periods, organisation units and requests. */
	async estimate(connectionId: string, config: DownloadConfig): Promise<{ dataItems: number; periods: number; firstPeriod?: string; lastPeriod?: string; organisationUnits: number; requests: number; calendar?: string }> {
		const mapping = await this.store.getMapping(connectionId, config.mappingId);
		if (!mapping) {
			throw new Error('Mapping not found');
		}
		const settings = await this.store.readSettings(connectionId);
		const calendar = await vscode.dhis2.metadata.getCalendar(connectionId);
		const organisationUnits = [config.boundaryOrgUnitUid ?? config.adminLevel];
		const parts = this.partsOf(mapping, config, calendar).filter(p => p.dataItems.length && p.periods.length);
		const plans = await Promise.all(parts.map(p => vscode.dhis2.planAnalyticsDownload(connectionId, { dataItems: p.dataItems, periods: p.periods, organisationUnits, settings })));
		// The monthly periods when there are any (Countdown's population is yearly, its other parts monthly)
		const periods = parts.find(p => p.name !== 'pop')?.periods ?? parts[0]?.periods ?? [];
		return {
			dataItems: parts.reduce((n, p) => n + p.dataItems.length, 0),
			periods: periods.length,
			firstPeriod: periods[0],
			lastPeriod: periods[periods.length - 1],
			organisationUnits: plans[0]?.organisationUnits ?? 0,
			requests: plans.reduce((n, p) => n + p.totalChunks, 0),
			calendar
		};
	}

	/** The download's parts: Countdown's three (their periods fixed by kind), or a custom mapping's one. */
	private partsOf(mapping: IAddMappingDraft, config: DownloadConfig, calendar: string | undefined): Part[] {
		if (mapping.mode !== 'countdown') {
			return [{ name: 'custom', dataItems: buildDxOperands(mapping.indicators), periods: generateDhis2Periods(config.startDate, config.endDate, config.periodType, calendar) }];
		}
		const category = (i: IIndicatorDraft) => getCountdownIndicatorCategory(i.exportCode);
		const yearly = generateDhis2Periods(config.startDate, config.endDate, 'yearly', calendar);
		const monthly = generateDhis2Periods(config.startDate, config.endDate, 'monthly', calendar);
		return [
			{ name: 'pop', dataItems: buildDxOperands(mapping.indicators.filter(i => category(i) === 'Population_data')), periods: yearly },
			{ name: 'completeness', dataItems: buildDxOperands(mapping.indicators.filter(i => category(i) === 'Reporting_completeness')), periods: monthly },
			{ name: 'service', dataItems: buildDxOperands(mapping.indicators.filter(i => category(i) !== 'Population_data' && category(i) !== 'Reporting_completeness')), periods: monthly }
		];
	}

	private async loadCheckpoint(connectionId: string, fileName: string): Promise<Checkpoint> {
		try {
			const parsed = JSON.parse(await this.store.readFile(connectionId, fileName)) as Partial<Checkpoint>;
			return { rows: Array.isArray(parsed.rows) ? parsed.rows : [], completedChunks: parsed.completedChunks ?? [] };
		} catch {
			return { rows: [], completedChunks: [] };
		}
	}
}
