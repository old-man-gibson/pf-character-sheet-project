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
[Save & AC bonuses](#save--ac-bonuses) — and what remains is whatever the export could
not account for at all.

This is verified by `tests/model.test.mjs`, which asserts that AC, touch, flat-footed,
CMD, all three saves, all three attack totals, initiative, and **every skill** reproduce
their source values. It reads the roster from `data/characters/index.json` rather than a
list of its own, so a character added to the index is checked without anyone having to
remember to add it to the tests as well.

---

## Using it as a sheet

Everything is editable. There is no separate "edit mode" — click a field and change it,
and anything downstream recalculates immediately.

**Play tracking**
- Hit points as a meter that carries everything at once — what is left, the temporary
  points stacked past the maximum, and how much of what is left is nonlethal — with
  Damage, Nonlethal, Heal and Rest buttons. Damage spends temporary hit points first;
  Rest restores everything and zeroes every tracker. Unconscious, dying and dead are
  flagged automatically, and below zero the bar itself goes red and glows, harder the
  closer the character gets to dying. See *Hit points* below.
- Conditions are switches (negative levels a count) that show what they cost — tick
  one and every number it moves reads out its conditioned value beside the base.
  See *The Overview* below.
- Hero points, and resource trackers with click-to-spend pips — add, edit, restyle
  and delete any of them (Mythic Power excepted; every character keeps that one).
- The built-in meters — hit points, essence, power points — take that same styling:
  pips, bar or squares, colours, gradients and zones. See *The built-in meters take
  the same style*.

**Editable everywhere**
- *Overview* — name, race, level, size, alignment, deity, portrait, **character
  colour**, speeds (add/remove, bonus as a formula), hit points, hero points, defenses
  and save bonuses, DR/SR/immunities/resistances, carrying capacity, conditions,
  character traits and race traits.
- *Stats* — the full ability build (see below).
- *Skills* — ranks, class-skill flag, key ability, misc bonus, notes, and the variant
  of an Artistry/Craft/Lore/Profession/Perform; add and remove skills. Unused skills are
  hidden behind a **Show all** toggle.
- *Combat & Magic* — the sphere, talent, veil and maneuver grids, cell by cell, with
  rows addable and removable.
- *Feats & Mythic* — granted feats (drawback, specialty, oaths, attunement) and the
  feats you chose, by group, plus add, rename, reorder and delete groups;
  classes with hit die, saves and skill ranks; mythic path, tier and abilities.
- *Equipment* — every slot with bonuses, weight and cost, plus a running carried-weight
  total against your light load.
- *Crafting* — speed increases, base costs, cost reductions, projects and their DCs,
  with the Discord posts generated from them.
- *Progression* — the level-by-level planner.
- *Extras & Notes* — free-form notes to jot on (add, retitle, delete), the workbook's
  **Approvals** table (what was applied for, who approved it, the link), and whatever
  else the ExtrasNotes worksheet held, as an editable grid. On import each of the
  sheet's *Range* columns becomes one note and its Approvals rows become rows; the
  template's own hint lines ("This sheet is not referenced anywhere.", "Go ham.") are
  dropped, and the raw grid is retired.
- *Lore* — every background section.

**Ability-stat selectors.** AC, each save, and each attack mode let you pick which
ability drives them, because these characters do not use the defaults — Angou's AC keys
off Strength and his alt CMB off Wisdom. Change the selector and the total moves.

**Weapons and attacks** is a new section rather than an import: the source sheets keep
this as prose. Add a weapon and its attack bonus and iteratives follow your BAB, ability
scores and size automatically.

Rows can be reordered with ↑ / ↓ and removed with ×. Every change is saved as you make
it, and **Save** marks the version the sheet opens on — see
[Saving, and going back](#saving-and-going-back). **Reset** returns the character to the
converted sheet, **Export JSON** downloads the current state and **Import JSON** brings
one back (see [Getting characters in](#getting-characters-in)).

> Editing a value that nothing else depends on — a note, a planner cell, a sphere talent
> — updates the model without re-rendering the panel. The largest grids run to several
> thousand inputs, and rebuilding those on every keystroke was plainly laggy (143 ms per
> edit, now 4 ms).

---

## The Overview

Top to bottom, the Overview reads: **At a glance** (the eight numbers a table asks
for), **Details** (what the player writes about the character) beside the ability
scores, **Specialty** beside **Languages**, then two supergroups — **Defenses** (hit points, armor class, saving throws)
and **Offenses** (attack, speed) — then conditions beside carrying capacity, the
Classes table, and traits.

**Conditions** are switches, not number boxes: all of them are on or off except
negative levels, which count. Each chip says what the condition costs
(*−2 atk, −2 saves…*), and ticking one changes nothing in the sheet's own totals —
those stay reconciled to the workbook — but every stat it moves grows a second
reading, **now +N**, under the base: attacks, AC, touch, flat-footed, CMD, the three
saves, initiative, hit points, speed, and the temporary ability scores and modifiers. Ability penalties are
applied to the score and the modifier taken again (entangled's −4 Dex is −2 to the
modifier; paralysis sets Dex to 0, which is −5 whatever it was), and *loses Dex to AC*
drops the ability bonus from AC and CMD, though a negative modifier stays. The two
ladders do not stack — shaken → frightened → panicked and fatigued → exhausted — the
worse one counts and the lesser is struck through. Anything a number cannot say
(*must flee*, *no attacks of opportunity*) is listed under **In effect**. Conditions
the sheet did not carry (flat-footed, staggered, nauseated, dazed, confused,
unconscious) can be added from a picker and removed again with **×**.

> The shared template ships with Helpless and Paralyzed set to 1 in every workbook,
> with nothing else on. That exact fingerprint is a leftover rather than a state, so
> the converter and the model both clear it; anything else ticked is the player's.

**Specialty** — the background, its feat (the same field as the Specialty row under
Granted feats) and its perks, as a list you can add to. **Languages** — native
languages are free; slots are one per point of Int bonus plus one per Linguistics
rank, plus **Extra** for whatever a race or trait adds, as a number or a formula
(`floor(level / 2)`). The known list is chips you add and remove, counted against
the slots; the workbook's comma- and pipe-separated cells are split into it on import.

**Speed** takes its bonus as a formula, because that is where class features land:
a monk's fast movement is `floor(level / 3) * 10`, and written that way it keeps up
with the level. The Final column is the model's and moves the moment either field
does; formula bonuses appear in the Formula audit like every other player formula.

**Race traits** have a table of their own under *Traits & drawbacks*, next to the
character traits — a race hands out anywhere from three to ten, so rows are added and
removed freely. The workbook's *"Darkvision: sees in the dark for 60 feet"* sentences
are split into name and effect on import.

## Hit points

The hit point meter carries three things on one track, because at the table they are
one question — *how much is left?*

**Temporary hit points are extra track**, not a fuller bar: they sit past the maximum,
hatched, so the bar can read over full without lying about what the maximum is. Damage
still spends them first, and they show as `+N` beside the current / max reading.

**Nonlethal is a marker**, not a subtraction. It is struck across the top of the fill
and eats downwards: when the marked stretch reaches the bottom, nonlethal has caught up
with what is left and the character is unconscious — which is exactly the rule, drawn.

**Below zero the bar has nothing to fill**, so the track itself carries the warning: it
goes red and glows, scaled by how far past zero the character is, reaching full at the
threshold where they die. One point under zero looks nothing like one point from death.

```
death threshold = −(Con + death threshold bonus)
```

Death at negative Constitution is the rule; the **death threshold +** field is the room
some characters buy past it — Death's Door, a mythic tier, a GM's ruling. It is a bonus
rather than an absolute, so the threshold still moves when Con does, including a
temporary Con from a rage or a potion. The panel states where death is, and how many
points away it is while dying.

---

## The Stats tab

Ability scores are not typed in — they are **built**, the same way the Google Sheet
builds them. The Overview shows the resulting scores read-only; the Stats tab is where
they are constructed.

```
enhancement = min(6, abp + gear)          <- ABP and gear stack, capped at +6
total       = pointBuy + race + enhancement + attunement + inherent
            + array + level4 + mythic + size + untyped
tempTotal   = total + alchemical + circumstance + morale
            + tempEnhancement + tempSize
```

**Permanent bonuses** — point buy, race, enhancement (ABP + gear), attunement,
inherent, array, Level/4, mythic, size, untyped.

**Temporary bonuses** — alchemical, circumstance, morale, enhancement, size. These
feed the Temp Score that every derived stat reads; the permanent Total is untouched.

The two tables sit side by side wherever the sheet is at least ~1385 px wide — a 1080p
screen — and stack below that. **Inherent** is no longer handed out by the server, so
the column is hidden unless the character actually has one; the button in the panel
header shows or hides it either way, remembered per character.

### Point buy

Costs come from the sheet's own table (`dataSheet!K21:L33`):

| Score | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Cost | −4 | −2 | −1 | 0 | 1 | 2 | 3 | 5 | 7 | 10 | 13 | 17 |

The total spend is calculated live and shown against the budget (30), turning red if
you go over. All five characters import at exactly 30/30.

### The +6 enhancement cap

ABP and gear are not two bonuses — they are both *enhancement*, which is why they stack
with each other and then stop at a combined **+6**. The table says so: they share one
banded **Enhancement (max +6)** group, closed by a **Used** column holding what the pair
actually contributes. Anything past the cap is wasted — Narockro's Charisma has ABP 4
plus gear 4, of which only 6 counts, which is exactly why her Charisma totals 30 rather
than 32. Over-cap abilities are called out in red, in the Used column and underneath.

### Save & AC bonuses

The sheet's Stats tab breaks both down by bonus type — one column per type with a Total
beside them — and that breakdown is the only place a flat save or AC bonus is written.
It is here too, as two tables under the ability build:

```
Saves   Total  ABP (Resist)  Resist.  Template  Alch.  Circum.  Compet.  Enhan.
        Insight  Luck  Trait  Morale  Profane  Racial  Sacred  Untyped  Sheet
AC      Total  ABP Deflect  Deflect.  ABP Nat  E. Nat  Natural  Enhan.  Dodge
        Circ.  Insight  Luck  Morale  Sacred  Profane  Untyped  Size  Template  Sheet
```

**Every cell takes a number or a formula**, in the same sandbox as the trackers, so a
conditional bonus can be written as the rule it actually is. Force Redirection Technique
— Strength in place of Dexterity, up to 3 + half BAB — is
`min(str.mod - dex.mod, 3 + floor(bab / 2))`, and it keeps up when BAB moves where a
typed-in number would quietly go stale. Formulas read abilities, level, BAB and any name
defined in prose, resolve in place (click to see the source), flag unknown names in red,
contribute 0 rather than breaking the sheet when broken, and appear in the Formula Audit.

**The type decides which defence it reaches.** Natural-armour and enhancement bonuses do
not count against touch attacks — the sheet's own "AC No Nat" row — and dodge is lost
while flat-footed. So one set of AC bonuses drives AC, touch and flat-footed together
instead of three numbers being nudged separately.

**ABP is read, not typed.** The three Automatic Bonus Progression columns — resistance
on the saves, deflection and toughening (natural armour) on AC — follow the character's
level along the progression's own ladder from the workbook's `dataSheet` (resistance +1
at 3rd, +2 at 8th, +3 at 10th, +4 at 13th, +5 at 14th; deflection +1 at 5th, +2 at 10th,
+3 at 16th, +4 at 17th, +5 at 18th; toughening +1 at 8th, +2 at 13th, +3 at 16th, +4 at
17th, +5 at 18th). They show as yellow read-only cells, each grouped with the typed
bonus of the same kind beside it (*Resist.*, *Deflect.*, *E. Nat*), and the pair adds up
to at most +5 — unless the typed side is past +5 on its own, in which case it stands
alone, the way a +6 item would. All five characters' imported ABP values sit exactly on
the ladder, so nothing moved. On the Overview, the flat-footed row's *Misc* is a
read-only mirror of the AC row's, since misc AC is armour-side and flat-footed keeps it.

The columns come in from the workbook's own defined names: `ABPFort`/`ABPRef`/`ABPWill`
and `ABPDef`/`ABPNat` seed the ABP columns (which the ladder then owns), and `FortBonuses`/`RefBonuses`/`WillBonuses`
and `ACStatsTotal` say what each row came to. Whatever the difference is lands in
**Sheet**, so the row still adds up to what the character sheet says while every part
stays visible and editable — and on a character built here it stays 0. Reconciliation
covers the remainder exactly as before, which is why every save and AC still imports to
the number the source sheet had.

> The full per-type split is in the workbook but not yet in the converter, so the columns
> between ABP and Sheet import as 0 and Sheet carries their sum. Narockro's Fortitude, for
> instance, is really ABP 3 + Resist 3 in the sheet and arrives here as ABP 3 + Sheet 2 —
> the same total, split coarsely. Teaching `convert.js`/`convert.py` to read
> `Stats!C11:Q14` and `Stats!C16:R17` would fill the rest in.

### Selectable progression picks

Four of the columns are **not typed in** — they are filled from pick selectors and
shown highlighted and read-only:

| Column | Picked at | Worth | Source |
|---|---|---|---|
| ABP | Mental Prowess 6/11/13/15/17/18/19/20, Physical 7/12/13/16/17/18/19/20 | +2 each | `Planner!AN7:AO21` |
| Array | four picks at 8, three at 12 and 16 | +2 each | `Planner!AP9:AS17` |
| Level/4 | levels 4 / 8 / 12 / 16 / 20 | +1 each | Planner `Level/4` |
| Mythic | even tiers 2 / 4 / 6 / 8 / 10 | +2 each | the mythic ladder |

Mental Prowess only offers Int/Wis/Cha and Physical Prowess only Str/Dex/Con, matching
the ABP rules.

The two prowess tracks advance on **different levels**, and the array grants four picks
at level 8 but only three at 12 and 16. Where a track or slot does not exist, the table
leaves the cell blank rather than showing a control that cannot be used — so every
dropdown on the Stats tab is a real, usable choice. Both shapes are identical across the
source sheets, and `tests/model.test.mjs` asserts the imported data never falls outside
them.

Level/4 and mythic are the same shape — one ability at each of five milestones — so they
share one panel, greyed independently: a level you have not reached and a tier you have
not reached are different things.

The **optional array** is not part of levelling. It is bought separately with Primordia
shards, and the panel says so above the picks.

**Levels 11 and 12 are not fresh choices.** The level 11 mental increase raises whatever
was picked at 6, and the level 12 physical increase raises the level 7 pick. They still
grant their own +2 — they just cannot point at a different ability. Those rows show the
inherited choice locked, labelled with where it came from, and changing the level 6 or 7
selector moves both increments at once.

Because the Planner holds a **full 20-level plan**, picks above the character's current
level are shown greyed and do not count yet. Level a character up and the banked
increases apply automatically. (This is why Nico, at 15, counts 3 of his 5 planned
Level/4 increases.)

> The Prowess and Array columns sit at different spreadsheet positions in different
> characters' Planners (AN/AO/AP for Angou and Nico, AL/AM/AN for the others), so the
> converter locates them by header text rather than column index.

### Attunement

A **single checkbox worth +2**, and **locked below level 20** — the boxes are disabled
and the model refuses the write, so it cannot be set indirectly either. Only Angou is
currently eligible.

### Verification

`tests/model.test.mjs` asserts that for all five characters, every one of the six
abilities rebuilds to the exact score in the source sheet, that point buy totals 30,
that the +6 cap engages where the sheet says it does, and that picks fold correctly
with the level filter applied.

---

## Spheres & Magic (training)

The Combat/Magic Training tabs are structured panels reproducing the workbook's own
formulas (extracted from the `DUMMYFUNCTION` strings in the export and verified
against every cached value):

**Per class** (up to three per side, plus extended-page classes): pick the class
(from the Planner), its **type** (Low/Mid/High casting, Proficient/Adept/Expert
practitioner), its **Talents/level** rate — separately, for classes where the two
don't match (Bryva's Blacksmith casts as Mid but learns talents as a High Caster) —
and its ability scores. Rates: High Caster/Expert 1, Mid 3/4, Low/Journeyman 1/2,
Virtuoso 3/4, Trained 1/4.

**Talent slots per level** unlock exactly like the sheet's conditional formatting:
a level that grants a talent gets a green, writable name field and a sphere dropdown
(sphere lists from `dataSheet!G6:H31`); other levels are disabled. A Proficient class
unlocks even levels only. **Class levels (override)** covers sparse Planners that
list a class once instead of per-level. Each row also takes a **note** beside the
talent — both it and the talent read `{…}` formulas and grow to fit what is written,
so a talent whose effect scales can carry the number with it. The running talent
count is the level cell's tooltip rather than a column of its own.

**Bonus talents** — the ones a feat, an item or a template handed over rather than a
class ladder — are their own full-width group under each side's class blocks, with a
source and a note per row.

**Blended classes** (Angou's Legendary Monk, Bryva's Blacksmith) train both ways off
one pool of talents. The workbook writes them as a block on each tab holding the same
talents twice, which read as two classes that had each learned everything; they are
paired on import and shown once, in a **Blended training** group whose sphere dropdown
offers both lists. Each half keeps its own type and ability score — Legendary Monk
advances as an Expert practitioner and a High caster — so caster level, practitioner
DC and the spell-point pool are unchanged; what changes is that each talent is now
counted once, on the side its **sphere** belongs to, instead of all twenty landing in
both sphere tables. Any class can be blended (or split again) from the Blended
checkbox on its class head.

**Traditions.** Martial: name + granted talents with spheres. Casting: drawbacks and
bought-off lists ("… x2" counts double; each drawback feat buys off two), with the
boon math computed live: `effective = drawbacks − 2×feats`, SP tier = min(effective, 5),
boons = the excess, and the boon ladder by the sheet's progression (1 boon → 1+level/6
… 5 → level). Verified: Angou 8 drawbacks − 2 = 6 → tier 5, 1 boon, 12 SP, total 83 SP
— matching his sheet exactly.

**Every effective drawback is a boon, and boons are spent** rather than merely counted.
The sheet separated the first five as a "spell-point tier" and the rest as "boons", and
granted nothing at all for the tier — so a character below six effective drawbacks got
nothing. They are one count on one ladder here: step *n* is worth what it adds to the
step below it, the ladder tops out at five, and the steps sum back to it exactly.

Each pool is split with **two number fields**: how many steps become spell points, how
many become essence. Spell points are multiplied by the number of casting classes, the
way the sheet totals them; essence is one pool, and replaces the Akashic tab's typed
*Essence Boon* — which is where every one of these sheets recorded exactly this number
(Angou 20 at 20th, Narockro 11 at 11th, Saburō 9 at 9th, each the ladder at five steps;
Bryva, at zero, has none). The default split is the one the sheets were written with:
the boons past the fifth as points, the rest as essence, which reproduces Angou's cached
12 tradition SP and 83 total.

> The three sheets that have an Essence Boon all read the ladder **twice** — Angou takes
> 20 as essence *and* 4 × 3 casting classes as spell points, 32 points' worth out of a
> 20-point ladder, and Narockro and Saburō do the same. Granting the tier and the boons
> both looks like a slip in a workbook assembled by hand over many weekends, so the app
> reads the ladder once and Angou's essence comes to 16 where he wrote 20. His spell
> points are untouched. The Akashic panel flags the gap against his typed pool with a
> "≠ pool" badge rather than hiding it, which is what that badge is for.

Every tradition cell reads
`{…}` too: *Expensive Locus ({locus = 22500} mana)* is a drawback and a number the
rest of the character can spend.

**Casting numbers**: global CL, DC (10 + CL/2 + best casting mod), MSB, MSD (MSB+11),
concentration, per-class SP (class levels + casting mod), each with its bonus field.
Where a character's own workbook cached a different number (Nico/Narockro/Saburo's
sheets contain `#ERROR!`s and internally inconsistent caches), the app shows a red
"sheet: N" hint beside the computed value.

**Sphere BAB/CL/DC tables** per sphere with rank/DC bonus fields — Alchemy keys off
Craft (alchemy) ranks and Beastmastery off Handle Animal/Ride, like the sheet.

**Bonus skill ranks**: 5 ranks per talent in an associated sphere (Athletics →
Acrobatics/Climb/Fly/Swim, Tech → Craft (mechanical), Fencing → Bluff/Sense Motive,
Gladiator → Intimidate, Scout → Perception/Stealth, Scoundrel → Sleight of Hand,
Beastmastery → Handle Animal/Ride, Leadership/Warleader → Diplomacy, …), capped at
level, toggleable per row, flowing straight into the Skills tab's Spheres column.
Light Body sets the Athletics-linked skills to full level, as the sheet does.

**Unarmed damage** implements the practitioner table (dataSheet F80:L101) with the
sheet's exact die-step chain: talents in Boxing/Brute/Open Hand/Wrestling (each
toggleable, laid out two abreast) + Unorthodox Unarmed Training spheres + Talented
Knuckle (a toggle, +2) + Brawler's Vest (a toggle, +4 — hover either for what it grants)
+ the Bands of the Asura veil (+4 Open Hand talents per essence invested in it, read
off the Akashic tab and shown only while that veil is shaped) + extra talents; then
step increases (+1 die step each) and size increases (+2 each). The Unorthodox spheres
are dropdown picks, two per *Unorthodox Unarmed Training* feat found on the character
(it can be taken more than once); without the feat the field says so instead of
offering picks. Angou: 19 effective talents → 2d8
base → 5 size increases → **12d8**, byte-identical to his sheet. Improved Unarmed
Strike is flagged at 1+ talents, and a "native progression" toggle surfaces the
one-size-larger rule instead.

