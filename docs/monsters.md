# Monsters and the Stat Block tab

_Part of the [Pathfinder Character Sheet Program](../README.md) docs. The GM's side of the sheet: a creature pasted off a page as a sheet of its own, and any sheet printed as a Bestiary would print it._

A monster is not a second kind of document. It is an ordinary character document — the
six scores on the Stats tab, the AC columns, weapon rows, a class row for its hit dice,
feats, skills, race traits — with one section more, `monster`, holding the lines a
Bestiary entry has and a character sheet does not: CR and XP, senses and aura, the
spell-like abilities, space and reach, the ecology, the description. Everything the
sheet already knows how to do — recalculation, conditions, buffs, the d20 buttons, the
formula language, trackers, history, publishing — it does for a monster unchanged, and
every sub-system tab can be switched on for one.

---

## Reading a stat block in

Tick **GM / inspector view** in the header and the picker grows a **+ Monster** button
(the welcome page gets one too). Paste a creature's stat block into the box — Archives of
Nethys, d20pfsrd, a PDF, from its *Name CR n* line down through the description — and the
line under the box says what the reader makes of it as you type: *CR 30 · 35 HD · AC 48 ·
717 hp · 2 attacks · 18 feats · 18 skills · 7 special abilities*, and how many lines it
could not place. **Create** puts the creature in the picker tagged *monster*, showing its
CR where a character shows a level, saved in this browser exactly like an import.

What the reader takes, and where it goes:

| Block line | Where it lands |
|---|---|
| *Name CR n*, XP, Source | the name; `monster.cr`, `.xp`, `.source` |
| *LE Large outsider (devil, …)* | alignment, size and race on the Overview; type and subtypes on the block |
| Init, Senses, Perception, Aura | initiative (its offset absorbs Improved Initiative); `monster.senses`, `.aura` |
| AC n, touch n, flat-footed n (+4 deflection, +10 Dex, +8 natural, –1 size …) | the typed **AC bonus columns** on the Stats tab — deflection, dodge, natural, insight, luck, sacred, profane, circumstance; *armor* and *shield* become worn pieces on Equipment; Dex and size are worked out, not copied |
| hp n (35d10+525); regeneration … | hit points, with Con behind them; the hit dice become a **class row** (*Outsider*, d10, ranks per HD by type); `monster.healing` |
| Fort, Ref, Will; +8 vs. … | each save's total, and the class row's good-save flags chosen to explain it; the note on the block |
| Defensive Abilities; DR; Immune; Resist; SR; Weaknesses | `monster.defensiveAbilities`; the five **defence boxes** on the Overview, which parse as they always have (`dr.good`, `resistance.acid`, `immune.cold` are readable and forwardable) |
| Speed | the movement rows; a fly speed keeps its manoeuvrability in its type (*Fly (perfect)*) |
| Melee, Ranged | one **weapon row** per attack. *2 slams +47 (8d6+13)* is a row named Slam with a count of 2; *+5 … longsword +53/+48/+43/+38 (2d6+24/17–20 plus 1d6 cold)* is a row with enhancement 5, a crit range of 4, four iteratives, and the rider written as `[[1d6]] cold` in its properties so it rides the roll. The *or* groups are kept, so the block prints them back as written |
| Space, Reach, Special Attacks | the block |
| Spell-Like Abilities (CL …), Spells Known/Prepared (CL …) | the block, as the lines were pasted, footnotes included; they are prose, so `{…}` works in them |
| Str … Cha | the scores, as 10 plus a racial adjustment on the Stats tab; a dash is a **nonability** and the block says so |
| Base Atk; CMB; CMD (note) | BAB (pinned as an override where no progression reaches it); CMB and CMD totals; the notes on the block |
| Feats | one feat group, *Feats*, with parentheticals in the detail column |
| Skills; Racial Modifiers | ranks on the standard rows — as many as explain the number, never more than the hit dice, as a class skill; *Knowledge (arcana, history)* fans out to its rows; an unlisted skill shows its ability modifier alone. Racial modifiers stay on the block |
| Languages; telepathy … | the language list; the part after the semicolon on the block |
| SQ, Gear, Environment, Organization, Treasure, Tactics | the block |
| Special Abilities | the **race-trait rows** on the Overview, one per ability with its (Ex/Su/Sp) kept in the name — because that is what they are, and because those rows are prose: a DC written as `{= 10 + con.mod + floor(level / 2)}` follows the score |
| Description | the block |

Anything else is **kept, not dropped**: a line the reader could not place waits in a
*Not read* list on the Stat Block tab, to be copied into the field it belongs in and
removed, or left there with the creature.

### The block's numbers win

