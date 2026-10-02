/*---------------------------------------------------------------------------------------------
 *  Data Extractor: picking a date range, the way DHIS2's own calendar (@dhis2/ui Calendar) does it -- compact 32px
 *  day cells in 14px type, a month and a year control each with its arrows, today marked with a dot, the days of the
 *  neighbouring months shown faded -- with two months side by side (the range's first and last), in the Gregorian or
 *  the Ethiopian calendar, its names in DataSuite's display language.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from 'react';
import { toEthiopic, toGregorian } from '../../core/ethiopicDate';
import { getEthiopicMonthsLocalized } from '../../core/ethiopicMonths';
import { Icon, Segmented } from '../components';
import { dateFormat } from '../locale';

export type CalendarSystem = 'gregorian' | 'ethiopic';

export interface DateRange {
	readonly start: Date;
	readonly end: Date;
}

/** A month in a calendar system (month 1-based; Ethiopic has 13). */
interface Month {
	readonly year: number;
	readonly month: number;
}

const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay = (a: Date | undefined, b: Date | undefined) => !!a && !!b && a.getTime() === b.getTime();

function monthOf(date: Date, system: CalendarSystem): Month {
	if (system === 'gregorian') {
		return { year: date.getFullYear(), month: date.getMonth() + 1 };
	}
	const eth = toEthiopic(date);
	return { year: eth.year, month: eth.month };
}

const monthsIn = (system: CalendarSystem) => system === 'gregorian' ? 12 : 13;

function step({ year, month }: Month, delta: number, system: CalendarSystem): Month {
	const n = monthsIn(system);
	const index = year * n + (month - 1) + delta;
	return { year: Math.floor(index / n), month: (index % n + n) % n + 1 };
}

function dateOf({ year, month }: Month, d: number, system: CalendarSystem): Date {
	return system === 'gregorian' ? new Date(year, month - 1, d) : day(toGregorian(year, month, d));
}

function monthNames(system: CalendarSystem): readonly string[] {
	if (system === 'ethiopic') {
		return getEthiopicMonthsLocalized();
	}
	const format = dateFormat({ month: 'long' });
	return Array.from({ length: 12 }, (_, i) => format.format(new Date(2000, i, 1)));
}

/** The week's day names from Monday, short ("Mo", "Tu"...). */
function weekdayNames(): string[] {
	const format = dateFormat({ weekday: 'short' });
	// 2024-01-01 was a Monday
	return Array.from({ length: 7 }, (_, i) => format.format(new Date(2024, 0, 1 + i)).replace(/\.$/, '').slice(0, 2));
}

/** A date as the trigger shows it: "1 Sep 2026" (Gregorian) or "1 Meskerem 2019" (Ethiopic). */
export function formatDate(date: Date, system: CalendarSystem): string {
	if (system === 'gregorian') {
		return dateFormat({ day: 'numeric', month: 'short', year: 'numeric' }).format(date);
	}
	const eth = toEthiopic(date);
	return `${eth.day} ${getEthiopicMonthsLocalized()[eth.month - 1]} ${eth.year}`;
}

/** The 6 x 7 days a month's grid shows, Monday first, with the neighbouring months' days around it. */
function gridOf(month: Month, system: CalendarSystem): { date: Date; inMonth: boolean; label: number }[] {
	// day by day from the Monday on or before the 1st (an Ethiopian Pagume of 5 or 6 days can be both neighbours)
	const first = dateOf(month, 1, system);
	const cells: { date: Date; inMonth: boolean; label: number }[] = [];
	for (let i = 0; i < 42; i++) {
		const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() - (first.getDay() + 6) % 7 + i);
		const at = monthOf(date, system);
		const label = system === 'gregorian' ? date.getDate() : toEthiopic(date).day;
		cells.push({ date, inMonth: at.year === month.year && at.month === month.month, label });
	}
	return cells;
}

