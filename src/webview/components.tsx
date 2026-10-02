/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the pieces the screens share, in the Countdown apps' look -- their components (@quire/components:
 *  CdButton, StatusBanner, EmptyState, ...) and their stylesheet's classes (cd-ui.css: cd-page-header, cd-card,
 *  cd-hdr-btn, cd-search, cd-input), with the few the apps have no equivalent of (a stat tile, a table) in
 *  styles.css on the same tokens.
 *--------------------------------------------------------------------------------------------*/

import { CdButton, EmptyState as CdEmptyState, IconSearch, StatusBanner } from '@quire/components';
import { ReactNode, useId } from 'react';
import { useComponentEvent } from './host';

/** A Font Awesome icon's classes, as the apps' components take them: `fa('plus')` is "fa-solid fa-plus". */
export const fa = (name: string, style: 'solid' | 'regular' = 'solid') => `fa-${style} fa-${name}`;

/** A Font Awesome icon: `<Icon name="rotate" />`. */
export function Icon({ name, className, regular }: { name: string; className?: string; regular?: boolean }) {
	return <i className={`${fa(name, regular ? 'regular' : 'solid')}${className ? ` ${className}` : ''}`} aria-hidden="true" />;
}

/** The apps' CdButton, its click handled here (the component reports it to the host under its id). */
export function Button({ label, icon, variant = 'default', size, onClick, disabled, title, block, className }: {
	label?: string; icon?: string; variant?: 'default' | 'primary' | 'link' | 'bare'; size?: 'sm' | 'md'; onClick?: () => void;
	disabled?: boolean; title?: string; block?: boolean; className?: string;
}) {
	const id = `de-btn-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
	useComponentEvent(id, onClick ? () => onClick() : undefined);
	return <CdButton id={id} label={label} icon={icon ? fa(icon) : undefined} variant={variant} size={size} disabled={disabled} title={title ?? label} block={block} className={className} />;
}

/** A square button with just an icon (a table row's actions). */
export function IconButton({ icon, title, onClick, disabled, danger }: { icon: string; title: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
	return <Button icon={icon} title={title} onClick={onClick} disabled={disabled} size="sm" className={`cd-button--icon de-icon-btn${danger ? ' de-icon-btn--danger' : ''}`} />;
}

export interface HeaderAction {
	readonly label: string;
	readonly icon: string;
	readonly onClick: () => void;
	readonly variant?: 'primary' | 'secondary' | 'accent';
	readonly disabled?: boolean;
	readonly title?: string;
}

export interface HeaderModel {
	/** The small line above the title (the apps' eyebrow). */
	readonly eyebrow?: string;
	readonly title: string;
	readonly badge?: { readonly text: string; readonly tone: 'draft' | 'editing' | 'info' };
	readonly subtitle?: string;
	readonly meta?: readonly { readonly icon?: string; readonly text: string }[];
	/** A way back (the mapping editor's Back), before the eyebrow. */
	readonly back?: { readonly label: string; readonly onClick: () => void };
	readonly actions?: readonly HeaderAction[];
}

/** The page header, as the apps' pages open: eyebrow, serif title, subtitle, and the page's buttons. */
export function PageHeader({ model }: { model: HeaderModel }) {
	return (
		<div className="cd-page-header">
			<div className="cd-page-heading">
				{(model.back || model.eyebrow) && (
					<div className="cd-page-eyebrow de-eyebrow">
						{model.back && <button type="button" className="de-back" onClick={model.back.onClick}><Icon name="arrow-left" /><span>{model.back.label}</span></button>}
						{model.back && model.eyebrow && <span className="de-eyebrow__sep">/</span>}
						{model.eyebrow && <span>{model.eyebrow}</span>}
					</div>
				)}
				<h1>
					{model.title}
					{model.badge && <span className={`de-badge de-badge--${model.badge.tone}`}>{model.badge.text}</span>}
				</h1>
				{model.subtitle && <p className="cd-page-subtitle">{model.subtitle}</p>}
				{!!model.meta?.length && (
					<div className="de-meta">
						{model.meta.map((m, i) => <span key={i} className="de-meta__item">{m.icon && <Icon name={m.icon} />}{m.text}</span>)}
					</div>
				)}
			</div>
			{!!model.actions?.length && (
				<div className="right-buttons">
					{model.actions.map(a => (
						<button key={a.label} type="button" className={`cd-hdr-btn cd-hdr-btn--${a.variant === 'secondary' ? 'outline' : a.variant ?? 'primary'}`}
							onClick={a.onClick} disabled={a.disabled} title={a.title ?? a.label}>
							<Icon name={a.icon} /><span className="cd-hdr-btn__label">{a.label}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

/** An action's error, as the apps show one: an error banner (with a way to put it away). */
export function ErrorLine({ error, onDismiss }: { error?: string; onDismiss?: () => void }) {
	if (!error) {
		return null;
	}
	return (
		<div className="de-banner">
			<StatusBanner status="error" description={error} />
			{onDismiss && <button type="button" className="de-banner__close" onClick={onDismiss} title="Dismiss" aria-label="Dismiss"><Icon name="xmark" /></button>}
		</div>
	);
}

/** A short status line: info, success or warning (the apps' StatusBanner). */
export function Banner({ status, title, text }: { status: 'info' | 'success' | 'warning' | 'error'; title?: string; text?: string }) {
	return <div className="de-banner"><StatusBanner status={status} title={title} description={text} /></div>;
}

/** Nothing to show yet, with what to do about it (the apps' EmptyState; its action button reports to the host). */
export function EmptyState({ title, message, actionLabel, onAction }: { title: string; message: string; actionLabel?: string; onAction?: () => void }) {
	const id = `de-empty-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
	useComponentEvent(`${id}_action`, onAction ? () => onAction() : undefined);
	return <CdEmptyState id={id} title={title} message={message} actionLabel={onAction ? actionLabel : undefined} />;
}

