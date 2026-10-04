/*---------------------------------------------------------------------------------------------
 *  Data Extractor: how the screens write periods, levels, sizes, times and how long is left.
 *--------------------------------------------------------------------------------------------*/

import { toEthiopic } from '../core/ethiopicDate';
import { OrgUnitLevel } from '../shared/api';
import { dateFormat, formatNumber } from './locale';

export const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/+$/, '');

/** What a connection's server is called: its country when DataSuite knows it, else its address. (A connection's `displayName` is the user's own name.) */
export const serverName = (connection: { readonly serverUrl: string; readonly country?: string }) => connection.country?.trim() ? `${connection.country.trim()} DHIS2` : hostOf(connection.serverUrl);

/** Who is signed in: "David Kariuki (damurka)". */
export const signedInAs = (connection: { readonly username: string; readonly displayName?: string }) =>
	connection.displayName?.trim() && connection.displayName.trim() !== connection.username ? `${connection.displayName.trim()} (${connection.username})` : connection.username;

export const ETHIOPIC_MONTHS = ['Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit', 'Megabit', 'Miyazya', 'Ginbot', 'Sene', 'Hamle', 'Nehase'] as const;

/** A month's short name in the display language: `monthName(0)` is "Jan". */
export const monthName = (month: number) => dateFormat({ month: 'short' }).format(new Date(2000, month, 1));

const parts = (iso: string) => {
	const [y, m, d] = iso.split('-').map(Number);
	return { year: y, month: (m || 1) - 1, day: d || 1 };
};

/** A download's periods in a few words: "Jan – Dec 2024", "Jul 2023 – Jun 2024", "2023", "2022 – 2025". */
export function periodRange(startDate: string, endDate: string, periodType: string, ethiopic = false): string {
	const s = parts(startDate), e = parts(endDate);
	if (ethiopic) {
		const a = toEthiopic(new Date(s.year, s.month, s.day)), b = toEthiopic(new Date(e.year, e.month, e.day));
		const name = (m: number) => ETHIOPIC_MONTHS[Math.min(m, 12) - 1];
		if (periodType === 'yearly') {
			return a.year === b.year ? `${a.year} EC` : `${a.year} – ${b.year} EC`;
		}
		return a.year === b.year ? (a.month === b.month ? `${name(a.month)} ${a.year} EC` : `${name(a.month)} – ${name(b.month)} ${a.year} EC`) : `${name(a.month)} ${a.year} – ${name(b.month)} ${b.year} EC`;
	}
	if (periodType === 'yearly') {
		return s.year === e.year ? String(s.year) : `${s.year} – ${e.year}`;
	}
	if (s.year === e.year) {
		return s.month === e.month ? `${monthName(s.month)} ${s.year}` : s.month === 0 && e.month === 11 ? String(s.year) : `${monthName(s.month)} – ${monthName(e.month)} ${s.year}`;
	}
	return `${monthName(s.month)} ${s.year} – ${monthName(e.month)} ${e.year}`;
}

/** "Level 3, Sub-County" from `LEVEL-3` and the server's levels. */
export function levelLabel(adminLevel: string, levels: readonly OrgUnitLevel[] | undefined): string {
	const n = Number(adminLevel.replace('LEVEL-', ''));
	const name = levels?.find(l => l.level === n)?.name;
	return name ? `Level ${n}, ${name}` : `Level ${n}`;
}

/** Megabytes from a size as the downloads keep it ("1.84 MB"); 0 when it has none. */
export const megabytes = (size: string | undefined) => { const n = parseFloat(size ?? ''); return Number.isFinite(n) ? n : 0; };

export function formatSize(megabytesTotal: number): string {
	return megabytesTotal >= 1 ? `${megabytesTotal.toFixed(1)} MB` : megabytesTotal > 0 ? `${Math.max(1, Math.round(megabytesTotal * 1024))} KB` : '0 MB';
}

export function formatBytes(bytes: number): string {
	return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "About 4 min left" from seconds. */
export function timeLeft(seconds: number | undefined): string {
	if (seconds === undefined || !Number.isFinite(seconds)) {
		return '';
	}
	if (seconds < 60) {
		return 'Under a minute left';
	}
	const minutes = Math.round(seconds / 60);
	return minutes < 90 ? `About ${minutes} min left` : `About ${Math.round(minutes / 60)} h left`;
}

/** When something happened, briefly: "Today, 09:12", "Yesterday", "29 Sep", "29 Sep 2024". */
export function when(time: number | undefined, fallback = '-'): string {
	if (!time) {
		return fallback;
	}
	const date = new Date(time), now = new Date();
	const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const days = Math.round((day(now) - day(date)) / 86_400_000);
	if (days === 0) {
		return `Today, ${dateFormat({ hour: '2-digit', minute: '2-digit' }).format(date)}`;
	}
	if (days === 1) {
		return 'Yesterday';
	}
	return dateFormat(date.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

/** "1 source", "3 sources". */
export const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
