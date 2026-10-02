/*---------------------------------------------------------------------------------------------
 *  Data Extractor: Ethiopian <-> Gregorian dates
 *  Ported from DataSuite (base/common/ethiopicDate.ts); keep the two in step until DataSuite's built-in extractor is removed.
 *--------------------------------------------------------------------------------------------*/

/**
 * Ethiopic (Ethiopian) calendar conversion utilities.
 *
 * The Ethiopic calendar is a solar calendar with 13 months:
 * - 12 regular months of 30 days each
 * - 1 additional month (Pagume) with 5 or 6 days (in leap years)
 *
 * The Ethiopic year is 7 years behind the Gregorian year from Ethiopic New Year (Meskerem 1) to
 * December 31, and 8 years behind from January 1 until the next New Year. Meskerem 1 is September 11,
 * or September 12 in the Gregorian year before a Gregorian leap year (e.g. 2023-09-12 = Meskerem 1, 2016).
 * Conversion goes through the Julian Day Number, so it is exact for any date.
 */

export interface IEthiopicDate {
	readonly year: number;
	readonly month: number; // 1-13 (Meskerem to Pagume)
	readonly day: number;
}

const ETHIOPIC_MONTHS_IN_YEAR = 13;
const REGULAR_MONTH_DAYS = 30;

/** Julian Day Number of the day before Meskerem 1, year 1 (Amete Mihret era), as used by the standard Ethiopic conversion. */
const JD_EPOCH_OFFSET_AMETE_MIHRET = 1723856;
/** Julian Day Number of 1970-01-01. */
const UNIX_EPOCH_JDN = 2440588;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Ethiopic month names (used internally; externalized strings are in ethiopicMonths.ts)
export const ETHIOPIC_MONTH_NAMES: readonly string[] = [
	'Meskerem',
	'Tikimit',
	'Hidar',
	'Tahsas',
	'Ter',
	'Yekatit',
	'Megabit',
	'Miaziah',
	'Genbot',
	'Sene',
	'Hamile',
	'Nehase',
	'Pagume'
];

/** Julian Day Number of a (local) calendar date -- computed from its local year/month/day so the time of day and DST never matter. */
function gregorianToJdn(date: Date): number {
	return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY) + UNIX_EPOCH_JDN;
}

/** Local-midnight Date for a Julian Day Number. */
function jdnToLocalDate(jdn: number): Date {
	const utc = new Date((jdn - UNIX_EPOCH_JDN) * MS_PER_DAY);
	return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

/**
 * Converts a Gregorian date to Ethiopic date.
 *
 * @param date - The Gregorian date to convert (its local calendar date is used)
 * @returns An object with year, month (1-13), and day
 */
export function toEthiopic(date: Date): IEthiopicDate {
	const days = gregorianToJdn(date) - JD_EPOCH_OFFSET_AMETE_MIHRET;
	const r = ((days % 1461) + 1461) % 1461;
	const n = (r % 365) + 365 * Math.floor(r / 1460);
	const year = 4 * Math.floor(days / 1461) + Math.floor(r / 365) - Math.floor(r / 1460);
	return { year, month: Math.floor(n / REGULAR_MONTH_DAYS) + 1, day: (n % REGULAR_MONTH_DAYS) + 1 };
}

/**
 * Converts an Ethiopic date to a Gregorian date.
 *
 * @param year - Ethiopic year
 * @param month - Ethiopic month (1-13)
 * @param day - Ethiopic day
 * @returns A Date object (local midnight) representing the Gregorian date
 */
export function toGregorian(year: number, month: number, day: number): Date {
	if (!isValidEthiopicDate(year, month, day)) {
		throw new Error(`Invalid Ethiopic date: ${year}-${month}-${day}`);
	}
	const jdn = (JD_EPOCH_OFFSET_AMETE_MIHRET + 365) + 365 * (year - 1) + Math.floor(year / 4) + REGULAR_MONTH_DAYS * month + day - 31;
	return jdnToLocalDate(jdn);
}

/**
 * Validates whether an Ethiopic date is valid.
 *
 * @param year - Ethiopic year
 * @param month - Ethiopic month (1-13)
 * @param day - Ethiopic day
 * @returns true if the date is valid, false otherwise
 */
export function isValidEthiopicDate(year: number, month: number, day: number): boolean {
	if (month < 1 || month > ETHIOPIC_MONTHS_IN_YEAR) {
		return false;
	}

	if (month < ETHIOPIC_MONTHS_IN_YEAR) {
		// Regular months have 30 days
		return day >= 1 && day <= REGULAR_MONTH_DAYS;
	} else {
		// Pagume (13th month): 5 days in regular years, 6 days in leap years
		const isLeap = isLeapYearEthiopic(year);
		const maxDays = isLeap ? 6 : 5;
		return day >= 1 && day <= maxDays;
	}
}

/**
 * Checks if an Ethiopic year is a leap year (Pagume has 6 days): every fourth year, the one whose
 * number leaves remainder 3 when divided by 4 (e.g. 2015, whose Pagume ended on 2023-09-11).
 *
 * @param year - Ethiopic year
 * @returns true if the year is a leap year
 */
export function isLeapYearEthiopic(year: number): boolean {
	return ((year % 4) + 4) % 4 === 3;
}

/**
 * Checks if a Gregorian year is a leap year.
 *
 * @param year - Gregorian year
 * @returns true if the year is a leap year
 */
export function isLeapYearGregorian(year: number): boolean {
	if (year % 400 === 0) {
		return true;
	}
	if (year % 100 === 0) {
		return false;
	}
	if (year % 4 === 0) {
		return true;
	}
	return false;
}

/**
 * Gets the number of days in an Ethiopic month.
 *
 * @param month - Ethiopic month (1-13)
 * @param year - Ethiopic year (needed for Pagume to determine leap year)
 * @returns Number of days in the month
 */
export function getEthiopicMonthDays(month: number, year: number): number {
	if (month < 1 || month > ETHIOPIC_MONTHS_IN_YEAR) {
		throw new Error(`Invalid Ethiopic month: ${month}`);
	}

	if (month < ETHIOPIC_MONTHS_IN_YEAR) {
		return REGULAR_MONTH_DAYS;
	} else {
		// Pagume (13th month)
		return isLeapYearEthiopic(year) ? 6 : 5;
	}
}

/**
 * Gets the Ethiopic month name.
 *
 * @param month - Ethiopic month (1-13)
 * @returns The English name of the month
 */
export function getEthiopicMonthName(month: number): string {
	if (month < 1 || month > ETHIOPIC_MONTHS_IN_YEAR) {
		throw new Error(`Invalid Ethiopic month: ${month}`);
	}
	return ETHIOPIC_MONTH_NAMES[month - 1];
}
