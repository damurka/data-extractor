/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the pieces the screens share, as the built-in extractor drew them (dhis2ProfileHeader.ts,
 *  dhis2StatCard.ts, dhis2ActionCard.ts, dhis2ProfileTable.ts, dhis2SearchInput.ts) -- the same elements and classes,
 *  so its stylesheets (legacy/*.css) apply unchanged.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode } from 'react';

/** A codicon: `<Icon name="sync" />` is `<span class="codicon codicon-sync">`. */
export function Icon({ name, className }: { name: string; className?: string }) {
	return <span className={`codicon codicon-${name}${className ? ` ${className}` : ''}`} aria-hidden="true" />;
}

export interface HeaderAction {
	readonly label: string;
	readonly icon: string;
	readonly onClick: () => void;
	readonly variant?: 'primary' | 'secondary' | 'plain';
	readonly disabled?: boolean;
	readonly title?: string;
}

export interface HeaderModel {
	readonly title: string;
	readonly badge?: { readonly text: string; readonly icon?: string; readonly className: string };
	readonly meta?: readonly { readonly icon?: string; readonly text: string }[];
	readonly leading?: readonly HeaderAction[];
	readonly actions?: readonly HeaderAction[];
}

function ActionButton({ action }: { action: HeaderAction }) {
	return (
		<button type="button" className={`header-action-btn header-action-btn-${action.variant ?? 'primary'}`} onClick={action.onClick} disabled={action.disabled} title={action.title ?? action.label}>
			<Icon name={action.icon} className="header-action-icon" />
			<span>{action.label}</span>
		</button>
	);
}

/** The page header: title, badge, meta line, actions (header.main-header). */
export function PageHeader({ model }: { model: HeaderModel }) {
	return (
		<header className="main-header">
			<div className="header-content">
				<div className="header-left-wrap">
					{!!model.leading?.length && <div className="header-actions-group header-actions-leading">{model.leading.map(a => <ActionButton key={a.label} action={a} />)}</div>}
					<div className="header-left-col">
						<div className="header-title-group">
							<h2 className="page-title">{model.title}</h2>
							{model.badge && (
								<span className={`status-pill header-badge ${model.badge.className}`}>
									{model.badge.icon ? <Icon name={model.badge.icon} /> : <span className="is-hidden" />}
									<span>{model.badge.text}</span>
								</span>
							)}
						</div>
						{!!model.meta?.length && (
							<div className="header-meta">
								{model.meta.map((m, i) => (
									<div key={i} className="header-meta-item">
										{m.icon && <Icon name={m.icon} className="header-meta-icon" />}
										<span>{m.text}</span>
									</div>
								))}
							</div>
						)}
					</div>
				</div>
				<div className="header-actions-group">{model.actions?.map(a => <ActionButton key={a.label} action={a} />)}</div>
			</div>
		</header>
	);
}

export function ErrorLine({ error, onDismiss }: { error?: string; onDismiss?: () => void }) {
	if (!error) {
		return null;
	}
	return (
		<div className="de-error" role="alert">
			<Icon name="error" />
			<span>{error}</span>
			{onDismiss && <button type="button" onClick={onDismiss} title="Dismiss"><Icon name="close" /></button>}
		</div>
	);
}

export function StatCard({ label, icon, value, sub, footer, footerIcon, theme, onClick }: {
	label: string; icon: string; value: ReactNode; sub?: string; footer: string; footerIcon?: string; theme: 'red' | 'gold' | 'teal'; onClick?: () => void;
}) {
	return (
		<div className={`stat-card-modern theme-${theme}${onClick ? ' clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined}>
			<Icon name={icon} className="bg-icon" />
			<div className="stat-header">
				<h3 className="stat-label">{label}</h3>
				<Icon name={icon} className="stat-icon" />
			</div>
			<div className="stat-value">{value}</div>
			{sub && <p className="stat-sub">{sub}</p>}
			<div className="stat-footer">
				{footerIcon && <Icon name={footerIcon} className="sc-footer-icon" />}
				{footer}
			</div>
		</div>
	);
}

export function ActionCard({ title, desc, icon, theme, onClick }: { title: string; desc: string; icon: string; theme: 'teal' | 'red' | 'gold'; onClick: () => void }) {
	return (
		<button type="button" className={`action-card primary theme-${theme}`} onClick={onClick}>
			<div className="icon-box"><Icon name={icon} /></div>
			<div>
				<span className="action-title">{title}</span>
				<span className="action-desc">{desc}</span>
			</div>
		</button>
	);
}

/** The search box with its icon (.d2-search). */
export function SearchInput({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (value: string) => void }) {
	return (
		<div className="d2-search compact hidden-mobile">
			<span className="d2-search-icon"><Icon name="search" /></span>
			<input className="d2-search-input" type="text" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
		</div>
	);
}

export interface Column<T> {
	readonly id: string;
	readonly title: string;
	readonly width?: string;
	readonly align?: 'left' | 'right' | 'center';
	readonly render: (row: T) => ReactNode;
}

/** A table card with a sticky header and pagination (dhis2ProfileTable.ts). */
export function DataTable<T>({ columns, rows, rowKey, rowClassName, sticky = true, page, pageSize, onPage, onPageSize }: {
	columns: readonly Column<T>[]; rows: readonly T[]; rowKey: (row: T) => string; rowClassName?: string; sticky?: boolean;
	page: number; pageSize: number; onPage: (page: number) => void; onPageSize: (size: number) => void;
}) {
	const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
	const shown = rows.slice(page * pageSize, (page + 1) * pageSize);
	return (
		<div className="table-card">
			<div className="table-responsive custom-scrollbar">
				<table className={`data-table${sticky ? ' sticky-header' : ''}`}>
					<thead>
						<tr>{columns.map(c => <th key={c.id} style={{ width: c.width, textAlign: c.align }}>{c.title}</th>)}</tr>
					</thead>
					<tbody>
						{shown.length === 0 ? (
							<tr className="table-empty-row"><td colSpan={columns.length}><div className="table-empty-state">No items to display</div></td></tr>
						) : shown.map(row => (
							<tr key={rowKey(row)} className={`table-row-hover${rowClassName ? ` ${rowClassName}` : ''}`}>
								{columns.map(c => <td key={c.id} style={{ textAlign: c.align }}>{c.render(row)}</td>)}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className="pagination-footer">
				<div className="pagination-info">{rows.length === 0 ? 'No results' : `Showing ${page * pageSize + 1} to ${Math.min(rows.length, (page + 1) * pageSize)} of ${rows.length} results`}</div>
				<div className="pagination-controls">
					<select className="pagination-page-size" aria-label="Rows per page" value={pageSize} onChange={e => onPageSize(Number(e.target.value))}>
						{[10, 20, 50].map(n => <option key={n} value={n}>{n} / page</option>)}
					</select>
					<div className="pagination-nav-group">
						<button type="button" className="page-nav-btn" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)}><Icon name="chevron-left" /></button>
						<div className="page-numbers">
							{Array.from({ length: totalPages }, (_, i) => (
								<button key={i} type="button" className={`page-num${i === page ? ' active' : ''}`} onClick={() => onPage(i)}>{i + 1}</button>
							))}
						</div>
						<button type="button" className="page-nav-btn" aria-label="Next page" disabled={page >= totalPages - 1} onClick={() => onPage(page + 1)}><Icon name="chevron-right" /></button>
					</div>
				</div>
			</div>
		</div>
	);
}
