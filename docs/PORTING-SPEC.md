
# Porting spec: the DHIS2 Data Extractor as a standalone extension

All paths are relative to `C:\Users\Murage\Documents\Dev\JS\datasuite-infrastructure\datasuite\`.

**The pieces that matter most for the port:**
- **Connection id is the profile id.** `dhis2ConnectionsService.ts:54` sets `id: profile.id`, so per-profile data migrates without re-keying.
- **`product.json` already has the extension slot.**
  - `extensionEnabledApiProposals` gives `"datasuite.data-extractor"` the `datasuiteDhis2` proposal (`product.json:~122`).
  - `dhis2TrustedExtensions: ["datasuite.data-extractor"]` (`product.json:127`) makes `isAllowed` always true for that id (`dhis2ExtensionAccessService.ts:45,59-61`).
- **`metadata.*` doesn't cover the whole download pipeline.** Analytics, raw GET, sync progress, logging, connectivity and validation must go through `vscode.dhis2.read` or be rebuilt. Details in B9.

---

## A. Persistent data the extractor owns

### A1. Files under `<userData>/dhis2/`

| Path | Owner after port | Format | Keyed by |
|---|---|---|---|
| `dhis2/profiles.json` | **stays in DataSuite** | JSON array of `IDhis2ProfileStored`, written via tmp file + move (`electron-main/dhis2Credentials.ts:47-91`) | profile `id` (UUID, `dhis2ProfileService.ts:81`) |
| `dhis2/metadata/<serverKey>.sqlite` | **stays in DataSuite** (metadata cache) | SQLite (`dhis2MetadataService.ts:47-50`) | `normalizeServerKey(serverUrl)`, i.e. per server, shared across profiles |
| `dhis2/profile/<profileId>.sqlite` (+ `-wal`/`-shm`, + `.backup`) | **extractor: migrate** | SQLite (`electron-main/dhis2ProfileStorageService.ts:17-34`) | profileId (one DB per profile) |
| `dhis2/downloads/<profileId>/<file>` | **extractor: migrate** | UTF-8 JSON files (`dhis2ProfileStorageService.ts:166-191`) | profileId |
| `dhis2/exports/*.csv` | extractor (chat CSV fallback target) | CSV (`tools/dhis2ToolSupport.ts:158`, `dirname(userRoamingDataHome)/dhis2/exports`) | none |

**SQLite base class:** `electron-main/cacheStorage.ts`.
- Connection pragmas (`:269-272`): `journal_mode=WAL`, `synchronous=NORMAL`, `temp_store=MEMORY`, `busy_timeout=5000`.
- Schema version is `PRAGMA user_version`.
- On a clean close the DB is copied to `<path>.backup` (`:134-141`). On a corrupt open it restores from that backup (`:185-202`).
- Writes go through `prepare()` (`:386-404`) and are fire-and-forget: they are not awaited, errors are only logged, and ordering relies on the sqlite3 connection's queue.

### A2. Profile DB schema
`electron-main/dhis2ProfileDataStore.ts:73-136`, `getUserVersion() = 2` (`:63`).
- Migration `from < 2` (`:65-71`) adds `boundary_org_unit_uid TEXT` to both download tables.
- The DB is per profile, so no table has a profileId column, except `drafts.profile_id`, which is redundant.

```sql
mappings(id TEXT PK, name TEXT NOT NULL, description TEXT, mode TEXT NOT NULL, indicators_count INTEGER NOT NULL DEFAULT 0,
         mapping_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)   -- idx_mappings_updated_at
drafts(profile_id TEXT PK, draft_json TEXT NOT NULL, updated_at INTEGER NOT NULL)
downloads_in_progress(id TEXT PK, file TEXT NOT NULL, subtitle TEXT NOT NULL, progress_pct INTEGER NOT NULL DEFAULT 0,
         right_text TEXT NOT NULL DEFAULT '', state TEXT NOT NULL /*downloading|processing|paused*/, mapping_id, mapping_name,
         mapping_mode, start_date, end_date, period_type, admin_level, boundary_org_unit_uid TEXT, updated_at INTEGER NOT NULL)
downloads_history(id TEXT PK, file TEXT NOT NULL, status TEXT NOT NULL /*Completed|Failed*/, mapping_id, mapping_name, mapping_mode,
         start_date, end_date, period_type, admin_level, boundary_org_unit_uid TEXT, size TEXT NOT NULL,
         date_text TEXT NOT NULL /*new Date().toLocaleString()*/, ended_at INTEGER NOT NULL)  -- idx_dh_ended_at, idx_dh_status
```

**Mappings**
- Mapping id format, from `makeId()` (`:494-496`):
  ```ts
  `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  ```
- `createMapping` (`:183-210`) stores `mapping_json = JSON.stringify(draft)` and `indicators_count = draft.indicators.length`.
- `updateMappingBasics` (`:220-245`) sets name, description, mode and count when present, plus `mapping_json = json_patch(mapping_json, ?)`. That is RFC 7396 merge-patch: arrays are replaced whole and `null` deletes a key.
- `listMappings` (`:143-163`): `ORDER BY updated_at DESC LIMIT 200` (clamped 1..500).
- `createMapping` in the service also calls `clearDraft` (`dhis2ProfileStorageService.ts:69-80`).

**Drafts**
- One row per profile (`:251-292`), upserted with `ON CONFLICT(profile_id)`.

**Downloads**
- `upsertInProgress` (`:325-371`): upsert by id. `progress_pct` is clamped and rounded to 0..100 (`clampPct`, `:489`).
- `finishToHistory` (`:435-470`): in one transaction, upserts the history row (`ended_at = Date.now()`) and deletes the in-progress row.
- `listHistory(filter, searchText, 200)` (`:385-433`):
  - `completed` gives `status='Completed'`; `failed` gives `status='Failed'`.
  - Search is `file LIKE OR mapping_name LIKE OR date_text LIKE`, ordered `ended_at DESC`.
- `getSnapshot` (`dhis2ProfileStorageService.ts:115-135`) returns no in-progress rows when filter is `completed` or `failed`. The filter `active` returns the in-progress rows plus all history.

### A3. JSON shapes
All in `common/dhis2ProfileStorageService.ts` (platform).

**`IAddMappingDraft`** (`:53-58`): `{ name; description?; mode: 'countdown'|'custom'; indicators: IIndicatorDraft[] }`. Both modes use the same shape; only `kind` and `exportCode` rules differ.

**`IIndicatorDraft`** (`:34-44`): `{ id (uuid); internalName; exportCode; kind: MappingMode; expanded?; sources: IIndicatorSourceDraft[] }`.
- Countdown: `exportCode` must be a `COUNTDOWN_INDICATORS[].id` and `internalName` is that entry's title.
- Custom: both fields are free text.

**`IIndicatorSourceDraft`** (`:19-32`): `{ id; sourceElement (display name); type; includedCategoriesText; active?; cocs?: ICategoryOptionCombo[]; categoryComboIsDefault?; parentIndicatorId?; parentIndicatorName?; origin?: 'ai'|'manual' }`.
- `type` values seen:
  - `'Data Element'`
  - `'DataSet'` (`'Dataset'` is accepted as an alias by the pipeline)
  - `'Indicator'` (AI tools only; the UI expands an indicator into `'Data Element'` sources with `parentIndicatorId`/`parentIndicatorName`)