The sheet computes AC from its columns, saves from the class row, attacks from BAB and
Strength, skills from ranks — and a Bestiary's numbers do not always add up to its parts.
So a monster document goes through exactly the **reconciliation** an imported workbook
does (see [Importing & saving](importing-and-saving.md#reconciliation--why-the-numbers-match)):
every total the block states is what the sheet shows, and whatever the visible parts do
not explain sits in that stat's offset, where the Stats tab's *Sheet* column and the
Formula Audit can see it. Baalzebul's AC of 48 is explained to the point by his columns
(offset 0); his slams at +47 carry a −2 offset for being secondary attacks; his hit
points carry the difference between rolled-average dice and the full dice the sheet
gives a character. Edit a score and every one of those numbers moves the way it would on
a character, offset and all — `tests/monster-import.test.mjs` checks that two points of
Strength take his sword from +53 (2d6+24) to +54 (2d6+26), and that a reload gives back
exactly what was saved.

Two things a character has that a monster does not: the **Automatic Bonus Progression**
ladder is off for a creature read off a page (its natural armour and saves are its own),
and hero points start at none. The ladder is a switch on the block's fields, for an NPC
built like a character who has it like anyone else.

---

## The Stat Block tab

A monster opens on it; its bar runs **Stat Block, Overview, Skills, Feats & Mythic,
Equipment, Trackers, Lore** plus every sub-system in use, in both views. The tab is the
creature as a Bestiary prints it — name and CR, XP, the alignment line, Defense, Offense,
Statistics, Ecology, Special Abilities, Description — with **every figure the model's own,
worked out now**. A condition ticked on the Overview or a buff on the dashboard replaces
the base value in place, red down and green up, base on the tooltip, the same read as
the session strip; hover a number for its working. The special abilities render their
`{…}` formulas.

Under the block:

- **From the sub-systems** — for every sub-system the creature uses, or a class row marks,
  the same card the session dashboard shows: spell slots and prepared castings with their
  pips, the psionic pool, the Spheres casting numbers and talents, veils shaped, readied
  maneuvers. They spend from the one pool the tab holds. This is how a monster is *given*
  a sub-system: switch its tab on in the ⚙ manager (or mark the system on the class row's
  *Systems* toggles on the Overview), fill the tab in as you would for a character, and the
  block carries it from then on.
- **Monster fields** — the block's own lines, to edit: CR, XP, source, type and subtypes,
  hit die, space and reach, the notes, and the prose fields (senses, aura, regeneration,
  defensive abilities, special attacks, spell-like abilities, spells, racial modifiers, SQ,
  gear, tactics, description). The rest of the block reads from its own tabs, and the
  hint says which.
- **Not read** — the leftover lines, if any.

### Any sheet as a stat block

The tab is not only a monster's. Under `role="admin"` the rail's **⋯** menu carries
**Stat block**, which opens the tab on any character — the NPC view — as a guest on the
bar the way a search result does. A character prints with its level in the CR's place,
its classes on the alignment line, and its race traits under *Race traits*; the lines a
character has no field for are simply left off. **Give this character a monster block**
puts the fields on it (CR, senses, ecology…) with the progression ladder left on, because
the character had it; **Remove the block** takes them off again and touches nothing else.

---

## What is not read yet

- **Class levels on an NPC block** (*Female human rogue 3*): the line is kept on the block
  as `classLine`, but the classes are not put on the class table — the hit dice row is the
  one built. An NPC's own classes want typing on the Overview for now.
- **Spells** are kept as the lines they were pasted, not read into the Vancian tab. A
  caster monster the GM wants slots for is a Vancian tab switched on and filled in by hand.
- **Gear** is a line on the block, not rows on Equipment (armor and shield from the AC
  parenthetical are the exception).
- **Racial skill modifiers** stay as text; the rows reconcile the number, so nothing is
  lost, but the *+4 racial* is not a column.

The reader itself is `app/js/monster/import.js` — pure, text in and document out — and
`tests/monster-import.test.mjs` is the place a block that comes through wrong should be
added to.

## Where it lives, and what it touches

The whole tool sits in `app/js/monster/` — the reader, the block's shape, the tab, and
two hook modules — so the main sheet can change around it. What the shared files carry
is deliberately one line each, every one delegating to `monster/`: the element imports
`monster/sheet.js` for its tab entry, panel case, ⋯ menu button, header line and two
actions; the picker page mounts `monster/picker.js` with one call, which writes its own
dialog and places its own button; `buildDefaultTabs` and `sessionDefaultTabs` lead with
the block for a monster; the defence resolver zeroes the ABP ladder for one; the overview
exports the dashboard cards the tab borrows. The tab's styles ride in its own markup, and
its render sweep lives in the monster suite rather than the panel sweep. Nothing else on
the sheet is edited, and a character document gains no field.
