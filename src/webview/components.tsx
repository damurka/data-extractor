/*---------------------------------------------------------------------------------------------
 *  Data Extractor: small pieces the screens share.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode } from 'react';

export interface HeaderAction {
	readonly label: string;
	readonly onClick: () => void;
	readonly variant?: 'primary' | 'secondary' | 'plain';
	readonly disabled?: boolean;
	readonly title?: string;
}

export function PageHeader({ title, badge, meta, actions = [], back }: { title: ReactNode; badge?: string; meta?: ReactNode; actions?: HeaderAction[]; back?: () => void }) {
	return (
		<div className="page-header">
			<div className="page-title">
				{back && <button className="plain back" onClick={back} title="Back">&larr;</button>}
				<h2>{title}</h2>
				{badge && <span className="badge">{badge}</span>}
				{meta && <div className="meta">{meta}</div>}
			</div>
			<div className="actions">
				{actions.map(a => (
					<button key={a.label} className={a.variant === 'primary' || !a.variant ? '' : a.variant} onClick={a.onClick} disabled={a.disabled} title={a.title}>{a.label}</button>
				))}
			</div>
		</div>
	);
}

export function ErrorLine({ error, onDismiss }: { error?: string; onDismiss?: () => void }) {
	if (!error) {
		return null;
	}
	return <div className="error-line" role="alert">{error}{onDismiss && <button className="plain" onClick={onDismiss} title="Dismiss">&times;</button>}</div>;
}

export function StatCard({ label, value, footer, theme, onClick }: { label: string; value: ReactNode; footer: ReactNode; theme: 'red' | 'gold' | 'teal'; onClick?: () => void }) {
	return (
		<div className={`stat-card ${theme}${onClick ? ' clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined}>
			<div className="stat-label">{label}</div>
			<div className="stat-value">{value}</div>
			<div className="stat-footer">{footer}</div>
		</div>
	);
}

export function Pager({ page, pageSize, total, onPage, onPageSize }: { page: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize: (size: number) => void }) {
	const pages = Math.max(1, Math.ceil(total / pageSize));
	return (
		<div className="pager">
			<span className="muted">{total === 0 ? 'Nothing to show' : `${page * pageSize + 1}-${Math.min(total, (page + 1) * pageSize)} of ${total}`}</span>
			<select value={pageSize} onChange={e => onPageSize(Number(e.target.value))}>
				{[10, 20, 50].map(n => <option key={n} value={n}>{n} per page</option>)}
			</select>
			<button className="secondary" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button>
			<button className="secondary" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Next</button>
		</div>
	);
}

export function ProgressBar({ pct }: { pct: number }) {
	return <div className="progress"><div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>;
}