**`ICategoryOptionCombo`** (`:12-17`): `{ uid; name; categoryComboUid: string|null; checked: boolean }`.

**`IMappingListItem`** (`:60-67`): `{ id; name; description?; mode; indicatorsCount; lastUpdatedAt }`.

**`IDhis2DownloadInProgressItem`** (`:72-88`): `{ id; file; subtitle; progressPct; rightText; state; mappingId; mappingName; mappingMode; startDate; endDate; periodType; adminLevel; boundaryOrgUnitUid? }`.

**`IDhis2DownloadHistoryRow`** (`:90-107`): same as the in-progress item, plus `status: 'Completed'|'Failed'`, `date?` and `size?`.

**Download files in `dhis2/downloads/<profileId>/`**

1. `<taskId>.json`: the completed payload (`dhis2WorkbenchService.ts:614-616`), written as `JSON.stringify(payload, null, 2)`:
   ```ts
   { mappingDraft: IAddMappingDraft, orgUnits: IDhis2OrgUnitWithLevels[], data: ICategorizedExport, calendar: string|undefined }
   ```
   - `ICategorizedExport = { population, completeness, service: IAggregatedDataRow[]; admin: IAdminDataRow[] }` (`dhis2ExportProcessorService.ts:55-74`).
   - Older files may have no `calendar`. The export path then asks the server (`dhis2ProfilePart.ts:445-447`).
2. Resume checkpoints (`dhis2WorkbenchService.ts:289,294,299,315`): `<taskId>.partial.pop.json`, `.partial.completeness.json`, `.partial.service.json`, `.partial.custom.json`. Content:
   ```ts
   { rows: IDhis2AnalyticsRow[] /* {dx,pe,ou,value:number|null} */, completedChunks: number }
   ```
   - Deleted when that phase finishes. Kept on failure, pause or cancel.
   - Deleting a history row deletes only `<taskId>.json`, so partial files can be left behind.

**Per-profile settings**
- `IDhis2Profile.downloadSettings: IDownloadTuningSettings` lives in `profiles.json`. It is written by `IDhis2ProfileService.updateDownloadSettings` (`electron-main/dhis2ProfileService.ts:111-123`); the interface is at `common/dhis2Profile.ts:56-75`.
- Fields: `maxConcurrentChunks`, `maxCellsPerChunk`, `retryAttempts`, `retryBaseDelayMs`, `requestTimeoutMs`.
- Defaults: `{1, 50000, 3, 2000, 120000}`.
- `createProfile` always writes the defaults (`dhis2ProfileService.ts:92`). So the global `dhis2.download.*` settings only take effect for profiles created before this field existed (`resolveDownloadTuningSettings`, `services/dhis2/common/dhis2WorkbenchService.ts:183-194`).
- The extension can't write `profiles.json`. Per-profile overrides need to move into extension storage, keyed by connectionId.

**Other state**
- The DHIS2 extension-access grants are DataSuite's, not the extractor's (`dhis2ExtensionAccessService.ts:22`, storage key `dhis2.extensionAccess`).
- Analysis memory for a DHIS2 profile lives in the assistant's storage under `dhis2-profile/<profileId>` (`datasuite-assistant/src/extension/tools/node/analysisMemoryTool.tsx:88-89,103-115`).
- `contrib/dhis2/browser/dhis2ViewModel.ts` is dead code: nothing imports it, and it holds only an in-memory mock state. Don't port it.

---

## B. Download pipeline

Interface: `services/dhis2/common/dhis2WorkbenchService.ts:198-312`. Implementation: `services/dhis2/electron-browser/dhis2WorkbenchService.ts`.

### B1. `runDownload(profileId, config, existingTaskId?)` (`impl :543-670`)
`startDownload` (`:508-510`) just returns `runDownload(...).taskId`.

`IDownloadTaskConfig` (`common :23-33`): `{ mappingId, mappingName, mappingMode, startDate (YYYY-MM-DD), endDate, periodType: 'monthly'|'yearly', adminLevel ('LEVEL-n'), boundaryOrgUnitUid? }`.

Steps:
1. `taskId = existingTaskId || uuid`; `file = ${taskId}.json`; `subtitle = "${start} to ${end}"`.
2. `getMapping` (fails with "Mapping not found"). Then `findIndicatorCategoryMismatch` on every indicator (throws). Then resolve tuning.
3. `deleteFromHistory(taskId)`.
4. `upsertInProgress` with `state 'processing'`, `rightText 'Processing...'`, 0%, `...config`.
5. `getAnalytics(..., onProgress, taskId, tuning)`.
   - Each progress tick upserts `state 'downloading'`, `rightText "${pct}%"`. These upserts are not awaited by the caller.
6. Upsert 100% `processing`. Then `getOrgUnitsByLevelWithAncestors(level, mode, boundary)` and `exportProcessor.aggregateDataByExportCode(...)`.
7. Read the calendar, then `buildTidyDownloadRows(...)`.
8. Write the payload file. Size is `(bytes/1048576).toFixed(2)+" MB"`.
9. `finishToHistory` with `status 'Completed'` and `date: new Date().toLocaleString()`.
   - **Bug:** this call omits `boundaryOrgUnitUid`. So does the Failed path at `:662-667`.
10. Return `{taskId, status:'completed', tidy, size}`.

Error handling:
- **Pause:** a `DownloadPausedSignal` upserts `state 'paused'` with the last pct and returns `paused`.
- **Other errors:**
  - Log to the "DHIS2" channel.
  - Unless the message matches `/download cancelled/i`, show an error notification: "Download failed for "{0}": {1}", source "DHIS2 Data Extractor".
  - `finishToHistory` with Failed and size `'-'`.
  - Return `failed` or `cancelled`.

### B2. Pause, cancel and orphaned downloads (`impl :44-74`)
- `downloadSignals: Map<taskId, 'pause'|'cancel'>`. These are checked cooperatively after each chunk.
- `reconcileOrphanedDownloads(profileId)` runs once per profile per session. It flips every in-progress row whose state isn't `paused` to `paused` with rightText "Paused".
- The UI also changes persisted state directly, for rows with no live loop (`dhis2ProfilePart.ts:492-525`):
  - Cancel: `finishToHistory` Failed, including boundary.
  - Pause: upsert paused.

### B3. `getAnalytics` (`impl :238-325`)
- **Setup:**
  - `calendar = getSystemCalendar`.
  - `targetLevel = parseInt(adminLevel.replace('LEVEL-',''))`.
  - `orgUnitCount = getOrgUnitsByLevelWithAncestors(...).rows.length`.
  - `MAX_CELLS = tuning.maxCellsPerChunk`.
- **Countdown:**
  - Indicators are split by `getCountdownIndicatorCategory(exportCode)` into `Population_data`, `Reporting_completeness`, and everything else (service).
  - Population uses yearly periods. Completeness and service use monthly periods. **`config.periodType` is ignored.**
  - Phases run sequentially in the order pop, completeness, service.
  - Total chunks are the sum of `planAnalyticsChunks` over the three phases.
- **Custom:** one phase over `buildDxOperands(all)` × `generateDhis2Periods(start, end, config.periodType, calendar)`.
- **Progress:** `round(completedChunks / totalChunks * 100)`.
- Rows are appended with a loop, not with `push(...spread)`, to avoid stack overflow (`:103-108`).