## Classes (gestalt) & traits

The Classes table lives on the Overview. Levels per class are counted from the
Planner up to the current level (with a manual override for sparse Planners; a class
the Planner never names is assumed to run all levels). From it the app derives,
following gestalt rules (best progression among the classes present each level):

- **Save bases** — good saves +2 once and +½/level, poor +⅓/level — written straight
  into the Saves panel.
- **HP/level** (best HD) and **skill ranks/level** (best class).

Traits & drawbacks are structured slots: Traits 1–3 always; Drawback 1 unlocks
Trait 4, Drawback 2 unlocks Trait 5, and a Major Drawback buys a Drawback Feat —
locked slots grey out until their drawback is filled. Categories cover the standard
list (Campaign, Combat, Cosmic, Equipment, Faith, Family, Magic, Mount, Race,
Regional, Religion, Social) plus any the player adds (Akashic, Mythic, Psionic…).
Race traits sit beside them in their own list — see [The Overview](#the-overview).

## Granted feats

Some feats are not picked at a level — something hands them over — and those live in
one panel on Feats & Mythic, **source first and the feat second**, because that is the
order they are read in: you know what granted it and are answering with which feat you
took.

| Source | Feat |
|---|---|
| Drawback | the feat a Major Drawback buys — the row appears only once one is taken |
| Specialty | mandatory, so always there |
| Oath 2, Attunement, … | source named per row |

The workbooks scattered these. The Drawback column ran `[feat, "Specialty", feat]` —
a header row masquerading as a feat, with each entry's source only implied by its
position — while Oaths and Attunement were columns of their own. The import folds all
of them into this one list and drops the header row, so Nico's reads *Drawback:
Harrowed Capability* and *Specialty: Genius Vigilante* rather than three feats, one of
which is the word "Specialty". Level Up, Class and Other/Flex stay as they were: those
are feats you chose.

## Primordia Techniques

One choice, made at 1st level — or the moment its prerequisite is finally met, if none
was taken before — that then advances on its own ladder for the rest of the character's
career. Every technique grants at **1st, 3rd, 5th, then 7th and every two levels after**;
only what lands there differs.

| Technique | Prerequisite | 1st / 3rd / 5th | 7th, 9th, 11th … |
|---|---|---|---|
| **Light Body** | 3/4 BAB or better | Athletics sphere *(leap)* or *(run)* + Unarmed Combatant; Wall Stunt; Air Stunt | an Athletics talent |
| **Piercing Eye** | Psionic manifesting | Psionic Talent + a Clairsentience power (twice); a third power | a Clairsentience power |
| **Keen Mind (Spheres)** | Mid or high spherecasting | Divination sphere + Practiced Seer; Detect Spellcaster; Fast Divinations | a Divination talent |
| **Keen Mind (Vancian)** | Vancian casting | Spell Focus (Divination); Diviner's Delving; a Divination spell | a Divination spell |
| **Armored Discipline** | Medium or Heavy Armor Proficiency | Endurance + Armor Adept; Armor Trick; Armor Focus (Medium/Heavy) | an armor-track feat |

The ladder reads like the mythic one: **Grants** is what the rules hand over — a label,
because it is not your choice — and the column beside it is what you took for it. A level
you have reached with a choice still to make is outlined and counted as *"N to pick"*; one
you have not reached yet is dotted, the plan rather than a chore. Levels whose grant is
fixed still take a note, which is where the sheet's own ladder was written.

**The two Vancian levels are a branch, not a footnote.** *"Spell Focus (Divination) as a
bonus feat. If they already possess it, they instead gain 1 spell"* is one grant with two
faces, so the row carries a tick box saying which one is live — and the totals follow it:
ticking it moves one off the feat count and onto the spells.

**Talents count.** Light Body's Athletics talents and Keen Mind (Spheres)' Divination ones
flow into the training tally like any other bonus talent, so they show up in the sphere
tables and the talent totals — three by 5th level and one more every other level after
(Angou at 20 has ten). A talent arrives with its level whether or not you have got round to
naming it, so the tally counts levels reached and the ladder reports the unnamed ones as
owed. Armored Discipline and the Vancian techniques grant no talents and add nothing.

**The prerequisite is checked, and says so when it can't be.** BAB comes off the Classes
table, spherecasting off the Spheres & Magic types (Advanced Magic Training's mythic
version counts as Mid), Vancian casting off the Vancian tab, armor off the Overview's
proficiencies. It is a note, never a lock — Bryva has had Armored Discipline for sixteen
levels and her sheet never imported an armor proficiency, so hers reads *prerequisite
unchecked* rather than a "no" that is really "I could not tell". Psionics is a plain
worksheet here, so Piercing Eye is always unchecked.

Picks and the notes field resolve `{name = expr}` like any other prose on the sheet, so a
technique note can define a value the rest of the character reads.

> **Where this came from.** The workbook had it in four places and modelled it in none.
> The choice is a dropdown on Character Info (`dataSheet!I25:I29`); the ten levels are
> printed on the Planner, on Vancian Magic and on Psionics — three copies of the same
> rows, all empty on every sheet but Bryva's, none of them beside the choice they belong
> to. The Planner's column is called `Armored Discipline Technique` whatever technique the
> character took, and parks the technique's *name* on the level 2 row, which is not a level
> the ladder grants at — so reading only the granting levels separates the ladder from the
> label on all five sheets at once. That column was on the progression importer's skip
> list, so before this **Bryva's seven filled-in rows were dropped on import**; they now
> load as her ladder, with 11th and 15th showing up owed.

## Equipment

The worksheet's four systems, separated and computed:

- **Weapons** — the workbook's six weapon blocks as editable cards. Attack = base
  mode total (Melee/Alt Melee/Ranged/…) + enhancement + misc + adjustment; damage =
  dice + floor(ability × multiplier) + misc + enhancement, with crit, groups, size,
  handedness, special properties and the rest. Imports reproduce the cached attack
  rolls (Angou's unarmed 40 = 34+5+1, damage 12d8+26), and the 🥊 toggle links a
  weapon's dice to the unarmed practitioner calculator live. Where the workbook noted
  a different total (e.g. Impact-sized dice), a hint shows it. The **Adj.** field is
  the import reconciliation offset (sheet attack − computed), doubling as a manual
  catch-all. Size/groups/handedness/familiarity/crit-mult are dropdowns; the ability
  multiplier is free (×3 and beyond allowed).

  **Damage/to-hit tokens**: write `{{…}}` in special properties to add to hit and
  `[[…]]` to add damage — dice, sandbox formulas, or both (`[[2d6 + con.mod]]`,
  `{{2}}`, `{{1d4}}`). The card shows the full working:

  ```
  atk +40 · dmg 12d8+26        avg 80
  {{…}} +2 to hit · [[…]] 2d6+13 damage
  atk +42 · dmg 12d8+2d6+39    avg 100
  ```

  Dice combine properly across sizes (12d8+2d6+…), averages use X×(Y+1)/2 per term,
  bad tokens are flagged on the card and excluded from totals, and every token
  appears in the GM's Formula Audit.

  The **Crit** tag marks what multiplies on a critical: base weapon damage always
  multiplies; **untagged** `[[…]]` tokens are damage riders added once,
  unmultiplied; `[[2d8 Crit]]` is crit-only damage that **is** multiplied; and
  `{{4 Crit}}` boosts confirmation rolls only. The workbook's Bonus Crit Damage
  column joins as unmultiplied burst dice. Average crit = base avg × mult +
  riders + tagged × mult + burst; the totals line reads e.g.
  `crit ×4+2d8×4 confirm +44 · avg 363`, and every weapon shows its crit average
  beside the normal one even without tokens.
- **Armor & shields** — worn pieces (the "On" checkbox) feed AC, cap the AC stat at
  the lowest Max Dex — the sheet's `MIN(MaxDex, stat)` rule, which is why Bryva's
  Str-based AC doesn't move with Str while her breastplate is on — and apply their
  armor check penalty to flagged skills. Multiple shields supported (Bryva's Cutting
  Board and Wok); extra ones start stowed.
- **Slotted gear** — the 14 body slots with three typed bonuses (value + type) and
  four freeform ones each, plus an **Other items** list.
- **Load & value** — weights per section, a reconciling adjustment, total carried
  against light load, and total value. Item weights flow into carry live.

## Item crafting

The workbook's Item Crafting tab was a small spreadsheet calculator — speed on the
left, cost in the middle, an item and its DC on the right, and two `&`-concatenated
cells at the bottom that produced the Discord posts. It is a calculator here too,
not a copy of its cells: three panels hold the crafter's standing setup and every
project is priced, dated and posted from them.

**Crafting speed.** A base rate per day plus the increases the crafter has earned,
each with a name and an on/off switch. A *flat* increase adds to the rate; a
*multiplier* stacks additively with the other multipliers, which is how the sheet's
own `MAX(1, COUNTIF(...) × 2)` counted Bryva's five crafting bonuses into ×10.
Time runs off the item's **base price** — `ceil(base price ÷ progress per day)`, what
the item is worth rather than what it cost to make, as both the sheet and Pathfinder's
own item-creation rules measure it. (A crafting-cost basis is offered for tables that
house-rule it the other way.)

**Crafting cost.** The base cost is a named preset — 50 / 33 / 25 % of base price,
and you can add your own. As on the sheet, those three mean a true half, third and
quarter, so a 200,000 item at a third costs 66,667 and not 66,000. Manufacturing cost
reductions are a named list and **compound** rather than add: 10 % and 20 % leave
0.9 × 0.8 = 72 % of the price. The panel shows the compounded factor and the final
value : craft ratio.

**The crafter.** Which Craft skill the check uses (with its live bonus from the Skills
tab), take 10 / take 20 / a rolled number, a misc bonus, the standing discount offered
to buyers, the DC each bypassed requirement adds, what the days count against, the
currency, and the name that signs a marketplace post.

**Projects.** As many as you like, each with its base price, an optional discount
override, a zero-profit toggle, a base item DC and a per-project check modifier. From
those it computes crafting cost, gross profit, sale price, net profit, days to
completion, the DC, and whether your check makes it:

```
base price 200,000 mana · cost 90,000 mana · gross 110,000 mana · sells for 90,000 mana
profit +0 mana · 20 day(s) 20 exact · DC 15 vs check +56  ✔ succeeds
base price 200,000 ÷ 10,000 / day · DC: Rush +5
```

**DCs carry their notes.** The sheet had a free-text *DC Notes* cell because it could
not add the modifiers up — Bryva's read `+5 Rush` beside an item DC of 10, and the
generated post said `+5 Rush10`. Those notes are now rows: a label and a value that
*moves* the DC. `+5 Rush` imports as a Rush adjustment worth +5, so her DC reads 15 and
the post explains itself as `**DC**: 15 (Rush +5)`. Bypassed requirements are their own
list, +5 each by default, and anything genuinely freeform stays freeform.

**Numbers may be formulas.** Speed increases, cost reductions, base prices and item
DCs accept a number *or* an expression in the same sandbox everything else uses — a
workshop bonus of `level * 100` follows the character, shows its current value beside
the field, and appears in the GM's Formula Audit like any other player formula.

**The Discord posts** are generated live in the workbook's own format, with a Copy
button:

```
**Crafting**: Ring of Flexibility
**Value**: 200000 mana
**Cost**: 90000 mana
**Profit**: 0 mana
**DC**: 15 (Rush +5)
**Check**: 56
**Time to Completion**: 20 (20) days
**Resources used:** 
**Notes/Description**: 
```

plus the marketplace post with the buyer, the price sold and what you have left.

> Bryva's tab also carried an Armiger customisation block beside the calculator
> (`M2:S9`) that is hers alone. It is not modelled, but it is not dropped either —
> unclaimed cells are kept verbatim in a *From the source tab* grid at the bottom.
> On the other four sheets nothing is left over.

Everything above is verified against Bryva's filled-in sheet in `tests/model.test.mjs`:
10,000 mana of progress a day, a 0.45 value : craft ratio, a 90,000 cost on a 200,000
ring, 110,000 gross, a sale at cost, 20 days, and a take-10 check of 56.

## Mythic

- **Tier is automatic** from character level (8→1, 10→2, 12→3, 14→4, then one per
  level to 20→10 — the campaign's own Mythic-tab table), with a manual override for
  GM-granted tiers.
- **The ladder is ten tiers, one row each**, and a row's position *is* its tier: a
  mythic feat on the odd ones, a path power and the +2 ability increase on the even
  ones. So the sheet's column reads Feat 1, RP Power 1, Feat 2, RP Power 2 … and the
  table says so — **Grants** is a label, because what a tier hands over is not the
  player's choice; **Choice** is what they took for it; and **Stat** appears on the
  even rows only, rather than five empty cells pretending otherwise. Tiers above the
  current one are greyed, the way the progression planner greys levels you have not
  reached. Each row also shows the level its tier arrives at.
- **Bonus HP/tier** adds `bonus × tier` on top of the normal maximum (Champion/
  Guardian 5, Marshal/Trickster 4, Archmage/Hierophant 3). Imported at 0 so existing
  totals don't shift until the player sets it; the HP panel shows the split.
- **Mythic tradition** is a structured block: Drawback 1 is mandatory and unlocks
  Boon 1; Drawbacks 2 and 3 unlock Boons 2 and 3; the Quality carries both a bonus
  and a drawback; plus the Flowing Power toggle. Extracted from both template
  layouts and no longer polluting the abilities list.
- **Stat bonuses on even tiers** — +2 at tiers 2/4/6/8/10, driving the Stats table's
  Mythic column the same way ABP and the array do. They are **one set of picks shown
  in two places**: the ladder above and *Level/4 & mythic increases* on the Stats tab.
  Either place edits it. Seeded from the ability each RP Power row names, falling back
  to spreading the imported total where the sheet left that blank.

## Progression

A structured plan, not a cell dump: a **static level list 1–20** with a class-track
dropdown per track (choices come from the Overview's class table; "+ Class track"
adds a third for tristalt and beyond, and each track has a × to delete it), and
read-only **HP, ranks, Fort/Ref/Will per level** computed gestalt-style from the
classes chosen on that row (good ½, poor ⅓).

**Class features live in collapsible groups below the table**, one per class named
in the progression, listing exactly the levels that class covers. Each group has its
own columns (add, rename inline, remove) — the imported sheets' feature text
migrates into the right group using the workbook's column blocks (Class 2's block
carried Wild Talent / Talent Level / Burn, so those land under Legendary Monk).
Feature text is keyed by **class name**, not track position, so deleting or
reshuffling tracks never loses it; a group whose class leaves the progression stays
visible, flagged "not in progression". Everything that reads the progression —
spheres training, gestalt saves, the budget — updates live when a track changes.

Feature cells are **multi-line** (they grow as the text wraps, so a Monk 1 or
Kineticist 1 wall of features stays readable), and **column widths are draggable**
— grab the right edge of a column header. Widths persist per character and follow
a column through renames.

### Column rule groups

Classes rarely grant something every level, so a feature column carries **rule groups**
— each a name, a level rule and a colour, added with *+ level rule* under the column's
name. Levels a group grants get a writable cell tinted in that group's colour; the rest
are dimmed and read-only. A column with no rule behaves exactly as before, live at every
level, which is how all five imported sheets load.

A rule is a comma-separated list of terms, unioned **left to right**:

| Term | Means | Example |
|---|---|---|
| *(blank)* / `all` | every level | — |
| `odd` / `even` | odd or even levels | kineticist infusions `odd`, utility talents `even` |
| `N` | that level | `7` |
| `A-B` | an inclusive range | `5-10` |
| `+N` | every Nth level onwards, from the term before it | Kheshig veils `2, +4` → 2/6/10/14/18 |
| `-TERM` | subtract a term instead of adding it | `odd, -13` |

Because terms accumulate in order, a generated pattern stays **extensible**: `2, +4, 3`
is the Kheshig schedule plus a one-off veil at 3, and `1, 2, +2` is the fighter's bonus
feats (1st, then every even level). Order matters — a subtraction only removes what is
already there, so `2, +4, -2` drops the level-2 grant while `2, -2, +4` puts it back.

Terms count the **class's own levels**, because "every 4 levels thereafter" is a
statement about the class and not the character carrying it; the two diverge the moment
a gestalt track has a gap, and each row's level cell carries a tooltip naming both
("character level 5 — Legendary Monk level 2"). Prefix the rule with `char:` to count
character levels instead.

Anything that is not a list of terms is handed to the same sandboxed evaluator the
formula fields use, with `classLevel`, `charLevel` and `level` in scope — so
`classLevel % 3 == 1` works for shapes the syntax does not cover. A rule that parses
as neither is flagged red with the parser's own message and **grants every level**, so
a typo never hides a row. Likewise, text already sitting on a level no rule covers is
kept and outlined in amber rather than dropped.

### Several schedules in one column

A column takes as many rule groups as it needs, which is how a kineticist's single
Wild Talent column holds both of its tracks:

| Group | Rule | Lands on |
|---|---|---|
| Infusions | `odd, -5, -9, -13` | 1, 3, 7, 11, 15, 17, 19 |
| Utility | `even` | 2, 4, 6, 8, 10, 12, 14, 16, 18, 20 |

Each level is tinted in its group's colour and tagged with its name (the tag only
appears when two or more groups share the column — with one, the column heading already
says it). Colours default to a distinguishable sequence starting with the same green the
sphere-talent grid uses, and each is overridable with a swatch picker. A cell holding an
inline formula is tinted like any other — it shows its computed view rather than its
textarea, and both layers take the group's colour, values included, so one cell in a
coloured column never comes out plain.

A group reads as one thing written out, so typing the braced form `{Infusions, odd, -5,
-9, -13}` into either the name or the levels box fills both. Clearing both fields drops
the group; dropping the last one returns the column to unruled.

### Two groups on the same level

Schedules overlap. A Blacksmith's `{Smithing Insight, even, 1}` and `{Creation
Specialist, 1, 5, +5}` both land on class levels 1, 10 and 20 — and those levels grant
**two** things, so the cell holds **two fields, stacked**, each in its own colour, with
its own tag, its own placeholder and its own filled/owed state:

```
      FEATURE SELECTION
      ● Smithing Insight    even, 1
      ● Creation Specialist 1, 5, +5

  1   SMITHING INSIGHT
      Recipes: Entrees (2), Flavors (2), Side Dish (2)
      CREATION SPECIALIST
      Creation Specialist…              <- owed, dashed, blue

  2   SMITHING INSIGHT
      Vegetables

  3   — locked —
