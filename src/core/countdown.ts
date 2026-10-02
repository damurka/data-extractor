/*---------------------------------------------------------------------------------------------
 *  Data Extractor: the Countdown 2030 indicators and their categories
 *  Ported from DataSuite (workbench/services/dhis2/common/dhis2WorkbenchService.ts); keep the two in step until DataSuite's built-in extractor is removed.
 *--------------------------------------------------------------------------------------------*/

import { localize } from './l10n';
import { IIndicatorDraft } from './types';

export interface ICountdownIndicator {
	id: string;
	title: string;
	category: string;
}

export const COUNTDOWN_INDICATORS: ICountdownIndicator[] = [
	// Admin_data
	{ id: 'Number_hospitals', title: localize('dhis2.indicator.hospitals', 'Total number of hospitals (based on country definition)'), category: localize('dhis2.category.adminData', 'Admin_data') },
	{ id: 'Number_hcenters', title: localize('dhis2.indicator.hcenters', 'Total number of health centres (non-hospitals; based on country definition)'), category: localize('dhis2.category.adminData', 'Admin_data') },
	{ id: 'Total_number_health_facilities', title: localize('dhis2.indicator.healthFcilities', 'Total number of health facilities (all types/categories)'), category: localize('dhis2.category.adminData', 'Admin_data') },
	{ id: 'Number_pfacilities_profit', title: localize('dhis2.indicator.profit', 'Total number of health facilities that are private-for-profit'), category: localize('dhis2.category.adminData', 'Admin_data') },
	{ id: 'Number_pfacilities_nonprofit', title: localize('dhis2.indicator.nonprofit', 'Total number of health facilities that are private-non-profit'), category: localize('dhis2.category.adminData', 'Admin_data') },
	{ id: 'Total_physicians', title: localize('dhis2.indicator.physicians', 'Total number of physicians/Medical officers'), category: localize('dhis2.category.adminData', 'Admin_data') },
	{ id: 'Total_nurses_midwives', title: localize('dhis2.indicator.nurses', 'Total number of nurses / midwives'), category: localize('dhis2.category.adminData', 'Admin_data') },
	{ id: 'Total_clinical_officers', title: localize('dhis2.indicator.clinicalOfficers', 'Total number of clinical officers/Assistant medical officers'), category: localize('dhis2.category.adminData', 'Admin_data') },
	{ id: 'Total_nonclinique_physicians', title: localize('dhis2.indicator.nonclinique', 'Total number of non-clinician physicians'), category: localize('dhis2.category.adminData', 'Admin_data') },
	{ id: 'Number_hospital_beds', title: localize('dhis2.indicator.hospitalBeds', 'Number of hospital beds'), category: localize('dhis2.category.adminData', 'Admin_data') },

	// Population_data
	{ id: 'Total_Population', title: localize('dhis2.indicator.totalPopulation', 'Total Population'), category: localize('dhis2.category.populationData', 'Population_data') },
	{ id: 'Population_ under_5years', title: localize('dhis2.indicator.under5', 'Population under 5 years'), category: localize('dhis2.category.populationData', 'Population_data') },
	{ id: 'Population_under_1year', title: localize('dhis2.indicator.under1', 'Population under 1 year'), category: localize('dhis2.category.populationData', 'Population_data') },
	{ id: 'Live_births', title: localize('dhis2.indicator.liveBirths', 'Projected total Live births (Estimated live births from census)'), category: localize('dhis2.category.populationData', 'Population_data') },
	{ id: 'Total_births', title: localize('dhis2.indicator.totalBirths', 'Projected total births (Estimated births from census)'), category: localize('dhis2.category.populationData', 'Population_data') },
	{ id: 'Women_15_49_years', title: localize('dhis2.indicator.wra', 'Total women 15-49 years'), category: localize('dhis2.category.populationData', 'Population_data') },

	// Reporting completeness
	{ id: 'ANC', title: localize('dhis2.indicator.anc', 'ANC reporting'), category: localize('dhis2.category.reportingCompleteness', 'Reporting_completeness') },
	{ id: 'Instdelivey', title: localize('dhis2.indicator.instdelivey', 'Institutional delivery reporting'), category: localize('dhis2.category.reportingCompleteness', 'Reporting_completeness') },
	{ id: 'Vacc', title: localize('dhis2.indicator.vacc', 'Vaccinations reporting'), category: localize('dhis2.category.reportingCompleteness', 'Reporting_completeness') },
	{ id: 'OPD', title: localize('dhis2.indicator.opd', 'OPD visits reporting'), category: localize('dhis2.category.reportingCompleteness', 'Reporting_completeness') },
	{ id: 'IPD', title: localize('dhis2.indicator.ipd', 'IPD admissions reporting'), category: localize('dhis2.category.reportingCompleteness', 'Reporting_completeness') },

	// Service_data_1
	{ id: 'BCG', title: localize('dhis2.indicator.bcg', 'Total number of BCG doses administered <1 year'), category: localize('dhis2.category.serviceData1', 'Service_data_1') },
	{ id: 'Penta1', title: localize('dhis2.indicator.penta1', 'Total number of Pentavalent vaccination 1st dose (infants)'), category: localize('dhis2.category.serviceData1', 'Service_data_1') },
	{ id: 'Penta3', title: localize('dhis2.indicator.penta3', 'Total number of Pentavalent vaccination 3rd dose (infants)'), category: localize('dhis2.category.serviceData1', 'Service_data_1') },
	{ id: 'Measles1', title: localize('dhis2.indicator.measles1', 'Total number of Measles vaccination 1st dose (infants)'), category: localize('dhis2.category.serviceData1', 'Service_data_1') },
	{ id: 'Measles2', title: localize('dhis2.indicator.measles2', 'Total number of Measles vaccination 2nd dose'), category: localize('dhis2.category.serviceData1', 'Service_data_1') },
	{ id: 'OPD_total', title: localize('dhis2.indicator.opd.total', 'Total number of OPD visits all ages (new and re-visit)'), category: localize('dhis2.category.serviceData1', 'Service_data_1') },
	{ id: 'OPD_under5', title: localize('dhis2.indicator.opd.under5', 'Number of OPD visits for children under-5 years'), category: localize('dhis2.category.serviceData1', 'Service_data_1') },
	{ id: 'IPD_total', title: localize('dhis2.indicator.ipd.total', 'Total number of IPD admissions, all ages'), category: localize('dhis2.category.serviceData1', 'Service_data_1') },
	{ id: 'IPD_under5', title: localize('dhis2.indicator.ipd.under5', 'Number of IPD admissions of children under-5 years'), category: localize('dhis2.category.serviceData1', 'Service_data_1') },
	{ id: 'under5_deaths', title: localize('dhis2.indicator.under5.deaths', 'Total number of under-5 deaths in health facilities'), category: localize('dhis2.category.serviceData1', 'Service_data_1') },
	{ id: 'total_deaths', title: localize('dhis2.indicator.total.deaths', 'Total number of all age deaths in health facilities'), category: localize('dhis2.category.serviceData1', 'Service_data_1') },

	// Service_data_2
	{ id: 'ANC1', title: localize('dhis2.indicator.anc1', 'Total number of ANC 1st visit'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },
	{ id: 'ANC_1trimester', title: localize('dhis2.indicator.anc.1trimester', 'Total number of ANC during the 1st trimester of pregnancy'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },
	{ id: 'ANC4', title: localize('dhis2.indicator.anc4', 'Total number of Pregnant women completing 4 ANC visits'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },
	{ id: 'IPT2', title: localize('dhis2.indicator.ipt2', 'Total number of pregnant women receiving IPT 2nd dose'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },
	{ id: 'IPT3', title: localize('dhis2.indicator.ipt3', 'Total number of pregnant women receiving IPT 3rd dose'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },
	{ id: 'IFA90', title: localize('dhis2.indicator.ifa90', 'Total number of pregnant women who received iron folic acid (IFA) supplementation for 90 or more days during the pregnancy'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },
	{ id: 'Syphilis_test', title: localize('dhis2.indicator.syphilis', 'Total number of pregnant women tested for syphilis during pregnancy'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },
	{ id: 'HIV_test', title: localize('dhis2.indicator.hiv', 'Total number of pregnant women tested for HIV during pregnancy'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },
	{ id: 'SBA', title: localize('dhis2.indicator.sba', 'Total number of skilled birth attendance in health facilities'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },
	{ id: 'Instdelivery', title: localize('dhis2.indicator.instdelivery', 'Total number of deliveries in health facilities'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },
	{ id: 'Instlivebirths', title: localize('dhis2.indicator.instlivebirths', 'Total number of live births in health facilities'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },
	{ id: 'Csection', title: localize('dhis2.indicator.csection', 'Total number of Caesarian Sections'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },
	{ id: 'Low_BWeight', title: localize('dhis2.indicator.lbweight', 'Total number of newborns with low birth weight (<2500g)'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },
	{ id: 'PNC_48h', title: localize('dhis2.indicator.pnc48h', 'Total number of mothers attending PNC visit within 48 hours after delivery'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },
	{ id: 'Stillbirth_total', title: localize('dhis2.indicator.stillbirth.total', 'Total number of stillbirths in health facilities (all)'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },
	{ id: 'Stillbirth_fresh', title: localize('dhis2.indicator.stillbirth.fresh', 'Total number of fresh stillbirths in health facilities'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },
	{ id: 'Stillbirth_macerated', title: localize('dhis2.indicator.stillbirth.macerated', 'Total number of macerated stillbirths in health facilities'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },
	{ id: 'maternal_deaths', title: localize('dhis2.indicator.maternal.deaths', 'Total number of maternal deaths reported'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },
	{ id: 'neonatal_deaths', title: localize('dhis2.indicator.neonatal.deaths', 'Total number of neonatal deaths reported'), category: localize('dhis2.category.serviceData2', 'Service_data_2') },

	// Service_data_3
	{ id: 'opv1', title: localize('dhis2.indicator.opv1', 'Total number of <1 year who received Polio 1 vaccine'), category: localize('dhis2.category.serviceData3', 'Service_data_3') },
	{ id: 'opv2', title: localize('dhis2.indicator.opv2', 'Total number of <1 year who received Polio 2 vaccine'), category: localize('dhis2.category.serviceData3', 'Service_data_3') },
	{ id: 'opv3', title: localize('dhis2.indicator.opv3', 'Total number of <1 year who received Polio 3 vaccine'), category: localize('dhis2.category.serviceData3', 'Service_data_3') },
	{ id: 'penta2', title: localize('dhis2.indicator.penta2', 'Total number of Pentavalent vaccination 2nd dose (infants)'), category: localize('dhis2.category.serviceData3', 'Service_data_3') },
	{ id: 'pcv1', title: localize('dhis2.indicator.pcv1', 'Total number <1 year who received Pneumococcal Conjugate 1 vaccine'), category: localize('dhis2.category.serviceData3', 'Service_data_3') },
	{ id: 'pcv2', title: localize('dhis2.indicator.pcv2', 'Total number of <1 year who received Pneumococcal Conjugate 2 vaccine'), category: localize('dhis2.category.serviceData3', 'Service_data_3') },
	{ id: 'pcv3', title: localize('dhis2.indicator.pcv3', 'Total number of <1 year who received Pneumococcal Conjugate 3 vaccine'), category: localize('dhis2.category.serviceData3', 'Service_data_3') },
	{ id: 'rota1', title: localize('dhis2.indicator.rota1', 'Total number of <1 year who received Rotavirus 1 vaccine'), category: localize('dhis2.category.serviceData3', 'Service_data_3') },
	{ id: 'rota2', title: localize('dhis2.indicator.rota2', 'Total number of <1 year who received Rotavirus 2 vaccine'), category: localize('dhis2.category.serviceData3', 'Service_data_3') },
	{ id: 'ipv1', title: localize('dhis2.indicator.ipv1', 'Total number of children who received inactivated poliovirus 1 vaccine'), category: localize('dhis2.category.serviceData3', 'Service_data_3') },
	{ id: 'ipv2', title: localize('dhis2.indicator.ipv2', 'Total number of children who received inactivated poliovirus 2 vaccine'), category: localize('dhis2.category.serviceData3', 'Service_data_3') },
	{ id: 'hpv1', title: localize('dhis2.indicator.hpv1', 'Total number of children who received human papillomavirus vaccine 1'), category: localize('dhis2.category.serviceData3', 'Service_data_3') },
	{ id: 'hpv2', title: localize('dhis2.indicator.hpv2', 'Total number of children who received human papillomavirus vaccine 2'), category: localize('dhis2.category.serviceData3', 'Service_data_3') },
	{ id: 'measles_cases', title: localize('dhis2.indicator.measles.cases', 'Total number of Measles cases reported'), category: localize('dhis2.category.serviceData3', 'Service_data_3') }
];

export function getCountdownIndicatorCategory(exportCode: string | undefined): string | null {
	if (!exportCode) { return null; }
	const ind = COUNTDOWN_INDICATORS.find(c => c.id === exportCode);
	return ind ? ind.category : null;
}

/**
 * Only Reporting_completeness-category indicators (ANC/Vaccination/OPD/etc. reporting) are meant
 * to pair with a Dataset source -- that's what drives the .REPORTING_RATE/.ACTUAL_REPORTS/
 * .EXPECTED_REPORTS operands in buildDxOperands. Any other category (Population_data, Admin_data,
 * Service_data_*) with a Dataset source is a semantic mismatch that DHIS2's analytics API rejects
 * on every chunk that includes it -- the download can never complete, it just burns through
 * retries first. Returns an explanatory message if the indicator has this mismatch, undefined
 * otherwise (including for non-Countdown indicators, which have no fixed category to check against).
 */
export function findIndicatorCategoryMismatch(indicator: IIndicatorDraft): string | undefined {
	if (indicator.kind !== 'countdown') { return undefined; }

	const category = getCountdownIndicatorCategory(indicator.exportCode);
	if (!category || category === 'Reporting_completeness') { return undefined; }

	const hasDatasetSource = indicator.sources?.some(s => s.type === 'DataSet');
	if (!hasDatasetSource) { return undefined; }

	return localize(
		'dhis2.indicator.categoryMismatch',
		'"{0}" is a {1} indicator mapped to a Dataset -- {1} indicators need a Data Element or Indicator source instead.',
		indicator.internalName || indicator.exportCode, category
	);
}