### B4. `fetchChunkedAnalytics` (`impl :378-489`)
- `{dxChunkSize, peChunkSize} = planAnalyticsChunks(...)`. The dx and period arrays are sliced into chunks.
- Org units: `ou = boundary ? [boundaryUid] : [adminLevel]`, i.e. a single uid or the `LEVEL-n` keyword.
- **Resume:** `loadPartial(resumeFile)` skips the first `completedChunks` of the flat list (dx-major, then pe) and fires `onChunkComplete` that many times.
- **Workers:** `min(maxConcurrentChunks, pending.length)` workers pull the next index.
  - Each chunk call:
    ```ts
    withRetry(() => metadata.analytics(profileId, {dxOperands, orgUnitUids, periods, timeoutMs: tuning.requestTimeoutMs}), retryAttempts, retryBaseDelayMs)
    ```
  - Backoff: `delay = base * 2^(attempt-1)` between attempts (`:334-347`). `attempts` counts total tries.
  - **Bug:** `retryAttempts: 0` means the loop never runs and `undefined` is thrown.
- **Checkpoint:** only the contiguous completed prefix is folded into `checkpointedRows`. After every chunk the resume file is rewritten as `{rows: checkpointedRows, completedChunks: alreadyDone + nextCheckpoint}`.
- **Stop:** after each chunk the worker checks `downloadSignals`. A signal stops new dispatches; in-flight chunks finish.
  - Pause throws `DownloadPausedSignal`.
  - Cancel throws `Error('Download cancelled')`.
- On success the resume file is deleted.

### B5. What one chunk sends (main process, `electron-main/dhis2MetadataService.ts:695-740` and `dhis2ClientService.ts:101-116`)
Reproduce this with `vscode.dhis2.read`:
```ts
read(id, { path: 'analytics', timeoutMs, query: {
  dimension: [`dx:${dx.join(';')}`, `pe:${pe.join(';')}`, `ou:${ou.join(';')}`],
  skipMeta: true, outputIdScheme: 'UID', includeNumDen: false } })
```
- Map each response row using the header indexes of `dx`, `pe`, `ou` and `value`.
- `value = (raw undefined|null|trim()==='') ? null : parseFloat(raw)`.
- Default timeout is 120000 ms. The API's cap is 10 minutes (`dhis2Paths.ts:83-84`).

### B6. Helpers in `services/dhis2/common/dhis2DataUtils.ts`
Reproduce these exactly.

**`buildDxOperands`** (`:24-50`), set semantics:
```ts
DataSet|Dataset → `${id}.REPORTING_RATE`, `.ACTUAL_REPORTS`, `.EXPECTED_REPORTS`
no cocs → id
checked = cocs.filter(checked); onlyDefaults = checked.length>0 && every name.trim().toLowerCase()==='default'
checked.length===0 || checked.length===cocs.length || onlyDefaults → id  else → `${id}.${coc.uid}` per checked
```
- **Inconsistency:** `buildTidyDownloadRows` and `aggregateDataByExportCode` use `src.categoryComboIsDefault` instead of `onlyDefaults`.

**`planAnalyticsChunks`** (`:59-71`):
```ts
MAX_ANALYTICS_URL_PARAMS = 250
if (dx===0||pe===0) return {0,0,0}
safe = max(1, floor(maxCells / max(1, ouCount)))
peChunk = min(pe, safe); dxChunk = max(1, floor(safe / peChunk))
if (peChunk+dxChunk > 250) { peChunk = min(peChunk,125); dxChunk = min(dxChunk,125) }
chunks = ceil(dx/dxChunk) * ceil(pe/peChunk)
```

**`buildTidyDownloadRows`** (`:237-303`): this is the chat download result.
- Targets: an operand maps to `{code, name}`.
  - Dataset sources give `${code}_reporting_rate` ("… - reporting rate (%)"), `_reporting_received` ("- reports received") and `_reporting_expected` ("- reports expected").
- Sums by `ou\0pe\0code`; a null value doesn't add.
- `levelCols = level1_name..level{maxLevel-1}_name`.
- Columns: `ou_uid, ou_name, ...levelCols, pe, year, month, dx_uid (=export code), dx_name, value`.
- Sort by dx_uid, then ou_name, then pe.

**CSV** (`toCsv`, `:86-99`):
- RFC 4180. A field is quoted if it matches `/[",\r\n]|^\s|\s$/`, with `"` doubled.
- null becomes empty. Lines are joined with `\n`, with a trailing `\n`.

**CSV file name** (`csvFileName`, `:102-107`): `<slug>_<yyyymmdd-hhmm>.csv`, local time.
- slug = lower-case, NFKD, `[^a-z0-9]+`→`_`, trim `_`, max 40 characters, fallback `dhis2`.

**Other helpers used by the chat tools:**
- `analyticsToTidyTable` (`:130-189`)
- `formatAnalyticsTable` (`:204-229`)
- `classifyDimensionItem` (`:327-359`)
- `pickNameMatch` (`:380-397`)
- `resolveProfileChoice` / `profileLabel` (`:403-448`)
- `summarizeJson` (`:458-491`)

### B7. Periods (`services/dhis2/common/dhis2Periods.ts`)
Depends on `src/vs/base/common/ethiopicDate.ts` (`toEthiopic`/`toGregorian`, 177 lines) and `ethiopicMonths.ts` (55 lines). Bundle both.

- `generateDhis2Periods(start, end, 'monthly'|'yearly', calendar)` (`:137-172`):
  - Dates are parsed by `parseIsoDateParts` (`:82-94`), never with `new Date(string)`.
  - On an Ethiopian calendar (`'ethiopian'|'ethiopic'`), both ends go through `toEthiopic(new Date(y, m-1, d))`, with the month clamped to ≤ 12 (no Pagume).
  - Yearly gives `YYYY`; monthly gives `YYYYMM`, both inclusive.
- `gregorianYearMonth(periodId, calendar)` (`:111-129`):
  - Ethiopian month → the Gregorian month it starts in.
  - Ethiopian year → `toGregorian(y,1,1).getFullYear()+1`.
- Also exported: `normalizePeriodId`, `isValidPeriodId`, `DHIS2_PERIOD_GRAMMAR`, `DHIS2_RELATIVE_PERIODS`.

### B8. Formula resolution for indicators
Done in the main process during warmup (`dhis2MetadataService.ts:628-690`):
- `#{de(.coc)}` regex; a coc of `*` is dropped.
- Nested `I{uid}` references are followed recursively with a visited set.
- Results are deduplicated.

In the new API this is `metadata.getRelated(IndicatorOperands, uid)`. It returns DE items with `cocUid` (`mainThreadDhis2.ts:158-163`), replacing `getResolvedDataElementsForIndicator` (`impl :503-506`).

### B9. Calls the pipeline makes, and their new-API equivalents

