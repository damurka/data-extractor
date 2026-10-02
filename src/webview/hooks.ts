/*---------------------------------------------------------------------------------------------
 *  Data Extractor: hooks for the screens -- the host, data loaded from it (and reloaded on its events), errors.
 *--------------------------------------------------------------------------------------------*/

import { DependencyList, useCallback, useEffect, useRef, useState } from 'react';
import { ExtractorEvents, ExtractorHost } from '../shared/api';
import { hostProxy, onHostEvent } from './rpc';

export const host = hostProxy<ExtractorHost>();

export interface Loaded<T> {
	readonly value: T | undefined;
	readonly error: string | undefined;
	readonly loading: boolean;
	reload(): void;
}

/**
 * `load()`'s result, loaded again when `deps` change and when the host fires one of `events` (for the connection
 * `connectionId`, when the event names one).
 */
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList, events: (keyof ExtractorEvents)[] = [], connectionId?: string): Loaded<T> {
	const [value, setValue] = useState<T>();
	const [error, setError] = useState<string>();
	const [loading, setLoading] = useState(true);
	const generation = useRef(0);

	// eslint-disable-next-line react-hooks/exhaustive-deps
	const run = useCallback(() => {
		const mine = ++generation.current;
		setLoading(true);
		load().then(
			v => { if (mine === generation.current) { setValue(v); setError(undefined); setLoading(false); } },
			(e: Error) => { if (mine === generation.current) { setError(e.message); setLoading(false); } }
		);
	}, deps);

	useEffect(() => {
		run();
		const offs = events.map(name => onHostEvent<unknown>(name, data => {
			if (connectionId === undefined || data === undefined || data === connectionId) {
				run();
			}
		}));
		return () => offs.forEach(off => off());
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [run, connectionId]);

	return { value, error, loading, reload: run };
}

/** Runs an action, keeping its error to show (and whether it is running). */
export function useAction(): [(action: () => Promise<unknown>) => Promise<void>, string | undefined, boolean, () => void] {
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const run = useCallback(async (action: () => Promise<unknown>) => {
		setBusy(true);
		setError(undefined);
		try {
			await action();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}, []);
	return [run, error, busy, () => setError(undefined)];
}

/** "3 minutes ago", "2 days ago". */
export function fromNow(time: number | undefined): string {
	if (!time) {
		return '-';
	}
	const seconds = Math.round((Date.now() - time) / 1000);
	const units: [number, string][] = [[60, 'second'], [60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']];
	let value = seconds;
	for (const [size, unit] of units) {
		if (Math.abs(value) < size) {
			return value <= 1 && unit === 'second' ? 'just now' : `${value} ${unit}${value === 1 ? '' : 's'} ago`;
		}
		value = Math.round(value / size);
	}
	return '-';
}