/** A card, as the apps draw them: header (title, subtitle, tools) and body. */
export function Card({ title, subtitle, icon, tools, children, className, flush }: {
	title?: string; subtitle?: string; icon?: string; tools?: ReactNode; children: ReactNode; className?: string; flush?: boolean;
}) {
	return (
		<div className={`cd-card${className ? ` ${className}` : ''}`}>
			{title && (
				<div className="cd-card__header de-card__header">
					<div className="cd-card__heading">
						<h3 className="cd-card__title">{icon && <Icon name={icon} />}{title}</h3>
						{subtitle && <p className="cd-card__subtitle">{subtitle}</p>}
					</div>
					{tools && <div className="cd-card__header-actions">{tools}</div>}
				</div>
			)}
			<div className={flush ? 'de-card__flush' : 'cd-card__body'}>{children}</div>
		</div>
	);
}

/** A number on the dashboard, with what it counts and its state. */
export function StatCard({ label, icon, value, sub, footer, footerIcon, onClick }: {
	label: string; icon: string; value: ReactNode; sub?: string; footer: string; footerIcon?: string; onClick?: () => void;
}) {
	const body = <>
		<div className="de-stat__head"><span className="de-stat__label">{label}</span><span className="de-stat__icon"><Icon name={icon} /></span></div>
		<div className="de-stat__value">{value}</div>
		{sub && <div className="de-stat__sub">{sub}</div>}
		<div className="de-stat__foot">{footerIcon && <Icon name={footerIcon} />}<span>{footer}</span></div>
	</>;
	return onClick
		? <button type="button" className="cd-card de-stat de-stat--clickable" onClick={onClick}>{body}</button>
		: <div className="cd-card de-stat">{body}</div>;
}

/** A thing to do next, on the dashboard. */
export function ActionCard({ title, desc, icon, onClick }: { title: string; desc: string; icon: string; onClick: () => void }) {
	return (
		<button type="button" className="cd-card de-action" onClick={onClick}>
			<span className="de-action__icon"><Icon name={icon} /></span>
			<span className="de-action__text"><span className="de-action__title">{title}</span><span className="de-action__desc">{desc}</span></span>
			<Icon name="chevron-right" className="de-action__chev" />
		</button>
	);
}