| Workbench call | Main method | New API |
|---|---|---|
| `getSystemCalendar` | `getSystemCalendar` | `metadata.getCalendar` |
| `getOrgUnitsByLevelWithAncestors(level, mode, only)` | `getOrgUnitsByLevelWithAncestors` (SQL `dhis2MetadataDataStore.ts:786-869`) | `metadata.getOrganisationUnits(level, {only})`. It always uses `'custom'` headers (`mainThreadDhis2.ts:173`), but rows are identical and the extractor never reads `headers` (grep confirms). Rows: `{id, name, level, level1_name..levelN_name}` |
| `getOrgUnitLevels` / `countOrgUnitsAtLevel` / `getOrgUnitLevelCounts` | `getOrganisationUnitLevels` / `countOrgUnitsAtLevel` / `getOrgUnitLevelCounts` | `metadata.getOrganisationUnitLevels()` (each level has `count`) |
| `analytics` (chunks) | `analytics` | **`read('analytics', …)`**, see B5 |
| `analyticsQuery` (chat) | client.analytics with `skipMeta:false` | **`read('analytics', {dimension, filter, skipMeta:false, outputIdScheme:'UID', includeNumDen:false, displayProperty, aggregationType, hierarchyMeta})`** |
| `rawQuery` | `rawGet` | **`read(path, query)`**. Note the blocked resources in `dhis2Paths.ts:61-64` |
| `getLastDataPeriod` | analytics over `LEVEL-1` (`:749-766`) | `metadata.getLastDataPeriod` |
| `getResolvedDataElementsForIndicator` | `getIndicatorDataElements` | `metadata.getRelated(IndicatorOperands)` |
| `getCocsForDataElement` | same | `getRelated(CategoryOptionCombos)` |
| `getDataSetElements` / `getDataSetsForElement` / `getGroupElements` | same | `getRelated(DataSetElements / DataSetsOfElement / GroupElements)` |
| `search*` (limit 50) / `search*Ex` | same | `metadata.search(kind, q, {limit, offset, level})`. Returns `{items, total}` **without `strategy`/`searched`**; search tool headers use `describeSearchStrategy` (`dhis2Search.ts:267`) |
| `get*ByUids` | same | `metadata.get(kind, uids)` (max 10000) |
| `getCacheStats` / `onDidChangeCacheStats` / `warmupAll(force)` | same | `getStatus` / `onDidChangeStatus` / `sync({force})`. Status has no `serverKey` or `totalObjects` (total = DE + COC + OU) |
| `getSyncProgress` | same | **no equivalent.** Only `status.syncing` exists |
| `validateUserProfile` | same | **no equivalent.** Use `read('me')` or similar and classify 401/403 versus network |
| `log` / `onDidLog` / `onDidChangeConnectivity` (`impl :86-100`, regex on log lines) | same | **no equivalent.** The extension needs its own OutputChannel and reachability from `read()` outcomes |
| `getProfileById` / `listProfiles` (IDhis2ProfileWorkbenchService) | IDhis2ProfileService | `dhis2.getConnections()`. Has no `lastUsedAt`, `dhis2Version`, `downloadSettings` or `updatedAt`; `usesAccessToken` replaces `authKind` |
| `createProfile` / `deleteProfile` | IDhis2ProfileService | `dhis2.signIn()`. **No delete API** |

### B10. Excel export

**Building the sheets** (`dhis2ExportProcessorService.ts`)
- **`aggregateDataByExportCode`** (`:118-248`):
  - Category per indicator from `COUNTDOWN_INDICATORS`: `pop` if it contains "population", `comp` if it contains "completeness", else `service`. Dataset sources always go to `comp`.
  - Map keys:
    - pop: `${ou}_${pe.substring(0,4)}`
    - others: `${ou}_${pe}`
  - Values sum; null stays null.
  - Flatten rows to `{district: ou.name, year: pe[0..3], month: en-US long month name from pe[4..5] (1-12 only), ...codes}`. Population rows have no month.
  - Admin rows: `{country: level1_name||'Unknown', first_admin_level: level2_name || (level===2 ? name : 'Unknown'), district_name: name||id}`.
- **`generateExcelStructures`** (`:250-362`):
  - Columns per indicator:
    - Comp (any dataset source or completeness category), three columns: `${code}_reporting_expected` "Expected number (#)", `_reporting_received` "Received number (#)", `_reporting_rate` "Reporting completeness rate (%)".
    - Pop: `code` with title `internalName`.
    - Others: service.
  - Sheet header row 1 (codes): `district, year[, month], codes…`. Row 2 (names): `District name, Year[, Month], names…`.
  - Data rows: a full grid of org units × periods. Population uses unique years from `periods.substring(0,4)`.
  - Rows are looked up by `${district NAME}_${year}[_${month}]`. Districts with the same name collide.
  - The displayed year/month comes from `resolvePeriodLabel(pe, sourceCalendar, labelCalendar)` (`:23-53`); Ethiopic month names come from `getEthiopicMonthsLocalized`.
  - Missing values become `''`.
  - Admin sheet: rows 1/2 are `district_name, first_admin_level, country` / `District, Region, Country`.

**Writing the workbook** (`electron-main/dhis2ProfileStorageService.ts:193-233`)
- exceljs `Workbook`. **No styles, widths or hidden rows.**
- Sheets in order: `Service_data`, `Population_data`, `Reporting_completeness`, `Admin_data`.
- A sheet with no data rows is skipped.
- Each sheet is `addRow(row1)`, `addRow(row2)`, then the data rows.
- Returned as a base64 `writeBuffer`.

**Export trigger** (`dhis2ProfilePart.ts:424-457`)
- Periods are regenerated with `generateDhis2Periods(start, end, periodType==='yearly'?'yearly':'monthly', cachedCalendar)`.
- `sourceCalendar` is ethiopic or gregorian. `labelCalendar` comes from the UI toggle.
- File names:
  - `${mappingName.replace(/\s+/g,'_')}_${custom ? `${s}_to_${e}_${periodType}` : `${s}_to_${e}`}.xlsx` (or `.json`)
  - JSON export = `JSON.stringify(cached.data, null, 2)`.
- `saveExport` (`:693-719`):
  - Save dialog defaulting to `~/Downloads/<file>`.
  - Afterwards a notification with **Open** (`datasuite.files.openWithSystemApplication`) and **Show in Folder** (`revealFileInOS`).

### B11. `estimateDownload` (`impl :512-541`)
- `orgUnitCount` = `boundary ? 1 : countOrgUnitsAtLevel(level)`.
- Requests = the same `planAnalyticsChunks` sums as `getAnalytics`.
- Countdown reports monthly periods for `periodCount`.
- Returns `{dxCount, periodCount, firstPeriod, lastPeriod, orgUnitCount, requests, calendar}`.

### B12. Countdown template and the category guard
- `COUNTDOWN_INDICATORS` (`common/dhis2WorkbenchService.ts:66-143`) has 74 entries.
  - Categories: Admin_data (10), Population_data (6), Reporting_completeness (5), Service_data_1 (11), Service_data_2 (19), Service_data_3 (14).
  - The id `'Population_ under_5years'` contains a space.
  - Note `Instdelivey` (Reporting_completeness) versus `Instdelivery` (Service_data_2).
  - Categories are wrapped in `localize()` but compared to English literals. Make them constants in the port.
- `findIndicatorCategoryMismatch` (`:160-174`): a countdown indicator whose category isn't Reporting_completeness and that has a DataSet source is an error.

---

## C. The UI (`contrib/dhis2/browser/**`)

