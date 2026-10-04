/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the line of downloads. A few run at the same time (the settings say how many); the rest wait their
 *  turn in the order they are listed, and one starts whenever a place is free.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IDhis2DownloadInProgressItem } from './core/types';
import { DownloadConfig, DownloadRunner } from './download';
import { readSettings } from './settings';
import { ExtractorStore } from './store';

const newTaskId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const configOf = (item: IDhis2DownloadInProgressItem): DownloadConfig => ({
	mappingId: item.mappingId, mappingName: item.mappingName, mappingMode: item.mappingMode, startDate: item.startDate, endDate: item.endDate,
	periodType: item.periodType === 'yearly' ? 'yearly' : 'monthly', adminLevel: item.adminLevel, boundaryOrgUnitUid: item.boundaryOrgUnitUid
});

const waiting = (item: IDhis2DownloadInProgressItem): IDhis2DownloadInProgressItem => ({ ...item, state: 'waiting', rightText: 'Waiting', etaSeconds: undefined, pausedAt: undefined });
const paused = (item: IDhis2DownloadInProgressItem): IDhis2DownloadInProgressItem => ({ ...item, state: 'paused', rightText: 'Paused', etaSeconds: undefined, pausedAt: item.pausedAt ?? Date.now() });

export class DownloadQueue {

	/** One look at a connection's line at a time (two would start the same download twice). */
	private readonly pumping = new Map<string, Promise<void>>();

	constructor(private readonly store: ExtractorStore, private readonly runner: DownloadRunner, private readonly log: vscode.LogOutputChannel) { }

	/** Puts a download at the end of the line (with `taskId`, a paused or failed one back in it); resolves to its id. */
	async enqueue(connectionId: string, config: DownloadConfig, taskId?: string, totalRequests?: number): Promise<string> {
		const id = taskId ?? newTaskId();
		const existing = (await this.store.getSnapshot(connectionId, 'active')).inProgress.find(i => i.id === id);
		if (!this.runner.isRunning(id)) {
			await this.store.deleteFromHistory(connectionId, id);
			await this.store.upsertInProgress(connectionId, waiting({
				id, file: `${id}.json`, subtitle: `${config.startDate} to ${config.endDate}`, progressPct: existing?.progressPct ?? 0, rightText: 'Waiting', state: 'waiting',
				doneRequests: existing?.doneRequests, totalRequests: existing?.totalRequests ?? totalRequests, ...config
			}));
		}
		await this.pump(connectionId);
		return id;
	}

	/** Pauses a download: a running one after the requests under way, a waiting one where it stands. */
	async pause(connectionId: string, taskId: string): Promise<void> {
		if (this.runner.isRunning(taskId)) {
			this.runner.stop(taskId, 'pause');
			return;
		}
		await this.store.changeInProgress(connectionId, items => items.map(i => i.id === taskId ? paused(i) : i));
	}

	async cancel(connectionId: string, taskId: string): Promise<void> {
		if (this.runner.isRunning(taskId)) {
			this.runner.stop(taskId, 'cancel');
			return;
		}
		const item = (await this.store.getSnapshot(connectionId, 'active')).inProgress.find(i => i.id === taskId);
		if (item) {
			const { progressPct: _p, rightText: _r, state: _s, subtitle: _t, doneRequests: _d, totalRequests: _n, etaSeconds: _e, pausedAt: _a, ...row } = item;
			await this.store.finishToHistory(connectionId, { ...row, status: 'Failed', size: '-', error: 'Cancelled', date: new Date().toLocaleString(vscode.env?.language || 'en') });
		}
		await this.pump(connectionId);
	}

	/** Moves a waiting download one place up, past the waiting one before it. */
	async moveUp(connectionId: string, taskId: string): Promise<void> {
		await this.store.changeInProgress(connectionId, items => {
			const at = items.findIndex(i => i.id === taskId);
			if (at < 0 || items[at].state !== 'waiting') {
				return items;
			}
			let before = at - 1;
			while (before >= 0 && items[before].state !== 'waiting') {
				before--;
			}
			if (before < 0) {
				return items;
			}
			const next = [...items];
			[next[before], next[at]] = [next[at], next[before]];
			return next;
		});
	}

	/** Pauses everything: the running ones after the requests under way, the waiting ones at once. */
	async pauseAll(connectionId: string): Promise<void> {
		const { inProgress } = await this.store.getSnapshot(connectionId, 'active');
		for (const item of inProgress) {
			if (this.runner.isRunning(item.id)) {
				this.runner.stop(item.id, 'pause');
			}
		}
		await this.store.changeInProgress(connectionId, items => items.map(i => i.state === 'waiting' ? paused(i) : i));
	}

	/** Puts every paused download back in line. */
	async resumeAll(connectionId: string): Promise<void> {
		await this.store.changeInProgress(connectionId, items => items.map(i => i.state === 'paused' && !this.runner.isRunning(i.id) ? waiting(i) : i));
		await this.pump(connectionId);
	}

	/** Starts waiting downloads while places are free. */
	pump(connectionId: string): Promise<void> {
		const next = (this.pumping.get(connectionId) ?? Promise.resolve()).catch(() => undefined).then(() => this.fill(connectionId));
		this.pumping.set(connectionId, next);
		return next;
	}

	private async fill(connectionId: string): Promise<void> {
		const { parallelDownloads } = await readSettings(this.store, connectionId);
		const { inProgress } = await this.store.getSnapshot(connectionId, 'active');
		let running = inProgress.filter(i => this.runner.isRunning(i.id)).length;
		for (const item of inProgress) {
			if (running >= parallelDownloads) {
				break;
			}
			if (item.state !== 'waiting' || this.runner.isRunning(item.id)) {
				continue;
			}
			running++;
			// run() marks it as running before its first await: the next look at the line counts it
			void this.runner.run(connectionId, configOf(item), item.id)
				.catch(error => this.log.error(`Download "${item.mappingName}" stopped: ${error}`))
				.finally(() => void this.pump(connectionId));
		}
	}
}
