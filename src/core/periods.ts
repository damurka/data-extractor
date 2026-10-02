/*---------------------------------------------------------------------------------------------
 *  Data Extractor: DHIS2 periods, Gregorian and Ethiopian
 *  Ported from DataSuite (workbench/services/dhis2/common/dhis2Periods.ts); keep the two in step until DataSuite's built-in extractor is removed.
 *--------------------------------------------------------------------------------------------*/

import { toEthiopic, toGregorian } from './ethiopicDate';

/**
 * DHIS2 period ids, as the analytics API accepts them. Shown to the AI in tool schemas, so keep it
 * short and exact.
 */
export const DHIS2_PERIOD_GRAMMAR = 'DHIS2 period ids: year 2024; month 202401; quarter 2024Q1; week 2024W5 (also 2024WedW5, 2024SunW5); bi-week 2024BiW1; bi-month 202401B; six-month 2024S1 (2024AprilS1, 2024NovS1); financial year 2024April/2024July/2024Oct/2024Nov; day 20240115. Relative: THIS_YEAR, LAST_YEAR, LAST_5_YEARS, THIS_MONTH, LAST_MONTH, LAST_3_MONTHS, LAST_6_MONTHS, LAST_12_MONTHS, MONTHS_THIS_YEAR, MONTHS_LAST_YEAR, THIS_QUARTER, LAST_QUARTER, LAST_4_QUARTERS, QUARTERS_THIS_YEAR, LAST_4_WEEKS, LAST_12_WEEKS, LAST_52_WEEKS, THIS_FINANCIAL_YEAR, LAST_FINANCIAL_YEAR. Ethiopian-calendar servers number periods in the Ethiopian calendar (e.g. 2016, 201601 = Meskerem 2016) -- relative periods work the same on every calendar.';

export const DHIS2_RELATIVE_PERIODS: ReadonlySet<string> = new Set([
	'TODAY', 'YESTERDAY', 'LAST_3_DAYS', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'LAST_60_DAYS', 'LAST_90_DAYS', 'LAST_180_DAYS',
	'THIS_WEEK', 'LAST_WEEK', 'LAST_4_WEEKS', 'LAST_12_WEEKS', 'LAST_52_WEEKS', 'WEEKS_THIS_YEAR',
	'THIS_BIWEEK', 'LAST_BIWEEK', 'LAST_4_BIWEEKS',
	'THIS_MONTH', 'LAST_MONTH', 'LAST_3_MONTHS', 'LAST_6_MONTHS', 'LAST_12_MONTHS', 'MONTHS_THIS_YEAR', 'MONTHS_LAST_YEAR',
	'THIS_BIMONTH', 'LAST_BIMONTH', 'LAST_6_BIMONTHS',
	'THIS_QUARTER', 'LAST_QUARTER', 'LAST_4_QUARTERS', 'QUARTERS_THIS_YEAR', 'QUARTERS_LAST_YEAR',
	'THIS_SIX_MONTH', 'LAST_SIX_MONTH', 'LAST_2_SIXMONTHS',
	'THIS_YEAR', 'LAST_YEAR', 'LAST_5_YEARS', 'LAST_10_YEARS',
	'THIS_FINANCIAL_YEAR', 'LAST_FINANCIAL_YEAR', 'LAST_5_FINANCIAL_YEARS', 'LAST_10_FINANCIAL_YEARS',
]);

const FIXED_PERIOD_PATTERNS: readonly RegExp[] = [
	/^\d{4}$/, // yearly
	/^\d{4}(0[1-9]|1[0-3])$/, // monthly (month 13 only exists on Ethiopian servers, which never generate it, but DHIS2 parses it)
	/^\d{4}(0[1-9]|1[0-2])B$/, // bi-monthly
	/^\d{4}Q[1-4]$/, // quarterly
	/^\d{4}NovQ[1-4]$/, // quarterly from November
	/^\d{4}(April|Nov)?S[12]$/, // six-monthly
	/^\d{4}(Wed|Thu|Sat|Sun)?W([1-9]|[1-4]\d|5[0-3])$/, // weekly
	/^\d{4}BiW([1-9]|1\d|2[0-7])$/, // bi-weekly
	/^\d{4}(April|July|Oct|Nov)$/, // financial years
	/^\d{4}(0[1-9]|1[0-3])(0[1-9]|[12]\d|30|31)$/, // daily
];

/**
 * Tidies the common near-miss spellings of a period id: `2024-01` -> `202401`, `2024-Q1`/`2024 q1`
 * -> `2024Q1`, `2024-W05` -> `2024W5`, `last_12_months` -> `LAST_12_MONTHS`. Anything else is
 * returned trimmed and otherwise unchanged.
 */
