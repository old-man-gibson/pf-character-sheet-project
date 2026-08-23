# Sub-systems: spheres, techniques, Akashic, Maneuvers, Vancian, Psionics, cards, cooking, companions

_Part of the [Pathfinder Character Sheet Program](../README.md) docs. The modelled sub-systems, each read once off its worksheet: Martial and Magic Spheres training, Primordia techniques (the panel, and the Technique List / AutoTechnique tabs), Akashic, Maneuvers and Vancian, Card casting, Auto-Cooking, and the three companions._

---

## Martial and Magic Spheres (training)

Two tabs, one subsystem: **Martial Spheres** holds the practitioner side — its classes,
tradition, customized weapons, unarmed damage and the skill ranks talents grant — and
**Magic Spheres** holds the casting side, its tradition and the casting numbers. Most
characters play only one of them, and the pair that trains both ways sits at the head
of both (see *Blended classes* below). They are structured panels reproducing the
workbook's own Combat/Magic Training formulas (extracted from the `DUMMYFUNCTION`
strings in the export and verified against every cached value):

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
checkbox on its class head. The **Blended training** group heads *both* sphere tabs
and is the same group on either — one set of rows, shown twice, so it can be read and
edited from whichever side you are working on.

**Customized weapons** — talents that arrive on several tracks at once, with one of them
live. Every other talent source here is a list that grows and they all add up; the
armiger's is not. She customizes three weapons, each of which learns its own talents, and
*may only benefit from the talents granted by one customized weapon at a time*. So it is
`sets` lists that each grow, and a switch saying which is in hand.

Two counting rules describe the whole thing, and they are in the panel head where the
class table's words were:

| | starts at | goes up at | reads |
|---|---|---|---|
| **Weapons** | 3 | `11, 19` | 3 weapons, a fourth at 11th, a fifth at 19th |
| **Talents each** | 1 | `3, +4` | one each, another at 3rd and every 4 levels after |

A third setting says **which spheres it may teach at all**: martial, magical, or both. A
customized weapon teaches its wielder to fight with it, so martial is the default and the
armiger's own is exactly that; the archetype that lets those weapons carry magic says so in
its own block (`"tracks": {"spheres": "both"}`), because that is a fact about the archetype
rather than about talent tracks in general. Nothing in the engine knows either name.

`gainsAt` is an ordinary level rule (the same syntax the Progression tab's feature columns
use), so `3, +4` is 3rd and every fourth level thereafter and the count at any level is the
start plus every step reached. Those two lines reproduce the armiger's table column for
column, 1st to 20th, and nothing about weapons is written into the engine: a class block in
a pack states them under `tracks` (see [Extensions](extensions.md)) and attaching copies
them onto the character, or they are typed straight into the head.

The weapons are laid out across rather than down, because choosing between them is the
whole point and because it is how the workbooks wrote it — two columns of a spare tab
headed *Weapon*. Each card takes a name, its talents with their spheres (from whichever
lists the track may teach), and a drawback. **Drawn / Stowed** is a radio, one per track.

Three different questions get asked of an armiger's spheres, and they get three different
answers:

- **What is live** — the class ladders, the bonus talents, the tradition, and whichever
  weapon is drawn. Drives the Sphere BAB/DC tables and the sphere badges, and changes the
  moment another weapon comes out.
- **What she owns in her own right** — the same, with no weapon at all. This is what a
  prerequisite reads and what the bonus skill ranks pay out on, because a customized weapon
  grants no skill retraining and its talents may not qualify for feats.
- **Everything the tracks have granted** — every weapon, drawn or stowed. Unarmed damage
  reads this one: a die progression is a constant, and the armiger "does not suddenly lose
  lingering benefits of these talents because they sheathed their knife and drew their
  sword".

**A sphere off the list is marked, not dropped.** Widening or narrowing the setting is one
dropdown, and a row already holding a sphere the track may no longer teach keeps it, marked
in the sheet's gold with the reason on it — it is nearly always an archetype nobody has
added yet, and throwing the row away would punish the player for the order they did things
in. Two different marks for two different questions: gold for a setting not made, red for a
rule broken.

**A talent needs its sphere's base**, on the same weapon or on the character. A row whose
sphere has neither is underlined in red and says why — the one rule that actually bites in
play. It is three-valued like every other requirement here: a row with nothing written in
it yet is unknown, not wrong, and is left alone.

**A drawback opens one more row on that weapon**, which is what a drawback on a
weapon-granted sphere is for; the tick beside it buys it off and spends the row again.

Rows are opened and folded shut, never emptied. Drop the level and the fifth row on every
weapon greys out with what was written still on it; a row or a weapon that closed with
nothing in it was never anything, and goes. The switch always lands on a weapon that
exists, and stays where it is whenever it can — opening a fourth weapon never changes what
is drawn.

> A workbook with nowhere to put this put it where it could: Bryva's has an *Armiger
> customization* block among her **casting** classes — no casting type, no talent rate, not
> one talent on its rows — and the weapons themselves on a spare corner of the Item
> Crafting tab. Read as written it is a caster who never cast anything, and it turned up in
> every list of her classes. An entirely empty training block whose name ends in
> *customization* is now read as what it is: the block goes and the class it names gets a
> track, waiting for its two rules.

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
Concentration carries a **d20** that copies the check for Roll20, as does each
prepared-casting class's own on the Vancian tab (see
[Rolling it at the table](using-the-sheet.md#rolling-it-at-the-table)).
Where a character's own workbook cached a different number (Nico/Narockro/Saburo's
sheets contain `#ERROR!`s and internally inconsistent caches), the app shows a red
"sheet: N" hint beside the computed value.