function MonthPanel({ month, system, onMonth, start, end, hover, onPick, onHover, today }: {
	month: Month; system: CalendarSystem; onMonth(month: Month): void; start: Date; end: Date | undefined; hover: Date | undefined;
	onPick(date: Date): void; onHover(date: Date | undefined): void; today: Date;
}) {
	const names = monthNames(system);
	const thisYear = monthOf(today, system).year;
	const years: number[] = [];
	for (let y = Math.min(month.year, thisYear - 15); y <= Math.max(month.year, thisYear + 2); y++) {
		years.push(y);
	}
	// the range, or while the last day is being chosen, from the first day to the one under the pointer
	const last = end ?? hover;
	const [from, to] = last && last < start ? [last, start] : [start, last];
	return (
		<div className="de-cal__month">
			<div className="de-cal__nav">
				<div className="de-cal__navgroup de-cal__navgroup--month">
					<button type="button" className="de-cal__arrow" aria-label="Previous month" onClick={() => onMonth(step(month, -1, system))}><Icon name="chevron-left" /></button>
					<select className="de-cal__select" aria-label="Month" value={month.month} onChange={e => onMonth({ year: month.year, month: Number(e.target.value) })}>
						{names.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
					</select>
					<button type="button" className="de-cal__arrow" aria-label="Next month" onClick={() => onMonth(step(month, 1, system))}><Icon name="chevron-right" /></button>
				</div>
				<div className="de-cal__navgroup">
					<button type="button" className="de-cal__arrow" aria-label="Previous year" onClick={() => onMonth({ ...month, year: month.year - 1 })}><Icon name="chevron-left" /></button>
					<select className="de-cal__select" aria-label="Year" value={month.year} onChange={e => onMonth({ ...month, year: Number(e.target.value) })}>
						{years.map(y => <option key={y} value={y}>{y}</option>)}
					</select>
					<button type="button" className="de-cal__arrow" aria-label="Next year" onClick={() => onMonth({ ...month, year: month.year + 1 })}><Icon name="chevron-right" /></button>
				</div>
			</div>
			<table className="de-cal__table" role="grid" onMouseLeave={() => onHover(undefined)}>
				<thead><tr>{weekdayNames().map(w => <th key={w} scope="col">{w}</th>)}</tr></thead>
				<tbody>
					{Array.from({ length: 6 }, (_, row) => (
						<tr key={row}>
							{gridOf(month, system).slice(row * 7, row * 7 + 7).map(cell => {
								// the neighbouring months' days are there to click, not to show the range again (the other panel does)
								const isStart = cell.inMonth && sameDay(cell.date, from);
								const isEnd = cell.inMonth && sameDay(cell.date, to);
								const inRange = cell.inMonth && !!from && !!to && cell.date > from && cell.date < to;
								const classes = ['de-cal__day', cell.inMonth ? '' : 'de-cal__day--other', inRange ? 'de-cal__day--range' : '',
									isStart || isEnd ? 'de-cal__day--selected' : '', isStart && to && !isEnd ? 'de-cal__day--start' : '', isEnd && !isStart ? 'de-cal__day--end' : '',
									sameDay(cell.date, today) ? 'de-cal__day--today' : ''].filter(Boolean).join(' ');
								return (
									<td key={cell.date.getTime()} className={inRange ? 'de-cal__cell--range' : isStart && to && !isEnd ? 'de-cal__cell--start' : isEnd && !isStart ? 'de-cal__cell--end' : undefined}>
										<button type="button" className={classes} onClick={() => onPick(cell.date)} onMouseEnter={() => onHover(cell.date)}
											aria-pressed={isStart || isEnd} aria-label={formatDate(cell.date, system)}>{cell.label}</button>
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/**
 * A field showing the range ("1 Sep 2026 – 30 Sep 2026") that opens the calendar below it: the first click picks the
 * first day, the second the last (in either order); OK keeps the range, Cancel, Escape or a click outside drop it.
 */
export function DateRangeCalendar({ value, onChange, system: initialSystem, allowToggle }: {
	value: DateRange; onChange(range: DateRange): void; system: CalendarSystem; allowToggle?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [system, setSystem] = useState<CalendarSystem>(initialSystem);
	const [start, setStart] = useState(day(value.start));
	const [end, setEnd] = useState<Date | undefined>(day(value.end));
	const [hover, setHover] = useState<Date>();
	const [left, setLeft] = useState(() => monthOf(value.start, initialSystem));
	const [right, setRight] = useState(() => monthOf(value.end, initialSystem));
	const root = useRef<HTMLDivElement>(null);
	const today = day(new Date());

	useEffect(() => setSystem(initialSystem), [initialSystem]);

	const show = () => {
		setStart(day(value.start));
		setEnd(day(value.end));
		const l = monthOf(value.start, system);
		const r = monthOf(value.end, system);
		setLeft(l);
		// two different months on screen, the end's after the start's
		setRight(r.year * 13 + r.month > l.year * 13 + l.month ? r : step(l, 1, system));
		setOpen(true);
	};
	const close = () => { setOpen(false); setHover(undefined); };
	const apply = () => {
		if (end) {
			const [s, e] = end < start ? [end, start] : [start, end];
			onChange({ start: s, end: e });
		}
		close();
	};

	useEffect(() => {
		if (!open) {
			return;
		}
		const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) { close(); } };
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
		document.addEventListener('mousedown', onDown);
		document.addEventListener('keydown', onKey, true);
		return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
	}, [open]);

	const pick = (date: Date) => {
		if (end) {
			setStart(date);
			setEnd(undefined);
		} else {
			setEnd(date);
		}
	};
	const changeSystem = (next: CalendarSystem) => {
		setSystem(next);
		setLeft(monthOf(start, next));
		const r = monthOf(end ?? start, next);
		const l = monthOf(start, next);
		setRight(r.year * 13 + r.month > l.year * 13 + l.month ? r : step(l, 1, next));
	};

	return (
		<div className="de-cal" ref={root}>
			<button type="button" className="cd-field-input de-cal__trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => open ? close() : show()}>
				<Icon name="calendar-days" regular />
				<span className="de-cal__value">{formatDate(value.start, system)} &ndash; {formatDate(value.end, system)}</span>
				<Icon name="chevron-down" className="de-cal__caret" />
			</button>
			{open && (
				<div className="de-cal__popover" role="dialog" aria-label="Choose the period">
					<div className="de-cal__top">
						<span className="de-cal__prompt">{end ? 'Click a day to start a new range' : 'Now click the last day'}</span>
						{allowToggle && <Segmented label="Calendar" value={system} onChange={changeSystem} options={[{ value: 'gregorian', label: 'Gregorian' }, { value: 'ethiopic', label: 'Ethiopian' }]} />}
					</div>
					<div className="de-cal__months">
						<MonthPanel month={left} system={system} onMonth={setLeft} start={start} end={end} hover={hover} onPick={pick} onHover={setHover} today={today} />
						<MonthPanel month={right} system={system} onMonth={setRight} start={start} end={end} hover={hover} onPick={pick} onHover={setHover} today={today} />
					</div>
					<div className="de-cal__foot">
						<span className="de-cal__summary">{formatDate(end && end < start ? end : start, system)} &ndash; {end ? formatDate(end < start ? start : end, system) : '…'}</span>
						<button type="button" className="cd-button cd-button--sm" onClick={close}>Cancel</button>
						<button type="button" className="cd-button cd-button--primary cd-button--sm" disabled={!end} onClick={apply}>OK</button>
					</div>
				</div>
			)}
		</div>
	);
}