```

Each field counts toward the *to pick* totals on its own, so a level granting two things
you have not chosen is owed twice.

Storage follows the data rather than leading it: a level with one field holds a plain
string, exactly as every imported sheet does and as the whole grid did before this
existed. Only a level with two or more fields becomes `{group: text}`, and it collapses
back to a string as soon as only the owning group has anything. Text written before a
second group existed belongs to the **first group that grants** at that level — so
Bryva's level-1 recipes stay put, and the Creation Specialist slot beside them shows up
empty and owed, which is exactly the pick that was previously invisible.

Group names key that storage, so renaming a group carries its text along the way
renaming a column does. Removing a group **strands** its text rather than deleting it:
the field stays, struck through and read-only in amber, until you clear it yourself.

### Slots you still owe

A level that grants something you have not filled in is highlighted, and how loudly
depends on whether you have got there yet:

- **Reached and empty** — a 2px dashed outline in the group's colour, a bar down the
  cell's left edge, and the group's name as placeholder text. Counted on the column
  header and totalled on the group panel as *"3 to pick"*.
- **Not reached yet** — a dotted outline only, on an already-dimmed future row. It is
  the plan, not a chore, and it is not counted.

Whitespace does not count as filled in. Columns with no rule never nag: without a
schedule there is no notion of a slot.

Groups are stored per column name beside the text, so they survive a rename and are
deleted with the column, and name, rule and colour all round-trip through Export JSON;
a rule saved by the first version of this feature as a bare string loads as a single
unnamed group. Covered by `tests/model.test.mjs`, including all three schedules above,
the interleaved kineticist column, Bryva's overlapping Blacksmith groups and their
independent fields, the string↔map storage in both directions, group rename and
removal, the owed-slot counting, the class/character divergence and the round trip.

The groups **pack dynamically**: each takes only the width its columns need, so
narrow groups sit side by side while a wide one wraps onto its own row — driven by
the viewport, re-evaluated live as you drag a column wider or collapse a group
(collapsed groups shrink to a header chip and pack too). Narrow groups render
first to keep the packing tight.

## Akashic, Maneuvers and Vancian

Three worksheets that used to be raw grids are read into structured tabs the same
way *Item crafting* is: the workbook's copy is imported once and then retired, so
the grid and the block it produced cannot drift apart. Between them they were about
**106 KB of cells across the five characters and are now 12 KB** — most of what those
tabs weighed was a value the sheet had already worked out somewhere else.

**Akashic** is a veil board. Each slot holds one veil, or two with **Twinveil**, and
every shaped veil takes a share of the day's essence:

```
veil DC = veilweaving base DC + essence invested in that veil
```

That held for every shaped veil across the workbooks, so only the essence is saved
and the DC is recomputed — about forty cells a sheet that no longer round-trip.
Angou's essence reads 20/20 against the sheet's own *Used/Total*, and the per-veil
**Total Cap** is essence cap + bonus cap rather than a stored number. The two
**Kheshig** receptacles name the slot they use instead of occupying one.

The day's essence reads as a **gauge** rather than a row of chips: what moves during
play is how much of the pool is still free, and that is a proportion. Base DC, steady
veil DC, the per-veil cap and the number of veils shaped are fixed readings, so they
sit beside it as tiles. The gauge takes a style like any tracker — see *The built-in
meters take the same style* — so it can be pips instead, and over-investing turns it
red rather than merely reading a negative number.

### Spell points into essence

A veilweaver with the **Veilweaving sphere** condenses **2 spell points into 1
temporary essence** for the day. The exchange sits at the end of the essence strip:
type how many temporary essence to make and the bar widens by that much — the
temporary part of the capacity is tinted, since it is borrowed rather than granted.

The points are spent whether or not the essence is ever invested, so they come off
the caster's own pool: **Spheres & Magic** keeps *Total SP* as the character's total
and adds *Condensed to essence* and *Available to cast with* under it. Asking for
more essence than the pool can pay for is **flagged rather than clamped** — both tabs
say how many points short it falls and the number you typed is kept, so it can be
corrected instead of being silently rewritten.

The condensed essence is a **layer** on the gauge rather than a bigger pool, so the
part of the day's capacity that was bought with spell points stays visible whichever
shape the meter is drawn in.

A veil is a **name and a description**, not one cell. The workbook only had the one,
so players wrote the effect into it in brackets — *Citadel Banner (20-foot radius,
+4 Atk/AC)* — and the import splits on the outermost pair. The description is a
resizable prose field that resolves `{name = expr}` formulas like any other, so a
veil can read `{= int.mod + 2}` and define names the rest of the sheet can use.

### Invested essence in a formula

Veils routinely scale something other than their save DC off the essence invested in
them, so every receptacle publishes its investment the way the workbook's defined
names did:

| Formula | The workbook's name | What it reads |
|---|---|---|
| `essence.hands` | `VeilEssenceHands` | the veil in the Hands slot |
| `essence.hands2` | `VeilEssenceHands2` | its twinned second veil |
| `essence.weapon`, `essence.armor` | `VeilEssenceWeapon` / `Armor` | the two Kheshig receptacles |
| `essence.the_caged_sun` | — | any other receptacle, by its own name |
| `essence.pool`, `.used`, `.free`, `.cap` | — | the day's totals |
| `essence.temp`, `essence.total` | — | what spell points bought, and the pool with it |
| **`essence.self`** | — | **the veil the formula is written on** |

Both names exist for every slot whether or not it is twinned, and an empty one reads
`0` rather than failing, so a formula written ahead of shaping the veil still works.

`essence.self` is the one to reach for inside a veil's own description — it saves
naming the slot, and it follows the veil if you move it. Angou's Bloodburst Blade
came off the sheet reading *"Up to 5 Blood Points x 26 (Con Mod + Invested Essence
x2) Damage"* — a hardcoded 26 with a note explaining it. Written as:

```
Up to 5 Blood Points x {= con.mod + essence.self * 2} damage
```

it still reads 26, and now moves when the essence does. All of it works in a
`{name = expr}` definition too, not only in a displayed value, so a veil can define
a name the rest of the sheet reads.

Slots lay out as narrow cards rather than fifteen full-width blocks. **Empty slots
are hidden** behind a *Show N empty* toggle and each slot collapses on its own; both
states persist with the character.

**Per row** sets how many cards share a row — *Auto* packs as many as fit, which on a
wide screen is five and leaves each veil's name and description squeezed; 3 or 4
trades a column for width per card. A pinned count is a floor, not a promise: a
narrow window still drops to fewer columns rather than overflowing. The choice
persists with the character, and the default is 4.

**Maneuvers** works the way the table does: knowing a discipline grants everything
in it, so you **pick the discipline from a dropdown** and every maneuver and stance
it grants appears underneath to be readied. Each discipline is a narrow column — the
useful width is a name and a tick box — and collapses on its own.

The maneuvers themselves come from `data/maneuvers.json`, built by
`tools/maneuvers_ref.py` from the workbook's own **maneuversRef** tab. That tab is
byte-identical in every workbook (30 disciplines, 1,033 maneuvers), so it is
extracted once into a file every character shares instead of being copied into each
of them: a character stores only which disciplines it trains and which maneuvers it
readied. Narockro's tab went from 20 KB of catalogue to a few hundred bytes, and
still reads 10/11 maneuvers and 4/4 stances with his six per-discipline counts
(2, 7, 0, 3, 2, 0) reproduced exactly. Anything the catalogue does not list — a
homebrew maneuver, a discipline the reference tab never had — is kept on the
character so nothing from a sheet is lost.

**Right-click a maneuver** to open its page on the campaign wiki
(<https://metzo.miraheze.org>) in a new tab — left-click still readies it, so the
other button does the looking-up. Hovering a row underlines the name to show there
is a page behind it.

The title is built from the maneuver's own name, with one wrinkle: the catalogue was
typed in Google Sheets, whose autocorrect turned **93 of the 1,033 names** curly, so
`Seraph’s Wrath` carries U+2019 rather than a plain quote. Apostrophes are
straightened before encoding, or the link would ask for `Seraph%E2%80%99s_Wrath` and
get nothing. Both spellings reach `Seraph%27s_Wrath`, and titles with a colon
(`Lesson I: Balance`) resolve too.

Rebuild the catalogue after a template change with:

```bash
python tools/maneuvers_ref.py
```

**Vancian** is six casting-class blocks, each a spell level 0–9 table of slots per
day, DC and spells known. No character on these sheets had a field of it filled in —
the only cell that varied between the six repeated `identity.primordiaTechnique`, which
the identity block already carries and *Primordia Techniques* above now models — so it
imports empty for everyone. It is
modelled anyway so a prepared caster has somewhere to put their spells, and its DC
is the real rule rather than the sheet's:

```
spell DC = 10 + spell level + casting stat modifier
```

The sheet's own column read a flat `10 + spell level` because no casting stat was
ever bound to a block.

None of these sits on the tab bar until it is asked for: the ⚙ manager badges the
one that holds the character's data *in use*, and **Show** puts it on the bar — for a
character taking up the system for the first time too. Cells no heading claimed are kept verbatim
under *From the source tab*, the same as crafting — four cells in total across all
six characters.

## Card casting

Nico casts off a deck: the **Card Casting** drawback (*Expanded Spheres: Cardcaster's
Gamble*) puts every effect that costs spell points on a card, drawn at random in
combat. His workbook kept the deck on its own *Cardcaster Deck* tab — 54 cards on a
Harrow deck (six ability suits × nine alignments), the drawback switches, the deck
manipulations he has taken and a table of land-attuned spheres — and that tab is now
read once into a **Cardcasting** tab, the same bargain as the four systems above.

**Opt-in.** The tab lives in the ⚙ manager's *Extra — weird systems* corner; a
character whose deck holds cards or whose tradition lists *Card Casting* among its
drawbacks sees it badged *in use* there, and **Show** puts it on the bar; anyone else
can turn it on the same way and start from empty. A caster with the drawback but no deck tab gets the
switches seeded from the tradition (`Cooldown`, `Mana Pool`, `Deckout`, `Colored
Mana (RBU)` → three colours R, B, U…) and the casting stat from the first casting
class, so the numbers read before a single card is typed.

**What is modelled.** The block is what the player chose, and everything the rules
derive from it is worked out on load and never saved:

| Chosen | Derived |
|---|---|
| casting ability | casting modifier; **opening hand** = 1 + modifier, at least 2 |
| the ladder — Cooldown, Mana Pool, Mana Graveyard — and the ten modifications (Bleeding Hand ×1/×2, Colored Mana 3/5, Deckout, Exposed Grip, Gradual Ramp, Lifebound Deck, Singleton, Stagnant Pool, Strikable Assets, Tight Hand) | what the drawback **counts as for boons** (1, +1 for Cooldown or Mana Pool, +1 for both, +1 for Mana Graveyard, +1 per modification, +2 for five-colour Colored Mana — Nico's is 7); prerequisites flagged (Deckout needs Cooldown, Stagnant Pool cannot sit with Mana Graveyard…) |
| the cards — name, effect, spell point cost and its **colour**, sphere, tags, the **mana** a fused card carries (`UB`), copies, an art link, and suit/alignment on a Harrow deck | deck size; effect / mana / fused counts; distinct effects and copies of each; the **identical-effect spread** against the casting modifier; **colour balance** under Colored Mana (every colour has an effect, none over half or a quarter); Singleton duplicates; the minimum of 20; d100 **draw ranges** per card; suit, alignment, sphere and colour tallies |
| deck manipulations by group, with a count and the note beside each pick; the number available (blank = automatic, or a number or formula) | one manipulation per **deck feat** (any feat or bought-off drawback tagged `[Deck]`) plus one for Card Shark — Nico's 10 + 1 = 11; each pick's rule text and prerequisites (Cooldown, Mana Pool, Colored Mana, Singleton…) from the catalogue in `data/cardcasting.json`, read off the wiki's [Card and Deck Feats](http://spheresofpower.wikidot.com/card-and-deck-feats) page; taken vs. left |
| **Rainbow Efficiency** (seen among the deck feats) | a card may cost two colours — three to five with *Improved* — and the colour balance loosens to ¾ / ½ |
| land-attuned spheres per colour, and which are attuned | cards in the deck per sphere |
| Lifebound Deck / Tight Hand | Lifebound value = ⌊HP ÷ 3 ÷ deck size⌋ (min 1); hand limit = 3 + Loaded Hand picks |

Every check is a line and a badge, never a gate. **Cards are drawn as cards**: the
name in the title bar (Nico's Harrow names — *Betrayal*, *Crows* — became the names;
a non-Harrow deck just types its own), the cost and its colour letters top right,
the frame in that colour — a two-colour cost splits the frame with a narrow blend
between the halves, three splits it in thirds; a card with no colour of its own takes
its **sphere's** colour from the land-attuned table; a plain Mana Point card wears its
mana; a Veilweaving card is an **artifact** in blue-grey, being outside sphere magic —
suit and alignment on the line beneath for a Harrow deck, the art from a
pasted image link, a *sphere — tags* type line, and the effect in the text box.
A card's effect is prose, so `Corpse Bomb — Fort DC {= 10 + floor(level/2) +
int.mod}` reads **30** on the card and follows Int and level. The deck is in the
formula scope as `deck.size`, `deck.cam`, `deck.hand`, `deck.handMax`,
`deck.effects`, `deck.mana`, `deck.unique`, `deck.lifebound`, `deck.drawbacks`,
`deck.manipulations`, `deck.manipulationsLeft`, and every manipulation's count as
`deck.manip.<name>` (`deck.manip.loaded_hand`, `deck.manip.draw_power_enhancement`)
— a tracker with max `deck.hand` gives the opening hand pips.

**Reading the tab.** A fused card's cell read `Reanimate | Blue/Black Mana`; the
effect and the mana split apart (`UB`), and a bar inside the effect's own brackets
(`Nether Blast (Chain Blast|Explosive Orb)`) stays put — which is why the sheet's
decklist counted 30 distinct effects and the tab counts 25: the rules make the mana
half a separate matter. The workbook's own tallies — colour counts, Harrow suit and
alignment totals, the decklist, the identical-effect diff, the deck-feat count —
are recomputed rather than kept, and Nico's tab leaves nothing under *From the
source tab*.

### The table

The tab has two faces: **The deck** (everything above) and **The table**, the
encounter in play. The table keeps its zones on `cardcasting.table` as card-instance
ids (`<card>#<copy>`) — deck order, hand, in play, mana in play (with a tapped flag),
discard, exile and the three Lifebound piles — so an encounter is play state like hit
points: saved, restored, and a few hundred bytes.

