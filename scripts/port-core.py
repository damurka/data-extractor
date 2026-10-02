import re
src = 'C:/Users/Murage/Documents/Dev/JS/datasuite-infrastructure/datasuite/src/vs/'
dst = 'C:/Users/Murage/Documents/Dev/JS/datasuite-infrastructure/extensions/data-extractor/src/core/'

import os
os.makedirs(dst, exist_ok=True)

HEADER = '''/*---------------------------------------------------------------------------------------------
 *  Data Extractor: {what}
 *  Ported from DataSuite ({origin}); keep the two in step until DataSuite's built-in extractor is removed.
 *--------------------------------------------------------------------------------------------*/
'''


def read(rel):
    return open(src + rel, encoding='utf-8').read().replace('\r\n', '\n')


def body(text):
    # drop the Microsoft licence header and the import lines
    text = re.sub(r'^/\*-+\n(?: \*.*\n)*? \*-+\*/\n', '', text)
    return re.sub(r'^import .*\n', '', text, flags=re.M).lstrip('\n')


def write(name, what, origin, imports, text):
    open(dst + name, 'w', encoding='utf-8', newline='\n').write(HEADER.format(what=what, origin=origin) + '\n' + imports + ('\n' if imports else '') + text)


# l10n: the copied code calls localize(key, message, ...args); here it only fills in the arguments (English)
open(dst + 'l10n.ts', 'w', encoding='utf-8', newline='\n').write(HEADER.format(what='localize() for the code ported from DataSuite', origin='nls.ts') + '''
/** `{0}`, `{1}`, ... in `message` replaced by `args` (the key is DataSuite's; the extension is English for now). */
export function localize(_key: string | { key: string }, message: string, ...args: unknown[]): string {
	return message.replace(/\\{(\\d+)\\}/g, (match, index: string) => {
		const arg = args[Number(index)];
		return arg === undefined ? match : String(arg);
	});
}
''')

# ethiopicDate: no imports
write('ethiopicDate.ts', 'Ethiopian <-> Gregorian dates', 'base/common/ethiopicDate.ts', '', body(read('base/common/ethiopicDate.ts')))
write('ethiopicMonths.ts', 'Ethiopian month names', 'base/common/ethiopicMonths.ts', "import { localize } from './l10n';\n", body(read('base/common/ethiopicMonths.ts')))
write('periods.ts', 'DHIS2 periods, Gregorian and Ethiopian', 'workbench/services/dhis2/common/dhis2Periods.ts', "import { toEthiopic, toGregorian } from './ethiopicDate';\n", body(read('workbench/services/dhis2/common/dhis2Periods.ts')))

# types: the mapping and download shapes (platform dhis2ProfileStorageService.ts without the service), plus the
# metadata/analytics row types the pipeline uses
storage = body(read('platform/dhis2/common/dhis2ProfileStorageService.ts'))
storage = storage[:storage.index('export const IDhis2ProfileStorageService')].rstrip() + '\n'
storage = storage.replace("export const DHIS2_PROFILE_STORAGE_CHANNEL_NAME = 'dhis2-profile-storage';\n\n", '')
metadata = read('platform/dhis2/common/dhis2Metadata.ts')


def grab(text, start, end_marker='\n}\n'):
    i = text.index(start)
    j = text.index(end_marker, i) + len(end_marker)
    return text[i:j]


extra = '\n'.join([
    "export type MappingMode = 'countdown' | 'custom';\n",
    grab(metadata, 'export interface IDhis2AnalyticsRow {'),
    grab(metadata, 'export interface IOrgUnitHeader {'),
    grab(metadata, 'export interface IDhis2OrgUnitWithLevels {'),
    grab(metadata, 'export interface IOrgUnitAncestorRow {'),
    grab(read('platform/dhis2/common/dhis2.ts'), 'export type Dhis2AnalyticsRow = string[];', ';\n'),
    grab(read('platform/dhis2/common/dhis2.ts'), 'export interface IDhis2AnalyticsResponse {'),
    '/** A DHIS2 connection as the ported code needs it (DataSuite\'s IDhis2Profile, vscode.Dhis2Connection). */\nexport interface IDhis2Profile {\n\treadonly id: string;\n\treadonly serverUrl: string;\n\treadonly username: string;\n\treadonly displayName: string;\n\treadonly country?: string;\n\t/** Not known for a connection (DataSuite keeps it): the choice falls back to the order given. */\n\treadonly lastUsedAt?: number;\n}\n',
])
write('types.ts', 'mappings, downloads and the analytics rows', 'platform/dhis2/common/dhis2ProfileStorageService.ts, dhis2Metadata.ts, dhis2.ts', '', storage + '\n' + extra)

# countdown: the indicator list and its category rules (from dhis2WorkbenchService.ts)
wb = read('workbench/services/dhis2/common/dhis2WorkbenchService.ts')
start = wb.index('export interface ICountdownIndicator {')
end = wb.index('/**\n * Resolves the download-tuning settings')
write('countdown.ts', 'the Countdown 2030 indicators and their categories', 'workbench/services/dhis2/common/dhis2WorkbenchService.ts',
      "import { localize } from './l10n';\nimport { IIndicatorDraft } from './types';\n", wb[start:end].rstrip() + '\n')

# data utils
du = body(read('workbench/services/dhis2/common/dhis2DataUtils.ts'))
write('dataUtils.ts', 'operands, chunk plans, tidy tables, CSV', 'workbench/services/dhis2/common/dhis2DataUtils.ts',
      "import { gregorianYearMonth } from './periods';\nimport { IAddMappingDraft, ICategoryOptionCombo, IDhis2AnalyticsResponse, IDhis2AnalyticsRow, IDhis2OrgUnitWithLevels, IDhis2Profile, IIndicatorDraft } from './types';\n", du)

# export processor: drop the service decorator, keep the class
ep = body(read('workbench/services/dhis2/common/dhis2ExportProcessorService.ts'))
ep = re.sub(r"export const IDhis2ExportProcessor = createDecorator<IDhis2ExportProcessor>\('dhis2ExportProcessor'\);\n\n", '', ep)
ep = ep.replace('\treadonly _serviceBrand: undefined;\n', '').replace('\tdeclare readonly _serviceBrand: undefined;\n', '')
write('exportProcessor.ts', 'the downloaded data as Countdown sheets', 'workbench/services/dhis2/common/dhis2ExportProcessorService.ts',
      "import { toEthiopic } from './ethiopicDate';\nimport { getEthiopicMonthsLocalized } from './ethiopicMonths';\nimport { gregorianYearMonth } from './periods';\nimport { COUNTDOWN_INDICATORS } from './countdown';\nimport { IAddMappingDraft, IDhis2AnalyticsRow, IDhis2OrgUnitWithLevels, IIndicatorDraft, IIndicatorSourceDraft } from './types';\n", ep)
print('ok', sorted(os.listdir(dst)))
