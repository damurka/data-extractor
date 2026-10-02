/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the downloaded data as Countdown sheets
 *  Ported from DataSuite (workbench/services/dhis2/common/dhis2ExportProcessorService.ts); keep the two in step until DataSuite's built-in extractor is removed.
 *--------------------------------------------------------------------------------------------*/

import { toEthiopic } from './ethiopicDate';
import { getEthiopicMonthsLocalized } from './ethiopicMonths';
import { gregorianYearMonth } from './periods';
import { COUNTDOWN_INDICATORS } from './countdown';
import { IAddMappingDraft, IDhis2AnalyticsRow, IDhis2OrgUnitWithLevels, IIndicatorDraft, IIndicatorSourceDraft } from './types';

export type Dhis2PeriodCalendar = 'gregorian' | 'ethiopic';

/**
 * Converts a raw DHIS2 period id (e.g. "202401", "201401", "2024") into a display year/month,
 * optionally translating between calendars -- e.g. an Ethiopic-numbered period id ("201401" =
 * Ethiopic year 2014, Meskerem) can be shown either as-is or converted to its equivalent
 * Gregorian month/year for readability. Anchors on the 1st of the month (or Meskerem 1 / January
 * 1 for a year-only period) since only a display label is needed, not an exact date.
 */
export function resolvePeriodLabel(periodId: string, sourceCalendar: Dhis2PeriodCalendar, labelCalendar: Dhis2PeriodCalendar): { year: string; month: string } {
	const peStr = String(periodId).trim();
	const yearNum = parseInt(peStr.substring(0, 4), 10);
	if (isNaN(yearNum)) {
		return { year: peStr, month: '' };
	}

	const hasMonth = peStr.length >= 6;
	const rawMonthNum = hasMonth ? parseInt(peStr.substring(4, 6), 10) : 1;
	const monthNum = (!isNaN(rawMonthNum) && rawMonthNum >= 1) ? rawMonthNum : 1;

	if (sourceCalendar === labelCalendar) {
		if (sourceCalendar === 'ethiopic') {
			return { year: String(yearNum), month: hasMonth ? (getEthiopicMonthsLocalized()[Math.min(monthNum, 13) - 1] ?? '') : '' };
		}
		return { year: String(yearNum), month: hasMonth ? new Date(2000, monthNum - 1, 1).toLocaleString('en-US', { month: 'long' }) : '' };
	}

	if (sourceCalendar === 'ethiopic') {
		// the Gregorian month an Ethiopian month starts in; a year -> the Gregorian year holding most of it
		const gregorian = gregorianYearMonth(hasMonth ? `${yearNum}${String(Math.min(monthNum, 13)).padStart(2, '0')}` : String(yearNum), 'ethiopian');
		if (!gregorian) {
			return { year: peStr, month: '' };
		}
		return { year: String(gregorian.year), month: gregorian.month ? new Date(2000, gregorian.month - 1, 1).toLocaleString('en-US', { month: 'long' }) : '' };
	}

	const gregorianDate = new Date(yearNum, monthNum - 1, 1);
	const ethiopicDate = toEthiopic(gregorianDate);
	return { year: String(ethiopicDate.year), month: hasMonth ? (getEthiopicMonthsLocalized()[ethiopicDate.month - 1] ?? '') : '' };
}

export interface IAggregatedDataRow {
	district: string;
	year: string;
	month?: string;
	[exportCode: string]: number | string | null | undefined;
}

export interface IAdminDataRow {
	country: string;
	first_admin_level: string;
	district_name: string;
	[exportCode: string]: number | string | null | undefined;
}

export interface ICategorizedExport {
	population: IAggregatedDataRow[];
	completeness: IAggregatedDataRow[];
	service: IAggregatedDataRow[];
	admin: IAdminDataRow[];
}

export interface IExcelColumn {
	code: string;
	name: string;
}

export interface IDhis2ExportItem {
	headerRow1_HiddenCodes: string[];
	headerRow2_VisibleNames: string[];
	dataRows: (string | number | null)[][];
}

export interface IDhis2Export {
	population: IDhis2ExportItem;
	completeness: IDhis2ExportItem;
	service: IDhis2ExportItem;
	admin: IDhis2ExportItem;
}

export interface IDhis2ExportProcessor {

	aggregateDataByExportCode(
		mappingDraft: IAddMappingDraft,
		rawDhis2Data: IDhis2AnalyticsRow[],
		orgUnits: IDhis2OrgUnitWithLevels[]
	): ICategorizedExport;

	generateExcelStructures(
		mappingDraft: IAddMappingDraft,
		aggregatedData: ICategorizedExport,
		periods: string[],
		orgUnits: IDhis2OrgUnitWithLevels[],
		sourceCalendar?: Dhis2PeriodCalendar,
		labelCalendar?: Dhis2PeriodCalendar
	): IDhis2Export;
}

export class Dhis2ExportProcessor implements IDhis2ExportProcessor {

