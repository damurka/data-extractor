/*---------------------------------------------------------------------------------------------
 *  Data Extractor tests: the parts of the `vscode` module the store, the migration and the download runner use, with
 *  vscode.dhis2 a fake each test sets (see setup.ts, which makes `require('vscode')` load this).
 *--------------------------------------------------------------------------------------------*/

type Listener<T> = (e: T) => void;

export class EventEmitter<T> {
	private listeners: Listener<T>[] = [];
	readonly event = (listener: Listener<T>) => {
		this.listeners.push(listener);
		return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
	};
	fire(e: T): void {
		for (const l of this.listeners) {
			l(e);
		}
	}
	dispose(): void {
		this.listeners = [];
	}
}

export class CancellationTokenSource {
	private cancelled = false;
	private readonly emitter = new EventEmitter<void>();
	readonly token: { readonly isCancellationRequested: boolean; onCancellationRequested: EventEmitter<void>['event'] };
	constructor() {
		const isCancelled = () => this.cancelled;
		this.token = { get isCancellationRequested() { return isCancelled(); }, onCancellationRequested: this.emitter.event };
	}
	cancel(): void {
		this.cancelled = true;
		this.emitter.fire();
	}
	dispose(): void {
		this.emitter.dispose();
	}
}

/** Error messages shown, for tests to read. */
export const shownErrors: string[] = [];

export const window = {
	showErrorMessage: (message: string) => { shownErrors.push(message); return Promise.resolve(undefined); }
};

/** The fake DHIS2 API: a test assigns what it needs. */
export const dhis2: Record<string, unknown> = {};

export function setDhis2(api: Record<string, unknown>): void {
	for (const key of Object.keys(dhis2)) {
		delete dhis2[key];
	}
	Object.assign(dhis2, api);
}

/** A log channel that keeps its lines. */
export function testLog() {
	const lines: string[] = [];
	const add = (level: string) => (message: string) => { lines.push(`${level} ${message}`); };
	return { lines, info: add('info'), warn: add('warn'), error: add('error'), trace: add('trace'), debug: add('debug') };
}
