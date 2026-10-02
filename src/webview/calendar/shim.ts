/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the few pieces of VS Code's base layer that the calendar range picker (calendarRangePicker.ts,
 *  copied from DataSuite's base/browser/ui/calendar) uses -- DOM helpers, events, disposables, codicons, Intl --
 *  so the picker is copied unchanged.
 *--------------------------------------------------------------------------------------------*/

export { localize } from '../../core/l10n';
export type CalendarMode = 'gregorian' | 'ethiopic';

export interface IDisposable {
	dispose(): void;
}

export class DisposableStore implements IDisposable {
	private readonly items = new Set<IDisposable>();
	add<T extends IDisposable>(item: T): T {
		this.items.add(item);
		return item;
	}
	clear(): void {
		for (const item of this.items) {
			item.dispose();
		}
		this.items.clear();
	}
	dispose(): void {
		this.clear();
	}
}

export type Event<T> = (listener: (e: T) => unknown) => IDisposable;

export class Emitter<T> implements IDisposable {
	private readonly listeners = new Set<(e: T) => unknown>();
	readonly event: Event<T> = listener => {
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	};
	fire(e: T): void {
		for (const listener of [...this.listeners]) {
			listener(e);
		}
	}
	dispose(): void {
		this.listeners.clear();
	}
}

export abstract class Widget implements IDisposable {
	private readonly store = new DisposableStore();
	protected _register<T extends IDisposable>(item: T): T {
		return this.store.add(item);
	}
	protected onclick(node: HTMLElement, listener: (e: MouseEvent) => void): void {
		this._register(addDisposableListener(node, EventType.CLICK, listener));
	}
	dispose(): void {
		this.store.dispose();
	}
}

export const EventType = { CLICK: 'click', MOUSE_DOWN: 'mousedown', KEY_DOWN: 'keydown' } as const;

export function addDisposableListener<K extends keyof HTMLElementEventMap>(node: EventTarget, type: K | string, handler: (e: HTMLElementEventMap[K]) => void, useCapture?: boolean): IDisposable {
	node.addEventListener(type, handler as EventListener, useCapture);
	return { dispose: () => node.removeEventListener(type, handler as EventListener, useCapture) };
}

export function getWindow(_node?: Node | null): Window & typeof globalThis {
	return window;
}

export function clearNode(node: HTMLElement): void {
	while (node.firstChild) {
		node.firstChild.remove();
	}
}

export function append<T extends Node>(parent: HTMLElement, ...children: T[]): T {
	for (const child of children) {
		parent.appendChild(child);
	}
	return children[children.length - 1];
}

/** `$('div.a.b#id', { attr: 'v' }, 'text', node)`, as VS Code's dom.ts. */
export function $<T extends HTMLElement = HTMLElement>(description: string, attrs?: Record<string, unknown>, ...children: (Node | string)[]): T {
	const match = /^([\w-]+)?(#[\w-]+)?((?:\.[\w-]+)*)$/.exec(description);
	if (!match) {
		throw new Error(`Bad element description: ${description}`);
	}
	const el = document.createElement(match[1] || 'div') as T;
	if (match[2]) {
		el.id = match[2].slice(1);
	}
	if (match[3]) {
		el.className = match[3].replace(/\./g, ' ').trim();
	}
	for (const [name, value] of Object.entries(attrs ?? {})) {
		if (value === undefined || value === null || value === false) {
			continue;
		}
		if (name === 'style' && typeof value === 'string') {
			el.style.cssText = value;
		} else if (/^on[A-Z]/.test(name) && typeof value === 'function') {
			el.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
		} else {
			el.setAttribute(name, value === true ? '' : String(value));
		}
	}
	for (const child of children) {
		el.append(child);
	}
	return el;
}

/** Codicon.chevronDown -> { id: 'chevron-down' }. */
export const Codicon = new Proxy({}, {
	get: (_target, name: string) => ({ id: name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`) })
}) as Record<string, { id: string }>;

export const ThemeIcon = {
	asClassNameArray: (icon: { id: string }) => ['codicon', `codicon-${icon.id}`],
	asClassName: (icon: { id: string }) => `codicon codicon-${icon.id}`
};

class Lazy<T> {
	private made = false;
	private _value: T | undefined;
	constructor(private readonly make: () => T) { }
	get value(): T {
		if (!this.made) {
			this._value = this.make();
			this.made = true;
		}
		return this._value as T;
	}
}

export const safeIntl = {
	DateTimeFormat(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions): Lazy<Intl.DateTimeFormat> {
		return new Lazy(() => {
			try {
				return new Intl.DateTimeFormat(locales, options);
			} catch {
				return new Intl.DateTimeFormat(undefined, options);
			}
		});
	}
};
