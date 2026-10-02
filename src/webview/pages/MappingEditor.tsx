/*---------------------------------------------------------------------------------------------
 *  Data Extractor: writing a mapping -- its name, description, mode and indicators. A new mapping (or a copy) is kept
 *  as a draft while it is written, so nothing is lost when the panel closes.
 *--------------------------------------------------------------------------------------------*/

import { CdTextArea, FieldSelect } from '@quire/components';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Connection, IAddMappingDraft, IIndicatorDraft, MappingMode } from '../../shared/api';
import { emptyDraft, isComplete, newIndicator, validationError } from '../../shared/mapping';
import { Button, Card, EmptyState, ErrorLine, Field, PageHeader } from '../components';
import { host, useAction } from '../hooks';
import { IndicatorCard } from './IndicatorCard';
import { EditTarget } from './Mappings';

const MODE_OPTIONS = [
	{ key: 'custom', text: 'Custom: your own indicators' },
	{ key: 'countdown', text: 'Countdown 2030 indicators' }
];

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
		return <><PageHeader model={{ title: 'Mapping', back: { label: 'Mappings', onClick: done } }} /><ErrorLine error={error} /></>;
	}

	const problem = validationError(draft);
	const setIndicator = (indicator: IIndicatorDraft) => change({ ...draft, indicators: draft.indicators.map(i => i.id === indicator.id ? indicator : i) });
	const expandOnly = (indicatorId: string | undefined) => draft.indicators.map(i => ({ ...i, expanded: i.id === indicatorId }));
	const addIndicator = () => {
		const indicator = { ...newIndicator(draft.mode), expanded: true };
		change({ ...draft, indicators: [...expandOnly(undefined), indicator] });
	};
	const complete = draft.indicators.filter(isComplete).length;

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
	const changeMode = (mode: string) => void run(async () => {
		if (mode === draft.mode) {
			return;
		}
		if (draft.indicators.length && !(await host.confirm('Change mapping mode?', 'Changing the mode clears the indicators: Countdown and custom indicators are not the same.', 'Change Mode'))) {
			return;
		}
		change({ ...draft, mode: mode as MappingMode, indicators: [] });
	});

	return (
		<>
			<PageHeader model={{
				back: { label: 'Mappings', onClick: done },
				eyebrow: editingId ? `ID ${editingId}` : 'New mapping',
				title: draft.name || 'New Mapping',
				badge: editingId ? { text: 'Editing', tone: 'editing' } : { text: 'Draft', tone: 'draft' },
				subtitle: `${draft.indicators.length} indicator${draft.indicators.length === 1 ? '' : 's'}, ${complete} complete.${editingId ? '' : ' The draft is kept as you go.'}`,
				actions: [
					{ label: 'Cancel', icon: 'xmark', variant: 'secondary', onClick: cancel },
					{ label: 'Save mapping', icon: 'floppy-disk', onClick: save, disabled: !!problem || busy, title: problem ?? 'Save Mapping' }
				]
			}} />
			<ErrorLine error={error ?? cardError} onDismiss={() => { dismiss(); setCardError(undefined); }} />
			<div className="de-editor">
				<aside className="de-editor__side">
					<Card title="About this mapping" icon="circle-info">
						<div className="de-fields">
							<Field label="Name">
								<input className="cd-field-input" type="text" placeholder="e.g. Monthly ANC report" value={draft.name} onChange={e => change({ ...draft, name: e.target.value })} />
							</Field>
							<CdTextArea label="Description" value={draft.description ?? ''} placeholder="What it is for" height={96} onChange={v => change({ ...draft, description: v })} />
							<FieldSelect label="Indicators" hint="Countdown's are the ones the Countdown analysis uses; custom ones are your own." options={MODE_OPTIONS} value={draft.mode} onChange={changeMode} />
						</div>
					</Card>
					{problem && <p className="cd-field-hint cd-field-hint--warn de-editor__problem">{problem}</p>}
				</aside>
				<section className="de-editor__main">
					<div className="de-editor__head">
						<div>
							<h2 className="de-section de-section--flush">Indicators</h2>
							<p className="de-muted">Each indicator sums the DHIS2 sources it is given, with the disaggregations chosen for each.</p>
						</div>
						<div className="de-row-actions">
							<Button label="Import JSON" icon="file-import" size="sm" onClick={() => void run(async () => {
								const imported = await host.importMappingFile();
								if (imported) {
									change({ ...imported, name: imported.name || draft.name, indicators: imported.indicators.map((i, n) => ({ ...i, expanded: n === 0 })) });
								}
							})} />
							{draft.indicators.length > 0 && <Button label="Clear all" icon="eraser" size="sm" onClick={() => void run(async () => {
								if (await host.confirm('Clear all indicators?', 'Every indicator of this mapping is removed.', 'Clear All')) {
									change({ ...draft, indicators: [] });
								}
							})} />}
							<Button label="Add indicator" icon="plus" variant="primary" size="sm" onClick={addIndicator} />
						</div>
					</div>
					{draft.indicators.length === 0 && (
						<div className="cd-card"><EmptyState title="No indicators yet" message={draft.mode === 'countdown' ? 'Add the Countdown indicators this server has data for, one by one.' : 'Add an indicator, name it, and pick the DHIS2 data it sums.'} actionLabel="Add indicator" onAction={addIndicator} /></div>
					)}
					<div className="de-stack">
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
					{draft.indicators.length > 0 && <button type="button" className="de-add" onClick={addIndicator}><span className="de-add__plus">+</span>Add another indicator</button>}
				</section>
			</div>
		</>
	);
}
