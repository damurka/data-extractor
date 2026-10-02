/*---------------------------------------------------------------------------------------------
 *  Data Extractor: writing a mapping -- its name, description, mode and indicators. A new mapping (or a copy) is kept
 *  as a draft while it is written, so nothing is lost when the panel closes.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from 'react';
import { Connection, IAddMappingDraft, IIndicatorDraft, MappingMode } from '../../shared/api';
import { emptyDraft, newIndicator, validationError } from '../../shared/mapping';
import { ErrorLine, PageHeader } from '../components';
import { host, useAction } from '../hooks';
import { IndicatorCard } from './IndicatorCard';
import { EditTarget } from './Mappings';

export function MappingEditor({ connection, target, done }: { connection: Connection; target: EditTarget; done(): void }) {
	const id = connection.id;
	const [draft, setDraft] = useState<IAddMappingDraft>();
	const [expanded, setExpanded] = useState<string>();
	const [run, error, busy, dismiss] = useAction();
	const editingId = target.kind === 'edit' ? target.mappingId : undefined;
	const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => {
		void run(async () => {
			let loaded: IAddMappingDraft | undefined;
			if (target.kind === 'new') {
				loaded = emptyDraft();
			} else if (target.kind === 'draft') {
				loaded = (await host.loadDraft(id)) ?? emptyDraft();
			} else {
				const mapping = await host.getMapping(id, target.mappingId);
				if (!mapping) {
					throw new Error('That mapping no longer exists.');
				}
				loaded = target.kind === 'clone' ? { ...mapping, name: `${mapping.name} (Copy)` } : mapping;
			}
			setDraft(loaded);
			setExpanded(loaded.indicators[0]?.id);
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
		return <><PageHeader title="Mapping" back={done} /><ErrorLine error={error} />{!error && <p className="muted">Loading...</p>}</>;
	}

	const problem = validationError(draft);
	const setIndicator = (indicator: IIndicatorDraft) => change({ ...draft, indicators: draft.indicators.map(i => i.id === indicator.id ? indicator : i) });
	const addIndicator = () => {
		const indicator = newIndicator(draft.mode);
		change({ ...draft, indicators: [...draft.indicators, indicator] });
		setExpanded(indicator.id);
	};

	const save = () => void run(async () => {
		clearTimeout(saveTimer.current);
		if (editingId) {
			await host.updateMapping(id, editingId, draft);
		} else {
			await host.createMapping(id, draft);
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
			<PageHeader
				title={draft.name || 'Untitled Mapping'}
				badge={editingId ? 'EDITING' : 'DRAFT'}
				meta={editingId ? `ID: ${editingId}` : 'Pending Save'}
				back={done}
				actions={[
					{ label: 'Cancel', variant: 'secondary', onClick: cancel },
					{ label: 'Save Mapping', onClick: save, disabled: !!problem || busy, title: problem }
				]}
			/>
			<ErrorLine error={error} onDismiss={dismiss} />
			<div className="editor">
				<aside className="editor-side">
					<label>Mapping Name<input value={draft.name} onChange={e => change({ ...draft, name: e.target.value })} placeholder="e.g. Kenya RMNCAH 2026" /></label>
					<label>Description<textarea value={draft.description ?? ''} onChange={e => change({ ...draft, description: e.target.value })} rows={3} /></label>
					<label>Mapping Mode
						<select value={draft.mode} onChange={e => void run(async () => {
							const mode = e.target.value as MappingMode;
							if (draft.indicators.length && !(await host.confirm('Change the mapping mode?', 'Its indicators are removed: Countdown and custom indicators are not the same.', 'Change Mode'))) {
								return;
							}
							change({ ...draft, mode, indicators: [] });
						})}>
							<option value="countdown">Countdown 2030</option>
							<option value="custom">Custom</option>
						</select>
					</label>
					<p className="muted small">{draft.mode === 'countdown' ? 'Countdown: each indicator is one of the Countdown 2030 analysis indicators, downloaded as its workbook.' : 'Custom: name your own indicators and codes, and choose monthly or yearly periods.'}</p>
				</aside>
				<section className="editor-canvas">
					<div className="canvas-head">
						<h3>Indicators Configuration <span className="muted">({draft.indicators.length})</span></h3>
						<div className="actions">
							<button className="secondary" onClick={() => void run(async () => {
								const imported = await host.importMappingFile();
								if (imported) {
									change({ ...imported, name: imported.name || draft.name });
								}
							})}>Import JSON</button>
							<button className="secondary" disabled={!draft.indicators.length} onClick={() => void run(async () => {
								if (await host.confirm('Remove all indicators?', undefined, 'Clear All')) {
									change({ ...draft, indicators: [] });
								}
							})}>Clear All</button>
							<button onClick={addIndicator}>Add Indicator</button>
						</div>
					</div>
					{draft.indicators.map(indicator => (
						<IndicatorCard
							key={indicator.id}
							connectionId={id}
							draft={draft}
							indicator={indicator}
							expanded={expanded === indicator.id}
							onExpand={() => setExpanded(indicator.id)}
							onChange={setIndicator}
							onClone={() => {
								const copy = { ...indicator, id: newIndicator(draft.mode).id, exportCode: draft.mode === 'countdown' ? '' : indicator.exportCode, internalName: draft.mode === 'countdown' ? '' : `${indicator.internalName} (Copy)` };
								change({ ...draft, indicators: [...draft.indicators, copy] });
								setExpanded(copy.id);
							}}
							onDelete={() => void run(async () => {
								if (await host.confirm(`Delete "${indicator.internalName || 'Untitled Indicator'}"?`, undefined, 'Delete')) {
									change({ ...draft, indicators: draft.indicators.filter(i => i.id !== indicator.id) });
								}
							})}
						/>
					))}
					<button className="add-block" onClick={addIndicator}>+ Add New Indicator Block</button>
				</section>
			</div>
		</>
	);
}