/** The apps' search box (cd-search). */
export function SearchInput({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (value: string) => void }) {
	return (
		<div className="cd-search de-search">
			<IconSearch />
			<input type="search" placeholder={placeholder} aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)} />
		</div>
	);
}

/** A labelled field of the apps' forms (FieldSelect's, CdTextArea's): label, the control (class cd-field-input), a hint. */
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
	return (
		<label className={`cd-field-stack${className ? ` ${className}` : ''}`}>
			<span className="cd-field-label">{label}</span>
			{children}
			{hint && <span className="cd-field-hint">{hint}</span>}
		</label>
	);
}

export interface Column<T> {
	readonly id: string;
	readonly title: string;
	readonly width?: string;
	readonly align?: 'left' | 'right' | 'center';
	readonly render: (row: T) => ReactNode;
}

/** A table in a card, paged (the apps' tables look). */
export function DataTable<T>({ columns, rows, rowKey, page, pageSize, onPage, onPageSize, empty }: {
	columns: readonly Column<T>[]; rows: readonly T[]; rowKey: (row: T) => string;
	page: number; pageSize: number; onPage: (page: number) => void; onPageSize: (size: number) => void; empty?: ReactNode;
}) {
	const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
	const shown = rows.slice(page * pageSize, (page + 1) * pageSize);
	return (
		<div className="cd-card de-table-card">
			<div className="de-table-wrap">
				<table className="de-table">
					<thead>
						<tr>{columns.map(c => <th key={c.id} style={{ width: c.width, textAlign: c.align }}>{c.title}</th>)}</tr>
					</thead>
					<tbody>
						{shown.length === 0
							? <tr><td colSpan={columns.length} className="de-table__empty">{empty ?? 'Nothing here yet.'}</td></tr>
							: shown.map(row => <tr key={rowKey(row)}>{columns.map(c => <td key={c.id} style={{ textAlign: c.align }}>{c.render(row)}</td>)}</tr>)}
					</tbody>
				</table>
			</div>
			{rows.length > 0 && (
				<div className="de-pager">
					<span className="de-pager__info">{`${page * pageSize + 1}-${Math.min(rows.length, (page + 1) * pageSize)} of ${rows.length}`}</span>
					<select className="cd-input de-pager__size" aria-label="Rows per page" value={pageSize} onChange={e => onPageSize(Number(e.target.value))}>
						{[10, 20, 50].map(n => <option key={n} value={n}>{n} per page</option>)}
					</select>
					<IconButton icon="chevron-left" title="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)} />
					<span className="de-pager__page">{page + 1} / {totalPages}</span>
					<IconButton icon="chevron-right" title="Next page" disabled={page >= totalPages - 1} onClick={() => onPage(page + 1)} />
				</div>
			)}
		</div>
	);
}

/** A segmented choice (the apps' cd-seg). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; label: string }) {
	return (
		<div className="cd-seg" role="radiogroup" aria-label={label}>
			{options.map(o => (
				<button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={`cd-seg__btn${o.value === value ? ' cd-seg__btn--on' : ''}`} onClick={() => onChange(o.value)}>{o.label}</button>
			))}
		</div>
	);
}

/** A dialog, as the apps' cd_dialog() draws one. */
export function Dialog({ title, children, footer, onClose, size = 'md' }: { title: string; children: ReactNode; footer: ReactNode; onClose: () => void; size?: 'md' | 'lg' }) {
	return (
		<div className="cd-dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) { onClose(); } }}>
			<div className={`cd-dialog cd-dialog--${size}`} role="dialog" aria-modal="true" aria-label={title}>
				<div className="cd-dialog__header de-dialog__header">
					<h2 className="cd-dialog__title">{title}</h2>
					<button type="button" className="de-dialog__close" onClick={onClose} aria-label="Close"><Icon name="xmark" /></button>
				</div>
				<div className="cd-dialog__body">{children}</div>
				<div className="cd-dialog__footer">{footer}</div>
			</div>
		</div>
	);
}
