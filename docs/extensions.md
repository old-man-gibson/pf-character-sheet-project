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
  tab), a whole feature group (`template`), an `options` menu a class feature picks from,
  a resource `tracker` (with its formula), a `note`. Attaching **copies** the block into the character through the same model
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
      "systems": ["path-of-war"],
      "features": [{ "level": 1, "name": "Rage" }, { "level": 2, "name": "Rage power" }] },
    { "kind": "tracker", "name": "Rage rounds", "maxFormula": "4 + con.mod + (level - 1) * 2", "refresh": "per day" },
    { "kind": "race", "name": "Dwarf", "size": "Medium", "speed": 20,
      "abilityMods": { "con": 2, "wis": 2, "cha": -2 },
      "traits": [{ "name": "Darkvision", "text": "…" }] },
    { "kind": "options", "name": "Rogue Talent", "class": "Rogue", "feature": "Rogue talent",
      "options": [{ "name": "Bleeding Attack", "type": "Ex", "category": "Rogue Talents",
        "minLevel": null, "source": "…", "replaces": [], "text": "…" }] }
    /* in the editor's form, one entry per line:
       "Rogue Talents / Bleeding Attack (Ex) 5+: text" — category, type and level all optional */
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

A class's own feature text lands **under the class**, on the Progression tab beneath its
ladder — *What they do*, one entry per distinct feature however many levels grant it, an
archetype's among them, each editable like anything typed in. The Template tab is for
templates. A sheet written by an earlier version, which put a class's text there, moves it
across on its next load: a group named for a class, carrying no template link, every one of
its features named on that class's ladder, and the class holding no text of its own yet.
Anything less exact is a template and stays one.

**On the sheet**, the ⚙ manager's *Extensions — building blocks* shelf lists every block
the enabled packs offer, filterable by kind and searchable, each with **+ Add**. The search
reads a block's name, its pack, its class and what its features are called and swap, so
*warrior* finds an archetype that replaces warrior's grace; a block the words name outright
comes first. A class lands as a
Classes-table row, its feature names on the Progression tab by level, and the features that
carry rules text under the class there; its class skills are ticked. Its optional `systems`
tags (`GAME_SYSTEMS` ids in `rules.js` — `"spheres-of-power"`, `"path-of-war"`,
`"psionics"`, …) land on the row's **Systems** toggles and merge with whatever the player
already marked, lighting the matching tabs up in the manager and on the session view's
bar. A race
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
feature) — and any "can be combined with…" note. A sentence naming levels — "this replaces
the 10th and 14th level warrior's grace" — swaps **those grants**, not the feature: the
swap key carries the level as `warriors grace@10`, which is why two archetypes taking
different grants of one feature stack while either clashes with one taking the whole of it. It applies only when its class is on
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
may select it); the feature itself keeps its schedule on the ladder. Removing the
archetype removes the group.

**A class feature taken over and over gets a column, and a menu to pick from.** Adding a
`class` block gives each feature its table names at more than one level a column of its
own on the Progression tab, on the schedule those levels describe — *Prowess* on `2, +2`,
*Bonus feat* on `1, +5`, an irregular one as the levels themselves. A **ladder** whose
name grows as it goes (*Thunderous blows +1d6*, *+2d6*) writes what it grew by in each
cell; a **menu** named the same way every time (*Smithing insight*) leaves them blank,
which is what the column's badge is counting. One-off features stay in *Special*.

Those menus live on pages of their own — *Rogue Talent*, *Legendary Samurai Iaijutsu
Technique* — and so in packs of their own, as an `options` block naming its class, the
feature that picks from it, and its entries (name, type, category, source, and the level
the entry asks for). **Naming the class and the feature is claim enough**: a column of that
name picks from it as soon as the pack is switched on, with nothing added and nothing
recorded on the character — so the menu and the class need not be added in any order, or
the menu at all. What is recorded is only a **name**: the character keeps which entry was
picked, never a copy of the menu, so a 178-entry rogue talent list is stored once in its
pack rather than in every rogue's sheet. Cells in a
column with a menu offer its entries and say what the chosen one does; they are still
boxes to type in, so a GM's ruling or an option no pack carries goes in as it always did.
The column head's dropdown picks the menu by hand and overrides what a pack claimed —
including *— no menu —*, which is a decision the packs do not take back. A menu whose pack
is switched off leaves the name on the sheet and the column a plain box until it comes back. With no such class or column on the sheet an `options` block copies
nothing: it stays in its pack and takes effect the moment a class with that feature arrives.

**A cell offers what its level can take.** An entry may ask for a level — its own sentence
("a legendary samurai must be 5th level or higher to select this iaijutsu technique") or
the heading it sits under where the page groups by level ("7th Level"). A cell's list holds
only what that class level has reached, and an entry written below the level it asks for is
flagged rather than refused, since a GM may allow it.

