/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the calendar range picker of the built-in extractor's New Download dialog, copied unchanged from
 *  DataSuite (base/browser/ui/calendar/calendarRangePicker.ts) onto shim.ts.
 *--------------------------------------------------------------------------------------------*/

import './calendarRangePicker.css';
import { $, addDisposableListener, append, CalendarMode, clearNode, Codicon, DisposableStore, Emitter, Event, EventType, getWindow, localize, safeIntl, ThemeIcon, Widget } from './shim';
import { getEthiopicMonthDays, toEthiopic, toGregorian } from '../../core/ethiopicDate';
import { getEthiopicMonthShortLocalized, getEthiopicMonthsLocalized } from '../../core/ethiopicMonths';

export interface IDateRange {
	readonly start: Date;
	readonly end: Date;
}

export interface ICalendarRangePickerOptions {
	mode?: CalendarMode;
	startDate: Date;
	endDate: Date;
	allowToggle?: boolean;
	/** Fires only when the user clicks OK (never on every click) -- both dates are always Gregorian regardless of display mode. */
	onRangeChange?: (range: IDateRange) => void;
	onModeChange?: (mode: CalendarMode) => void;
	className?: string;
}

/** A grid's displayed month, in whatever calendar system is currently active (1-based month). */
interface IGridPosition {
	year: number;
	month: number;
}

/** The year overlay pages through this many years at a time -- matches the month overlay's 12-item, 3-column, 4-row grid exactly, so the two overlay views are always the same shape. Paging further back/forward uses the same prev/next arrows as month navigation. */
const YEARS_PER_PAGE = 12;
/** How far before the anchor year a freshly opened year page starts, so the currently-displayed year lands roughly in the middle of the page instead of at an edge. */
const YEAR_PAGE_ANCHOR_OFFSET = 5;

/**
 * A date RANGE picker with a single non-editable trigger button (calendar icon + formatted range
 * text + chevron) that opens one shared popup below with two connected month grids side by side
 * (left seeded to the start month, right to the end month).
 *
 * Each grid has its own prev/next month arrows, plus a month/year chip that opens an overlay picker
 * in place of the day grid -- clicking it shows a year grid first (so a distant year is one click
 * away instead of dozens of month clicks), and picking a year reveals a month grid to finish the
 * jump. Moving one grid, in any of these ways, never moves the other.
 *
 * The first day click picks the range start, the second picks the end (highlighting everything
 * between them live, regardless of which grid each click landed in); a third click after both are
 * set begins a new range. Today is always ringed, regardless of whether it falls inside the
 * selected range. The popup only commits on OK -- Cancel, Escape, or an outside click discard the
 * in-progress selection.
 */
export class CalendarRangePicker extends Widget {
	private container: HTMLElement;
	private options: ICalendarRangePickerOptions;
	private mode: CalendarMode;

	/** Last-applied range, shown in the trigger button's label. */
	private rangeStart: Date;
	private rangeEnd: Date;

	/** In-progress selection while the popup is open; discarded on Cancel. */
	private draftStart: Date;
	private draftEnd: Date | undefined;

	/** Independently navigable -- moving one never moves the other. */
	private gridLeft: IGridPosition;
	private gridRight: IGridPosition;

	private wrapper: HTMLElement | null = null;
	private trigger: HTMLButtonElement | null = null;
	private triggerLabel: HTMLElement | null = null;
	private popup: HTMLElement | null = null;
	private popupOpen = false;
	private applyBtn: HTMLButtonElement | null = null;

	/** Which grid, if any, currently shows its month/year overlay instead of its day grid. */
	private leftOverlayView: 'closed' | 'years' | 'months' = 'closed';
	private rightOverlayView: 'closed' | 'years' | 'months' = 'closed';

	/** First year of the currently displayed 12-year page in the year overlay (see YEARS_PER_PAGE). */
	private leftYearPageStart = 0;
	private rightYearPageStart = 0;

