/*---------------------------------------------------------------------------------------------
 *  Data Extractor: writing a mapping -- its name, description, mode and indicators. A new mapping (or a copy) is kept
 *  as a draft while it is written, so nothing is lost when the panel closes.
 *--------------------------------------------------------------------------------------------*/

import { CdTextArea, FieldSelect } from '@quire/components';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Connection, IAddMappingDraft, IIndicatorDraft, MappingMode } from '../../shared/api';
import { emptyDraft, isComplete, newIndicator, validationError } from '../../shared/mapping';
import { Button, Card, ErrorLine, Field, Icon, PageHeader, SectionHeader } from '../components';
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
	const total = draft.indicators.length;
	const importJson = () => void run(async () => {
		const imported = await host.importMappingFile();
		if (imported) {
			change({ ...imported, name: imported.name || draft.name, indicators: imported.indicators.map((i, n) => ({ ...i, expanded: n === 0 })) });
		}
	});
	const clearAll = () => void run(async () => {
		if (await host.confirm('Clear all indicators?', 'Every indicator of this mapping is removed.', 'Clear All')) {
			change({ ...draft, indicators: [] });
		}
	});

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
				subtitle: editingId ? 'Changes are kept when you save.' : 'A new mapping is kept as a draft as you write it, until you save it.'
			}} />
			<div className="de-summary" role="list">
				<div className="de-summary__item" role="listitem">
					<span className="de-summary__label">Indicators</span>
					<span className="de-summary__value">{total}</span>
				</div>
				<div className="de-summary__item" role="listitem">
					<span className="de-summary__label">Complete</span>
					<span className="de-summary__value">{complete}<span className="de-summary__of"> / {total}</span></span>
					<span className="de-summary__bar"><span style={{ width: `${total ? Math.round(complete / total * 100) : 0}%` }} /></span>
				</div>
				<div className={`de-summary__item${total - complete ? ' de-summary__item--warn' : ''}`} role="listitem">
					<span className="de-summary__label">To finish</span>
					<span className="de-summary__value">{total - complete}</span>
				</div>
				<div className="de-summary__item" role="listitem">
					<span className="de-summary__label">Indicators are</span>
					<span className="de-summary__value de-summary__value--text">{draft.mode === 'countdown' ? 'Countdown 2030' : 'Custom'}</span>
				</div>
			</div>
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
				</aside>
				<section className="de-editor__main">
					<SectionHeader title="Indicators" count={total} description="Each indicator sums the DHIS2 sources it is given, with the disaggregations chosen for each.">
						{total > 0 && <Button label="Clear all" icon="eraser" size="sm" className="de-btn-danger-quiet" onClick={clearAll} />}
						{total > 0 && <span className="de-section-header__sep" aria-hidden="true" />}
						{total > 0 && <Button label="Import JSON" icon="file-import" size="sm" onClick={importJson} />}
						{total > 0 && <Button label="Add indicator" icon="plus" variant="primary" size="sm" onClick={addIndicator} />}
					</SectionHeader>
					{total === 0 && (
						<div className="cd-card de-start">
							<span className="de-start__icon"><Icon name="diagram-project" /></span>
							<h3 className="de-start__title">Add the first indicator</h3>
							<p className="de-start__text">{draft.mode === 'countdown'
								? 'Pick a Countdown 2030 indicator, then the DHIS2 data elements this server records it in. Add them one by one; each is checked as you go.'
								: 'Name an indicator, give it an analysis code, then pick the DHIS2 data it sums and the disaggregations to keep.'}</p>
							<div className="de-start__actions">
								<Button label="Add indicator" icon="plus" variant="primary" onClick={addIndicator} />
								<Button label="Import a mapping file" icon="file-import" onClick={importJson} />
							</div>
						</div>
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
					{total > 0 && <button type="button" className="de-add" onClick={addIndicator}><span className="de-add__plus">+</span>Add another indicator</button>}
				</section>
			</div>
			<div className="de-savebar" role="region" aria-label="Save">
				<span className={`de-savebar__state${problem ? ' de-savebar__state--warn' : total ? '' : ' de-savebar__state--quiet'}`}>
					<Icon name={problem ? 'triangle-exclamation' : total ? 'circle-check' : 'circle-info'} />
					{problem ?? (total ? `${complete} of ${total} indicator${total === 1 ? '' : 's'} complete. Ready to save.` : "No indicators yet: add one to map this server's data.")}
				</span>
				<Button label="Cancel" icon="xmark" onClick={cancel} />
				<Button label="Save mapping" icon="floppy-disk" variant="primary" onClick={save} disabled={!!problem || busy} title={problem ?? 'Save mapping'} />
			</div>
		</>
	);
}
