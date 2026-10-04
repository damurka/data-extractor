/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the pieces the screens share -- icons, buttons, cards, tabs, menus, dialogs, form controls -- drawn
 *  with app.css.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, useEffect, useRef, useState } from 'react';

const ICONS: Record<string, ReactNode> = {
	overview: <path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" />,
	mappings: <path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" />,
	download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
	upload: <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />,
	settings: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4" />,
	sync: <path d="M20 11a8 8 0 0 0-14.9-4M4 5v4h4M4 13a8 8 0 0 0 14.9 4M20 19v-4h-4" />,
	database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
	'chevron-right': <path d="M9 6l6 6-6 6" />,
	'chevron-left': <path d="M15 6l-6 6 6 6" />,
	'chevron-down': <path d="M6 9l6 6 6-6" />,
	plus: <path d="M12 5v14M5 12h14" />,
	close: <path d="M6 6l12 12M18 6L6 18" />,
	check: <path d="M5 12l5 5 9-10" />,
	'check-circle': <><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>,
	pause: <path d="M9 5v14M15 5v14" />,
	play: <path d="M8 5l11 7-11 7z" fill="currentColor" stroke="none" />,
	up: <path d="M12 19V5M6 11l6-6 6 6" />,
	search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
	lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
	pencil: <path d="M4 20h4L19 9l-4-4L4 16v4z" />,
	dots: <><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" /></>,
	grip: <>{[6, 12, 18].flatMap(y => [9, 15].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="currentColor" stroke="none" />))}</>,
	share: <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14" />,
	copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
	trash: <path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" />,
	file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
	folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
	warning: <path d="M12 8v5M12 16h.01M10.3 4.3L2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />,
	info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
	na: <><circle cx="12" cy="12" r="8" /><path d="M6.5 17.5l11-11" /></>,
	missing: <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />,
	calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
	sheet: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M4 15h16M10 10v10" /></>,
	retry: <path d="M20 11a8 8 0 1 0-2.3 6.7M20 5v6h-6" />,
	exit: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10" />,
	'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
	shield: <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" />
};

export function Icon({ name, size = 16, stroke = 2, className }: { name: string; size?: number; stroke?: number; className?: string }) {
	return (
		<svg className={`dx-icon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
			strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>
	);
}

type Variant = 'default' | 'primary' | 'soft' | 'inverse' | 'danger' | 'danger-solid' | 'dashed' | 'warn' | 'outline';

export function Button({ label, icon, iconAfter, variant = 'default', size, onClick, disabled, title, block, type = 'button', expanded, haspopup }: {
	label: string; icon?: string; iconAfter?: string; variant?: Variant; size?: 'sm' | 'md' | 'lg'; onClick?: () => void; disabled?: boolean; title?: string; block?: boolean;
	type?: 'button' | 'submit'; expanded?: boolean; haspopup?: 'menu' | 'dialog';
}) {
	return (
		<button type={type} className={`dx-btn${variant === 'default' ? '' : ` dx-btn--${variant}`}${size ? ` dx-btn--${size}` : ''}${block ? ' dx-btn--block' : ''}`}
			onClick={onClick} disabled={disabled} title={title} aria-expanded={expanded} aria-haspopup={haspopup}>
			{icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}{label}{iconAfter && <Icon name={iconAfter} size={16} stroke={2.2} />}
		</button>
	);
}

export function IconButton({ icon, label, onClick, disabled, size, tone, expanded, haspopup }: {
	icon: string; label: string; onClick?: () => void; disabled?: boolean; size?: 'sm'; tone?: 'bare' | 'quiet' | 'warn' | 'danger'; expanded?: boolean; haspopup?: 'menu';
}) {
	return (
		<button type="button" className={`dx-iconbtn${size ? ' dx-iconbtn--sm' : ''}${tone ? ` dx-iconbtn--${tone}` : ''}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}
			aria-expanded={expanded} aria-haspopup={haspopup}>
			<Icon name={icon} size={size ? 15 : 16} />
		</button>
	);
}

export function PageHead({ kicker, title, children }: { kicker?: ReactNode; title: ReactNode; children?: ReactNode }) {
	return (
		<header className="dx-head">
			<div>
				{kicker && <div className="dx-head__kicker">{kicker}</div>}
				<h1>{title}</h1>
			</div>
			{children && <div className="dx-head__actions">{children}</div>}
		</header>
	);
}

/** An action's error, with a way to put it away. */
export function ErrorLine({ error, onDismiss }: { error?: string; onDismiss?: () => void }) {
	if (!error) {
		return null;
	}
	return (
		<div className="dx-banner dx-banner--bad" role="alert">
			<Icon name="warning" />
			<span className="dx-grow">{error}</span>
			{onDismiss && <IconButton icon="close" label="Dismiss" size="sm" tone="bare" onClick={onDismiss} />}
		</div>
	);
}

export function Banner({ tone, icon, children }: { tone: 'ok' | 'warn' | 'bad'; icon?: string; children: ReactNode }) {
	return <div className={`dx-banner dx-banner--${tone}`}>{icon && <Icon name={icon} />}<span className="dx-grow">{children}</span></div>;
}

export function Card({ title, label, tools, children, clip = true, id }: { title?: string; label?: string; tools?: ReactNode; children: ReactNode; clip?: boolean; id?: string }) {
	return (
		<section id={id} className={`dx-card${clip ? ' dx-card--clip' : ''}`} aria-label={label ?? title}>
			{title && <div className="dx-card__head"><h2>{title}</h2>{tools}</div>}
			{children}
		</section>
	);
}