	private readonly popupSessionDisposables = this._register(new DisposableStore());
	private readonly popupContentDisposables = this._register(new DisposableStore());

	private readonly _onDidChangeRange = this._register(new Emitter<IDateRange>());
	readonly onDidChangeRange: Event<IDateRange> = this._onDidChangeRange.event;

	private readonly _onDidChangeMode = this._register(new Emitter<CalendarMode>());
	readonly onDidChangeMode: Event<CalendarMode> = this._onDidChangeMode.event;

	constructor(container: HTMLElement, options: ICalendarRangePickerOptions) {
		super();
		this.options = options;
		this.container = container;
		this.mode = options.mode ?? 'gregorian';
		[this.rangeStart, this.rangeEnd] = CalendarRangePicker.normalizeRange(options.startDate, options.endDate);
		this.draftStart = this.rangeStart;
		this.draftEnd = this.rangeEnd;
		this.gridLeft = this.toGridPosition(this.rangeStart);
		this.gridRight = this.toGridPosition(this.rangeEnd);

		this.render();
	}

	private toGridPosition(date: Date): IGridPosition {
		if (this.mode === 'gregorian') {
			return { year: date.getFullYear(), month: date.getMonth() + 1 };
		}
		const eth = toEthiopic(date);
		return { year: eth.year, month: eth.month };
	}

	private render(): void {
		clearNode(this.container);

		this.wrapper = append(this.container, $('.range-picker-wrapper'));
		if (this.options.className) {
			this.wrapper.classList.add(this.options.className);
		}

		this.trigger = append(this.wrapper, $('button.range-picker-trigger', { type: 'button' })) as HTMLButtonElement;
		this.trigger.setAttribute('aria-haspopup', 'dialog');
		const triggerContent = append(this.trigger, $('span.range-picker-trigger-content'));
		append(triggerContent, $('span.range-picker-trigger-icon')).classList.add(...ThemeIcon.asClassNameArray(Codicon.calendar));
		this.triggerLabel = append(triggerContent, $('span.range-picker-trigger-label'));
		append(this.trigger, $('span.range-picker-trigger-chevron')).classList.add(...ThemeIcon.asClassNameArray(Codicon.chevronDown));

		this.updateTriggerLabel();

		this.onclick(this.trigger, () => this.openPopup());
	}

	private updateTriggerLabel(): void {
		if (this.triggerLabel) {
			this.triggerLabel.textContent = `${this.formatDisplayDate(this.rangeStart)} - ${this.formatDisplayDate(this.rangeEnd)}`;
		}
	}