export function normalizePeriodId(pe: string): string {
	const t = pe.trim();
	if (/^[a-z_0-9]+$/i.test(t) && DHIS2_RELATIVE_PERIODS.has(t.toUpperCase())) {
		return t.toUpperCase();
	}
	let m = /^(\d{4})[-/.](\d{1,2})$/.exec(t);
	if (m) {
		return `${m[1]}${m[2].padStart(2, '0')}`;
	}
	m = /^(\d{4})[-\s]?q([1-4])$/i.exec(t);
	if (m) {
		return `${m[1]}Q${m[2]}`;
	}
	m = /^(\d{4})[-\s]?w0*(\d{1,2})$/i.exec(t);
	if (m) {
		return `${m[1]}W${m[2]}`;
	}
	m = /^(\d{4})[-\s]?s([12])$/i.exec(t);
	if (m) {
		return `${m[1]}S${m[2]}`;
	}
	m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
	if (m) {
		return `${m[1]}${m[2]}${m[3]}`;
	}
	return t;
}

/** Whether `pe` (already normalised) is a DHIS2 fixed or relative period id. */
export function isValidPeriodId(pe: string): boolean {
	return DHIS2_RELATIVE_PERIODS.has(pe) || FIXED_PERIOD_PATTERNS.some(p => p.test(pe));
}

/**
 * Parses `YYYY-MM-DD` (or `YYYY-MM`, or `YYYY`) into calendar parts without going through
 * `new Date(string)` -- which reads a date-only string as UTC midnight, so local getters in a
 * timezone west of UTC land on the previous day (and `2024-01-01` became December 2023).
 */
export function parseIsoDateParts(value: string): { year: number; month: number; day: number } | undefined {
	const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/.exec(value.trim());
	if (!m) {
		return undefined;
	}
	const year = Number(m[1]);
	const month = m[2] ? Number(m[2]) : 1;
	const day = m[3] ? Number(m[3]) : 1;
	if (month < 1 || month > 12 || day < 1 || day > 31) {
		return undefined;
	}
	return { year, month, day };
}

/** Whether a DHIS2 server calendar (system/info's `calendar`) is the Ethiopian one. */
export function isEthiopianCalendar(calendar: string | undefined): boolean {
	return calendar === 'ethiopian' || calendar === 'ethiopic';
}

/**
 * The Gregorian year and month (1-12) a fixed yearly or monthly period id of the server stands for -- how exports
 * label Ethiopian periods in the Gregorian calendar, and the `year`/`month` columns of the tidy CSV files.
 * - Gregorian server: the period's own year and month.
 * - Ethiopian server: a month is labelled with the Gregorian month it starts in (Ethiopian months start between the
 *   7th and the 12th, so that month holds most of its days, and no two months share one: Meskerem -> September ...
 *   Nehase -> August); a year with the Gregorian year holding most of it (it runs from September: EC 2016 =
 *   September 2023 to September 2024 -> 2024).
 * Undefined for any other period (quarters, weeks, relative periods...).
 */
export function gregorianYearMonth(periodId: string, calendar: string | undefined): { year: number; month?: number } | undefined {
	const match = /^(\d{4})(\d{2})?$/.exec(String(periodId).trim());
	if (!match) {
		return undefined;
	}
	const year = Number(match[1]);
	const month = match[2] === undefined ? undefined : Number(match[2]);
	if (month !== undefined && (month < 1 || month > 13)) {
		return undefined;
	}
	if (!isEthiopianCalendar(calendar)) {
		return month === undefined ? { year } : (month <= 12 ? { year, month } : undefined);
	}
	if (month === undefined) {
		return { year: toGregorian(year, 1, 1).getFullYear() + 1 };
	}
	const start = toGregorian(year, month, 1);
	return { year: start.getFullYear(), month: start.getMonth() + 1 };
}

/**
 * The fixed DHIS2 period ids covering `start`..`end` (YYYY-MM-DD, both inclusive), yearly or
 * monthly, in the server's calendar. On an Ethiopian-calendar server the ids carry Ethiopian
 * year/month numbers ("201401" = Meskerem 2014); the 13th month (Pagume) has no monthly period,
 * so a boundary inside it clamps to month 12. Throws for an unparseable date.
 */
export function generateDhis2Periods(startDate: string, endDate: string, periodType: 'monthly' | 'yearly', calendar?: string): string[] {
	const start = parseIsoDateParts(startDate);
	const end = parseIsoDateParts(endDate);
	if (!start || !end) {
		throw new Error(`Invalid date range "${startDate}" to "${endDate}" -- use YYYY-MM-DD.`);
	}

	let from = { year: start.year, month: start.month };
	let to = { year: end.year, month: end.month };
	if (isEthiopianCalendar(calendar)) {
		// Local-time Date built from parts, matching toEthiopic's local getters.
		const s = toEthiopic(new Date(start.year, start.month - 1, start.day));
		const e = toEthiopic(new Date(end.year, end.month - 1, end.day));
		from = { year: s.year, month: Math.min(s.month, 12) };
		to = { year: e.year, month: Math.min(e.month, 12) };
	}

	const periods: string[] = [];
	if (periodType === 'yearly') {
		for (let y = from.year; y <= to.year; y++) {
			periods.push(String(y));
		}
		return periods;
	}

	let { year, month } = from;
	while (year < to.year || (year === to.year && month <= to.month)) {
		periods.push(`${year}${String(month).padStart(2, '0')}`);
		month++;
		if (month > 12) {
			month = 1;
			year++;
		}
	}
	return periods;
}