| Control | What the rules say, and what it does |
|---|---|
| **Start encounter** | shuffle every copy; draw 1 + casting modifier (at least 2), plus 2 per Loaded Hand. Under Mana Pool a plain Mana Point card drawn goes straight to the table — except under Gradual Ramp, where it waits in hand to be played one a round. |
| **Redraw hand** | shuffle the hand back and draw one fewer (mana drawn into play at initiative goes back too); the same number the first time with Mulligan; never from a hand of one. |
| **Next round** | draw one (not under Exposed Grip, which draws by action), untap Stagnant Pool mana, reset the Gradual Ramp count; under Deckout an empty deck says so (4 Con burn a turn). |
| **Draw a card** | Rapid Fill, Life Draw, Prize Card, Primed Hand — any draw the rules hand you. Tight Hand stops a draw at 3 + Loaded Hand. A dry deck under Cooldown reshuffles the discard first, as a free action, unless Deckout forbids it. |
| **Cast** / **Ongoing** | on each card in hand. *Cast* resolves at once — the card shuffles back into the deck, or goes to the discard under Cooldown; *Ongoing* keeps it in play until you **Resolve** it. Under Mana Pool the cost is read against mana in play (of the card's colour under Colored Mana; a mana card of each colour for a Rainbow Efficiency cost): Mana Graveyard sends that many Mana Point cards to the discard, Stagnant Pool taps them. The check shows as a badge — *castable* or *2/5 mana* — and never refuses. |
| **As mana** | a Mana Point card, or the mana half of a fused card, onto the table. Gradual Ramp allows one a round — the button greys out after it — except a card tagged *Mana Rock* (for a spell point) or *Moxen*. |
| **Trap** | with the *Trap Card* deck feat: the card goes face down into play; **Spring** casts it then (keywords and all), **Reveal** turns it up. |
| 🎲 | a cast (or a springing trap, or a Retrace) rolls the card's dice by itself — the **Dice** field (`6d6+int.mod` — the flat part reads the sheet) or the first dice in its text, formulas resolved first — and logs `[5, 1, 3, 3, 5, 5] + 13 = 35`; the header shows the last roll and 🎲 rolls again. |
| **Shuffle discard in** | Cooldown's full-round action. |
| **Read the cards** | the top card, or three when taken twice; *bottom (1 SP)* buries it for the spell point the rule charges, *discard* is the twice-taken option. |
| **Retrace** (on a discard row) | casts the card from the discard: its cost + 1 spell point (or a longer casting time — leave the point alone then), it rolls, its keywords fire, and it stays in the discard. |
| **move…** | on every card, anywhere: hand, in play, mana, discard, exile, top or bottom of the deck, shuffled in, the Stun / Wounds / Death piles — for Bleeding Hand, Into Nothing, Recollection, Resupply, Retrace, Impulse, Lifebound, and misclicks. |
| **End encounter** | everything back into the deck, shuffled. |

**Keywords.** Square-bracketed words in a card's text fire when it is cast (or when a
trap springs): `[Draw 2]`, `[Discard]` (a prompt — you choose), `[Shuffle]` (the
discard into the deck, or the deck itself), `[Mill 3]`, `[Peek]`, `[Tap 2]`,
`[Untap]`, `[Wild]`, and for the card itself `[Exile]`, `[Bottom]`, `[Top]`,
`[Deck]` (shuffled in), `[Return]`. What a card does to itself is its own rule;
`[Peek]` wants Read the Cards and `[Wild]` Wild Card, and are logged as skipped
otherwise. They show as chips on the card.

