/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the Countdown apps' components (@quire/components) in this webview. They tell their host what
 *  happened (a click is an input value, as in Shiny); here that goes to the React handler registered under the
 *  component's id, never to Shiny.
 *--------------------------------------------------------------------------------------------*/

import { setLang, setUiHost } from '@quire/components';
import { useEffect, useRef } from 'react';

const handlers = new Map<string, (value: unknown) => void>();

setUiHost({
	setInputValue: (id, value) => handlers.get(id)?.(value),
	// the components listen for a few host messages (the language, a file input reset); this host sends none
	onMessage: () => { }
});
setLang('en');

/** Calls `handler` when the component with `id` reports a value (a CdButton's click, EmptyState's `${id}_action`). */
export function useComponentEvent(id: string, handler: ((value: unknown) => void) | undefined): void {
	const latest = useRef(handler);
	latest.current = handler;
	useEffect(() => {
		handlers.set(id, value => latest.current?.(value));
		return () => { handlers.delete(id); };
	}, [id]);
}