	/** Human-readable label for the trigger button, e.g. "Oct 12, 2023". */
	private formatDisplayDate(date: Date): string {
		if (this.mode === 'gregorian') {
			return safeIntl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).value.format(date);
		}
		const eth = toEthiopic(date);
		const monthLabel = getEthiopicMonthShortLocalized()[eth.month - 1];
		return `${monthLabel} ${eth.day}, ${eth.year}`;
	}

	private openPopup(): void {
		if (this.popupOpen || !this.wrapper) {
			return;
		}
		this.popupOpen = true;
		// Seed the draft from the last-applied range -- left grid shows the start month, right shows the end month.
		this.draftStart = this.rangeStart;
		this.draftEnd = this.rangeEnd;
		this.gridLeft = this.toGridPosition(this.rangeStart);
		this.gridRight = this.toGridPosition(this.rangeEnd);

		this.renderPopup();

		const win = getWindow(this.wrapper);
		this.popupSessionDisposables.add(addDisposableListener(win.document, EventType.MOUSE_DOWN, e => {
			if (this.wrapper && !this.wrapper.contains(e.target as Node)) {
				this.cancelPopup();
			}
		}, true));
		this.popupSessionDisposables.add(addDisposableListener(win.document, EventType.KEY_DOWN, e => {
			if ((e as KeyboardEvent).key === 'Escape') {
				this.cancelPopup();
			}
		}));
	}

	private closePopup(): void {
		if (!this.popupOpen) {
			return;
		}
		this.popupOpen = false;
		this.leftOverlayView = 'closed';
		this.rightOverlayView = 'closed';
		this.popupContentDisposables.clear();
		this.popupSessionDisposables.clear();
		this.popup?.remove();
		this.popup = null;
		this.applyBtn = null;
	}

	private cancelPopup(): void {
		this.closePopup();
	}

	private renderPopup(): void {
		if (!this.wrapper) {
			return;
		}
		this.popupContentDisposables.clear();
		this.popup?.remove();

		this.popup = append(this.wrapper, $('.range-picker-popup'));

		if (this.options.allowToggle) {
			const toggleRow = append(this.popup, $('.range-picker-mode-toggle-row'));
			const toggleTrack = append(toggleRow, $('.range-picker-mode-toggle'));

			const gregorianBtn = append(toggleTrack, $('button.range-picker-mode-btn', { type: 'button' }));
			gregorianBtn.textContent = localize('calendarRange.mode.gregorian', 'Gregorian');
			gregorianBtn.classList.toggle('active', this.mode === 'gregorian');
			this.popupContentDisposables.add(addDisposableListener(gregorianBtn, EventType.CLICK, () => {
				if (this.mode !== 'gregorian') { this.toggleMode(); }
			}));

			const ethiopicBtn = append(toggleTrack, $('button.range-picker-mode-btn', { type: 'button' }));
			ethiopicBtn.textContent = localize('calendarRange.mode.ethiopic', 'Ethiopic');
			ethiopicBtn.classList.toggle('active', this.mode === 'ethiopic');
			this.popupContentDisposables.add(addDisposableListener(ethiopicBtn, EventType.CLICK, () => {
				if (this.mode !== 'ethiopic') { this.toggleMode(); }
			}));
		}

		const grids = append(this.popup, $('.range-picker-grids'));

		this.renderGrid(append(grids, $('.range-picker-grid')), 'left');
		this.renderGrid(append(grids, $('.range-picker-grid.right')), 'right');

		const footer = append(this.popup, $('.range-picker-footer'));
		const cancelBtn = append(footer, $('button.range-picker-cancel-btn', { type: 'button' }));
		cancelBtn.textContent = localize('calendarRange.cancel', 'Cancel');
		this.popupContentDisposables.add(addDisposableListener(cancelBtn, EventType.CLICK, () => this.cancelPopup()));

		this.applyBtn = append(footer, $('button.range-picker-apply-btn', { type: 'button' })) as HTMLButtonElement;
		this.applyBtn.textContent = localize('calendarRange.ok', 'OK');
		this.applyBtn.disabled = !this.draftEnd;
		this.popupContentDisposables.add(addDisposableListener(this.applyBtn, EventType.CLICK, () => this.applyRange()));
	}

	/** Applies one prev/next arrow click, whose meaning depends on the pane's current overlay view. */
	private stepGrid(side: 'left' | 'right', position: IGridPosition, overlayView: 'closed' | 'years' | 'months', delta: 1 | -1): void {
		if (overlayView === 'years') {
			this.setYearPageStart(side, this.getYearPageStart(side) + delta * YEARS_PER_PAGE);
			return;
		}
		if (overlayView === 'months') {
			this.setGridPosition(side, { year: position.year + delta, month: position.month });
			return;
		}
		this.setGridPosition(side, this.stepMonth(position, delta));
		this.setOverlayView(side, 'closed');
	}

	private stepMonth(position: IGridPosition, delta: number): IGridPosition {
		if (this.mode === 'gregorian') {
			const d = new Date(position.year, position.month - 1 + delta, 1);
			return { year: d.getFullYear(), month: d.getMonth() + 1 };
		}
		let { year, month } = position;
		if (delta > 0) {
			if (month < 13) { month++; } else { month = 1; year++; }
		} else {
			if (month > 1) { month--; } else { month = 13; year--; }
		}
		return { year, month };
	}

	private getGridPosition(side: 'left' | 'right'): IGridPosition {
		return side === 'left' ? this.gridLeft : this.gridRight;
	}

	private setGridPosition(side: 'left' | 'right', position: IGridPosition): void {
		if (side === 'left') { this.gridLeft = position; } else { this.gridRight = position; }
	}

	private getOverlayView(side: 'left' | 'right'): 'closed' | 'years' | 'months' {
		return side === 'left' ? this.leftOverlayView : this.rightOverlayView;
	}

	private setOverlayView(side: 'left' | 'right', view: 'closed' | 'years' | 'months'): void {
		if (side === 'left') { this.leftOverlayView = view; } else { this.rightOverlayView = view; }
	}

	private getYearPageStart(side: 'left' | 'right'): number {
		return side === 'left' ? this.leftYearPageStart : this.rightYearPageStart;
	}

	private setYearPageStart(side: 'left' | 'right', start: number): void {
		if (side === 'left') { this.leftYearPageStart = start; } else { this.rightYearPageStart = start; }
	}

	private getMonthOptions(): { value: number; label: string }[] {
		if (this.mode === 'gregorian') {
			const formatter = safeIntl.DateTimeFormat(undefined, { month: 'long' });
			return Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: formatter.value.format(new Date(2000, i, 1)) }));
		}
		return getEthiopicMonthsLocalized().map((label, i) => ({ value: i + 1, label }));
	}

	/** Abbreviated (3-letter) month labels, used in the month overlay grid -- the chip itself still shows the full name. */
	private getMonthOptionsShort(): { value: number; label: string }[] {
		if (this.mode === 'gregorian') {
			const formatter = safeIntl.DateTimeFormat(undefined, { month: 'short' });
			return Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: formatter.value.format(new Date(2000, i, 1)) }));
		}
		return getEthiopicMonthShortLocalized().map((label, i) => ({ value: i + 1, label }));
	}

	private getYearPageOptions(side: 'left' | 'right'): number[] {
		const start = this.getYearPageStart(side);
		return Array.from({ length: YEARS_PER_PAGE }, (_, i) => start + i);
	}

	private renderGrid(host: HTMLElement, side: 'left' | 'right'): void {
		const position = this.getGridPosition(side);
		const overlayView = this.getOverlayView(side);

		const header = append(host, $('.range-picker-grid-header'));

		// The prev/next arrows are contextual: in the day grid they step a month, in the month
		// overlay they step a year (re-showing the month grid for it), and in the year overlay they
		// page the 12-year window -- so reaching anything reachable never requires scrolling, just
		// more clicks of the same two arrows.
		const prevBtn = append(header, $('button.range-picker-nav-btn', { type: 'button', title: localize('calendarRange.prevMonth', 'Previous month') }));
		append(prevBtn, $('span')).classList.add(...ThemeIcon.asClassNameArray(Codicon.chevronLeft));
		this.popupContentDisposables.add(addDisposableListener(prevBtn, EventType.CLICK, () => {
			this.stepGrid(side, position, overlayView, -1);
			this.renderPopup();
		}));

		// The month/year label doubles as a button that opens an overlay picker (years first, then
		// months on year click) -- lets either grid jump straight to a distant year without dozens
		// of month-by-month clicks, without permanently showing dropdown chrome.
		const chip = append(header, $('button.range-picker-chip', { type: 'button' }));
		chip.classList.toggle('open', overlayView !== 'closed');
		append(chip, $('span.range-picker-chip-month')).textContent = this.getMonthOptions().find(opt => opt.value === position.month)?.label ?? '';
		append(chip, $('span.range-picker-chip-year')).textContent = String(position.year);
		append(chip, $('span')).classList.add(...ThemeIcon.asClassNameArray(overlayView === 'closed' ? Codicon.chevronUp : Codicon.chevronDown));
		this.popupContentDisposables.add(addDisposableListener(chip, EventType.CLICK, () => {
			if (overlayView === 'closed') {
				this.setYearPageStart(side, position.year - YEAR_PAGE_ANCHOR_OFFSET);
				this.setOverlayView(side, 'years');
			} else {
				this.setOverlayView(side, 'closed');
			}
			this.renderPopup();
		}));

		const nextBtn = append(header, $('button.range-picker-nav-btn', { type: 'button', title: localize('calendarRange.nextMonth', 'Next month') }));
		append(nextBtn, $('span')).classList.add(...ThemeIcon.asClassNameArray(Codicon.chevronRight));
		this.popupContentDisposables.add(addDisposableListener(nextBtn, EventType.CLICK, () => {
			this.stepGrid(side, position, overlayView, 1);
			this.renderPopup();
		}));

		// The day grid always renders; the overlay, when open, is an absolutely positioned layer on
		// top of it rather than a replacement. Combined with the pane's generous min-height (see
		// .range-picker-grid in the CSS, chosen to exceed even a 6-row month), this guarantees the
		// popup's shape never changes across day/month/year views or between the two
		// independently-navigated panes -- the same technique the reference template uses
		// (`.view-overlay` absolutely covering its date grid, `.pane`'s min-height as the floor).
		this.renderDayGrid(host, position);
		if (overlayView !== 'closed') {
			this.renderOverlay(host, side, overlayView, position);
		}
	}

	/** The year/month picker shown in place of the day grid while `overlayView !== 'closed'`. */
	private renderOverlay(host: HTMLElement, side: 'left' | 'right', view: 'years' | 'months', position: IGridPosition): void {
		const overlay = append(host, $('.range-picker-overlay'));

		if (view === 'years') {
			const yearGrid = append(overlay, $('.range-picker-overlay-grid.years'));
			for (const year of this.getYearPageOptions(side)) {
				const yearBtn = append(yearGrid, $('button.range-picker-overlay-btn', { type: 'button' }));
				yearBtn.textContent = String(year);
				yearBtn.classList.toggle('active', year === position.year);
				this.popupContentDisposables.add(addDisposableListener(yearBtn, EventType.CLICK, () => {
					this.setGridPosition(side, { year, month: position.month });
					this.setOverlayView(side, 'months');
					this.renderPopup();
				}));
			}
			return;
		}

		const monthGrid = append(overlay, $('.range-picker-overlay-grid.months'));
		for (const opt of this.getMonthOptionsShort()) {
			const monthBtn = append(monthGrid, $('button.range-picker-overlay-btn', { type: 'button' }));
			monthBtn.textContent = opt.label;
			monthBtn.classList.toggle('active', opt.value === position.month);
			this.popupContentDisposables.add(addDisposableListener(monthBtn, EventType.CLICK, () => {
				this.setGridPosition(side, { year: position.year, month: opt.value });
				this.setOverlayView(side, 'closed');
				this.renderPopup();
			}));
		}
	}

	private renderDayGrid(host: HTMLElement, position: IGridPosition): void {
		const grid = append(host, $('.range-picker-grid-days'));

		const weekdayFormatter = safeIntl.DateTimeFormat(undefined, { weekday: 'narrow' });
		for (let i = 0; i < 7; i++) {
			const weekdayHeader = append(grid, $('.range-picker-weekday-header'));
			weekdayHeader.textContent = weekdayFormatter.value.format(new Date(2000, 0, 2 + i));
		}

		const { year, month } = position;
		let firstDayOfWeek: number;
		let daysInMonth: number;
		if (this.mode === 'gregorian') {
			firstDayOfWeek = new Date(year, month - 1, 1).getDay();
			daysInMonth = new Date(year, month, 0).getDate();
		} else {
			firstDayOfWeek = toGregorian(year, month, 1).getDay();
			daysInMonth = getEthiopicMonthDays(month, year);
		}

		for (let i = 0; i < firstDayOfWeek; i++) {
			append(grid, $('.range-picker-day.empty'));
		}

		const today = new Date();

		for (let day = 1; day <= daysInMonth; day++) {
			const gregorianDate = this.mode === 'gregorian' ? new Date(year, month - 1, day) : toGregorian(year, month, day);

			const dayCell = append(grid, $('.range-picker-day'));
			dayCell.textContent = day.toString();

			if (this.isSameDay(gregorianDate, today)) {
				dayCell.classList.add('today');
			}
			if (this.isSameDay(gregorianDate, this.draftStart)) {
				dayCell.classList.add('range-start');
			}
			if (this.draftEnd && this.isSameDay(gregorianDate, this.draftEnd)) {
				dayCell.classList.add('range-end');
			}
			if (this.draftEnd && gregorianDate > this.draftStart && gregorianDate < this.draftEnd) {
				dayCell.classList.add('in-range');
			}

			this.popupContentDisposables.add(addDisposableListener(dayCell, EventType.CLICK, () => this.selectDay(gregorianDate)));
		}
	}

	private selectDay(date: Date): void {
		if (!this.draftEnd) {
			// Completing a range (or the range collapses to a single day if clicked again on the same date).
			if (date < this.draftStart) {
				this.draftEnd = this.draftStart;
				this.draftStart = date;
			} else {
				this.draftEnd = date;
			}
		} else {
			// Both endpoints were already set -- this click starts a brand-new range.
			this.draftStart = date;
			this.draftEnd = undefined;
		}
		this.renderPopup();
	}

	private toggleMode(): void {
		const newMode: CalendarMode = this.mode === 'gregorian' ? 'ethiopic' : 'gregorian';

		// Re-derive both grids' positions in the new calendar system, anchored on the 1st of their
		// currently-displayed month (only a display-month equivalence is needed, not an exact date).
		const leftAnchor = this.mode === 'gregorian' ? new Date(this.gridLeft.year, this.gridLeft.month - 1, 1) : toGregorian(this.gridLeft.year, this.gridLeft.month, 1);
		const rightAnchor = this.mode === 'gregorian' ? new Date(this.gridRight.year, this.gridRight.month - 1, 1) : toGregorian(this.gridRight.year, this.gridRight.month, 1);

		this.mode = newMode;
		this.gridLeft = this.toGridPosition(leftAnchor);
		this.gridRight = this.toGridPosition(rightAnchor);
		this.leftOverlayView = 'closed';
		this.rightOverlayView = 'closed';

		this.updateTriggerLabel();
		this._onDidChangeMode.fire(newMode);
		this.options.onModeChange?.(newMode);
		this.renderPopup();
	}

	private applyRange(): void {
		if (!this.draftEnd) {
			return;
		}
		this.rangeStart = this.draftStart;
		this.rangeEnd = this.draftEnd;
		this.updateTriggerLabel();
		this.closePopup();

		const range: IDateRange = { start: this.rangeStart, end: this.rangeEnd };
		this._onDidChangeRange.fire(range);
		this.options.onRangeChange?.(range);
	}

	private isSameDay(date1: Date, date2: Date): boolean {
		return date1.getFullYear() === date2.getFullYear() &&
			date1.getMonth() === date2.getMonth() &&
			date1.getDate() === date2.getDate();
	}

	/** The last-applied (Gregorian) range. */
	getValue(): IDateRange {
		return { start: new Date(this.rangeStart), end: new Date(this.rangeEnd) };
	}

	/** Set the applied range (e.g. programmatic reset). Does not open the popup. */
	setValue(range: IDateRange): void {
		[this.rangeStart, this.rangeEnd] = CalendarRangePicker.normalizeRange(range.start, range.end);
		this.updateTriggerLabel();
	}

	getMode(): CalendarMode {
		return this.mode;
	}

	/** Swaps the pair if reversed, so every entry point into the widget (construction, setValue) gives the same start-before-end guarantee that interactive day-clicking already does via selectDay. */
	private static normalizeRange(start: Date, end: Date): [Date, Date] {
		return start > end ? [end, start] : [start, end];
	}
}
