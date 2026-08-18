# Pathfinder Character Sheet Program

A self-contained web app for Pathfinder characters built on our campaign's Google
Sheets template: bring a workbook (or start from a blank sheet), and get a live sheet
with full recalculation and a player-authored, GM-inspectable custom tracker system.
Everything runs in the browser — nothing is uploaded, nothing is installed, and what
you make is stored in your browser only.

It is a static site, so it runs from any file host (GitHub Pages included) or from a
local folder; the sheet itself is a standard custom element, so it drops into an
existing website unchanged. **The app ships with no characters** — the ones it was
built and tested against belong to their players and stay off the repository (see
[Your characters, and the fixtures](#your-characters-and-the-fixtures)).

Everything past the basics — how each tab computes, the sub-systems, formulas and
trackers, embedding, conversion — is in [docs/](docs/); the index is at the end of
this page.

---

## Quick start

```bash
node tools/serve.mjs
```

Then open <http://localhost:8777/app/index.html>. Pass a port to use another one
(`node tools/serve.mjs 8778`). `tools/serve.mjs` is a ~90-line dependency-free static
server — Node only, nothing to install. If you have Python instead, `python -m
http.server 8777` from the repository root does the same job.

> On Windows, `python` may resolve to a 0-byte Microsoft Store *app execution alias*
> rather than a real interpreter, which fails with `The system cannot find the path
> specified`. Nothing here needs Python: use the Node server above, and
> `tools/convert.mjs` instead of `tools/convert.py` to convert a workbook.

The picker starts empty: press **+ New** for a blank sheet, or **+ Import** (or drop a
file on the page) for a workbook exported from Google Sheets or a JSON this app wrote.
Tick **GM / inspector view** to reveal the Formula Audit tab. `app/embed-example.html`
shows the same sheet embedded in a hostile-looking host page.

### Publishing it (GitHub Pages or any static host)

There is no build step. Push the repository and serve its root: on GitHub Pages, set
the source to the branch root, and the app is at `https://<you>.github.io/<repo>/` (the
root `index.html` forwards to `app/`; `.nojekyll` keeps Pages from touching the
files). Visitors' characters live in their own browsers, so a read-only host is all
it needs.

To pre-load a roster on a deployment of your own, drop each character's JSON into
`data/characters/` and list it in `data/characters/index.json` — `tools/convert.mjs`
does both when it converts a workbook (below). Anything listed there is public to
whoever can reach the site, which is why the repository's own list is empty.

---

## Layout

```
index.html              forwards to app/ (so a host serving the repo root lands on the app)
data/characters/        bundled character JSON + index.json -- empty in the repository
data/maneuvers.json     shared discipline catalogue (every character reads it)
data/cooking.json       the iron chef's ingredient list, effect formulas as templates
tools/convert.py        xlsx -> JSON converter (Python, needs openpyxl)
tools/convert.mjs       the same converter as a Node CLI, no dependencies
tools/dump_tab.py       debugging aid: print a worksheet as a coordinate grid
tools/maneuvers_ref.py  build data/maneuvers.json from a workbook's maneuversRef tab
app/index.html          local host page (character picker)
app/embed-example.html  embedding demo
app/js/xlsx.js          dependency-free .xlsx reader (ZIP + OOXML)
app/js/zip.js           dependency-free .zip writer, for Export all
app/js/convert.js       xlsx -> JSON converter, shared by the browser and Node
app/js/formula.js       sandboxed expression language
app/js/rules.js         Pathfinder tables + derived-stat definitions
app/js/model.js         live character model
app/js/history.js       saved versions, snapshots and checkpoints (IndexedDB)
app/js/companions.js    familiar / animal companion / eidolon tables and sums
app/js/tracker-style.js tracker appearance: palette, zones, gradients, bar geometry
app/js/sheet-element.js the <character-sheet> custom element
app/js/styles.js        component stylesheet (shadow-scoped)
tests/                  node test suites
docs/                   the long-form documentation, one file per area (index below)
tests/fixtures.mjs      where the suites find real characters to test against (private/)
private/                git-ignored: real characters and their workbooks, if you have them
```

Run the tests with:

```bash
node tests/formula.test.mjs && node tests/tracker-style.test.mjs && node tests/model.test.mjs && node tests/convert.test.mjs && node tests/history.test.mjs && node tests/zip.test.mjs
```

`model.test` and `convert.test` check the model and the converter against real
characters, which the repository does not carry; without them they say so and exit 0
(the other suites run in full). See the next section for where they look.

---

## Your characters, and the fixtures

The app was built against five real characters from one campaign — the worked
examples throughout this document (Angou's essence, Bryva's spell-school table, Nico's
deck …) are them. They are players' characters, not sample data, so they are **not in
the repository**: the published app starts with an empty picker, and each visitor's
characters live in that visitor's browser.

Locally, the same five are what the regression suites run against. They and their
source workbooks sit in a git-ignored `private/` folder that mirrors the old layout:

```
private/characters/index.json    the roster, in the app's own index format
private/characters/<id>.json     converted documents
private/raw/<id>.xlsx            the workbooks they were converted from
```

`tests/fixtures.mjs` is the one place that knows this; set `CHARACTER_FIXTURES` to
point the suites somewhere else. `model.test.mjs` iterates the roster it finds, so a
character added to `private/characters/index.json` is tested without being listed
anywhere else; the checks written by name against the original five skip themselves
when those five are absent.

To rebuild the private set after a workbook changes:

```bash
node tools/convert.mjs --out private/characters --raw private/raw
```

All five descend from one template (24–27 tabs each) plus character-specific tabs
(a Technique List/AutoTechnique pair, a Cardcaster Deck, an Auto-Cooking tab), which
is what the converter's `extraTabs` capture is for.

---

## Documentation

| | |
|---|---|
| [Using the sheet](docs/using-the-sheet.md) | How the sheet is edited and what its core tabs compute — the Overview and its panels, the wallet, hit points, the Stats tab (point buy, enhancement cap, save and AC bonuses, progression picks, attunement), classes and traits, granted feats, skills, character colour, and the tab bar. |
| [Equipment & progression](docs/equipment-and-progression.md) | The gear list and what it feeds, the Item Crafting calculator, mythic tiers and paths, the Progression tab (column rule groups, schedules, owed slots), and templates. |
| [Sub-systems](docs/sub-systems.md) | The modelled sub-systems, each read once off its worksheet: Spheres & Magic training, Primordia techniques (the panel, and the Technique List / AutoTechnique tabs), Akashic, Maneuvers and Vancian, Card casting, Auto-Cooking, and the three companions. |
| [Formulas & trackers](docs/formulas-and-trackers.md) | The sandboxed formula language: `{name = expr}` in prose, custom trackers and meters, their appearance (zones, gradients, pips), the GM / inspector view and why player-written formulas are safe. |
| [Embedding](docs/embedding.md) | The `<character-sheet>` custom element: attributes, events, theming through custom properties, and the audit API. |
| [Importing & saving](docs/importing-and-saving.md) | How the converters read a workbook (defined names, label-anchored scans, reconciliation), the four ways a character comes in, Export all, and saving, snapshots, checkpoints and the schema. |
