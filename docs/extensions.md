# Extensions: content packs and the paste importer

_Part of the [Pathfinder Character Sheet Program](../README.md) docs. Content packs: the engine ships content-free and classes, disciplines, races and building blocks arrive in JSON packs — bundled or local, written, imported and shared from the Extensions dialog; the paste importer that reads a scraper's structured markdown or a copied rules page into blocks, with its review stage._

The engine knows rules — how a save is built, what a level rule means, how a tracker's
formula is evaluated. It does not know the names of anyone's classes, disciplines,
races or feats. Those are **content**, and content arrives in **extension packs**: one
JSON file each, which a player writes, imports from a friend, or gets bundled with a
deployment. The engine can therefore be shipped on its own, with no publisher's names
in it, and a table's content travels separately.

A pack carries two kinds of thing:

- **Shared tables** the whole app reads — a discipline catalogue (`maneuvers`), a sphere
  catalogue (`spheres`), casting tables (`vancian`), manifesting curves (`psionics`), deck
  manipulations (`cardcasting`), cooking ingredients (`cooking`) — under `provides`. Every enabled
  pack's tables are merged at load and registered with the model; a later pack's entry
  replaces an earlier one of the same name, so a player can correct a bundled table by
  shipping a fixed copy in their own pack. **A discipline is the exception** — two packs
  naming the same one join maneuver by maneuver, and only an entry of the same name is
  replaced, because a discipline is a list of thirty rather than one fact and a pack
  carrying a single corrected maneuver must not delete the twenty-nine it had no opinion
  about. Tables are **not** copied into a character: the sheet reads them where they
  stand, so a corrected pack corrects every sheet already in play.
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
    { "kind": "class", "name": "Armiger", "hd": 10, "bab": 1, "goodFort": true, "goodRef": true,
      "skillRanks": 4,
      "tracks": { "name": "Customized weapon", "unit": "weapon", "spheres": "combat",
        "sets":    { "start": 3, "gainsAt": "11, 19" },
        "talents": { "start": 1, "gainsAt": "3, +4" } } },
    { "kind": "archetype", "name": "Antiquarian", "class": "Armiger",
      "tracks": { "spheres": "both" },
      "features": [{ "level": 1, "name": "Relic lore", "text": "This replaces quick change." }] },
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

**Where packs come from.** *Bundled* packs are listed in an `index.json` and sit beside
it, in either of two folders. `data/extensions/` is the repository's own — the same
arrangement as `data/characters/`, and like it the published engine can ship the index
empty. This repository's five bundled packs are the campaign's shared tables (disciplines,
casting and manifesting tables, deck manipulations, cooking ingredients), which used to be
bare files under `data/`; the `tools/*_ref.py` scripts now write them as packs, keeping an
existing pack's header and bumping its revision. `private/extensions/` is the folder git
ignores — the same bargain as `private/` characters: yours to hold, not the repository's
to publish, so a deployment carries content the published engine will not.

A pack in either folder is **fetched into memory at load and never written to storage**,
and that is the reason to prefer one for anything large: a 4 MB catalogue that will not go
into localStorage in every browser costs nothing at all from here. `node
tools/pack-index.mjs` writes the index for you — it walks the folder, names anything that
is not a pack rather than dropping it quietly, and passes over any file or folder starting
with `_`, which is how a pack stays in the folder without being offered. An id in both
folders resolves to the private copy, which is how you correct a bundled pack you cannot
edit.

*Local* packs are the ones that cost storage: they live in the visitor's browser only,
under the same two keys they always had — a `character-sheet:extensions` index and a
`character-sheet:ext:<id>` document per pack — but in **IndexedDB** now rather than
localStorage, in a `character-sheet-extensions` database beside the one holding saved
characters. The move is what makes a large pack importable at all: localStorage's budget
is whatever a given browser feels like (49.8 MB in this app's Chromium, less than 4.2 MB
in one Brave profile), where IndexedDB's is a fraction of free disk — the same browser
that refused a pack in localStorage reports a quota in the gigabytes for the database.
Packs already in localStorage move across on the first load that finds a working
database, and the room they were holding comes back. A browser with no database — private
browsing, a blocked frame — carries on in localStorage exactly as before.