**Triggers.** `[OnMill]`, `[OnRedraw]`, `[OnDraw]`, `[OnDiscard]`, `[OnExile]` mark
the sentence that applies when that happens to the card — Infernal Combustion's free
attack when it is milled off the top, its HP loss when the hand is shuffled back,
Grave Peril's free cast when drawn to an empty deck and hand. The table logs
⚡ *card (event): the sentence* and shows the latest under the header. `[Ante]` is
Perfect Draw: cast, it shuffles back with Early counters equal to the maximum ante
(2 + 1 per 4 levels past 1st); each new round ticks them down and then adds Late
counters up to the maximum; drawing it logs which branch applies, and the next cast
exiles it. **Exile one at random** on the discard is Blood and Dust and Grave Peril.

**Formulas on cards.** `{ceil(caster.level/2)}d6` and `{caster.level}` evaluate in
place (a bare `{expr}` is a value, a dotted name a reference), and the same works in
the **Dice** field: `{ceil(caster.level/2)}d6+{ceil(caster.level/2)}` rolls 8d6+8 for
Nico. Dice found in the text resolve their formulas before they roll.

**Named rolls.** The Dice field may list several rolls, `;`-separated and labelled:
`{ceil(caster.level/2)}d6; boost (1 SP): {caster.level}d6; milled: {ceil(caster.level/2)}d4;
milled boost (1 SP): {caster.level}d4`. The first is what a cast rolls on its own; a
**roll…** picker beside 🎲 offers the rest, wherever the card is (hand, in play, the
discard), and a label carrying `(1 SP)` spends that when picked — so a milled Infernal
Combustion is *roll… → milled* for the free attack, or *milled boost (1 SP)* for the
bigger one, straight from the discard row.