### Shell
- An editor pane, `Dhis2Editor` (`dhis2Editor.ts`), for `Dhis2EditorInput`.
  - Shows a "Loading..." overlay.
  - `input.resolve()` calls `validateUserProfile`.
  - The login screen shows only for the login URI or for `invalidCredentials`. A network error still opens the profile with cached data.
- `Dhis2Widget` (`dhis2Widget.ts`) caps width at 950 and routes login versus profile.
- `Dhis2ProfilePart` (`profile/dhis2ProfilePart.ts`) is the profile app: a sidebar, `main.app-main`, an offline banner, a header and five pages toggled by `display`.

### Login (stays in DataSuite: replace with `dhis2.signIn`/`getConnections`)
- `login/dhis2ViewLoginPart.ts`, `dhis2LoginView.ts`, `dhis2LoginProfileView.ts`, `inputs/baseInput.ts`, `inputs/validators.ts`.
- **Profiles list:** "Select Data Profile". Each row has an avatar initial, displayName, serverUrl, Delete and Connect.
  - **Connect:** validate first.
    - On `invalidCredentials`: a warning, then the login form pre-filled with "Please re-enter your password."
    - On `networkError`: an info message, then open anyway.
  - "Add New Profile" opens the form.
- **Form:** a split panel with an image (`media/login.png`) on the left and on the right "Countdown to 2030 / DHIS2 Data Extractor".
  - Fields:
    - Server: an autocomplete over `product.dhis2Instances`, placeholder `https://play.dhis2.org/2.40.3`.
    - Username and Password, with a show/hide toggle.
    - Login button.
  - Login calls `createProfile`. A plain `http://` server gets a warning. Then the profile opens.

### Sidebar
`profile/dhis2ProfileSidebar.ts`, with a resizable sash in `dhis2Sash.ts`. Initial width 260, minimum 220; it collapses below 720 px.
- Logo plus "Countdown to 2030" and "DHIS2 Data Extractor".
- Navigation: Dashboard, Mappings, Downloads.
- Footer: Settings, **Disconnect** (calls `openLogin`, which only navigates and does not sign out), "Version 1.0.0".

### Header
`profile/dhis2ProfileHeader.ts`. Each page contributes a `getHeaderModel()` with title, badge, meta, leading actions and actions. Action variants are primary, secondary and plain.
- Actions with `requiresNetwork` are disabled while offline, with the tooltip "Requires an internet connection".
- Default header: title = `profile.country ?? 'Dashboard'`; meta = serverUrl, username, displayName; action **Sync Meta** calls `warmupAll(force=true)`.

### Offline handling (`dhis2ProfilePart.ts:104-136,163-179`)
- Offline is detected from `navigator.onLine`, window online/offline events and `onDidChangeConnectivity`.
- While offline, the part polls `validateUserProfile` every 15 s.
- Banner text: "No internet connection -- previously downloaded data…".

### Dashboard (`profile/dhis2DashboardView.ts`)
- Three stat cards.
  - **Metadata Cache:** `totalObjects`. The footer shows Syncing… / Sync failed / Synced {fromNow} / Not synced yet. Clicking the card forces a sync.
  - **Active Mappings:** count. Footer "Recent: {first name}" or "No mappings yet".
  - **Downloads Queue:** the in-progress count. Footer: "Downloading {pct}", "Downloading…", "Paused", "Processing" or "No active downloads".
- Three Quick Actions:
  - Create New Mapping: `startNew`, then the add-mapping page.
  - Open Existing: the Mappings page.
  - View Downloads.
- On open the dashboard calls a passive `warmupAll(profileId)`.

### Mappings list (`profile/dhis2ProfileMappingsView.ts`)
- Header "Mappings Manager" with **New Mapping**. If a non-empty draft exists, confirm "Overwrite existing draft?".
- A draft banner ("You have an unsaved mapping draft: X") with Resume Editing.
- Search over name, id, description and mode. Type filter: All, Countdown, Custom.
- Paged table; sizes 10/20/50, default 20.
  - Columns: Mapping Name with "ID: …"; Type pill; Indicators count with a bar (<10 red, <25 gold, else green); Last Sync (0 indicators shows "Sync Failed", else `fromNow(lastUpdatedAt)`).
  - Row actions:
    - Edit and Clone: both confirm discarding a draft that has indicators. Clone appends " (Copy)" and saves as new.
    - Export JSON: `<name_with_underscores>_export.json`.
    - Delete: with a confirm.
  - Clicking a row fires `onDidOpenMapping`, which has **no handler**.

### Add / Edit Mapping (`profile/dhis2ProfileAddMappingView.ts`)
- **Header:**
  - Title is the draft name. Badge is EDITING or DRAFT. Meta is "ID: <id>", or `MP_<SLUG15>`, or "Pending Save".
  - Back, Cancel (clears the draft) and **Save Mapping**.
  - Save is disabled with a tooltip from `getValidationError` (`:700-719`): a name is required; every indicator needs `internalName`, `exportCode` and ≥ 1 source, and must pass the category-mismatch check.
  - Save calls `createMapping` or `updateMapping` and returns to the list.
- **Left panel:** Mapping Name, Description, Mapping Mode (Custom/Countdown). Changing the mode with indicators present confirms, then clears the indicators.
- **Canvas:** "Indicators Configuration". Import JSON (a file input; takes name/description/mode/indicators), Clear All (confirm), Add Indicator, and the dashed "Add New Indicator Block".
  - Only one card is expanded at a time.
  - Every change autosaves the draft after 750 ms (`saveDraftMapping`).
- **Source search** (≥ 2 characters):
  - Runs `searchDataElements`, `searchIndicators` and `searchDataSets` in parallel.
  - For each indicator hit it calls `getResolvedDataElementsForIndicator` to show "{n} Elements".
  - Selecting an indicator adds one `'Data Element'` source per resolved DE. Each gets its name via `searchDataElements(deUid)` and COCs via `getCocsForDataElement`. COCs are checked if the formula used the bare DE, else only the referenced COCs are checked. Sources carry `parentIndicatorId/Name` and `origin 'manual'`.
  - Selecting a DataSet adds a source with `cocs: []`.
  - Selecting a DE adds a source with all COCs checked and `categoryComboIsDefault`.

### Indicator card (`widgets/dhis2IndicatorCard.ts`)
- **Collapsed:** title, a complete/incomplete dot, and the code.
- **Expanded fields:**
  - "Result Name": for Countdown, a select over unused `COUNTDOWN_INDICATORS`, which also fills a read-only code. For Custom, free text.
  - "Analysis Code": with a SUM badge.
- **Sources:**
  - Source chips; all sources from one parent indicator share a single chip, and removing it removes them all.
  - A search box.
  - A "Resolved Data Sources" table with Source/Type/Included Categories, plus origin badges (AI/Manual) and "From Indicator".
- **Disaggregation** state: `none` (DataSet), `noData`, `default` (`categoryComboIsDefault`) or `real`.
  - The active source with real categories shows a COC panel: checkboxes, "Auto-map all", 4 shown then "Show N more".
  - A COC named `default` is locked as checked.
  - `includedCategoriesText` updates live.
- Clone and Delete per card; Delete confirms.

