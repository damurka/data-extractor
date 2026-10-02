/*---------------------------------------------------------------------------------------------
 *  Data Extractor: Ethiopian month names
 *  Ported from DataSuite (base/common/ethiopicMonths.ts); keep the two in step until DataSuite's built-in extractor is removed.
 *--------------------------------------------------------------------------------------------*/

import { localize } from './l10n';

/**
 * Ethiopic month names - localized for the current language.
 * These are used by the calendar widget to display month names.
 */

export function getEthiopicMonthsLocalized(): readonly string[] {
	return [
		localize('ethiopic.month.meskerem', 'Meskerem'),
		localize('ethiopic.month.tikimit', 'Tikimit'),
		localize('ethiopic.month.hidar', 'Hidar'),
		localize('ethiopic.month.tahsas', 'Tahsas'),
		localize('ethiopic.month.ter', 'Ter'),
		localize('ethiopic.month.yekatit', 'Yekatit'),
		localize('ethiopic.month.megabit', 'Megabit'),
		localize('ethiopic.month.miaziah', 'Miaziah'),
		localize('ethiopic.month.genbot', 'Genbot'),
		localize('ethiopic.month.sene', 'Sene'),
		localize('ethiopic.month.hamile', 'Hamile'),
		localize('ethiopic.month.nehase', 'Nehase'),
		localize('ethiopic.month.pagume', 'Pagume')
	];
}

export function getEthiopicMonthShortLocalized(): readonly string[] {
	return [
		localize('ethiopic.month.short.meskerem', 'Mes'),
		localize('ethiopic.month.short.tikimit', 'Tik'),
		localize('ethiopic.month.short.hidar', 'Hid'),
		localize('ethiopic.month.short.tahsas', 'Tah'),
		localize('ethiopic.month.short.ter', 'Ter'),
		localize('ethiopic.month.short.yekatit', 'Yek'),
		localize('ethiopic.month.short.megabit', 'Meg'),
		localize('ethiopic.month.short.miaziah', 'Mia'),
		localize('ethiopic.month.short.genbot', 'Gen'),
		localize('ethiopic.month.short.sene', 'Sen'),
		localize('ethiopic.month.short.hamile', 'Ham'),
		localize('ethiopic.month.short.nehase', 'Neh'),
		localize('ethiopic.month.short.pagume', 'Pag')
	];
}

export function getEthiopicMonthNameLocalized(month: number): string {
	const months = getEthiopicMonthsLocalized();
	if (month < 1 || month > 13) {
		throw new Error(`Invalid Ethiopic month: ${month}`);
	}
	return months[month - 1];
}
