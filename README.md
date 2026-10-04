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
  requests, adapts to how the server copes, and reports progress chunk by chunk.

## Chat tools

DataSuite's assistant reaches DHIS2 through this extension's `dhis2_*` tools (search metadata, query analytics, check
reporting completeness, read and write mappings, start and follow downloads). They answer only inside a chat request,
so another extension cannot use them to reach DHIS2 through this one; the tools that change something ask first.

## Releasing

`npm version <patch|minor|major>` and push the tag: CI publishes the `.vsix` to the DataSuite registry and makes a
GitHub release whose notes give the `product.json` pin for DataSuite's `builtInExtensions`.

## What it keeps

Per connection, in the extension's global storage: mappings, the downloads (the line of them and the finished ones),
the settings, and finished downloads' data (`store.ts`). A finished download is written as a file only when it is
opened: into the folder of the settings (by default Documents/DataSuite/Downloads).

## Development

```bash
npm install
npm run build       # out/extension.js and out/webview.js (React)
npm run typecheck
npm test
node scripts/harness.mjs   # the webview in a browser, on sample data: out-harness/index.html (served over http)
```

The logic in `src/core/` is ported from DataSuite's built-in extractor (`scripts/port-core.py`); `docs/PORTING-SPEC.md`
describes the built-in extractor the port follows.
