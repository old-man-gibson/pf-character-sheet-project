# Getting characters in: conversion, import, export, history

_Part of the [Pathfinder Character Sheet Program](../README.md) docs. How the converters read a workbook (defined names, label-anchored scans, reconciliation), the four ways a character comes in, Export all, and saving, snapshots, checkpoints and the schema._

---

## How the conversion works

Extraction is driven by two mechanisms rather than hard-coded cell addresses, so it
survives the small layout differences between one player's copy of the template and
the next:

1. **Defined names.** The template declares ~476 named ranges (`StrMod`, `BAB`,
   `CondEntangled`, …). These are stable across characters and are captured wholesale
   into each character's `named` block.
2. **Label-anchored scans.** Tables are located by finding their header text, then
   walking the rows beneath it.

Tabs without a dedicated extractor are still captured cell-for-cell under
`extraTabs`, so nothing in a character's bespoke machinery is silently dropped.

### Reconciliation — why the numbers match

Many totals in the source sheets are computed by Google-only functions
(`ARRAYFORMULA`, `FILTER`) that do not survive an `.xlsx` export, and by gear and
Automatic Bonus Progression tables spread across several tabs. Rather than guess at
those, the model computes each derived stat from the parts it can see and stores the
difference against the sheet's own value:

```
offset = sheetValue − computedFromVisibleParts
```

The result: on import **every derived number matches the Google Sheet exactly**, and
edits still move things correctly — raise Con by 2 and Fortitude rises by exactly 1.
The UI shows which values have drifted from the source sheet.

Offsets are ordinary editable fields, not hidden bookkeeping: AC, touch, flat-footed
and CMD carry one each in the Overview's Defense panel, and the three saves in the
Saves panel, under **Other**. Nothing extra is stored for an edited one: the offset is
recovered on load as `savedTotal − computedFromVisibleParts`, so it round-trips through
`localStorage` and Export JSON exactly as an imported one does.