### Downloads (`profile/dhis2ProfileDownloadsView.ts`)
- **Header:** "Downloads Manager" with **New Download Task** (`requiresNetwork`).
- **Toolbar:** a segmented All / Active / Completed / Failed filter and a search box.
- **In Progress** cards:
  - Mapping name, subtitle, state text and a progress bar.
  - Pause (when downloading), Resume (when paused; calls `startDownload` with the same id), Cancel.
- **Recent History** table, paged:
  - Columns: context (mapping name plus dates, plus period type for custom), Mode, Admin, Size, Date, Status pill.
  - Actions: Excel and JSON for Completed; Retry (`startDownload` with the same id) otherwise; Delete (removes the file and the row).
- An "Excel labels: Ethiopic | Gregorian" toggle appears only on Ethiopian servers.
- **New Download modal:**
  - Mapping select.
  - `CalendarRangePicker` (`src/vs/base/browser/ui/calendar/calendarRangePicker.ts` 534 lines + `.css` 403 + `calendarTypes.ts`; only used here, so port it). It is in the server's calendar mode with a toggle. Default range is one month ago to today.
  - Frequency (Monthly/Yearly), hidden for countdown but its default `monthly` is still sent.
  - Admin Level: `Level n (name)` with value `LEVEL-n`.
  - Optional Sub-region typeahead: `searchOrgUnits(q, 50, level)`, showing `pathNames`. Hidden when the level has ≤ 1 org unit.
  - Start validates the dates, then `startDownload`.
- `update()` reads the calendar. Changes to downloads trigger a refresh.

### Settings (`profile/dhis2ProfileSettingsView.ts`)
- "Download Settings" / "Server Tuning". Five number inputs, clamped to: `maxConcurrentChunks` 1-20, `maxCellsPerChunk` 1000-500000, `retryAttempts` 0-10, `retryBaseDelayMs` 200-60000, `requestTimeoutMs` 5000-600000.
- Save calls `updateDownloadSettings` and shows "Download settings saved.".

### Widgets
- `dhis2ProfileTable.ts`: generic table with a pagination footer.
- `dhis2SearchInput.ts`: fires on each input, no debounce.
- `dhis2StatCard.ts`: themes red, gold, teal.
- `dhis2ActionCard.ts`.

### CSS and media (`contrib/dhis2/browser/media/`)
- Stylesheets:
  - `dhis2Components.css` (378)
  - `dhis2ProfileLayout.css` (257)
  - `dhis2ProfileSidebar.css` (149)
  - `dhis2DashboardView.css` (75)
  - `dhis2ProfileMappingsView.css` (142)
  - `dhis2ProfileAddMappingView.css` (129)
  - `dhis2IndicatorCard.css` (246)
  - `dhis2ProfileDownloadsView.css` (329)
  - `dhis2ProfileSettingsView.css` (40)
  - `dhis2StatCard.css` (99)
  - `dhis2ActionCard.css` (66)
  - `table.css` (350)
  - `login.css` (601)
- Images: `login.png`, `login-bg.png`, `login-bg-dark.png`. The CSS also uses `../../../../browser/media/code-icon.svg` (`dhis2ProfileSidebar.css:37`, `login.css:190`).
- Colours registered in `dhis2Colors.ts`:

  | Token | Dark | Light |
  |---|---|---|
  | `dhis2.brandRed` | #c47a7b | #9b5758 |
  | `dhis2.brandRedHover` | #b06869 | #8e4648 |
  | `dhis2.brandGold` | #cfaa50 | #cfaa50 |
  | `dhis2.secondaryRed` | #e05545 | #DB4437 |
  | `dhis2.surfaceBackground` | editorBackground | #fff |
  | `dhis2.sidebarBackground` | rgb(30,30,30) | rgb(250,250,252) |
  | `dhis2.foregroundMuted` | rgb(180,180,180) | rgb(107,114,128) |

  - Teal uses `button.background`.
  - Local CSS variables `--dhis2-*` are listed in `build/lib/stylelint/vscode-known-variables.json:146-149,1108-1134`.
- Codicons are used throughout, so the webview needs `@vscode/codicons`.

---

## D. Chat tools

**Registration** (`tools/dhis2ChatTools.ts:1773-1817`):
- All tools are `ToolDataSource.Internal` with `canBeReferencedInPrompt:false`.
- Every tool except `dhis2_getProfiles` and `dhis2_getCountdownIndicators` has `when: dhis2HasProfile`. That context key is defined at `:1771` and refreshed from `listProfiles` and `onDidChangeProfiles`.
- Each tool is wrapped in `Dhis2ToolWrapper` (`dhis2ToolSupport.ts:50-108`):
  - Resolves `profileId` with `resolveProfileChoice`: by id, then exact displayName, then host or URL; with no hint, the most recently used profile, plus a note when several exist.
  - Prefixes the result with `Profile: <displayName> (<host>)\n` and an optional `_note_`.
  - Logs `[tool] id profile="…" Nms ok rows= chars=` to the "DHIS2" channel.
  - Turns a thrown error into text "{tool} failed: msg / Likely cause / Next step" using `classifyDhis2Error` (`platform/dhis2/common/dhis2Errors.ts:143-178`).
  - Re-throws `prepareToolInvocation` errors.
- Every tool's input has an optional `profileId`.

**Writing CSVs** (`Dhis2DataFileWriter`, `dhis2ToolSupport.ts:136-168`). The target folder is the first of:
1. If `datasuite.shinyApps.listTabs` returns an active tab with `workspaceDir`, then `<workspaceDir>/dhis2/`.
2. `<first workspace folder>/data/dhis2/`.
3. `<userData>/dhis2/exports/`.

`describeDataFile` (`:171-185`) adds "Full result: N rows x M columns written to `<path>` (<location>)", the columns, a 5-row CSV preview and ``df <- readr::read_csv("<path>", show_col_types = FALSE)``. The path uses forward slashes.

