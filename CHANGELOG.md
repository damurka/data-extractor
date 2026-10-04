# Changelog

## 0.2.0

- A new look and layout: an overview (what needs attention, the latest downloads, the server; the three steps to a
  first download until one is made), mappings with how far each is, and a mapping editor with the indicators, the
  selected one and the search side by side. IBM Plex, in DataSuite's light and dark themes.
- Downloads wait their turn: a few run at the same time (Settings), the rest in a line that can be reordered, paused
  and resumed as a whole. Each shows its requests done and the time left; a failed one says why.
- New download: Last 12 months, This year, Last year or a range of months or years, picked in the Gregorian or the
  Ethiopian calendar on a server that uses it.
- A Countdown mapping lists every Countdown indicator, each to map or to mark as not available on the server (with a
  reason): those count as done and keep their column, empty, in the workbook.
- A custom mapping's indicators are grouped into sheets, each a sheet of its workbook, and can be reordered.
- Importing a mapping checks it against the server first: which sources it has, which it lacks, and whether to
  import it as a new mapping or over the one with the same name.
- Finished downloads open from the folder of the settings, named by a pattern; a custom mapping's workbook can add
  each organisation unit's id and the units above it.
- Settings: the calendar and period type New download starts with, how downloads run, the files they make, and when
  the metadata copy is refreshed (each time the extractor opens, daily, weekly, or only when asked).
- Choosing a connection: each server shows whether it answers, its DHIS2 version, its mappings and when it was last
  used here; one the extractor may not read through yet says what allowing it means; one whose sign-in the server no
  longer accepts offers to sign in again in DataSuite; and the last used server can open straight away.
- Only DataSuite changes a connection: Settings shows it, and hands off to DataSuite to sign in, sign out or manage
  which extensions may use it.
- On Windows, a download no longer fails when its progress is saved while a screen reads it.

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