**Sphere BAB/CL/DC tables** per sphere with rank/DC bonus fields — Alchemy keys off
Craft (alchemy) ranks and Beastmastery off Handle Animal/Ride, like the sheet.

**Bonus skill ranks**: 5 ranks per talent in the associated sphere, capped at level,
toggleable per row, flowing straight into the Skills tab's Spheres column. Light Body
sets the Athletics-linked skills to full level, as the sheet does.

Each row says what it wants, and only pays out when the character has it — the sphere
itself for a *Base* row, the named package or talent for the rest:

| Skill | Sphere or talent |
|---|---|
| Acrobatics | Athletics (Leap package), Athletics (Run package) |
| Bluff | Fencing (Base) |
| Climb | Athletics (Climb package) |
| Craft (any) | Equipment (Craftsman talent) |
| Craft (alchemy) | Alchemy (Base) |
| Craft (mechanical) | Tech (Base) |
| Craft (traps) | Trap (Base) |
| Diplomacy | Leadership (Base), Warleader (Base) |
| Fly | Athletics (Fly package) |
| Handle Animal | Beastmastery (Handle Animal package) |
| Intimidate | Gladiator (Base) |
| Perception | Scout (Great Senses talent) |
| Ride | Beastmastery (Ride package) |
| Sense Motive | Fencing (Read Foe talent) |
| Sleight of Hand | Scoundrel (Base) |
| Stealth | Scout (Base) |
| Swim | Athletics (Swim package) |

Two sources are an either/or: Diplomacy comes from Leadership *or* Warleader.

Talents are read from everywhere they come from — the class ladders, the bonus
talents, the tradition, and the **Primordia technique**, which names most of what it
grants: Light Body's Wall Stunt at 3rd and Air Stunt at 5th are the rules' choice, not
the player's, so they count as named without anyone typing them. Names are matched
loosely, because they are written with their choices attached: *"Guardian Sphere
(Challenge package -4/+2)"* carries "Challenge" the same as a bare "Challenge" does.

The check is three-valued, because a talent the sheet cannot see is not the same as
one the character does not have:

- **met** — the talent is there. A row is also met when an unmade choice can only
  land on talents it accepts: Light Body's 1st level is *the Athletics sphere, taking
  (leap) or (run)*, and Acrobatics takes either, so it is satisfied whichever way that
  choice went — before anyone writes it down.
- **unmet** — the sphere is not there at all, or every talent in it is accounted for
  and the one asked for is not among them. The row does not appear.
- **unknown** — the sphere is there and still holds talents nobody has named, which is
  usually a technique's own picks from 7th level. The requirement is drawn with a
  dotted underline and the tick beside the row decides, which is what that column has
  always been. Naming those picks on the **Primordia** tab settles the row one way or
  the other: give Light Body's 7th-level pick the Swim package and Swim answers for
  itself; fill in every pick without one and Climb turns from *unknown* to a plain no.

Only the rows a character can reach are listed: the block is seventeen skills and a
character has two or three, and a row that can only ever read zero is not information.
A character with no such talent at all gets a sentence saying so instead of a table of
noughts.

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

---

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
table, spherecasting off the Magic Spheres types (Advanced Magic Training's mythic
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

---

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
the caster's own pool: **Magic Spheres** keeps *Total SP* as the character's total
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

The maneuvers themselves come from the Path of War disciplines extension pack
(`data/extensions/path-of-war-disciplines.json`, see [Extensions](extensions.md)), built by
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

---

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
| deck manipulations by group, with a count and the note beside each pick; the number available (blank = automatic, or a number or formula) | one manipulation per **deck feat** (any feat or bought-off drawback tagged `[Deck]`) plus one for Card Shark — Nico's 10 + 1 = 11; each pick's rule text and prerequisites (Cooldown, Mana Pool, Colored Mana, Singleton…) from the catalogue in the deck-manipulations extension pack, read off the wiki's [Card and Deck Feats](http://spheresofpower.wikidot.com/card-and-deck-feats) page; taken vs. left |
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

---

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

---

## Auto-Cooking — the iron chef's dish

Bryva's *Iron Chef Dish Maker*, for anyone at the table: two entrees, three flavors,
two side dishes, an aroma and a garnish, each granting the diners an effect whose
numbers scale with the chef's level, and some strengthening each other — a Red Meat
entree adds to the Strength that Apples grant, Rice counts the recipe as three levels
higher, a Sweet flavor sharpens Ginger. Duration is ⌊level ÷ 3⌋ + 1 hours.

The ingredient list and every effect's formula are shared rules, not character data,
so they live in the Iron Chef extension pack (`data/extensions/iron-chef-ingredients.json`) — each effect a template whose `{expr}` holes are
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

---

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

A companion acts on its own initiative, so it rolls on its own sheet: **d20** buttons
sit on the Init tile, on each save total, on each ability's Mod, on every skill and on
every natural attack, and what they copy is titled *Angou's Hoot — Bite* rather than
Angou. The master's conditions stay the master's. The damage column here is free text,
so `1d6+7` is rolled and `1d6 plus grab` is carried along as a note instead of being
truncated to the dice — see
[Rolling it at the table](using-the-sheet.md#rolling-it-at-the-table).

Where the worksheet's formulas and its own tables disagreed, the tabs follow the
tables: the animal companion's and eidolon's BAB, saves, skill ranks and Str/Dex bonus
are looked up by **level** (the sheet's cells keyed the level table by HD, which
gave a 1st-level companion the 2nd-level row); the animal companion's touch AC leaves
natural armour out; the eidolon's total attack keeps its size modifier. Only what is
typed is saved; every total is recomputed on load, and `tests/model.test.mjs`
checks the table rows, the familiar's halving, and the round trip.