	public aggregateDataByExportCode(
		mappingDraft: IAddMappingDraft,
		rawDhis2Data: IDhis2AnalyticsRow[],
		orgUnits: IDhis2OrgUnitWithLevels[]
	): ICategorizedExport {

		const popMap: Record<string, Record<string, number | null>> = {};
		const compMap: Record<string, Record<string, number | null>> = {};
		const serviceMap: Record<string, Record<string, number | null>> = {};

		const uidToExportCode = new Map<string, Array<{ code: string; category: 'pop' | 'comp' | 'service' }>>();

		const addTarget = (uid: string, target: { code: string; category: 'pop' | 'comp' | 'service' }) => {
			let list = uidToExportCode.get(uid);
			if (!list) {
				list = [];
				uidToExportCode.set(uid, list);
			}
			list.push(target);
		};

		const ouLookup = new Map<string, IDhis2OrgUnitWithLevels>();
		for (const ou of orgUnits) {
			ouLookup.set(ou.id, ou);
		}

		mappingDraft.indicators.forEach((ind: IIndicatorDraft) => {
			if (!ind.exportCode || !ind.sources) { return; }

			let baseCategory: 'pop' | 'comp' | 'service' = 'service';
			const countdownMeta = COUNTDOWN_INDICATORS.find(c => c.id === ind.exportCode);

			if (countdownMeta?.category) {
				const cat = countdownMeta.category.toLowerCase();
				if (cat.includes('population')) { baseCategory = 'pop'; }
				else if (cat.includes('completeness')) { baseCategory = 'comp'; }
			}

			ind.sources.forEach((src: IIndicatorSourceDraft) => {
				if (src.type === 'DataSet' || src.type === 'Dataset') {
					addTarget(`${src.id}.REPORTING_RATE`, { code: `${ind.exportCode}_reporting_rate`, category: 'comp' });
					addTarget(`${src.id}.ACTUAL_REPORTS`, { code: `${ind.exportCode}_reporting_received`, category: 'comp' });
					addTarget(`${src.id}.EXPECTED_REPORTS`, { code: `${ind.exportCode}_reporting_expected`, category: 'comp' });
				} else {
					const checkedCocs = (src.cocs || []).filter(c => c.checked);

					// `categoryComboIsDefault` (not a Category Option Combo name -- see ADR-0015) is the
					// authoritative "nothing to disaggregate" signal; COC names are admin-generated text
					// that can go stale and must never be pattern-matched to infer disaggregation state.
					if (checkedCocs.length === 0 || checkedCocs.length === src.cocs?.length || src.categoryComboIsDefault) {
						addTarget(src.id, { code: ind.exportCode!, category: baseCategory });
					} else {
						checkedCocs.forEach(coc => {
							addTarget(`${src.id}.${coc.uid}`, { code: ind.exportCode!, category: baseCategory });
						});
					}
				}
			});
		});

		for (const row of rawDhis2Data) {
			const targets = uidToExportCode.get(row.dx);
			if (!targets) { continue; }

			for (const target of targets) {
				let targetMap = serviceMap;
				let rowKey = `${row.ou}_${row.pe}`;

				if (target.category === 'pop') {
					targetMap = popMap;
					const popYear = String(row.pe).substring(0, 4);
					rowKey = `${row.ou}_${popYear}`;
				} else if (target.category === 'comp') {
					targetMap = compMap;
				}

				if (!targetMap[rowKey]) { targetMap[rowKey] = {}; }
				if (targetMap[rowKey][target.code] === undefined) { targetMap[rowKey][target.code] = null; }

				if (row.value !== null) {
					if (targetMap[rowKey][target.code] === null) { targetMap[rowKey][target.code] = row.value; }
					else { targetMap[rowKey][target.code]! += row.value; }
				}
			}
		}

		const flattenPeriodicMap = (map: Record<string, Record<string, number | null>>, includeMonth: boolean): IAggregatedDataRow[] => {
			const flatArray: IAggregatedDataRow[] = [];
			for (const [key, metrics] of Object.entries(map)) {
				const [ouId, pe] = key.split('_');

				const peStr = String(pe).trim();
				let year = peStr;
				let month = '';

				// Safely parse month using strict en-US locale
				if (peStr.length >= 6) {
					year = peStr.substring(0, 4);
					const monthNum = parseInt(peStr.substring(4, 6), 10);
					if (!isNaN(monthNum) && monthNum >= 1 && monthNum <= 12) {
						const date = new Date(2000, monthNum - 1, 1);
						month = date.toLocaleString('en-US', { month: 'long' });
					}
				}

				const ouInfo = ouLookup.get(ouId);
				const rowData: IAggregatedDataRow = {
					district: ouInfo?.name || ouId,
					year: year,
					...metrics
				};

				if (includeMonth) { rowData.month = month; }
				flatArray.push(rowData);
			}
			return flatArray;
		};

		const adminDataArray: IAdminDataRow[] = orgUnits.map(ou => ({
			country: ou.level1_name || 'Unknown',
			first_admin_level: ou.level2_name || (ou.level === 2 ? ou.name : 'Unknown'),
			district_name: ou.name || ou.id
		}));

		return {
			population: flattenPeriodicMap(popMap, false),
			completeness: flattenPeriodicMap(compMap, true),
			service: flattenPeriodicMap(serviceMap, true),
			admin: adminDataArray
		};
	}

