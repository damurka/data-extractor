/*---------------------------------------------------------------------------------------------
 *  Data Extractor: writing a mapping (dhis2ProfileAddMappingView.ts) -- its name, description, mode and indicators. A
 *  new mapping (or a copy) is kept as a draft while it is written, so nothing is lost when the panel closes.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react';
import { Connection, IAddMappingDraft, IIndicatorDraft, MappingMode } from '../../shared/api';
import { emptyDraft, newIndicator, validationError } from '../../shared/mapping';
import { ErrorLine, Icon, PageHeader } from '../components';
import { host, useAction } from '../hooks';
import { IndicatorCard } from './IndicatorCard';
import { EditTarget } from './Mappings';

export function MappingEditor({ connection, target, done }: { connection: Connection; target: EditTarget; done(): void }) {
	const id = connection.id;
	const [draft, setDraft] = useState<IAddMappingDraft>();
	const [run, error, busy, dismiss] = useAction();
	const [cardError, setCardError] = useState<string>();
	const editingId = target.kind === 'edit' ? target.mappingId : undefined;
	const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const onCardError = useCallback((e: string) => setCardError(e), []);

	useEffect(() => {
		void run(async () => {
			let loaded: IAddMappingDraft;
			if (target.kind === 'new') {
				loaded = { ...emptyDraft('custom'), name: 'New Mapping' };
			} else if (target.kind === 'draft') {
				loaded = (await host.loadDraft(id)) ?? emptyDraft('custom');
			} else {
				const mapping = await host.getMapping(id, target.mappingId);
				if (!mapping) {
					throw new Error('That mapping no longer exists.');
				}
				loaded = target.kind === 'clone' ? { ...mapping, name: `${mapping.name} (Copy)` } : mapping;
			}
			// One card open at a time: the first
			setDraft({ ...loaded, indicators: loaded.indicators.map((i, n) => ({ ...i, expanded: n === 0 })) });
		});
	}, [id, target, run]);

	/** Every change: kept as the draft after a pause (not while editing a saved mapping: Save keeps it). */
	const change = (next: IAddMappingDraft) => {
		setDraft(next);
		if (!editingId) {
			clearTimeout(saveTimer.current);
			saveTimer.current = setTimeout(() => void host.saveDraft(id, next), 750);
		}
	};
	useEffect(() => () => clearTimeout(saveTimer.current), []);

	if (!draft) {
		return <><PageHeader model={{ title: 'Mapping', leading: [{ label: 'Back', icon: 'arrow-left', variant: 'plain', onClick: done }] }} /><ErrorLine error={error} /></>;
	}

	const problem = validationError(draft);
	const setIndicator = (indicator: IIndicatorDraft) => change({ ...draft, indicators: draft.indicators.map(i => i.id === indicator.id ? indicator : i) });
	const expandOnly = (indicatorId: string | undefined) => draft.indicators.map(i => ({ ...i, expanded: i.id === indicatorId }));
	const addIndicator = () => {
		const indicator = { ...newIndicator(draft.mode), expanded: true };
		change({ ...draft, indicators: [...expandOnly(undefined), indicator] });
	};
	const slug = (draft.name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
	const idLabel = editingId ? `ID: ${editingId}` : slug && draft.name !== 'New Mapping' ? `ID: MP_${slug.substring(0, 15)}` : 'ID: Pending Save';

	const save = () => void run(async () => {
		clearTimeout(saveTimer.current);
		const clean = { ...draft, indicators: draft.indicators.map(({ expanded, ...rest }) => rest as IIndicatorDraft) };
		if (editingId) {
			await host.updateMapping(id, editingId, clean);
		} else {
			await host.createMapping(id, clean);
		}
		done();
	});
	const cancel = () => void run(async () => {
		if (!editingId && draft.indicators.length && !(await host.confirm('Discard this mapping?', 'The draft is deleted.', 'Discard'))) {
			return;
		}
		clearTimeout(saveTimer.current);
		if (!editingId) {
			await host.clearDraft(id);
		}
		done();
	});

	return (
		<>
			<PageHeader model={{
				title: draft.name || 'New Mapping',
				badge: editingId ? { text: 'EDITING', className: 'amv-badge-editing' } : { text: 'DRAFT', className: 'amv-badge-draft' },
				meta: [{ text: idLabel }],
				leading: [{ label: 'Back', icon: 'arrow-left', variant: 'plain', onClick: done }],
				actions: [
					{ label: 'Cancel', icon: 'close', variant: 'secondary', onClick: cancel },
					{ label: 'Save Mapping', icon: 'save', variant: 'primary', onClick: save, disabled: !!problem || busy, title: problem ?? 'Save Mapping' }
				]
			}} />
			<ErrorLine error={error ?? cardError} onDismiss={() => { dismiss(); setCardError(undefined); }} />
			<div className="editor-layout">
				<div className="editor-workspace-row">
					<aside className="config-sidebar custom-scrollbar">
						<div className="sidebar-form">
							<div className="sidebar-section">
								<div className="sidebar-section-label text-red"><Icon name="info" /><h3>General Metadata</h3></div>
								<div className="d2-form-group">
									<label className="d2-label">Mapping Name</label>
									<input className="d2-input" type="text" placeholder="e.g. Monthly ANC Report" value={draft.name} onChange={e => change({ ...draft, name: e.target.value })} />
								</div>
								<div className="d2-form-group">
									<label className="d2-label">Description</label>
									<textarea className="d2-input" rows={4} placeholder="Describe purpose..." value={draft.description ?? ''} onChange={e => change({ ...draft, description: e.target.value })} />
								</div>
							</div>
							<div className="sidebar-h-divider" />
							<div className="sidebar-section">
								<div className="sidebar-section-label text-red"><Icon name="settings" /><h3>Configuration</h3></div>
								<div className="d2-form-group">
									<label className="d2-label">Mapping Mode</label>
									<div className="relative-select-container">
										<select className="d2-input d2-select" value={draft.mode} onChange={e => void run(async () => {
											const mode = e.target.value as MappingMode;
											if (draft.indicators.length && !(await host.confirm('Change mapping mode?', 'Changing the mode clears the indicators: Countdown and custom indicators are not the same.', 'Change Mode'))) {
												return;
											}
											change({ ...draft, mode, indicators: [] });
										})}>
											<option value="custom">Custom</option>
											<option value="countdown">Countdown</option>
										</select>
										<Icon name="chevron-down" className="select-custom-arrow" />
									</div>
								</div>
							</div>
						</div>
					</aside>
					<div className="editor-content-area custom-scrollbar wavy-bg">
						<div className="content-canvas-centered">
							<div className="canvas-header-row">
								<div className="canvas-label-group">
									<h2 className="canvas-title-text">Indicators Configuration</h2>
									<p className="canvas-subtitle-text">Define mapping logic for {draft.indicators.length} indicators.</p>
								</div>
								<div className="canvas-btn-group-inline">
									<button type="button" className="d2-btn d2-btn--secondary" onClick={() => void run(async () => {
										const imported = await host.importMappingFile();
										if (imported) {
											change({ ...imported, name: imported.name || draft.name, indicators: imported.indicators.map((i, n) => ({ ...i, expanded: n === 0 })) });
										}
									})}><Icon name="cloud-upload" /><span>Import JSON</span></button>
									{draft.indicators.length > 0 && (
										<button type="button" className="d2-btn d2-btn--secondary" onClick={() => void run(async () => {
											if (await host.confirm('Clear all indicators?', 'Every indicator of this mapping is removed.', 'Clear All')) {
												change({ ...draft, indicators: [] });
											}
										})}><Icon name="clear-all" /><span>Clear All</span></button>
									)}
									<button type="button" className="d2-btn d2-btn--primary d2-btn--sm" onClick={addIndicator}><Icon name="add" /><span>Add Indicator</span></button>
								</div>
							</div>
							<div className="indicators-list-stack">
								{draft.indicators.map(indicator => (
									<IndicatorCard
										key={indicator.id}
										connectionId={id}
										draft={draft}
										indicator={indicator}
										onChange={setIndicator}
										onError={onCardError}
										onToggle={() => change({ ...draft, indicators: expandOnly(indicator.expanded ? undefined : indicator.id) })}
										onClone={() => {
											const copy: IIndicatorDraft = {
												...indicator, id: newIndicator(draft.mode).id, expanded: true,
												exportCode: draft.mode === 'countdown' ? '' : indicator.exportCode,
												internalName: draft.mode === 'countdown' ? '' : `${indicator.internalName || 'Indicator'} (Copy)`
											};
											change({ ...draft, indicators: [...expandOnly(undefined), copy] });
										}}
										onDelete={() => void run(async () => {
											if (await host.confirm('Delete indicator?', `"${indicator.internalName || 'Untitled Indicator'}" and its sources are removed from this mapping.`, 'Delete')) {
												change({ ...draft, indicators: draft.indicators.filter(i => i.id !== indicator.id) });
											}
										})}
									/>
								))}
							</div>
							<button type="button" className="btn-dashed-add" onClick={addIndicator}>
								<div className="btn-dashed-circle"><Icon name="add" /></div>
								<span className="btn-dashed-label">Add New Indicator Block</span>
							</button>
						</div>
					</div>
				</div>
			</div>
		</>
	);
}