| Tool id | Inputs (required in **bold**) | Behaviour, calls and output | Confirm |
|---|---|---|---|
| `dhis2_getProfiles` (`:58-112`) | none | `listProfiles` sorted by `lastUsedAt`. Markdown list of name/id/server/username/country/version/last used, plus a plain-http warning. No `when`, no profile prefix | none |
| `dhis2_searchMetadata` (`:118-327`) | **type** ∈ dataElements, indicators, dataSets, dataElementGroups, orgUnits, orgUnitGroups; **query**; limit (default 20, max 500); offset; level (orgUnits); detail | `search*Ex`. If `getSyncProgress(entity)` isn't warm, waits up to 30 s, polling every 5 s with progress reports, then falls back to live `rawQuery(resource, {filter:'identifiable:token:q', fields, pageSize, page, order:'displayName:asc'})`. orgUnitGroups always goes live. Header "showing a-b of total (strategy)". One line per row; `detail` adds descriptions, groups, formulas and lastUpdated. `toolMetadata.rows` | none |
| `dhis2_getOrgUnitLevels` (`dhis2QueryTools.ts:202-245`) | none | `getOrgUnitLevels` + `getOrgUnitLevelCounts`. Markdown table Level/Name/Org units/`LEVEL-n` | none |
| `dhis2_queryAnalytics` (`QueryTools :251-365`) | **dx[]**; pe[]; ou[] (default USER_ORGUNIT); filters[] `dim:a;b`; displayProperty; aggregationType; saveAs; maxRows (default 50, max 500) | `Dhis2ItemResolver` turns names into uids: dx via indicator and DE search, `.METRIC` via dataset search; ou via levels by name/number, `OU_GROUP` via rawQuery `organisationUnitGroups`, names via org unit search; pe via `normalizePeriodId`. Problems return without querying. `analyticsQuery({dimensions, filters, displayProperty, aggregationType, hierarchyMeta:true})`, then `analyticsToTidyTable(resp, calendar)`, `formatAnalyticsTable`, CSV (label = saveAs or the first dx_name), and the query string | none |
| `dhis2_reportingCompleteness` (`:371-537`) | **dataSet** (uid or name); **pe[]**; ou[]; level; byPeriod; maxRows | dx = `<ds>.EXPECTED_REPORTS;ACTUAL_REPORTS;REPORTING_RATE`; pe is a filter unless `byPeriod`. `pivotReporting` gives expected/actual/rate/missing, lowest rate first. Overall line, table, a "Sent no reports" list (max 50), CSV `<name>_reporting` | none |
| `dhis2_getDataValues` (`:543-705`) | **orgUnits[]**; dataSet; dataElements[]; periods[] or startDate/endDate; children; maxRows | `rawQuery('dataValueSets', {dataSet, dataElement[], orgUnit[], period[] or startDate/endDate, children})`. Names come from `get*ByUids`. Columns `ou_uid, ou_name, ou_path, pe, dx_uid, dx_name, coc_uid, coc_name, aoc_uid, value, stored_by, last_updated, comment`. CSV `<label>_values` | none |
| `dhis2_getCategoryOptionCombos` (`:333-397`) | **dataElementUid** | `getDataElementsByUids` + `getCocsForDataElement`. Says "Default Category Combo, don't set cocUids" when applicable, else a list of COC name/uid | none |
| `dhis2_getDataSetElements` (`:403-469`) | **dataSetUid** | `getDataSetElements`, with displayName/formName/description/groups/lastUpdated | none |
| `dhis2_getDataSetsForElement` (`:475-525`) | **dataElementUid** | `getDataSetsForElement` | none |
| `dhis2_getGroupElements` (`:531-594`) | **groupUid** | `getGroupElements` | none |
| `dhis2_getLastDataPeriod` (`:600-652`) | **dxUid** | `getLastDataPeriod`. "last has reported data in period **X**", or a no-data hint | none |
| `dhis2_getIndicatorDataElements` (`:658-719`) | **indicatorUid** | `getResolvedDataElementsForIndicator` + `getIndicatorsByUids` + DE/COC names | none |
| `dhis2_getMappings` (`:725-784`) | none | `storage.listMappings` | none |
| `dhis2_getMappingDetails` (`:790-868`) | **mappingId** | `storage.getMapping`; per indicator, its sources with type, inactive flag, disaggregation and parent | none |
| `dhis2_downloadInstructions` (`:893-968`) | **mappingId**; startDate; endDate; periodType; adminLevel | Mapping preview plus mismatch warnings. If dates and level are given: `normalizeAdminLevel` (`:875-887`) + `estimateDownload`. Ends with "how to run" text | none |
| `dhis2_createMapping` (`:1200-1275`) | **name**, **mode**, **indicators[]** (schema `:1160-1194`: internalName, exportCode, sources[{id, sourceElement, type ∈ Data Element/DataSet/Indicator, cocUids?}], **confidence** High/Medium/Low, **reasoning**); description | Rejected unless every indicator has confidence and reasoning (`validateIndicatorReasoning` `:1059-1069`). `buildMappingDraft`/`buildSourceDraft` (`:1115-1158`): DE sources get COCs via `getCocsForDataElement`, checked by `cocUids` or all, plus `categoryComboIsDefault`; `origin 'ai'`. Then `storage.createMapping` | **Yes.** `prepareToolInvocation` shows `summarizeMappingChanges` (`:980-1031`), confidence lines and a reuse warning (a source in more than 3 export codes, `:1072-1098`) |
| `dhis2_updateMapping` (`:1281-1385`) | **mappingId**; name; description; mode; indicators (replaces the whole list) | Diff by exportCode, then by source id; dropping a `manual` source is flagged ⚠️. `storage.updateMapping` | **Yes** |
| `dhis2_startDownload` (`:1391-1578`) | **startDate**, **endDate**, **periodType**, **adminLevel**; mappingId, or mappingName+mode+indicators (inline create); boundaryOrgUnitUid; resumeTaskId | Validates dates and the mapping arguments. Inline mode creates the mapping first. `runDownload(profileId, config, resumeTaskId \|\| uuid)`; cancelling the chat token calls `cancelDownload`. Completed: CSV of `outcome.tidy` named after the mapping, plus a note that Excel is in the Downloads tab. Paused/cancelled/failed: the `resumeTaskId` hint and the `classifyDhis2Error` advice | **Yes**, the estimate summary (`:1460-1500`). No confirmation for invalid calls; invoke reports them |
| `dhis2_getDownloadStatus` (`:1584-1631`) | taskId | `storage.getSnapshot`. One task, or running plus the 10 most recent | none |
| `dhis2_getCountdownIndicators` (`:1637-1676`) | none | `COUNTDOWN_INDICATORS` grouped by category, with the space-in-id note. No `when` | none |
| `dhis2_rawQuery` (`:1682-1764`) | **path**; query (values may be arrays) | `validateDhis2RawPath`. pageSize defaults to 50 unless the path ends with a uid or `paging` is set. `rawQuery`, then `summarizeJson(…, 12000)`; output is "GET /api/<path>" plus a fenced json block | none |

**Tool set** (`contrib/chat/browser/tools/clientToolSetsContribution.ts:71-100`):
- id/referenceName `dhis2`, icon database, "DHIS2 Data Extractor", `hiddenInToolsPicker:false`.
- Members are the 21 ids above.
- Membership is reconciled dynamically by tool name or id (`:131-161`). An extension tool registered under the same name would join automatically.

**Gate on invocation** (`api/common/extHostLanguageModelTools.ts:122-126`): any extension invoking a `dhis2_*` tool must have the `datasuiteDhis2` proposal.
- The assistant has it (`extensions/datasuite-assistant/package.json:43-44`).
- An extension-contributed tool keeps that name.

**datasuite-assistant references**
- `src/extension/agents/vscode-node/agentTypes.ts:58-69`: `DATA_READ_TOOLS` lists 11 ids with the `dhis2/` toolset prefix: getProfiles, searchMetadata, queryAnalytics, reportingCompleteness, getDataValues, getOrgUnitLevels, getLastDataPeriod, getCategoryOptionCombos, getIndicatorDataElements, getMappings, getMappingDetails. Extension tools outside a toolset would be named `<extId>/<tool>`, so the `dhis2` toolset must keep containing them.
- `src/extension/prompts/node/agent/analyst/analystCore.tsx:70-72,190`: looks up the bare names `dhis2_queryAnalytics`, `dhis2_reportingCompleteness`, `dhis2_searchMetadata` for routing text.
- `package.json:3661-3668` (`chatInstructions`):
  - `assets/prompts/instructions/dhis2-mapping.instructions.md` (83 lines) with `when: "dhis2ProfileEditorActive"`.
  - `dhis2-data-questions.instructions.md` (23 lines, `applyTo "**"`).