**An archetype's menu layers onto the class's rather than replacing it.** Where an
archetype's feature carries a menu and alters or replaces a class feature that has a
column, the archetype's menu goes on the end of that column's list, under the name
*Archetype — Feature*. Entries whose text says what they replace ("this replaces the Ranged
Cut and Armor Rending Slash iaijutsu techniques") push those out of the list, entries with
the same name win, and the rest of the class's menu stands — so an Isougiri picks from the
samurai's thirteen remaining techniques plus its own eight, with the eight they replaced
gone. The column head shows the layer under the base menu; the archetype's pill takes it
off again. And a **repeat feature an archetype replaces outright** loses its whole column —
its schedule, its menu and whatever was written in it, kept on the archetype's own record
and put back, in place, when the archetype comes off.

**One grant at a time.** Where an archetype names levels rather than the feature, the
column stays and its schedule loses those levels: `2, +4` becomes `2, +4, -10, -14`, which
is the rule language writing what happened in terms a player can read and edit. Whatever
had been picked at a level it took is kept on the archetype's record and put back with it,
and undoing takes the `-10` term out rather than restoring a remembered rule — so the order
several archetypes come off in does not matter. The feature's own text stays on the Template
tab throughout: it arrives one time fewer, it does not go. A level the class never granted
at is **not** a swap that happened: nothing is changed and the report says so, which is what
catches a page whose table and prose disagree.

Switching a
pack on or off in the dialog redraws every sheet on the page at once. `app/js/extensions.js`
is the pure module (format, store, merge, attach), `extension-runtime.js` the page's one
set of active packs registered with the model, `extension-manager.js` the dialog; a host
page mounts the dialog with `mountExtensionManager(dialogElement, { say, currentCharacter })`.
Covered by `tests/extensions.test.mjs`.

## Paste text — reading a rules page into blocks

The editor's **Paste text…** takes a class, a race or a veil copied straight off a rules
page (Archives of Nethys, d20pfsrd, the Metzofitz wiki, the Spheres of Power wikidot wiki —
the whole page, several pages one after another) and reads it into blocks. It is a two-stage
affair, and the second stage is the point:

1. **Read it.** `app/js/paste-import.js` finds what the paste holds by a handful of anchor
   lines every page uses — *Hit Die* for a class, *Standard Racial Traits* / *Ability Score
   Modifiers* for a race, *Chakra Slots* for a veil — reaches back for each thing's preamble
   and forward to the next thing, with two blank lines in a row (what a paste of several
   pages has between them) as a hard boundary. A wiki page's chrome — the sign-in and
   search lines over the title, the tab strip, the errata *Notice*, the breadcrumb, and the
   whole navigation column and footer — is recognised first and stays transparent: never
   content, never a boundary, never a leftover. A wikidot page is cut the same way, by its
   own landmarks rather than by what its menus happen to say: everything above the
   breadcrumb (*Wiki Home Page » Classes » Blacksmith*) is the banner and side menu, the
   *Table of Contents* under it runs to the next blank line, and the footer takes the columns
   of links above it with it. Each of those runs once per page, and a page's title is a floor
   the page below it cannot reach back over. Markdown copies (bullets, `[text](url)`
   links) are flattened before reading, and a *FAQ* in the middle of a list is an interlude
   the list carries on past. A class yields its progression table (tab-separated rows,
   space-separated, or one cell per line; *Level* or *Class Level*, levels written *1st* or
   plainly *1*), hit die, BAB and good saves read off the 20th row
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
   proficiency line are features too; a page that heads its features with a bare name and no
   *(Ex)* (*Combat Training* over its paragraph) is read where the table names that feature,
   any other short heading staying a sidebar inside the feature above; alternate capstones
   become features in their own group; the favored-class list (*Options* or *Bonuses*) and
   the archetype list — a table, or each name over a line of flavour — become notes. What
   sits below those lists is the page's other pages (its feats, its magic items, a bestiary):
   it is set aside rather than offered a chunk at a time, and the report says how much.
   A race yields its ability modifiers, size, speed,
   languages and standard traits, its alternate traits as `trait` blocks (each says what it
   replaces, colon or no colon), subtypes and favored-class options as notes, and the age and
   height tables are dropped and said so. A veil becomes a `veil` block: title, chakra
   slot(s), descriptor and source from the info box; shaping text, *Essence*, *Chakra Bind*,
   saving throw and bind levels as its text. An archetype page (its info box names the
   class it is for) becomes an `archetype` block — flavour, source, and its features with
   what each replaces or alters; the *Alternate Class Features* page becomes one
   single-feature archetype per option, sectioned. An **option page** — whose info box
   says *Option* as well as *Classes Available* — becomes an `options` block instead: the
   class, the feature that picks from it, and one entry per *Name (Ex): text* line or
   table row, with the level each asks for (*"must be 5th level or higher to select"*, not
   a level it scales at) and the heading it sits under as its category. Where the page's
   contents list numbers its headings, that is what says which heading is a category and
   which the book it came from; failing that, the heading with another heading under it is
   the outer of the two. A plain archetype document — homebrew in a
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
back in the review as text to tag — bar the page tail above, which the report accounts for.
`tests/paste-import.test.mjs` runs the reader over the three table shapes, both
feature-prose shapes, the segmentation, the whole Barbarian / Dwarf / Warlord / veil paste,
a two-page wikidot copy and an option page.

> The engine still carries some publisher names of its own — the Spheres of Power sphere
> lists in `rules.js` (which drive skill-rank and unarmed logic), the Primordia techniques,
> the mythic path names — and those are the next thing to lift into packs.