**Spell points.** With a tracker named *Spell Points* (or *SP*) on the character, a
cast spends the card's cost from it — the header shows what is left — and every
effect card carries **+1 SP** for a modal option (Infernal Combustion's boost); the
controls have **Spend 1 SP** for anything else (Retrace, Read the Cards). Traps pay
when they spring. Without a tracker the header says so and nothing is deducted.

The field is laid out as a table: the hand across the top; **In play** three
quarters wide with the **Deck** beside it; **Mana in play** on the left half and the
**Discard** over the **Exile** on the right; the log across the bottom.

Every action writes a line to the log. Cards deleted from the deck mid-encounter fall
out of every zone; copies added wait for the next shuffle. The table reads from
formulas as `deck.round`, `deck.inHand`, `deck.inDeck`, `deck.inPlay`,
`deck.inDiscard`, `deck.manaInPlay` and `deck.manaUntapped`.

## Primordia techniques — Technique List and AutoTechnique

A technique is a recipe of spheres, talents and "other" features (a feat, a wild
talent, a mythic path ability); its complexity, DCs and SP cost fall out of how many
of each it uses. The workbook keeps every technique the character knows or is designing
in one column each of a `techRef` tab — 53 on Angou's — with the **Technique List**
tab reading one of them by name, row by row, and **AutoTechnique** being the same layout
typed by hand for a new one, with a Discord application built underneath. Both live in
the ⚙ manager's *Extra — weird systems* corner.

The converter now captures `techRef` cell-for-cell (it was on the reference-tab skip
list), and the model reads the three grids once into `techniques` — the catalogue, the
name the list is open on, and the AutoTechnique draft — then retires them, the way
Item Crafting and the Template tab are read. Every field is found by its label, so a
document saved with the grids but without their row numbers reads the same.

**Technique List** is a picker over the catalogue and a read-only sheet of the one
picked: name row (prefix, e.g. *Nakano Style Counter*, and name), the three sphere rows
with the talent each contributes, the numbers, range and saves, and the four description
lines. Only the **approval status** (*Known*, *Design Phase*, *Approved*…) and the
*Type* are edited here; to change a technique, **Copy to AutoTechnique**, edit, and add
it back — the same name replaces the entry. **AutoTechnique** is the same layout with
every field live, plus its three crafting choices (Instant Initiation, Versatile
Technique, Signature Technique), and **+ Add to Technique List** puts the draft on the
list, which is what the workbook's tab did to `techRef`. Both end in the workbook's
Discord application text — character, what is applied for, the technique in a code
block — with a **Copy for Discord** button.

**Import from workbook…** on the Technique List takes only the techniques out of a
`.xlsx` and merges them into the character — same names replaced with the workbook's
status, the rest kept, nothing else on the sheet touched. That is the fix for a
character imported before `techRef` was captured (its list had collapsed to the one
technique the tab was showing), and the way to bring newly designed techniques over
without re-importing the whole sheet. Placeholder columns that share a name (`???`)
are kept apart with a suffix rather than folded into one.

The arithmetic is each tab's own, from the workbook's formulas:

| | |
|---|---|
| base talents | distinct spheres and other entries, less any *Feat* among the others |
| complexity | base, plus (distinct − 2) once there are more than two, plus every talent named — floor 0 |
| crafting time / effective | 1 + complexity; effective knocks a third off, rounded down |
| craft DC / decipher / learn | 5 + 5 × complexity; 20 + complexity; 10 + 2 × complexity |
| Technique Prowess | *Yes (Martial Focus…)* when the technique uses no magic sphere at all |
| effective complexity, **Technique List** | with prowess: complexity − 1 − ⌊BAB ÷ 5⌋ − Adept Initiator, floor 0; else complexity − Adept Initiator |
| effective complexity, **AutoTechnique** | complexity + Instant Initiation + Versatile − Signature − Adept Initiator, floor 0 |
| total SP | effective + the technique's own extra SP |

Verified against the workbook's cached values in `tests/model.test.mjs`: Wheelbreaker on
the list (complexity 6, DCs 35 / 26 / 22, prowess No, effective 5), Knucklebuster on
AutoTechnique (5, 30 / 25 / 20, prowess Yes, effective 4 with Adept Initiator).

> The two tabs disagree with each other on effective complexity — the list applies the
> prowess discount and knows nothing of the three crafting flags; AutoTechnique applies
> the flags and ignores the discount — and each is reproduced as written rather than
> merged, so a technique reads the same here as on the tab it came from. The workbook's
> Technique List prowess cell also read a label where it meant complexity; the intent
> (complexity) is what is computed.

## Auto-Cooking — the iron chef's dish

Bryva's *Iron Chef Dish Maker*, for anyone at the table: two entrees, three flavors,
two side dishes, an aroma and a garnish, each granting the diners an effect whose
numbers scale with the chef's level, and some strengthening each other — a Red Meat
entree adds to the Strength that Apples grant, Rice counts the recipe as three levels
higher, a Sweet flavor sharpens Ginger. Duration is ⌊level ÷ 3⌋ + 1 hours.

The ingredient list and every effect's formula are shared rules, not character data,
so they live in `data/cooking.json` — each effect a template whose `{expr}` holes are
evaluated in the app's own formula sandbox with `level` and the count of each
ingredient in the dish (`rice`, `sweet`, `redMeat`, …), exactly the COUNTIFs the
workbook's cells read. Any character can show **Auto-Cooking** from the ⚙ manager's
weird-systems corner, type the chef's level (blank uses their own) and cook; Bryva's
own tab opens on the dish her workbook last built. The tab shows what the meal does,
one bullet per ingredient with its combo noted, a folded reference of every ingredient
at the current level, and a **Copy for Discord** post: dish, chef and level, the
courses, the duration, the effects.

> Several of the workbook's combo counts had broken to `#REF!` in the export and so
> counted as zero (its cached Spicy read +16 at level 16 with Rice on the plate). The
> combos its own *Combo Bonus* column names are applied here — Spicy reads +19 — and
> Broccoli's *Mycoproteins* typo is matched to the Mycoprotein entree it means.

## Companions — Familiar, Animal Companion and Eidolon

Three more worksheets that used to be raw grids are read into structured tabs the
same way *Item crafting* and the *Akashic, Maneuvers and Vancian* tabs are — with one
difference: none of the five workbooks ever filled a companion in, so there is
nothing to import. Every character carries the three blocks empty, and each tab
waits in the ⚙ manager until it is shown (badged *in use* once the companion has a
name or a master class). The template's grids, which were `#ERROR!`
end to end in the export, are retired on load; a workbook whose copy does carry a
name keeps its grid beside the block rather than losing it.

What the sheet computed, the tabs compute — from the tables its formulas read off
`dataSheet`, now in `app/js/companions.js`:

| | Familiar | Animal Companion | Eidolon |
|---|---|---|---|
| **Level** | the master's, capped at 20 | levels in the master class named (or **Handle Animal** / **Ride** ranks for a Spheres companion) | levels in the master class named |
| **HD / BAB / saves** | the master's; base saves never below +2 | the animal companion table, good/poor saves ticked per save | the eidolon table |
| **Hit points** | half the master's maximum (doubled for a **Protector** from 11th) | 8 a die + Con each | 8 a die + Con each |
| **Scores** | Int from the familiar table unless typed | Str/Dex bonus by level; +1 to a chosen score at 4/9/14/20 | Str/Dex bonus by level; +1 at 5/10/15; **Evo** column for the Ability Increase evolution, capped at 2 + 2 per six levels |
| **Natural armour** | the familiar table's adjustment | the table's | the table's |
| **Skills** | own ranks or the master's, whichever is higher | ranks from the table | HD × (6 + Int mod), the sheet's own cell |
| **Feats / tricks** | — | feats and bonus tricks from the table | feats from the table |
| **Extras** | protector flag, familiar abilities | body type → item slots and *can grasp*, slotless items | evolution pool (less the master-level penalty, plus bonus points), attack cap, DR / resistances / immunities |

Every tab also has a **master-level penalty**, a **level override** to pin the level,
AC bonuses split three ways (**all**, **touch only**, **flat-footed only**), CMD and
initiative extras, misc per save, speeds, natural attacks (type from the catalogue
gives the damage type and whether it is primary; secondaries take −5, or −2 with a
feat named Multiattack), and Damage / Heal / Rest buttons over a hit-point line that
spends temporary points first. Prose fields take inline formulas, and each companion
reads from a formula as `familiar.hp`, `familiar.attack`, `eidolon.hd`,
`eidolon.evoLeft`, `animalCompanion.str.mod`, and so on.

Where the worksheet's formulas and its own tables disagreed, the tabs follow the
tables: the animal companion's and eidolon's BAB, saves, skill ranks and Str/Dex bonus
are looked up by **level** (the sheet's cells keyed the level table by HD, which
gave a 1st-level companion the 2nd-level row); the animal companion's touch AC leaves
natural armour out; the eidolon's total attack keeps its size modifier. Only what is
typed is saved; every total is recomputed on load, and `tests/model.test.mjs`
checks the table rows, the familiar's halving, and the round trip.

## The tab bar and the ⚙ manager

A sheet opens with nine tabs across the top — **Overview, Stats, Lore, Skills, Progression,
Feats & Mythic, Primordia, Trackers, Equipment** — and everything else waits in the
**⚙** manager at the end of the bar. That order is a preference, not a rule: drag a
tab along the bar (or a row in the manager's *Tab bar* list) to move it, **Hide** it
to send it back to the manager, or **reset** to the default nine. The bar is saved
with the character (`uiPrefs.tabOrder`), so it survives a reload and travels with an
export.

The manager lists what is off the bar **alphabetically**, in three groups:

- **Hidden tabs** — the rest of the built-in tabs (Spheres & Magic, Crafting,
  Extras & Notes), the modelled sub-systems (Akashic, Maneuvers, Vancian, Psionics,
  Template, and the three companions), and the workbook's own worksheets. A
  sub-system that already holds the character's data is badged *in use*, so a
  character with veils sees which waiting tab has them; **Show** puts a tab at the
  end of the bar.
- **Extra — weird systems** — the odd machinery kept out of the way unless a
  character runs on it: **Cardcasting**, the **Technique List** and **AutoTechnique**
  pair, and **Auto-Cooking**.
- **Worksheets** — add a free grid tab of your own for a spellbook, a mount, or a
  homebrew system.

Every remaining worksheet of the workbook — the character-specific tabs like a
Technique List or an Auto-Cooking sheet — is its own tab, fully editable: **rename**
inline (in the manager or from the tab's own header), **delete** with a confirm, grow
it with rows and columns. Cells accept inline `{name = expr}` formulas, so a custom
tab can define character-wide values too. The big Spheres & Magic panels can be
minimized; all of this persists per character.

> The `#ERROR!` cells in the exports sat in Animal Companion (16 per workbook) and
> Eidolon on **all five** workbooks. (Item Crafting, Akashic, Maneuvers and Vancian
> Magic had them too.) None of those is a grid any more — see *Item crafting*,
> *Akashic, Maneuvers and Vancian* and *Companions* above — so no raw tab shows an
> error cell now. The casting-number differences on Nico/Narockro/Saburo come from template
> revisions, not broken formulas; Saburo's cached CL 4, for instance, is his
> Advanced Magic Training flag, which the app now reproduces.

## Skills

Total ranks follow the sheet's real formula:

```
totalRanks = min(level, bought + (specialty + gear + other) × level + sphereRanks)
```

**Specialty skills** are three picks — one Knowledge/Lore, one background skill
(Unchained list), one free — each granting full ranks; they're seeded from the
imported Specialty flags and marked ★. **Gear** (headband et al) and **Other**
(class features, templates) are per-skill checkboxes worth full ranks. **Spheres**
is computed from training. All five characters' imported ranks and totals reproduce
exactly.

**Hiding a skill.** The list is the template's, in the template's order: rows are not
reordered or deleted. The eye at the end of each row hides a skill instead; hidden skills
come back under **Show all**, dimmed with the eye closed, to be reopened. On a character
with no ranks anywhere the unused-skill filter is off, so a new sheet shows the whole
list.

### Variants

A skill is one name, variant included — there is no separate Spec. column, just
**Craft ( Weapons and Armor )** with the parentheses drawn around the part you fill in.

Most skills are one fixed thing, and their names are labels rather than fields: the
Pathfinder list is what it is, and a row imported from the sheet is not something to
rename. **Artistry**, **Craft**, **Lore** and **Profession** are open slots the
character names themselves, and **Perform** is open to nine categories and no others:

| | |
|---|---|
| Act | comedy, drama, pantomime |
| Comedy | buffoonery, limericks, joke-telling |
| Dance | ballet, waltz, jig |
| Keyboard instruments | harpsichord, piano, pipe organ |
| Oratory | epic, ode, storytelling |
| Percussion instruments | bells, chimes, drums, gong |
| String instruments | fiddle, harp, lute, mandolin |
| Wind instruments | flute, pan pipes, recorder, trumpet |
| Sing | ballad, chant, melody |

Only those slots are editable — Artistry, Craft, Lore and Profession as text, Perform
as a dropdown of the nine — and they are highlighted, dashed while empty and filled
once named. Every other skill is just its name.

Whatever is typed is stored as the variant alone and displayed as `Skill (variant)`,
so **Craft (Weapons and Armor)** and **Weapons and Armor** both land the same way —
the skill's own name, a `:` or `-` separator and wrapping parentheses all come off,
while inner parentheses (*Bows (composite) and Arrows*) and words that merely start
the same (*Craftsmanship*) are left alone. Changing a skill or its variant carries its
specialty pick along, so a ★ never detaches from the row it was granted to. The sheets
abbreviate a couple of the Perform categories — Narockro's `String` for *String
instruments* — and those import as the real category; anything vaguer is kept as written
and marked `… *` rather than guessed at.

**Add skill** is the exception that names itself: a row the player adds has no name
yet, so that one is a field. It is also how a further Craft or a new Lore gets made —
name it `Craft` and the variant slot appears — and how anything the sheet never had
gets onto the character.

**Bought ranks accept formulas**: an integer, or a level-derived expression like
`level` or `floor(level - 2)`, evaluated in the same sandbox as trackers (rank
formulas may only read `level`) and shown in the Formula Audit for GMs.

**Misc bonuses accept formulas too** — an integer (negatives fine), an ability
modifier (`int.mod`), arithmetic (`floor(level/2)`), or a value defined in prose
(`skill_familiarity`, for the vigilante social talent written as
`{skill_familiarity = 4 + floor(level/5)}` in a class feature). Formulas follow their
inputs live, flag unknown names in red, and appear in the Formula Audit. Misc formulas
may read abilities, level and inline names but not other skills' totals — and inline
names may not read skills — so no cycle can form between the two.

Both cells show the **resolved value in place** rather than the source text with the
answer parked beside it: the column reads as numbers, and clicking or tabbing into a
cell swaps the source in without moving anything. The same field is used for crafting
amounts and a weapon's Dice, so `{kinetic.fist}` reads as **4d8** until you edit it.
A formula that does not resolve keeps its source showing, in red.

**Rank budget**: available points = (best class ranks/level + Int bonus/level +
bonus points/level) × level, checked against the ranks bought — a red error when
over-assigned, a note when points are unspent. The Int and bonus metrics are the
sheet's own rows under the skills table (no longer imported as skills). Angou:
8/level × 20 = 160 available, 140 spent, 20 left — matching his sheet's own tally.

## Templates

A template is a list of **abilities**, each a name, a type (—, Ex, Su or Sp) and its
text, and each able to carry **sub-abilities** and **tables**. That is what the source
sheets actually contain: Bryva's Omni-Cooking has four blocks under it, two of which
are tables of ingredient ranks and creature types.

```
Omni-Cooking                                    Su
  Bryva can learn how to prepare spells by cutting them with her "kitchen tools"…
  ├ Omni-Cooking: Precise Preparation           Ex
  ├ Omni-Cooking: Ingredient Ranks              Ex
  │   Rank │ Description             │ Minimum Effective Spell DC
  │   E    │ Standard, run-of-the-mill. │ 15
  └ Omni-Cooking: Nose-To-Tail                  Ex
      Type    │ Ingredient 1 │ Ingredient 2 │ Additional Information
```

Sub-abilities are the sheet's own idea, written as `<parent>: <name>` in the column
under their parent, and that is how they are gathered — the longest matching parent
wins, so a group whose name starts with another group's still collects its own.

**A table is a real table**, not prose: named columns, rows you add, move and delete,
columns you add and delete, and cells that grow with their text and resolve `{…}`
inline formulas like any other prose field. Previously the import turned each table
into a feature named after its first heading and threw the remaining columns away —
Bryva's *Description* and *Minimum Effective Spell DC* columns were simply gone.

A table also has a **Move to…** picker naming every ability and sub-ability in the
template, because where a table is *drawn* is not always what it *means*: the
spell-school table is written in the right-hand column beside Temporal Haze and
belongs to Omni-Cooking's Ingredient Ranks. The import puts it where it was written
rather than guessing, and one dropdown moves it without retyping eighty cells.

### Merged cells

Cells merge by what is written in the cell that disappears:

| Type this | Means |
|---|---|
| `-----` | this cell belongs to the one on its **left** |
| `\|\|\|\|\|` | this cell belongs to the one **above** it |

`Meats │ ----- │ -----` is one cell three columns wide, and a `|||||` under a value
extends it down a row. The two combine, so a block is merged by filling its right-hand
column with `-----` and its lower rows with `|||||` — and column headers take `-----`
too. **Three or more** of the character counts, so the single `-` these sheets use for
"none" stays ordinary content.

Nothing about a merge is stored: the table stays a plain rectangular grid, one value
per cell, and the spans are worked out from it every time it is drawn. That is what
makes a merge survive adding a row, deleting a column and an export/import with no
bookkeeping to go stale — and what makes it visible in the JSON as the text you typed.

A merged cell is not drawn, so **Cells** on the table's header shows the grid exactly
as stored, markers and all, for splitting one again or adjusting it. A merge only
grows while it stays rectangular; a marker that cannot attach to anything — one in the
first column, or one left over from an L-shaped run — is drawn as the dashes it is,
which is how a mistyped merge says so.

> Merges are a thing you write here, not something imported: the workbook reader uses
> a sheet's merged ranges to size the grid and does not record them, and teaching both
> converters to carry them was not worth the duplication.

**Rearranging.** Grab an ability by its ⠿ handle and drop it among the others;
grab a sub-ability and drop it anywhere in its own group or in another one. What a
sub-ability cannot do is land at the top level — it hangs off the feature above it, so
dropping one on a group's head puts it *inside* that group rather than above it, and
there is no drop that promotes it. ↑ / ↓ do the same moves without a mouse and carry
on into the neighbouring ability rather than stopping at the ends of their group.

### Reading the workbook's tab

The Template tab is captured cell-for-cell by the converter and read once by the
model — the same treatment *Item crafting*, *Akashic*, *Maneuvers* and *Vancian* get,
and for the same reason: the grid is retired afterwards, so the structured block and
the copy it came from cannot drift apart. It also keeps that scan in one place rather
than in both converters.

The scan follows the template's own geometry rather than cell addresses. Every feature
slot carries a **`Type:` marker three columns right of the name**, so that is what
finds them — which is why Bryva's second column of features at L reads exactly like her
first at B, and why the six empty slots on an untouched template import as nothing at
all. Below a feature, further rows in its column are more description and a run of rows
using more than one column is a table, whose columns are the ones the block actually
uses (the school table spans L, N, Q and T because of the sheet's merged cells).

**What it cannot place, it keeps.** A table with no feature above it, a column the
template never had, a layout the scan does not recognise at all — none of it is
dropped. It lands in a **Temporary** group at the end of the template, marked in the
same dashed blue an owed feature slot uses, holding the cells verbatim as a table.
Nothing else treats it specially: rename it, retype it, drag it, give it
sub-abilities, or delete it once its contents have found homes. All five test
sheets import without needing one.

A character who has no template carries no Template tab. **⚙ → Template → Show**
turns one on for a character taking one up for the first time, and the empty tab
offers to start one.

---

## Inline formulas in prose

Any descriptive field — class features, template features, notes, background,
traits, mythic abilities and tradition, weapon special properties, gear notes,
sphere talents, crafting resources and notes — can carry formulas inside the text:

| Form | Meaning |
|---|---|
| `{= expr}` | inline value: evaluates and displays the result |
| `{name = expr}` | **named** value: evaluates, displays, and defines `name` for use anywhere on the character |
| `{name}` | reference: displays a previously named value |

**Which fields take them.** A field that understands formulas carries a soft gold
bar down its **right** edge — the same gold the computed values wear — and says so
on hover. A field without the bar takes plain text. Three kinds of field have it:

- prose that may carry `{…}` tokens anywhere in the text (the list above),
- single-value expression fields, where the whole value may be an expression
  instead of a number (skill ranks bought, crafting amounts, weapon dice),
- the formula inputs in the tracker editor (max, min, zone bounds).

The bar dims out when a field is disabled, so a locked trait slot does not advertise
what it cannot do. The **left** edge is a different signal — "granted at this level",
on the Primordia and class-feature grids — so the two never collide.

Names may be dotted labels (`arms.hp`, `qi.max`) and can reference each other;
definitions resolve in dependency order no matter where on the sheet they're
written, so `{qi.max = floor((burn.max + qi.base) / 4)}` in one feature can read
`{burn.max = 18}` from another. Named values are **character-wide**: they show in
the Trackers tab's available-values list and can be read by tracker maxes,
weapon `[[…]]`/`{{…}}` tokens, skill-rank formulas, crafting amounts and other
inline tokens.

```
Elemental Arms: AC {arms.ac = 10 + con.mod + 2}, hardness {arms.hardness = con.mod},
HP {arms.hp = 3 * con.mod}, dispel DC {arms.dc = 11 + con.mod}. Angou gains another
pair at 11/14/17 ({arms.pairs = 1 + (level >= 11) + (level >= 14) + (level >= 17)} pairs).
```

renders as *"…AC **24**, hardness **12**, HP **36**, dispel DC **23**… (**4** pairs)"*
with each value underlined; hover shows the formula, click to edit the raw source,
and everything recomputes when Con or level changes. A tracker with max `arms.hp`
gives the pool pips. Cycles, duplicates and bad references show inline in red and in
the GM's Formula Audit; a definition can never shadow a built-in like `level`.

**Dice from names.** A weapon's Dice field accepts a reference — `{kinetic.fist}`
(or `[[kinetic.fist]]` / `{= …}`) — beside literal dice. A number-valued name is
read as that many d6 (kineticist blast dice: `{kinetic.fist = floor(…)}` → 4 → 4d6);
for other die sizes define the name as dice text with the `dice()` helper:
`{kinetic.fist = dice(floor(ceil((min(level,20)+6)/2)/3), 8)}` → `4d8`. The field
shows the resolved dice in place — click it to see the reference again — and follows
level changes live. Function names are case-insensitive (`FLOOR`, `Min`, `IF` all fine).

## Character colour

The Details panel carries a **character colour** — the sixteen swatches, a hex box and
the system colour picker, or blank for the theme's own gold. It is applied as the
sheet's accent, which is the one colour everything unstyled already reads: panel
headings, tracker pips, the underline on a computed value, the edge that marks a field
as accepting formulas. So one choice colours the character throughout, and a tracker
with no colour of its own is drawn in it.

It is stored as `identity.color` and travels with the character's JSON. Embedders can
still override it per instance with `--cs-accent`, since the character's own colour is
set on the element rather than in the stylesheet.

## Custom trackers

Players define their own resources — mythic power, uses per day, ki, burn, luck —
by giving a name and a **max as a formula**:

```
floor(level / 2) + wis.mod
3 + mythic.tier * 2
if(mythic.tier = 0, 0, 3 + mythic.tier * 2)
```

Trackers recalculate live as the character changes, and are spent with `+`/`−` or by
clicking the pips.

**Every tracker is editable.** The ones seeded from the sheet's own Resource Tracker
block are ordinary trackers: ✎ renames them, retypes their max as a formula, adds a
min, changes the refresh and restyles them, and × deletes them. Bryva's Spell Points
can become `caster.sp` instead of the frozen 23, and her hand-kept *Satiety* and
*Stuffed (88%)* rows can go entirely, replaced by zones on Culinary Stamina.

Edits are stored as **deltas against the sheet** (`sheetTrackerState`) — the imported
`resources` block is never rewritten, so an edited tracker carries a *from sheet,
edited* badge, **Reset** brings the sheet's version back, and re-importing from Drive
still works. Deleting a sheet-seeded tracker is remembered, so it does not reappear on
reload.

**Mythic Power is the one exception.** Every character has it from level 8, so it
cannot be deleted (no ×, and the model refuses the call) and is created automatically
for a character who reaches tier 1 without one. It is worth `3 + 2` per tier —
which is exactly what all five sheets recorded — so it is imported with

```
if(mythic.tier = 0, 0, 3 + mythic.tier * 2)
```

as its max and follows the tier from then on: Angou 23 at tier 10, Bryva 15 at 6,
Saburo 5 at 1, each identical to their sheet. It also **drains by default** — it is a
pool you draw down over an adventuring day, so it starts full and `−` spends from it.
It is still renameable and restyleable like anything else; only deletion is blocked.
(A sheet whose number disagreed with the rule would keep its own value rather than be
"corrected".)

That default is a seed, not a lock: switch Fill back to *fills up as it is spent* and
the choice is saved as an explicit "no style" against the seed, so it survives a
reload instead of being re-defaulted. **Reset** restores the drain along with
everything else from the sheet.

### The note

Every tracker has a **note** — prose under the pips that may carry `{…}` formulas, and
those formulas read the tracker itself through `self`. It is for a resource that *does*
something as it fills, rather than merely running out: a kineticist's burn is nonlethal
damage and a damage bonus at once, and the note is where those numbers live.

```
Nonlethal {= self.current * level}. Overflow +{= floor(self.current / 3)}.
{= self.remaining} left — {= self.zone}.
```

reads *"Nonlethal 60. Overflow +1. 0 left — overheating."* at 3 burn on a level 20
character, and every number moves the instant a pip is clicked. The note is edited in the
✎ editor (Enter is a newline there, not Save) and shown resolved on the row.

A note is a readout, not a definition site: a `{name = …}` written in one displays its
value but is **not** published to the rest of the character, because the note is
evaluated after the trackers it reads. Put character-wide names in a class feature or a
note on Lore & Notes instead. Every token in a tracker note appears in the GM's Formula
Audit with what it reads and what it currently evaluates to.

**Two-sided meters.** A tracker can also carry a **min** formula (0 when left blank).
Give it a negative min and it becomes a meter that swings below zero — Angou's
Hellfire Qi fuses Qi and Burn into one resource with a minimum and maximum of
±⌊(max Burn + max Qi)/4⌋:

```
max:  floor((burn.max + qi.max) / 4)
min: -floor((burn.max + qi.max) / 4)
```

Its pips run from −7 to +7 either side of a zero mark, the negative side fills in
red and the value turns red while negative, the range reads `/ ±7` (or `/ −3…+10`
for a lopsided one), `+`/`−` and the pips clamp to the range on both ends, clicking
the zero mark resets it, and Rest returns it to 0. Both formulas are audited, and
`tracker.<id>.min` joins `.current` / `.max` / `.remaining` in the formula scope.
Custom trackers can be edited in place (✎) — name, max, min and refresh — so an
existing pool can be given a min without being re-created.

### Appearance

Every tracker (sheet-seeded ones too) has a **Style** section in its ✎ editor, with a
live preview. It is stored as data on the tracker (`style`), so it exports, persists,
and audits like everything else:

| Setting | Options |
|---|---|
| Shape | **Pips** (one per step, up to 40) or a **bar** — a continuous track that scales to any pool, so Spell Points 83 gets a visual too. Click anywhere on a bar to set it. |
| Fill | **Fills up as it is spent** (pips light as you use them — the sheet's Uses / Total) or **drains** — the tracker shows what is *left*: it starts full, `−` spends, and the number, pips and bar all read remaining. Two-sided meters always show their position. |
| Colour | Any `#rrggbb`, with 16 suggested swatches (gold, orange, red, crimson, pink, magenta, violet, indigo, blue, cyan, teal, green, lime, yellow, bronze, slate), a native colour picker, or the theme accent. Two-sided meters colour each side separately. |
| Fade to | A second colour makes a gradient across the range — pips are interpolated step by step, bars carry a real gradient sized to the whole track, so the leading edge shows the colour for the value it sits at (green when fresh, red when spent). |
| Zones | Highlight a value or range in its own colour, with an optional label: **from** and **to** are formulas (`tracker.burn.max - 2` … `tracker.burn.max`), so a danger zone moves with the character. Lit pips and bar segments inside a zone take its colour; unlit pips and the rest of the bar keep a faint tint so the range is visible when empty. Later zones win, so a single-value highlight can sit on a broad band. A **labelled** zone doubles as a state readout: while the tracker's value sits in it, its name shows as a badge on the row. |

Zones as states — Bryva's Satiety, on the sheet's own Culinary Stamina tracker
(bar, drains, so the value shown is what she has left):

```
Hungry   from 0                                              to floor(tracker.culinary_stamina.max * 0.3)
Sated    from floor(tracker.culinary_stamina.max * 0.3) + 1  to floor(tracker.culinary_stamina.max * 0.7)
Stuffed  from floor(tracker.culinary_stamina.max * 0.7) + 1  to tracker.culinary_stamina.max
```

At 15 of 17 the row reads **15 / 17 · Stuffed**, the bar shows all three bands, and the
badge flips to Sated at 11 and Hungry at 5 — the sheet's hand-kept "Stuffed (88%)"
row becomes unnecessary. Zone bounds resolve after every tracker's range is computed,
so a zone may refer to its own tracker's max and is right on the first evaluation.

The stored value is always what has been *spent* (or a two-sided meter's position);
the drain toggle only changes what the row shows and edits, so `tracker.<id>.current`
never changes meaning — read `tracker.<id>.remaining` for what is left. Bryva's
imported "uses 15" therefore shows as 15 in filling mode and 2 left in draining mode;
type the real value once and it sticks.

Colours are validated to plain hex before they touch a style attribute — a player
types colours, never CSS. Zone bounds appear in the GM's Formula Audit as
`Tracker zone 1 (label) from / to`; a bound that fails to evaluate is flagged on the
tracker and that zone matches nothing. `app/js/tracker-style.js` holds the palette,
the colour rules and the bar geometry as pure functions, covered by
`tests/tracker-style.test.mjs`.

#### The built-in meters take the same style

**Hit points**, **Essence** and the psionic **Power points** pool are not trackers —
their numbers come from the sheet rather than from a pool you top up — but they are the
same picture, so they get the same editor. The **✎ Style** button beside any of them
opens the controls above: shape, fill, colour, gradient and zones, with the same live
preview. A meter starts as a bar rather than as pips (a hundred and eighty hit points is
not a row of pips), and a shape that would need more than 40 steps to draw stays a bar
and says so. The power point pool starts *drained* rather than filling, because that is
how the sheet reads it — "23 of 40 left" — and it stays click-to-set whichever shape it
is wearing: click along the bar, or click the pip you want to be left with.

What a meter adds is **layers**: a stretch of the track that was borrowed rather than
granted — temporary hit points, essence condensed from spell points — and a stretch
that is filled but spoken for, which is nonlethal damage. Layers are value ranges, not
pixels, so they survive a change of shape: on a bar the borrowed stretch is a hatched
band past the maximum, and in pips it is the last few pips drawn as outlines. Choose
pips for essence and Angou's four condensed points are the four hollow pips on the end.

Only what differs from that default is stored (`meterStyles.hp`, `meterStyles.essence`,
`meterStyles.pp`), so a sheet nobody has restyled saves nothing at all, and **Reset to
default** in the editor puts a meter back.

### Formula language

Operators `+ - * / % ^`, comparisons `< > <= >= == !=` (a bare `=` is accepted as
equality, out of spreadsheet habit), `&& || ?:`, and parentheses.

Functions: `floor` `ceil` `round` `trunc` `abs` `sign` `min` `max` `sum` `clamp`
`if` `and` `or` `not` `mod` `iterations`.

`floor(n, step)` rounds down to a multiple, matching the sheet's `Floor(x, 1)` idiom.
`mod(score)` is the ability-modifier rule. `iterations(bab)` counts iterative attacks.

Readable values include `level`, `bab`, `hp.total`, `mythic.tier`, `initiative`,
`str.score` / `str.mod` / `str.temp` / `str.tempMod` (and the other five abilities),
`saves.*`, `ac.*`, `attack.*`, `skill.<name>`, and every tracker (below). The Trackers
tab lists every available name.

### Calling a tracker's numbers

Every tracker publishes six numbers under its **id**:

| Name | Meaning |
|---|---|
| `tracker.<id>.current` | what is stored — spent for a filling pool, position for a two-sided meter |
| `tracker.<id>.max` / `.min` | the ends of the track |
| `tracker.<id>.remaining` | `max − current` |
| `tracker.<id>.spent` | `current − min`, which for the usual min of 0 is `current` |
| `tracker.<id>.pct` | position on the track, 0–100 — "how full" |

The id is slugged from the name the tracker was **created** with (`Hellfire Qi` →
`hellfire_qi`) and is deliberately fixed: renaming a tracker never breaks a formula
pointing at it. Because that means the id can drift from the label, the ✎ editor spells
out the tracker's own names, and the Trackers tab lists them all.

Inside a tracker's own note and zone bounds there is a shorter way: **`self`** is that
tracker, with the same six numbers plus `self.zone` — the label of the zone the value is
currently sitting in. So a zone reads `floor(self.max * 0.3)` rather than naming its own
tracker, and a symmetric meter's min is just `-self.max`. `self` exists only inside the
tracker it belongs to; a max formula cannot use it (it would be defining itself), and no
other field on the character can see it.

### Why this is safe to let players write

The engine **never uses `eval` or the `Function` constructor**. Formula text is
tokenised, parsed into an AST, and walked by an interpreter that can only reach the
values it was handed. Specifically:

- Property lookup follows **own data properties only** — `constructor`, `__proto__`,
  `prototype` and inherited members resolve to nothing, so a formula cannot climb out
  to host objects.
- No I/O, no network, no DOM, no access to other characters.
- Source length, node count and recursion depth are all capped, so a formula cannot
  hang the page.
- Division by zero, unknown names and bad arity are reported as ordinary errors.

These properties are covered by tests in `tests/formula.test.mjs`, including explicit
sandbox-escape attempts.

### GM / inspector view

Because formulas are stored as text, they stay auditable. The **Formula Audit** tab
(shown when `role="admin"`) lists, for every formula on the character:

- the exact source text the player wrote
- every value it reads and every function it calls
- what it currently evaluates to
- whether it is valid, and why not if it isn't

The same data is available programmatically via `sheet.audit()`, which returns plain
objects — so a campaign site or an approval script can check submitted characters
server-side without running any player-supplied code.

---

## Embedding in an existing site

```html
<script type="module" src="/app/js/sheet-element.js"></script>

<character-sheet
  src="/characters/your-character.json"
  role="player"
  theme="light"
  storage-key="campaign:your-character"
  snapshot-every="20"></character-sheet>
```

| Attribute | Purpose |
|---|---|
| `src` | URL of a character JSON document |
| `role` | `player` (default) or `admin` — admin reveals the Formula Audit tab |
| `theme` | `dark` (default) or `light` |
| `storage-key` | localStorage key for edits; omit for the per-character default |
| `snapshot-every` | changes between automatic snapshots (default 20) |

**Properties / methods:** `.character` (get or set a document directly, no fetch),
`.model`, `.toJSON()`, `.audit()`, `.resetToSource()`, `.whenReady()` (resolves once
stored state has been reconciled — setting `.character` starts an IndexedDB read, so the
model is not there on the next line), `.changeCount`.

**Events:** `character-change` (`detail: {character, diff}`) and `tracker-change`
(`detail: {tracker}`), both composed so they cross the shadow boundary.

A host page that saves server-side can ignore all of the local machinery and listen to
`character-change`. One that wants the saved-version and history behaviour gets it for
free; see [Saving, and going back](#saving-and-going-back) for what is stored where.

The component renders into a shadow root, so host CSS and sheet CSS cannot collide
in either direction. Theming is done with custom properties, which do pierce the
boundary:

```css
character-sheet { --cs-accent: #7b3f9d; --cs-radius: 14px; }
```

Available: `--cs-bg`, `--cs-panel`, `--cs-panel-2`, `--cs-line`, `--cs-text`,
`--cs-muted`, `--cs-accent`, `--cs-good`, `--cs-bad`, `--cs-edit`, `--cs-radius`,
`--cs-font`, `--cs-mono`, and `--cs-formula` / `--cs-formula-strong` (the edge that
marks a field as accepting formulas, at rest and on hover).

There is no build step and no runtime dependency — plain ES modules.

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