- `output-and-reports.instructions.md:11` describes the CSV locations: Shiny analysis folder, else `data/dhis2/`.
- The instructions also mention "Downloads tab".
- `src/extension/tools/node/analysisMemoryContextPrompt.tsx:20-37` parses the chat-context `stableId` `dhis2Profile:<profileId>`. `package.json:687-718`: `analysisMemory` has scope `dhis2Profile`.
- `src/extension/prompts/node/panel/vscode.tsx:165,171` and `datasuiteHelp/common/test/editorSearch.spec.ts:20,27` mention the command `workbench.action.extractor.launch` and the label "DHIS2: Open Data Extractor".

---

## E. Other integration points to replace or remove

**Command** (`contrib/dhis2/browser/dhis2.contribution.ts:41-67`)
- `workbench.action.extractor.launch`, "Open Data Extractor", f1.
- Keybinding `Ctrl/Cmd+O Ctrl/Cmd+E`, weight WorkbenchContrib.
- Menu `MenubarFileMenu` group `2_open` order 2.
- Opens `dhis2://login/` pinned.

**Editor registration**
- Editor pane `workbench.editors.dhis2Editor` with label "DHIS2 Data Extractor" (`:30-39`).
- Serializer `workbench.input.dhis2Editor` (`:69`, `dhis2EditorInput.ts:116-149`): only profile inputs are serialized.
- Resolver for `dhis2:**/**` (`dhis2.ts:15-51`, label "Data Extractor").
- Input (`dhis2EditorInput.ts`): `Readonly|Singleton|CanDropIntoEditor`, name "Data Extractor".

**URI scheme**
- `Schemas.dhis2 = 'dhis2'` (`src/vs/base/common/network.ts:145`).
- URIs (`common/dhis2Uri.ts`): `dhis2://login/` and `dhis2://profile/<encodeURIComponent(id)>`.
- Navigation service `IDhis2NavigationService` (`common/dhis2.ts:20-85`): `openLogin` / `openProfile` with an in-place option, and `closeProfile`.

**Settings** (`dhis2.contribution.ts:85-127`)
- Section id `dhis2Download`, title "DHIS2 Data Extractor".
- `dhis2.download.maxConcurrentChunks` (1-20), `maxCellsPerChunk` (1000-500000), `retryAttempts` (0-10), `retryDelayMs` (200-60000), `requestTimeoutMs` (5000-600000), with defaults from `DEFAULT_DOWNLOAD_TUNING_SETTINGS`.

**Context keys**
- `dhis2HasProfile`: `dhis2ChatTools.ts:1771`, bound at `:1785-1788`.
- `dhis2ProfileEditorActive`: `dhis2ChatContext.contribution.ts:16`, set on active-editor change. The assistant `chatInstructions` `when` depends on it.

**Chat context** (`dhis2ChatContext.contribution.ts`)
- `IChatContextService.updateWorkspaceContextItems('dhis2.activeProfile', [{handle:0, label:'DHIS2 Profile', value:'DHIS2 profile "<name>" (<url>), id: <id>.', stableId:'dhis2Profile:<id>'}])` while a profile editor is active, else `[]`.
- An extension needs an equivalent API to keep this.

**Logging** (`dhis2Logging.contribution.ts`)
- Output channel id `dhis2`, label "DHIS2", fed from `metadataService.onDidLog`.
- Line format: `[time] [error]/[warn] msg`.
- The HTTP trail stays in DataSuite. The extension's download and tool logs need their own channel.

**Welcome page**
- `welcomeGettingStarted/browser/gettingStarted.ts:101` (`DHIS2_START_ENTRY_ID`) and `:1036-1046`: Start entry "Open Data Extractor" with `command:workbench.action.extractor.launch`, `order MIN_SAFE_INTEGER`, codicon database. Used at `:1058`.
- `welcomeGettingStarted/common/gettingStartedContent.ts:283-285`: walkthrough step `dhis2DataExtractor` with a button running the same command.
- Keeping the same command id in the extension keeps both working.

**Workbench registration to remove**
- `workbench.desktop.main.ts:189-192` imports `dhis2.contribution.js`, `dhis2MainProcessServices.js` and `dhis2ExtensionAccess.contribution.js`. The last one stays.
- `services/dhis2/electron-browser/dhis2MainProcessServices.ts:26-37`:
  - Main-process remote services for profile, metadata, **profile-storage** and connections.
  - Singletons `IDhis2WorkbenchService`, `IDhis2ProfileWorkbenchService`, `IDhis2ProfileStorageWorkbenchService`, `IDhis2ExportProcessor`.

**Main process** (`src/vs/code/electron-main/app.ts`)
- Imports at `:39-49`; services at `:1209-1214`; channels at `:1381-1388`.
- The `IDhis2ProfileStorageService` registration (`:1214,1385-1386`) and the `exceljs` dependency are extractor-only.

**Also in DataSuite (not ported)**
- `product.json` `dhis2Instances` (`:170+`, used by the login ServerInput) and `dhis2TrustedExtensions`. Product typings at `src/vs/base/common/product.ts:293-296`.
- `contrib/dhis2/electron-browser/dhis2ExtensionAccess.contribution.ts`: the "DHIS2: Manage Extension Access" command.
- The API itself: `api/browser/mainThreadDhis2.ts`, `api/common/extHostDhis2.ts`, `extHost.api.impl.ts`, `extHost.protocol.ts`, `extHostTypes.ts`, `extensionsApiProposals.ts`, `vscode-dts/vscode.proposed.datasuiteDhis2.d.ts`.

**Localization**
- XLF: `build/i18n/xlf/vscode-workbench/{fr,pt}/vs_workbench_contrib_dhis2.xlf`, `vs_workbench_services_dhis2.xlf`; chat and welcome XLF files mention dhis2 too.
- Language packs: `extensions/datasuite-language-pack-{fr,pt}/translations/main.i18n.json` (e.g. `:12505`, `:12864`, `:17968-17971`).
- The extension needs its own `package.nls` and l10n bundles.

**Tests to port**
- `services/dhis2/test/common/dhis2DataUtils.test.ts` (221 lines)
- `services/dhis2/test/common/dhis2Periods.test.ts` (121 lines)
- `src/vs/workbench/contrib/datasuite/test/common/datasuiteToolNames.test.ts:27` references `dhis2_queryAnalytics`.

**ADRs that explain the rules**
In `docs/adr/`:
- 0015: isDefault flag
- 0018: analysis memory
- 0019–0021: mapping workflow
- 0022: confidence enforced in code
- 0023: last-data-period signal

**Pure modules to copy into the extension**
- `dhis2DataUtils.ts`, `dhis2Periods.ts`, `dhis2ExportProcessorService.ts`
- `COUNTDOWN_INDICATORS`, `findIndicatorCategoryMismatch` and `resolveDownloadTuningSettings` from `common/dhis2WorkbenchService.ts`
- `platform/dhis2/common/dhis2Errors.ts` (`classifyDhis2Error`)
- `dhis2Search.ts` (`describeSearchStrategy`)
- `dhis2Paths.ts` (`validateDhis2RawPath`)
- `base/common/ethiopicDate.ts`, `ethiopicMonths.ts`
- `base/browser/ui/calendar/*`