	public generateExcelStructures(
		mappingDraft: IAddMappingDraft,
		categorizedData: ICategorizedExport,
		periods: string[],
		orgUnits: IDhis2OrgUnitWithLevels[],
		sourceCalendar: Dhis2PeriodCalendar = 'gregorian',
		labelCalendar: Dhis2PeriodCalendar = 'gregorian'
	): IDhis2Export {
		const popCols: IExcelColumn[] = [];
		const compCols: IExcelColumn[] = [];
		const serviceCols: IExcelColumn[] = [];

		mappingDraft.indicators.forEach(ind => {
			if (!ind.exportCode) { return; }

			const countdownMeta = COUNTDOWN_INDICATORS.find(c => c.id === ind.exportCode);
			const cat = countdownMeta?.category?.toLowerCase() || '';

			const isPop = cat.includes('population');
			const isComp = ind.sources?.some(s => s.type === 'DataSet' || s.type === 'Dataset') || cat.includes('completeness');

			if (isComp) {
				compCols.push({ code: `${ind.exportCode}_reporting_expected`, name: 'Expected number (#)' });
				compCols.push({ code: `${ind.exportCode}_reporting_received`, name: 'Received number (#)' });
				compCols.push({ code: `${ind.exportCode}_reporting_rate`, name: 'Reporting completeness rate (%)' });
			} else if (isPop) {
				popCols.push({ code: ind.exportCode, name: ind.internalName || ind.exportCode });
			} else {
				serviceCols.push({ code: ind.exportCode, name: ind.internalName || ind.exportCode });
			}
		});

		const buildSheet = (columns: IExcelColumn[], dataArray: IAggregatedDataRow[], hideMonth: boolean): IDhis2ExportItem => {
			const row1 = ['district', 'year'];
			const row2 = ['District name', 'Year'];

			if (!hideMonth) {
				row1.push('month');
				row2.push('Month');
			}
			columns.forEach(c => { row1.push(c.code); row2.push(c.name); });

			const lookup = new Map<string, IAggregatedDataRow>();
			for (const row of dataArray) {
				const monthKey = hideMonth ? '' : `_${row.month}`;
				const key = `${row.district}_${row.year}${monthKey}`;
				const existing = lookup.get(key) || {};
				lookup.set(key, { ...existing, ...row });
			}

			const dataRows: (string | number | null)[][] = [];

			// Generate safe strings for all years
			const uniqueYears = Array.from(new Set(periods.map(p => String(p).trim().substring(0, 4))));
			const periodsToUse = hideMonth ? uniqueYears : periods;

			for (const ou of orgUnits) {
				for (const pe of periodsToUse) {
					const peStr = String(pe).trim();
					let year = peStr;
					let month = '';

					// Safely parse periods to match the exact keys generated during aggregation
					// (always Gregorian-numbered digit parsing here -- this is only a lookup key,
					// not the displayed label, so it must stay identical to flattenPeriodicMap's key derivation)
					if (!hideMonth && peStr.length >= 6) {
						year = peStr.substring(0, 4);
						const monthNum = parseInt(peStr.substring(4, 6), 10);
						if (!isNaN(monthNum) && monthNum >= 1 && monthNum <= 12) {
							const date = new Date(2000, monthNum - 1, 1);
							month = date.toLocaleString('en-US', { month: 'long' });
						}
					}

					const district = ou.name;
					const monthKey = hideMonth ? '' : `_${month}`;
					const rowKey = `${district}_${year}${monthKey}`;

					const dataForThisRow: Partial<IAggregatedDataRow> = lookup.get(rowKey) || {};

					const displayLabel = resolvePeriodLabel(peStr, sourceCalendar, labelCalendar);
					const rowData: (string | number | null)[] = [district, displayLabel.year];
					if (!hideMonth) { rowData.push(displayLabel.month); }

					for (const col of columns) {
						const val = dataForThisRow[col.code];
						rowData.push((val === null || val === undefined) ? '' : val);
					}
					dataRows.push(rowData);
				}
			}
			return { headerRow1_HiddenCodes: row1, headerRow2_VisibleNames: row2, dataRows };
		};

		const buildAdminSheet = (dataArray: IAdminDataRow[]): IDhis2ExportItem => {
			const row1 = ['district_name', 'first_admin_level', 'country'];
			const row2 = ['District', 'Region', 'Country'];
			const dataRows: (string | number | null)[][] = [];

			for (const row of dataArray) {
				dataRows.push([row.district_name, row.first_admin_level, row.country]);
			}

			return { headerRow1_HiddenCodes: row1, headerRow2_VisibleNames: row2, dataRows };
		};

		return {
			population: buildSheet(popCols, categorizedData.population, true),
			completeness: buildSheet(compCols, categorizedData.completeness, false),
			service: buildSheet(serviceCols, categorizedData.service, false),
			admin: buildAdminSheet(categorizedData.admin)
		};
	}
}