Most of what used to sit in those offsets is now itemised — see
[Save & AC bonuses](using-the-sheet.md#save--ac-bonuses) — and what remains is whatever the export could
not account for at all.

This is verified by `tests/model.test.mjs`, which asserts that AC, touch, flat-footed,
CMD, all three saves, all three attack totals, initiative, and **every skill** reproduce
their source values. It reads the roster from `data/characters/index.json` rather than a
list of its own, so a character added to the index is checked without anyone having to
remember to add it to the tests as well.

---

## Getting characters in

Four ways in, for four different jobs.

### From nothing — in the app

**+ New** in the picker asks for a name, a player and a level (3rd or higher — the
campaign's floor), and opens a blank sheet. "Blank" here means the campaign template with
nothing typed into it: 10 in every score (bought at 10 on the standard point-buy table),
the template's skill list with no ranks, Con behind hit points, Dex behind AC and
initiative, the usual ability behind each save and attack mode, one hero point, **6 hit
points a level** as a starting maximum (a plain number to overwrite once the classes are
in), two empty perk slots, three empty race-trait slots, every companion tab empty and
waiting in ⚙, and nothing else. Empty slots the character is owed — Traits 1–3, the
race-trait rows, the perks — carry a red wash until filled, and the panel headers count
them (*0 of 3 picked*). Classes go in on the Overview and onto the Progression tracks;
hit-point maximum and base attack are typed, as they are on the workbook; everything
downstream recalculates as it does for an imported character.

Under the hood it is not a second document shape: `blankDocument()` in
`app/js/convert.js` runs the converter's own `build()` over a workbook whose structured
tabs all exist and are empty, so every extractor returns its empty structure rather than
the `null` it returns for a tab that is missing, and then fills in the seeds above. The
result passes the same `inspectDocument` gate an import does, is stored in
`localStorage` the same way, and shows in the picker tagged *new* rather than
*imported*. Its imported AC/touch/flat-footed/CMD totals are set to the 10 the model will
compute, so the reconciliation offsets come out at zero — a blank character reads as
having drifted from nothing. `tests/convert.test.mjs` checks the shape, the seeds, the
gate, the zero offsets, and that a Dex point, a class on the tracks and a skill rank all
move the numbers they should.

The Skills tab hides unranked skills by default; on a character with no ranks anywhere
that filter would hide everything, so it shows the whole list until a rank is spent. The
⚙ manager tab is always there now (a blank character has no raw grid tabs, and it is
where the companion and system tabs are switched on).

### From a workbook — in the app

Anyone looking at the page can add their own character, with nothing installed and
no command line. In Google Sheets choose **File → Download → Microsoft Excel
(.xlsx)**, then press **+ Import** in the top bar — or drop the file anywhere on
the page.

The workbook is read and transcribed **in the browser**. It is not uploaded, there
is nothing to upload it to, and the file itself is discarded once its contents have
been read; only the resulting character document is kept, in `localStorage`, exactly
like an imported JSON. This is what makes a read-only deployment — GitHub Pages, or
any static host — usable by testers rather than just browsable.

`app/js/xlsx.js` reads the ZIP and OOXML directly, using the platform's own
`DecompressionStream` for DEFLATE and no library for anything else, so this adds no
dependency and no build step. `app/js/convert.js` then runs the same extraction the
Python converter does; it is pulled in only when a workbook actually arrives (or
**+ New** is pressed), so an embedded sheet does not carry it for nothing. An 800 KB
workbook takes roughly half a second.

A workbook that is not the campaign template still converts — the extractors return
empty structures rather than failing — and the import banner reports what was
missing rather than leaving you to discover a thin sheet later.

### From a workbook — on the command line

For bundling characters into a deployment of your own, or converting in bulk. Two
interchangeable front ends to the same job:

```bash
node tools/convert.mjs path/to/kaito.xlsx --id kaito
```

```bash
python tools/convert.py path/to/kaito.xlsx --id kaito
```

`convert.mjs` needs nothing installed and shares its extraction logic with the
in-browser converter. `convert.py` needs `openpyxl`. They write byte-identical files —
`tests/convert.test.mjs` is what keeps that true. Neither holds a list of characters:
a roster is whatever `index.json` in the output directory lists.

That writes `data/characters/kaito.json` and adds it to `index.json`, so the character
appears in the picker on the next reload — for everyone who can reach the site, so
this is for a deployment you control, not the public one. Re-running on an updated workbook replaces
both — and keeps the `--name` and `--file-id` already recorded, so a plain re-run does
not downgrade them to defaults.

| Flag | Default |
|---|---|
| `--id` | the workbook's filename, slugified |
| `--name` | the workbook's filename (the source title stored in the document) |
| `--file-id` | none — supply the Google Sheets file id to record a link back |
| `--out` | `data/characters` |
| `--raw` | `data/raw` — where a roster rebuild looks for `<id>.xlsx` |
| `--dry-run` | report what would be written, write nothing |

With **no** workbook it rebuilds every character listed in `<out>/index.json` from
`<raw>/<id>.xlsx` and rewrites the index — which, for the private test set, is:

```bash
node tools/convert.mjs --out private/characters --raw private/raw
```

```bash
python -m pip install openpyxl
python tools/convert.py --out private/characters --raw private/raw
```

The extractors return empty structures rather than failing, so a workbook that is not
the campaign template converts to a thin document instead of an error. That is what the
`warning` lines are for — a missing skills table, no defined names, an empty Planner:

```
reading  path/to/kaito.xlsx
tabs     24 (10 structured, 9 captured verbatim)
warning  no defined names - this does not look like the campaign template
wrote    data/characters/kaito.json  (243,696b)
updated  data/characters/index.json  (6 characters)
```

### From an exported JSON — in the app

**Export JSON** and **Import JSON** are a pair. Import takes a file the app itself
wrote, so a build moves between browsers and machines and a backup restores. Either use
the button in the sheet header, the **+ Import** chip in the picker, or drop a `.json`
file anywhere on the page.

The page cannot write to `data/characters/`, so an imported character lives in
`localStorage` and joins the picker marked *imported*, with an × to remove it (which
takes its edits, its saved version and its whole history with it, and leaves the
converted sheets alone). A document whose id collides keeps its data and takes the next
free id — `saburo-2` — so nothing is ever overwritten. Each is ~260 KB against a typical
5–10 MB budget, and a full store reports that rather than failing silently.

### Every character at once — Export all

**Export all** in the picker downloads every character it lists as one `.zip`. Each
entry inside is a plain document of exactly the kind **Export JSON** writes, so any one
of them drops straight back in through Import — there is no bundle format, and nothing
in the archive that only this page can read.

It packs the version opening that character would show: the one last **Save**d, or where
you last left off if you have never saved it, or the converted document if you have never
touched it. Entries are named after the character (`Dōkei Saburō.json`), and two
characters sharing a name are told apart by their id.

Five typical characters are ~620 KB of JSON and ~100 KB zipped. `app/js/zip.js`
writes the archive, and it is the mirror of the reader in `xlsx.js` — an `.xlsx` is a ZIP
that has to be opened, this is a ZIP that has to be closed, and both halves of DEFLATE
are built into the browser (`DecompressionStream` there, `CompressionStream` here). So
neither direction needs a dependency or a build step. `tests/zip.test.mjs` reads back what
the writer writes using `xlsx.js`'s own `openZip`, on the real characters: the writer and
the reader are two halves of one format, so the honest test of either is the other.

### Saving, and going back

Three things are kept per character, each in the store that suits it.

| | Where | Written |
|---|---|---|
| The working sheet | `localStorage` | on every edit |
| The saved version | IndexedDB | when you press **Save** |
| Snapshots and checkpoints | IndexedDB, gzipped | every 20 changes, or on request |

**The sheet opens on the saved version.** That is what makes Save mean something: an
evening of experiments does not quietly become the character. Nothing is lost to that,
though — edits made after the last Save are filed as a snapshot the moment the sheet next
opens, and offered back with *"2 unsaved changes from 14:03 were not part of the saved
version"*. Because the recovery is a snapshot rather than a banner, it survives ignoring
the banner, closing the tab, or a crash two minutes later.

**Snapshots** are automatic, taken every 20 changes away from the saved version, and the
last 5 are kept. **Checkpoints** are the same thing with a name you gave it — "before
respec", "end of session 12" — and nothing evicts them. **History** lists both, and
opening one makes it the working sheet without making it the saved version, so looking at
an old state is not the same as declaring it current. The state you were on is filed
first, so a restore is itself undoable. **Reset** goes back to the character as converted
and keeps your named checkpoints, because a Reset pressed by mistake should not be the
one action you cannot walk back.

A "change" is a differing leaf value, not a keystroke: type a wrong number and type it
back and you have drifted nowhere, and the count says so.

Why the split of stores, rather than one: the working sheet's whole job is to still be
there after a closed tab, and only `localStorage` can be written synchronously as the
edit happens — an IndexedDB write started as the tab goes away may never settle. The
saved version and the history have the opposite shape, written on a button press or once
every twenty edits but many documents deep, and there `localStorage`'s ~5 MB is the wrong
budget. A document is ~250 KB of JSON and ~20 KB gzipped, so five snapshots and a saved
version cost ~120 KB per character against a quota measured in hundreds of megabytes.

If IndexedDB is unavailable — private browsing, a blocked frame, a zero quota — there is
no saved version and no history, and the sheet behaves as it did before any of this
existed: edits are kept continuously and it reopens where you left off.

`tests/history.test.mjs` covers the parts that need no database: what counts as a change,
what gets evicted, and the compression, against the real characters.

A file is vetted before it loads, and a refusal says what to do about it: wrong
`schemaVersion` names both versions and points at the converter, malformed JSON gives
the parse error, and anything that is not a character document says so. `Reset` on an
imported character restores the document as imported, since there is no URL to re-fetch.

### Both paths, and the schema

Local edits are unaffected by re-conversion until you press **Reset** on a character.
Saved edits, saved versions, snapshots and imported files all carry the document's
`schemaVersion` (currently 9, declared as `SCHEMA_VERSION` in `model.js` and written by
the converter); if the schema changes, stale working state is discarded, stale imports
refused, and a stale snapshot is listed but not openable — struck through, saying what it
was written for — rather than loaded with sections missing.

`tests/model.test.mjs` asserts that every converted character passes the import gate,
that what the app exports imports back with its edits intact, and that each refusal
reports the right reason.

`tests/convert.test.mjs` covers the other end: it re-converts every fixture workbook
with the JavaScript converter and compares the result field for field against the
JSON the Python one wrote. Two implementations of one format drift unless
something makes them prove they agree, and that test is what makes them.
