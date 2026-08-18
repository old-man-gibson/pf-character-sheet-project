# Extensions: content packs and the paste importer

_Part of the [Pathfinder Character Sheet Program](../README.md) docs. Content packs: the engine ships content-free and classes, disciplines, races and building blocks arrive in JSON packs — bundled or local, written, imported and shared from the Extensions dialog; the paste importer that reads a rules page into blocks, with its review stage._

The engine knows rules — how a save is built, what a level rule means, how a tracker's
formula is evaluated. It does not know the names of anyone's classes, disciplines,
races or feats. Those are **content**, and content arrives in **extension packs**: one
JSON file each, which a player writes, imports from a friend, or gets bundled with a
deployment. The engine can therefore be shipped on its own, with no publisher's names
in it, and a table's content travels separately.

A pack carries two kinds of thing:

- **Shared tables** the whole app reads — a discipline catalogue (`maneuvers`), casting
  tables (`vancian`), manifesting curves (`psionics`), deck manipulations
  (`cardcasting`), cooking ingredients (`cooking`) — under `provides`. Every enabled
  pack's tables are merged at load and registered with the model; a later pack's entry
  replaces an earlier one of the same name, so a player can correct a bundled table by
  shipping a fixed copy in their own pack.
- **Blocks** a player attaches to one character: a `class` (hit die, BAB, saves, ranks,
  class skills, features by level), a `race` (size, speed, ability modifiers, traits,
  languages), a single race `trait`, a `feature` (joins a named group on the Template
  tab), a whole feature group (`template`), a resource `tracker` (with its formula), a
  `note`. Attaching **copies** the block into the character through the same model
  methods a hand edit uses, so an exported character is self-contained and needs no
  pack to open — and what landed is then editable like anything typed in.

```json
{
  "format": "character-sheet-extension", "formatVersion": 1,
  "id": "core-classes", "name": "Core classes", "author": "…", "revision": 1,
  "description": "…", "source": "https://…", "license": "OGL 1.0a",
  "provides": { "maneuvers": { "disciplines": [ … ] } },
  "blocks": [
    { "kind": "class", "name": "Barbarian", "hd": 12, "bab": 1, "goodFort": true,
      "skillRanks": 4, "classSkills": ["Acrobatics", "Climb", "…"],
      "features": [{ "level": 1, "name": "Rage" }, { "level": 2, "name": "Rage power" }] },
    { "kind": "tracker", "name": "Rage rounds", "maxFormula": "4 + con.mod + (level - 1) * 2", "refresh": "per day" },
    { "kind": "race", "name": "Dwarf", "size": "Medium", "speed": 20,
      "abilityMods": { "con": 2, "wis": 2, "cha": -2 },
      "traits": [{ "name": "Darkvision", "text": "…" }] }
  ]
}
```

**Where packs come from.** *Bundled* packs are listed in `data/extensions/index.json`
and sit beside it — the same arrangement as `data/characters/`, and like it the
published engine can ship the index empty. This repository's five bundled packs are the
campaign's shared tables (disciplines, casting and manifesting tables, deck
manipulations, cooking ingredients), which used to be bare files under `data/`; the
`tools/*_ref.py` scripts now write them as packs, keeping an existing pack's header and
bumping its revision. *Local* packs live in the visitor's browser only
(`character-sheet:extensions` index, `character-sheet:ext:<id>` documents), alongside
imported characters.

**The Extensions dialog** (the button in the host page's header) lists both: switch any
pack on or off (bundled ones too — the choice is remembered), **Export** one as a
`.json` to share, **Import** a file, paste JSON, or drop a pack anywhere on the page —
the page tells a pack from a character by its `format` line, and the sheet's own Import
button hands a pack up the same way. **+ New extension** opens the editor: the header
fields, then blocks as one small form each (features and traits are typed one per line
— `1: Fast movement, Rage`, `Darkvision: text`), or the whole document as JSON. **Copy
to mine** clones a bundled pack into an editable local one; **From this character…**
lifts the open sheet's classes, race, feature groups and trackers into a new pack, which
is how something built by hand gets shared. A pack imported with the same id as one
already here replaces it (that is how a friend's rev 2 lands); a local pack cannot take
a bundled pack's id.

**On the sheet**, the ⚙ manager's *Extensions — building blocks* shelf lists every block
the enabled packs offer, filterable by kind, each with **+ Add**. A class lands as a
Classes-table row, its feature names on the Progression tab by level, and the features
that carry rules text as a group on the Template tab; its class skills are ticked. A race
sets the race, size and racial ability modifiers, and fills the race-trait rows. Switching a
pack on or off in the dialog redraws every sheet on the page at once. `app/js/extensions.js`
is the pure module (format, store, merge, attach), `extension-runtime.js` the page's one
set of active packs registered with the model, `extension-manager.js` the dialog; a host
page mounts the dialog with `mountExtensionManager(dialogElement, { say, currentCharacter })`.
Covered by `tests/extensions.test.mjs`.

## Paste text — reading a rules page into blocks

The editor's **Paste text…** takes a class, a race or a veil copied straight off a rules
page (Archives of Nethys, d20pfsrd, the Metzofitz wiki — the whole page, several pages
one after another) and reads it into blocks. It is a two-stage affair, and the second stage
is the point:

1. **Read it.** `app/js/paste-import.js` finds what the paste holds by a handful of anchor
   lines every page uses — *Hit Die* for a class, *Standard Racial Traits* / *Ability Score
   Modifiers* for a race, *Chakra Slots* for a veil — reaches back for each thing's preamble
   and forward to the next thing, with two blank lines in a row (what a paste of several
   pages has between them) as a hard boundary. A class yields its progression table (tab-
   separated rows, space-separated, or one cell per line), hit die, BAB and good saves read
   off the 20th row, skill ranks, class skills with the `(Dex)` tags stripped, and features
   by level with their prose matched by name — *Trap sense +1* on the table finds *Trap Sense
   (Ex)* in the text; extra table columns (Known / Readied / Stances) fold into one entry per
   level; *Ex-Barbarians* and the proficiency line are features too; alternate capstones
   become features in their own group and the favored-class list a note. A race yields its
   ability modifiers, size, speed, languages and standard traits, its alternate traits as
   `trait` blocks (each says what it replaces), subtypes and favored-class options as
   notes, and the age and height tables are dropped and said so. A veil becomes a feature
   group: description, *Essence*, *Chakra Bind*.
2. **Review.** The panel shows what was read — one line per block, each with a tick to
   drop it — and then **everything the reader did not use**, as stretches of the original
   text with a tag menu on each: *feature of* the class it sat under, *race trait of* the
   race, a trait block, a feature block (in a named group), a note, or leave it out. The
   reader suggests a tag (a `Label: text` line near a class is offered as its feature; page
   chrome as skippable) and the player decides. **Add N blocks** folds the decisions in:
   tagged text joins the class or race it was tagged onto, the rest become blocks, and the
   editor's block forms are where anything gets corrected before Save.

Nothing is guessed at silently: every line either lands somewhere the report names or comes
back in the review as text to tag. `tests/paste-import.test.mjs` runs the reader over the
three table shapes, both feature-prose shapes, the segmentation and the whole
Barbarian / Dwarf / Warlord / veil paste.

> The engine still carries some publisher names of its own — the Spheres of Power sphere
> lists in `rules.js` (which drive skill-rank and unarmed logic), the Primordia techniques,
> the mythic path names — and those are the next thing to lift into packs.

