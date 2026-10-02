# Data Extractor

Map indicators to a DHIS2 server's data elements, indicators and datasets, download their routine data, and export it
as the Countdown 2030 workbook (Excel) or JSON. A DataSuite extension: it replaces the extractor that was built into
DataSuite, and carries its mappings and downloads over the first time it runs.

## How it reaches DHIS2

Through DataSuite's DHIS2 API (`vscode.dhis2`, proposal `datasuiteDhis2`):

- **Connections and credentials are DataSuite's.** You sign in in DataSuite's own dialog (a personal access token is
  recommended); DataSuite keeps the password or token encrypted and signs every request. This extension never sees
  them.
- **Metadata** (data elements, indicators, datasets, organisation units) comes from DataSuite's shared copy of each
  server's metadata (`vscode.dhis2.metadata`).
- **Downloads** run through DataSuite's analytics download (`vscode.dhis2.downloadAnalytics`), which splits them into
  requests, retries, and reports progress chunk by chunk.

## What it keeps

Per connection, in the extension's global storage: mappings, the draft being written, the downloads list, download
settings, and finished downloads (`store.ts`).

## Development

```bash
npm install
npm run build       # out/extension.js and out/webview.js (React)
npm run typecheck
npm test
```

The logic in `src/core/` is ported from DataSuite's built-in extractor (`scripts/port-core.py`); `docs/PORTING-SPEC.md`
describes the built-in extractor the port follows.
