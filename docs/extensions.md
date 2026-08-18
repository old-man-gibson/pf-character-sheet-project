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
sets the race, size and racial ability modifiers, and fills the race-trait rows. A veil is
shaped in its chakra slot on the Akashic board (essence 0), the first listed slot with room.

**Alternate racial traits swap, and remember.** A `trait` block carries `replaces` — read
off its own text ("This racial trait replaces defensive training and hatred", "in place of
stonecunning") unless the pack says otherwise — and the shelf shows it. Adding the trait
removes those rows from the character and keeps them on the new row as its history
(`replaced`, an **alt** badge on the Overview). A later alternate that overlaps undoes
exactly the right amount: if *Sky Sentinel* replaced defensive training, hatred and
stonecunning, and *Ancient Enmity* (which replaces hatred) is then added, Sky Sentinel is
displaced, hatred moves into Ancient Enmity's history, and defensive training and
stonecunning — which Ancient Enmity does not replace — come back as the standard traits
they were. A trait that names something not on the sheet is added and says what it did
not find; the same trait twice is refused. Removing an alternate's row by hand does not
put its traits back — add them again from the race's pack.

**Archetypes swap class features, stack when they can, and come off again.** An
`archetype` block names its class and carries its features, each with what it *replaces*
and what it *alters* — read off the feature's own sentence ("This ability replaces
challenge and kiai arts", "alters resolve", "modifies proficiencies"; "replaces the
determined ability of the resolve class feature" and "replaces the duty's call kiai art"
mean the parent is altered, not gone; anything "…proficiencies" is the one proficiency
feature) — and any "can be combined with…" note. It applies only when its class is on
the Classes table. **Adding** it takes the replaced features out of every Progression cell
they sit in and out of the class's Template group, puts the archetype's features in at
their own levels, and leaves altered features standing beside their new text; the class
row gets a **pill** with the archetype's name, and its free-text *Archetypes* field names
it too. Two archetypes **stack** when the sets of features they touch (replaced or altered
— proficiencies count) do not overlap; when they do, the second is **blocked**, the ⚙
shelf says which archetype and which features, unless one of them says it can be
combined with the other. The pill's **×** removes the archetype and puts back exactly what
it took, from its own record; what other archetypes did stays. The *Alternate Class
Features* page reads as one single-feature archetype per option, so those swap and stack
by the same rules. A feature that comes with a **menu** — talents, techniques, arts: a
heading naming the feature over typed entries, with sub-headings (*Cuts*, *Slashes*) as
categories — keeps the menu as its `options`; untyped "Name: text" entries under the
heading (a *Mapped:* condition) are the menu's information. On the sheet the menu becomes
its own Template group, *Class — Feature*, with an *About these options* entry first and
one entry per option under its category (and a *(Level N+)* mark where the text says who
may select it); the feature itself keeps its schedule on the ladder. The sheet has no
picker for such menus yet — rogue talents and the like are typed into a Progression column
under its level rule — so the group is where the text lives to pick from. Removing the
archetype removes the group.

Switching a
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
   pages has between them) as a hard boundary. A wiki page's chrome — the sign-in and
   search lines over the title, the tab strip, the errata *Notice*, the breadcrumb, and the
   whole navigation column and footer — is recognised first and stays transparent: never
   content, never a boundary, never a leftover. Markdown copies (bullets, `[text](url)`
   links) are flattened before reading, and a *FAQ* in the middle of a list is an interlude
   the list carries on past. A class yields its progression table (tab-separated rows,
   space-separated, or one cell per line), hit die, BAB and good saves read off the 20th row
   (or the wiki's info box), skill ranks, source, class skills with the `(Dex)` tags stripped
   (a missing comma between two skills is healed), a description made of the flavour, the
   *Role:* and other labelled lines and any sidebar above the table, and features by level
   with their prose matched by name — *Trap sense +1* on the table finds *Trap Sense (Ex)*
   below, singular finds plural (*kiai art* / *Kiai Arts*), and where a page's table and prose
   disagree (*opportune strike* / *Opportune Slash*) the same level and first word pair them.
   A feature's prose runs on: continuation paragraphs, list lines, untyped sub-entries
   (*Spirited Initiative: …* under *Spirit*), a *See:* pointer and any sidebar (*Sheathed*,
   *Grit, Panache, and Spirit*) stay inside the feature they sit under; extra table columns
   (Known / Readied / Stances) fold into one entry per level; *Ex-Barbarians* and the
   proficiency line are features too; alternate capstones become features in their own
   group; the favored-class list (*Options* or *Bonuses*) and the archetype table (name and
   one-line flavour) become notes. A race yields its ability modifiers, size, speed,
   languages and standard traits, its alternate traits as `trait` blocks (each says what it
   replaces, colon or no colon), subtypes and favored-class options as notes, and the age and
   height tables are dropped and said so. A veil becomes a `veil` block: title, chakra
   slot(s), descriptor and source from the info box; shaping text, *Essence*, *Chakra Bind*,
   saving throw and bind levels as its text. An archetype page (its info box names the
   class it is for) becomes an `archetype` block — flavour, source, and its features with
   what each replaces or alters; the *Alternate Class Features* page becomes one
   single-feature archetype per option, sectioned. A plain archetype document — homebrew in a
   text file, with no info box — anchors on its first "This ability replaces…" / "X alters Y"
   sentence instead: the first short line is its name, a *Description* section its flavour,
   `Name (Ex)` title lines (colons allowed) and untyped headings over a paragraph its
   features; the class is left blank for the form (or resolves to the sheet's only class).
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