**The Extensions dialog** (the button in the host page's header) lists both: switch any
pack on or off (bundled ones too — the choice is remembered), **Export** one as a
`.json` to share, **Import** a file, paste JSON, or drop a pack anywhere on the page —
the page tells a pack from a character by its `format` line, and the sheet's own Import
button hands a pack up the same way. **+ New extension** opens the editor: the header
fields, then the discipline catalogue (below) and blocks as one small form each (features
and traits are typed one per line — `1: Fast movement, Rage`, `Darkvision: text`), or the
whole document as JSON. The other four tables are big, regular and usually built by a
tool, so they stay JSON-only. **Copy
to mine** clones a bundled pack into an editable local one, and says what that will cost
when the pack is a big one — editing the copy is free, saving it is what spends the
storage the original was not using; **From this character…**
lifts the open sheet's classes, race, feature groups and trackers into a new pack, which
is how something built by hand gets shared. A pack imported with the same id as one
already here replaces it (that is how a friend's rev 2 lands); a local pack cannot take
a bundled pack's id.

### Disciplines

The one shared table with a form of its own, because it is the one a player writes by
hand rather than generating with a tool. Under **Disciplines** in the editor: name the
discipline, add maneuvers and stances under it, and for each of them fill in as much of
its card as you want to — type, action, range, target, duration, saving throw, DC and a
description, the same eight cells the sheet's Maneuvers tab shows. A saved pack puts the
discipline in the sheet's *Train a discipline…* dropdown beside the bundled thirty, and
everything under it can be readied.

Every cell reads `{…}` formulas when the sheet draws it, so a pack can write
`Close ({= 25 + 5 * floor(level / 2)} ft.)` once and have it come out right on every
character who trains the discipline. What the pack cannot do is *define* a name or
forward a bonus: only the character's own prose is collected for that, so a `{…}` in a
pack cell shows a value and nothing more. It also never reaches the Formula Audit, which
lists what this character wrote — a pack's formula is fixed in the pack.

**What a player writes on their sheet sits over the pack, cell by cell.** A ruling made
at the table goes in the cell and wins; the cells beside it still come from the pack;
emptying it hands that cell straight back. Only the cells actually written are saved
with the character, which is what lets a corrected pack correct a sheet already in play.
In the editor's cells the greyed text tells you which is which: a plain ghost value
(*Melee attack*) is what the cell will say if left alone, and one marked *e.g.* is only
a suggestion.

The bundled Path of War catalogue fills in nothing but the type. That is not a
limitation of the format — it is that its 1,033 maneuver names are a publisher's, and
their rules text is not ours to ship. A pack of your own homebrew has nothing to hold
back.

### Spheres

A whole sphere — its description, its base abilities and every talent in it — is a shared
table too, under `provides.spheres.spheres`. There is no form for one: a sphere is forty
talents deep and arrives whole off a wiki page, so **Paste text…** is how one gets in, and
the editor's **Spheres** list is for seeing what a pack holds and taking a sphere back out.
Unlike a discipline, a later pack naming the same sphere **replaces** it: one page is the
whole sphere, so a corrected copy is a copy of all of it.

```json
{ "name": "Boxing", "kind": "combat",
  "description": "Boxers specialize in fighting with their fists…",
  "abilities": [{ "name": "Counter Punch", "text": "…" }],
  "talents": [
    { "name": "Clinch", "group": "Counter Talents",
      "tags": ["counter"], "sources": [], "prerequisites": "", "text": "…" },
    { "name": "Elongated Step", "group": "Boxing Talents",
      "tags": ["stance"], "sources": ["3PP"], "prerequisites": "", "text": "…" }
  ] }
```

**Base abilities are lifted out of the description.** A scraper writes them into the
sphere's blockquote as an emphasised label — `*Destructive Blast:* As a standard action…` —
and everything under one belongs to it until the next. They land in `abilities`, and the
description keeps only what the sphere itself is. That split matters because the sheet asks
two different questions: what the sphere *is*, and what taking it *grants*.

Taking the sphere is a **base pick**, not a talent in it, so a row that records one reads as
the sphere and what it opened — **Destruction Sphere (Destructive Blast)**, *Fencing Sphere
(Fatal Thrust)* — with the abilities' full text in the note beside it, where the rest of the
rules live. `isBasePick` already reads that shape as a base pick (it strips parentheses
before looking for the word), so it counts for the sphere tallies the moment it is written.
A pick that already carries a parenthesis of its own is left exactly as typed.

**The two kinds of tag are kept apart, because they answer different questions.** A `(…)`
tag is a **rule** the talent carries — `(counter)` is a talent a counter punch can apply,
`(stance)` one you take a stance in — and lands in `tags`. A `[…]` tag is nearly always
**provenance** — `[3PP]`, `[Apoc]`, `[Youxia HB]`, `[EO3]` — and lands in `sources`, which
is what a table filters on when it rules content in or out. Nearly always: a few rules tags
are written in brackets too (`[utility]`), so those are named in the reader rather than
guessed at. A talent's own `Source:` line joins `sources` as well, since it says which book
where the tag only says which shelf.

`sphereEntry(name)`, `sphereTalents(name)`, `talentsTagged(tag)` and `talentTagCounts()`
read the registered catalogue; `talentsTagged` searches both lists, since which of the two
a wiki wrote a label in is its business rather than a caller's.

**What the sheet does with it.** Two things, both light. Every sphere picker on the
Spheres &amp; Magic tab offers what the packs carry as well as the names `rules.js` knows —
appended after the built-in ones, on the matching side, and never doubling a name the
engine already has. And a talent cell whose text matches the catalogue grows a small **✦**
carrying the whole entry on hover: its sphere and group, its tags, its prerequisites and
its rules text, muted rather than gold when it came from a named third-party source.
`sphereTalent(sphere, talent)` is the match — case, spacing and any tag the player typed
are ignored, and with **no** sphere on the row the whole catalogue is searched so the sheet
can tell you which sphere a talent came from instead of being told.

**Typing a recognised talent fills in what the catalogue can answer for free** — the sphere
it belongs to, and its rules text as the row's note. Only ever into cells that are *empty*:
a note is where the table's own ruling goes, and having that overwritten by a book would be
worse than never filling anything. Clearing a filled cell and leaving the talent alone
leaves it cleared; retyping the talent is how you ask for it back. Tables without a notes
column (a customized weapon, a martial tradition) fill only the sphere, and never grow one.

The cell stays a prose field: a talent is still whatever you write, `{…}` formulas and all,
and the catalogue is a second opinion rather than a gate. A talent no pack covers is simply
unmarked and fills nothing, which is what every talent on every sheet did before this.

> `rules.js` still hard-codes the sphere **names** — skill-rank and unarmed logic key off
> them, so the catalogue widens the pickers without yet replacing that list. Lifting it out
> is the remaining step.

A class's own feature text lands **under the class**, on the Progression tab beneath its
ladder — *What they do*, one entry per distinct feature however many levels grant it, an
archetype's among them, each editable like anything typed in. The Template tab is for
templates. A sheet written by an earlier version, which put a class's text there, moves it
across on its next load: a group named for a class, carrying no template link, every one of
its features named on that class's ladder, and the class holding no text of its own yet.
Anything less exact is a template and stays one.

**A class whose talents arrive on several tracks at once** — an armiger's customized
weapons — says so under `tracks`, as two counting rules: how many tracks there are, and how
many talents each of them holds. Each is a `start` plus a `gainsAt` level rule naming where
the count goes up, which is how a class table words it in prose. The example above is the
whole armiger: three weapons and a fourth at 11th and a fifth at 19th, one talent each and
another at 3rd and every four levels after. A bare number is a count that never moves
(`"sets": 2`), a bare string is where it goes up from one (`"talents": "4, +4"`). `spheres`
is `combat` (the default), `magic` or `both`. Attaching
copies the rules onto the character like everything else a pack lands, and the weapons
themselves live on Martial Spheres (see
[Customized weapons](sub-systems.md#martial-and-magic-spheres-training)).

**An archetype may change a track**, and carries only the parts it changes: the one that
lets an armiger's customized weapons teach magic is `"tracks": {"spheres": "both"}` and
nothing else, merged over what the class states when the archetype is added and put back
when it comes off. An archetype whose class has no track on the sheet says so rather than
inventing the counting rules it has none of.

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
sets the race, size and racial ability modifiers, and fills the race-trait rows. A veil block — one written by hand, rather than the catalogue a pack's veils table
carries — is shaped in its chakra slot on the Akashic board (essence 0), the first listed
slot with room.

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

### Veils

A veil is a shared table too, under `provides.veils.veils`: one entry per veil, carrying
its `name`, the chakra `slot`s it shapes in ("Hands, Wrists"), its `descriptor`s, the
`classes` whose veil lists it is on, its rules `text`, and its `source`. The Akashic tab
reads it where it stands — the character keeps the name and the essence and nothing else,
so a corrected pack reaches every sheet already playing that veil and an exported
character carries names rather than a publisher's prose. See
[Sub-systems](sub-systems.md) for the card.

**A veil is the one table assembled from two kinds of page**, and merges field by field
because of it. The veil's own page has the rules text, the chakras and the descriptors
and says nothing about who may shape it; a *class's* veil list says exactly that and
carries a one-line summary at most. So a field a later pack leaves empty leaves the
earlier answer standing, a field it fills wins, and `classes` is the **union** — five
classes listing the same veil is five packs each adding one name to it. The name itself
is never rewritten by a merge: it is the key the halves meet on, and it is what a sheet
that shaped the veil has written down.

That merge is also what dissolves the duplicate problem the per-chakra packs had. A veil
shapeable in five chakras is on five of the wiki's slot pages with the same text each
time; as blocks that was five entries in the picker, and as a table it is one. Sixteen
per-chakra packs switched on together come to the 1,496 veils that exist rather than the
2,149 rows they are written as.

Packs scraped before veils were a table carry them as blocks instead.
`node tools/veils-to-table.mjs <pack.json|dir>` converts one in place — collapsing the
duplicates, and lifting the `Class access:` line the old reader had appended to the foot
of each veil's text into the `classes` field where it belongs.

## Paste text — a scraper's document

**Paste text…** takes two quite different things, and tells them apart before it reads
either. One is a page somebody copied out of a browser, below. The other is a document a
**tool** wrote — and a tool does not have the problem the page readers spend all their
care on. A page is built for human eyes, where a heading is a short line and a talent's
name is a short line and telling them apart is most of the job; a scraper already knows
what it found and can say so in the file.

So structured markdown is read on its own terms, and read **first** — `clean()` flattens
the markdown that the page readers cannot use and this one is made of.

```markdown
# Iron Tortoise                      what the document is about

> The discipline known as Iron Tortoise rose up from…       its description

---

## Maneuvers & Stances (34 Abilities)                       a section
### Level 1 Maneuvers                                       a group inside it

#### Angering Smash                                         one entry

* **Discipline:** Iron Tortoise
* **Level:** 1 (Maneuver [Strike])
* **Initiation Action:** 1 standard action
* **Range:** Melee attack
* **Target / Area:** One creature
* **Duration:** One round
* **Source:** Path of War p. 69

**Summary:** *Melee attack that causes -4 to hit any target but you.*

By making a quick shield bash, the disciple taunts and aggravates his foes…
```

**The rule that makes it extensible: what an entry *is* comes from the fields it carries**,
not from where it sits, what the document is called, or what the headings above it say. A
thing with a `Discipline` and an `Initiation Action` is a maneuver wherever it turns up. So
a scraper can learn to fetch classes, archetypes, veils or races and emit them in the same
frame, and teaching the reader a new kind is one row in `STRUCTURED_KINDS`:

```js
{ kind: 'maneuver',
  wants: ['discipline', 'initiation action'],   // all of these must be present
  drops: ['source', 'prerequisite'],            // no cell — reported, not lost
  read: structuredManeuver,                     // fields -> the thing
  into: 'maneuvers' }                           // which list it joins
```

Until that row exists the entry is **not dropped**: it comes back to the review stage as a
leftover, fields and all, to be tagged as a note or left out. The scraper is free to run
ahead of the reader.

What the frame guarantees, whatever the kind:

| | |
|---|---|
| `# Title` | what the document is about |
| `> quote` | its description — no cell of its own, so it is offered as a note |
| `##` / `###` | sections and groups; an entry knows the trail above it |
| `#### Name` | one entry — the heading level worked out below |
| `* **Key:** value` | its fields, matched case- and space-insensitively |
| `**Summary:** *…*` | an optional précis, kept apart from the prose |
| `##### Sub` | a heading *below* the entry level: part of that entry, not another one |
| `---` | ends an entry |

The kinds it knows so far:

| kind | identified by | becomes |
|---|---|---|
| maneuver | `Discipline` + `Initiation Action` | an entry in the pack's discipline catalogue |
| veil | `Shapeable Slot(s)` | an entry in the pack's veils table, with `Class Access` as its class list |
| sphere | the *document* — a `Sphere Talents` section | a whole sphere in the pack's `spheres` table |

**A heading deeper than the entry level belongs to the entry above it.** An akashic veil
writes each of its chakra binds as `##### Chakra Bind: [Belt]` under the `###` that names
the veil, and there may be five of them. Taken as entries of their own they turned 2,149
veils into 5,785 things — every veil stripped of its binds, beside a run of nameless
fragments carrying no fields at all. The sub-heading stays in the text, being what says
which bind the paragraph under it belongs to.

**The entry level is worked out per document, not fixed.** One source writes
`## section / ### group / #### entry`; another has no group level at all and puts every
entry directly under the page's one section. Both are right, and what tells them apart is
that an entry carries *fields* while a section carries only more headings — so the entry
level is the deepest one whose headings are followed by a field list. A document whose
entries have no group heading says which group a talent is in with a `Section:` field
instead, and that is used in its place.

**A field is only a field at the top of an entry.** Past the first line of prose, a
`* **Lesser Charm:** …` line is one of the effects the talent is made of rather than a
property of it — the Mind and Nature spheres are full of them, and eating those would take
the rule away with them.

Two more things a scraped page carries that a prose cell cannot use: a **MediaWiki table**
(`{| … |}`) becomes tab-separated rows, which is how the sheet shows a table everywhere
else, and a **MediaWiki external link** (`[https://… label]`) is unwrapped to its label.

The wiki's own markup goes the same way. Formatting tags (`<br />`, `<sup>`, `<nowiki>`,
`<poem>`…) are named one by one and stripped, keeping what they wrapped — named rather
than matched as `<…>` so a rule reading `AC <10` survives. A `==Heading==` is unwrapped to
its words, and dropped when it has nothing under it: `==Bind Level==` over a lone
`<references group="Bind Level"/>` is a footnote section whose footnotes the scrape did
not take, and there are 183 of those across the akashic veils.

### A directory of them at once

The panel reads one document, which is right when a player has copied a page. A scraper
that has just walked a wiki hands over a directory, and pasting sixteen files of up to a
megabyte each is not that. `tools/scrape-pack.mjs` runs **the same reader** over a
directory and writes the packs, so what happens in the browser is one **Import a pack…**
each:

```bash
node tools/scrape-pack.mjs <scrape-dir> --match '*_veils.md' --out private/extensions/veils
```

`--one "Name"` puts everything in a single pack instead, deduplicated by name — a veil
shapeable in five chakras is on five of the slot pages with the same text each time, and
every copy is identical, so dropping the others loses no slot. `--sort bind` orders a pack
by the chakra each veil binds to **first**, `--bind-order "Hands,Feet,…"` gives that its
sequence, and without one it is alphabetical: no chakra ladder is assumed, because the
veils' own slot lists contradict each other as an ordering (Shoulders precedes Body 34
times and follows it 13).

Write the packs into `private/extensions/`: packs are content, content is a publisher's,
and that folder is both git-ignored and loaded. Run `node tools/pack-index.mjs` afterwards
and the sheet offers them on the next load — fetched into memory, never stored, which is
what takes size off the table. *Importing* one is the different matter: 1,496 veils in a
4.2 MB pack goes in and opens for editing in 298 ms in this app's Chromium, which held
49.8 MB in the origin before localStorage threw, and Brave refused the same pack with a
discipline pack after it. There is no number to design against — there is a folder that
does not ask you for one. Per-page packs stay useful for a player who wants a single
chakra rather than all of them; keep them beside the combined catalogue under a name
starting with `_` and the indexer passes over them until they are wanted.

**What a cut page leaves behind.** A scrape that stops mid-construct leaves marks, and
`tidyScrapeResidue` takes out the three that turned up across the akashic veils:

- **a template close with nothing that opened it.** A `{{…}}` call written across two
  lines has its head on one and its tail on the next, and a scrape that took the second
  without the first leaves a line reading `(Akasha Retold)}}` standing over the article
  it was heading — 75 of the 1,496 veils began on one. That is the argument list of a
  call whose name is gone, so the line goes. **Only where the text holds no `{{` at
  all**: a template taken whole is content, and `{{Chakra Bind|Belt}}` is the call that
  says which chakra a paragraph belongs to.
- **a raw wiki link** — `[[Target|what it reads as]]` shows its second half, `[[Target]]`
  is its own text. The markdown spellings were already handled; this is the one that
  arrives unconverted.
- **non-breaking spaces**, which are spaces everywhere the sheet shows them and only make
  a word un-findable.

**Text with nothing wrong with it comes back byte-identical**, which is the property that
makes the pass safe to run over a pack full of somebody's paragraphs: it cannot quietly
reflow fifteen hundred of them on its way to fixing a hundred. It is idempotent, so a
second run is a no-op.

`node tools/tidy-pack-text.mjs <pack.json|dir>` runs it over a pack built before the
reader did — every text a pack holds, not only its veils — and reports what changed
before it changes anything under `--dry`. It calls the same function the reader calls, so
a re-scrape and a tidied-up pack come out agreeing rather than nearly agreeing.

**There is no bind level in a scrape.** On the wiki a bind is the template call
`{{Chakra Bind|Belt}}`, whose only argument is the slot — checked across all 2,149 — and
the level is what the template works out from the veil's class list and prints as a
footnote. A scrape captures the call, not its expansion, which is why `==Bind Level==`
arrives standing over an empty `<references group="Bind Level"/>`. A level has to come
from the (class, slot) table instead; it was never in the per-veil source to lose.
A title's own stamp is trimmed too — `# Open Hand Sphere (Wikidot)` names the sphere
**Open Hand**, which is what the pickers and the side lookup want.

For a maneuver: `Level: 1 (Maneuver [Strike])` gives the level, whether it is a maneuver or
a stance, and its type, all three the way a discipline's table prints them; `Initiation
Action` is normalised (*1 standard action* → **Standard**); `Target / Area`, `Target`,
`Targets`, `Area` and `Effect` all reach the target cell. The summary and the prose both
matter and there is one description cell, so the summary sits over the prose with a blank
line between. `Source` and `Prerequisite` have no cell on a maneuver's card, so they are
left out and the report names them.

Detection is deliberately narrow: a "copy as markdown" browser extension also produces
headings and bold, and those pages must keep going to the readers that know their shape.
What only a tool writes is the **field list** — three or more `* **Key:** value` lines. That
is the whole test.

## Paste text — reading a copied rules page

The other half of the same box. **Paste text…** also takes a class, a race, a veil, a sphere
or a maneuver copied straight off a rules page (Archives of Nethys, d20pfsrd, the Metzofitz wiki, the Spheres of Power wikidot
wiki — the whole page, several pages one after another) and reads it into blocks. It is a two-stage
affair, and the second stage is the point:

1. **Read it.** `app/js/paste-import.js` finds what the paste holds by a handful of anchor
   lines every page uses — *Hit Die* for a class, *Standard Racial Traits* / *Ability Score
   Modifiers* for a race, *Chakra Slots* for a veil, *Initiation Action* for a maneuver, the
   first *X Talents* heading on a page whose breadcrumb says Spheres of Power or Might for a
   sphere — reaches back for each thing's preamble
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
   A **martial ability page** is the one thing that does not become a block. Its box copies as
   a label on one line and its value on the next, bar *Range / Target / Duration*, which copy
   as a small tab-separated table; from that come the discipline it belongs under, its level,
   whether it is a maneuver or a stance and of what type (*Maneuver (Boost)*), the action it
   is initiated with (*1 swift action* → **Swift**), range, target, duration, saving throw
   (*Fort* → **Fortitude**, but *Will negates* kept whole — the qualifier is the useful half)
   and the rules text. Its *Descriptors*, *Prerequisites* and *Sources* lines have no cell on a
   maneuver's card, so they are left out and the report says so rather than wedging them into
   the description. What comes back is a **catalogue entry**, not a block, because a
   discipline is a [shared table](#disciplines): it is filed in the pack's discipline list,
   where every character who trains that discipline reads it.
   A **sphere page** is read from its **table of contents**, which is the whole trick: the
   contents name, in order and spelt exactly as they appear below, every heading the article
   has — the base abilities, the tables, each *X Talents* group and every talent under it —
   so the body needs no guessing at all about which short line is a talent's name and which is
   the first line of a paragraph, the question that makes every other reader here as careful
   as it is. Each talent keeps its group, its `(rules)` and `[source]` tags
   ([above](#spheres)), a leading *Prerequisites:* or *Source:* line lifted out of its text,
   and the rest as its text; what sits above the first group is the sphere's description and
   its base abilities. It is [a shared table](#spheres) too, so it is filed rather than
   blocked. (A class page has *X Talents* headings of its own — a table's *Combat Talents*
   column — which is why the breadcrumb has to vouch for a sphere page first.)
2. **Review.** The panel shows what was read — one line per block, each with a tick to
   drop it — and then **everything the reader did not use**, as stretches of the original
   text with a tag menu on each: *feature of* the class it sat under, *race trait of* the
   race, a trait block, a feature block (in a named group), a note, or leave it out. The
   reader suggests a tag (a `Label: text` line near a class is offered as its feature; page
   chrome as skippable) and the player decides. Maneuvers get a section of their own, each
   with the discipline it will be filed under as an editable field — a page that never named
   one is marked, and a maneuver with no discipline is left out and said to be. Spheres get a
   section of their own too, each showing its groups and the tags its talents carry. **Add …
   to the pack** folds the decisions in: tagged text joins the class or race it was tagged
   onto, the rest become blocks, maneuvers join their discipline (making it if the pack has
   none, replacing an entry of the same name so a re-read lands rather than doubling),
   spheres replace any of the same name, and the editor's forms are where anything gets
   corrected before Save.

Nothing is guessed at silently: every line either lands somewhere the report names or comes
back in the review as text to tag — bar the page tail above, which the report accounts for.
`tests/paste-import.test.mjs` runs the reader over the three table shapes, both
feature-prose shapes, the segmentation, the whole Barbarian / Dwarf / Warlord / veil paste,
a two-page wikidot copy, an option page, a martial ability page, a sphere page, and a
scraper document (its frame, its maneuvers, and an entry of a kind the reader does not
know yet).

> The engine still carries some publisher names of its own — the Spheres of Power sphere
> lists in `rules.js` (which drive skill-rank and unarmed logic), the Primordia techniques,
> the mythic path names — and those are the next thing to lift into packs. The `spheres`
> table above is the first half of that: what a sphere *contains* now travels in a pack,
> even though what the spheres are *called* does not yet.

