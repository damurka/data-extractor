# Changelog

## 0.1.1

- The Countdown 2030 logo as the extension's icon (as Countdown Analytics'), and the editor tab's icon follows the
  light or dark theme.

## 0.1.0

- The Data Extractor as an extension, on DataSuite's DHIS2 API: connections and credentials stay in DataSuite;
  metadata from DataSuite's shared copy; downloads through DataSuite's analytics download with progress, pause and
  resume; the built-in extractor's mappings, downloads and settings carried over once per connection.
- Downloads adapt to the server: more requests at once while it keeps up, fewer when it struggles, and a request the
  server finds too big split in two. Checkpoints are appended a chunk at a time.
- DataSuite's DHIS2 chat tools (`dhis2_*`) move here with the same names; they answer only inside a chat request.