/** A choice of one among a few, as buttons side by side. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; label: string }) {
	return (
		<div className="dx-seg" role="radiogroup" aria-label={label}>
			{options.map(o => <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
		</div>
	);
}

/** Tabs that filter a list, each with how many it holds. */
export function Tabs<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: string; count?: number }[]; onChange: (value: T) => void; label: string }) {
	return (
		<div className="dx-tabs" role="tablist" aria-label={label}>
			{options.map(o => <button key={o.value} type="button" role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}>{o.label}{o.count !== undefined ? ` ${o.count}` : ''}</button>)}
		</div>
	);
}

export function SearchBox({ value, placeholder, onChange, tight, label }: { value: string; placeholder: string; onChange: (value: string) => void; tight?: boolean; label?: string }) {
	return (
		<label className={`dx-search${tight ? ' dx-search--tight' : ''}`}>
			<Icon name="search" />
			<input type="search" aria-label={label ?? placeholder} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
		</label>
	);
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
	return <button type="button" role="switch" className="dx-switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button>;
}

export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (value: number) => void; label: string }) {
	return (
		<div className="dx-stepper">
			<button type="button" aria-label={`Less: ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
			<span aria-label={label}>{value}</span>
			<button type="button" aria-label={`More: ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
		</div>
	);
}

/** A row of the settings: what it is on the left, its control on the right. */
export function Setting({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
	return (
		<div className="dx-setting">
			<div className="dx-grow"><div className="dx-setting__title">{title}</div>{hint && <div className="dx-setting__hint">{hint}</div>}</div>
			{children}
		</div>
	);
}

export function Field({ label, hint, bad, strong, children }: { label: ReactNode; hint?: ReactNode; bad?: boolean; strong?: boolean; children: ReactNode }) {
	return (
		<label className="dx-field">
			<span className={strong ? 'dx-field__label--strong' : undefined}>{label}</span>
			{children}
			{hint && <span className={`dx-field__hint${bad ? ' dx-field__hint--bad' : ''}`}>{hint}</span>}
		</label>
	);
}

/** One of a few choices, each with a line saying what it means. */
export function Choices<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: readonly { value: T; label: string; detail: string }[]; onChange: (value: T) => void }) {
	return (
		<>
			{options.map(o => (
				<label key={o.value} className={`dx-choice${o.value === value ? ' dx-choice--on' : ''}`}>
					<input type="radio" name={name} checked={o.value === value} onChange={() => onChange(o.value)} />
					<span><span className="dx-choice__label">{o.label}</span><span className="dx-choice__detail">{o.detail}</span></span>
				</label>
			))}
		</>
	);
}

/** Closes something open when a click lands outside it or Escape is pressed. */
function useDismiss(open: boolean, close: () => void) {
	const root = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) {
			return;
		}
		const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) { close(); } };
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); } };
		document.addEventListener('mousedown', onDown);
		document.addEventListener('keydown', onKey);
		return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);
	return root;
}

/** A menu under its button: `trigger` draws the button, `children` the items (given a way to close the menu). */
export function Menu({ trigger, children, wide, label }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; wide?: boolean; label?: string }) {
	const [open, setOpen] = useState(false);
	const root = useDismiss(open, () => setOpen(false));
	return (
		<div className="dx-menu" ref={root}>
			{trigger(open, () => setOpen(!open))}
			{open && <div className={`dx-menu__list${wide ? ' dx-menu__list--wide' : ''}`} role="menu" aria-label={label}>{children(() => setOpen(false))}</div>}
		</div>
	);
}

export function MenuItem({ icon, label, detail, onClick, danger, disabled, lead }: { icon?: string; label: string; detail?: string; onClick?: () => void; danger?: boolean; disabled?: boolean; lead?: ReactNode }) {
	return (
		<button type="button" role="menuitem" className={`dx-menu__item${danger ? ' dx-menu__item--danger' : ''}`} onClick={onClick} disabled={disabled}>
			{lead}{icon && <Icon name={icon} size={15} />}
			<span>{label}{detail && <small>{detail}</small>}</span>
		</button>
	);
}

/** A popover under a field (the month picker): closes on a click outside or Escape. */
export function Popover({ open, close, children, className }: { open: boolean; close: () => void; children: ReactNode; className?: string }) {
	const root = useDismiss(open, close);
	return <div className={className} ref={root}>{children}</div>;
}

export function Dialog({ title, kicker, sub, children, footer, onClose, wide, splitFooter }: {
	title: string; kicker?: string; sub?: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean; splitFooter?: boolean;
}) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); } };
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [onClose]);
	return (
		<div className="dx-overlay" onMouseDown={e => { if (e.target === e.currentTarget) { onClose(); } }}>
			<div className={`dx-dialog${wide ? ' dx-dialog--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
				<div className="dx-dialog__head">
					<div>
						{kicker && <div className="dx-eyebrow">{kicker}</div>}
						<h2>{title}</h2>
						{sub && <p>{sub}</p>}
					</div>
					<IconButton icon="close" label="Close" tone="quiet" onClick={onClose} />
				</div>
				<div className="dx-dialog__body">{children}</div>
				{footer && <div className={`dx-dialog__foot${splitFooter ? ' dx-dialog__foot--split' : ''}`}>{footer}</div>}
			</div>
		</div>
	);
}

/** How far along something is. */
export function Bar({ pct, warn, thin }: { pct: number; warn?: boolean; thin?: boolean }) {
	return <div className={`dx-bar${warn ? ' dx-bar--warn' : ''}${thin ? ' dx-bar--thin' : ''}`}><span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>;
}

export function KindBadge({ mode }: { mode: 'countdown' | 'custom' }) {
	return mode === 'countdown'
		? <span className="dx-badge dx-badge--accent"><Icon name="lock" size={12} stroke={2.2} />Countdown</span>
		: <span className="dx-badge dx-badge--info"><Icon name="pencil" size={12} stroke={2.2} />Custom</span>;
}
