# Equipment, item crafting, mythic, progression, templates

_Part of the [Pathfinder Character Sheet Program](../README.md) docs. The gear list and what it feeds, the Item Crafting calculator, mythic tiers and paths, the Progression tab (column rule groups, schedules, owed slots), and templates._

---

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
  `{{2}}`, `{{1d4}}`). A `{name}` you defined in prose works inside one too
  (`[[{deathgrip.dmg} Mult]]`, `{{ {deathgrip.dmg} }}`, `[[2d6 + {bonus}]]`), as does
  the Bonus Crit Damage column, the Misc dmg column and the Dice field: the name's
  **value is put into the text** before it is read, so a name holding dice text
  (`{kinetic.fist}` → `4d8`) arrives as dice and a name holding a number arrives as a
  number. A name that does not resolve is reported on the row and contributes nothing.

  **When it applies, and whether it multiplies.** Two keywords, which between them
  cover every way an ability is written. This is the part worth knowing, because the
  wrong one is silently wrong rather than visibly broken:

  | written | every hit | on a confirmed crit | for |
  |---|---|---|---|
  | `[[6]]` | yes | added **once**, unmultiplied | the usual rider — flaming, sneak attack, anything the rules say is not multiplied |
  | `[[6 Crit]]` | no | added and **multiplied** | damage that only happens on a crit |
  | `[[6 Mult]]` | yes | **multiplied** with the weapon | damage with no "not multiplied" caveat on it, which behaves like the weapon's own |
  | `{{4}}` | yes | also on the confirmation roll | an attack bonus |
  | `{{4 Crit}}` | no | confirmation roll only | a bonus to confirm, only |

  A player **never writes the same thing twice** — untagged already covers both the
  normal roll and the crit, and `Crit` means *only* on a crit rather than *also* on one.
  `Mult` is a damage keyword; attack rolls are not multiplied, so it does nothing on a
  `{{…}}`. The **Misc dmg** column is the same rule as `[[… Mult]]` — flat damage that
  multiplies — and it takes a formula (`floor(level / 4) + 1`) as well as a number, so
  an ability written as a rule does not go stale. The **Bonus Crit Damage** column is
  crit-only and unmultiplied (burst dice).

  The card shows the full working, and every term of the crit line is printed in the
  order it is worked out, so the string adds up to the average beside it:

  ```
  atk +40 · dmg 12d8+26        avg 80
  {{…}} +2 to hit · [[…]] 2d6+13 damage, added once on a crit
  atk +42 · dmg 12d8+2d6+39    avg 100    crit (12d8+26)×4+2d6+13   avg 340
  ```

  Dice combine properly across sizes (12d8+2d6+…), averages use X×(Y+1)/2 per term,
  bad tokens are flagged on the card and excluded from totals, and every token
  appears in the GM's Formula Audit.

  Average crit = (base + `Mult` tokens) × mult + riders + `Crit` tokens × mult +
  burst, which is exactly what the crit line prints, term by term:
  `crit (12d8+26)×4+2d6+2d8×4 confirm +44 · avg 363`. A base of more than one part
  is bracketed so the × cannot look as though it binds to the last bit of it. Every
  weapon shows its crit average beside the normal one, even without tokens.

  The **d20** on a weapon's head copies the whole attack for Roll20 — every
  iterative, the damage, the confirmation roll and the critical damage, with the
  threat range as `cs>` on the die so it is highlighted rather than spotted. The
  four pools divide there exactly as they do above: base and `Mult` multiplied,
  riders once, `Crit` multiplied, burst once — so the copied `48d8+104` is the
  same arithmetic as the printed average. See
  [Rolling it at the table](using-the-sheet.md#rolling-it-at-the-table).
- **Armor & shields** — worn pieces (the "On" checkbox) feed AC, cap the AC stat at
  the lowest Max Dex — the sheet's `MIN(MaxDex, stat)` rule, which is why Bryva's
  Str-based AC doesn't move with Str while her breastplate is on — and apply their
  armor check penalty to flagged skills. Multiple shields supported (Bryva's Cutting
  Board and Wok); extra ones start stowed.
- **Slotted gear** — the 14 body slots with three typed bonuses (value + type) and
  four freeform ones each, plus an **Other items** list.
- **Load & value** — weights per section, a reconciling adjustment, total carried
  against light load, and total value. Item weights flow into carry live.

---

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

---

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

---

## Progression

A structured plan, not a cell dump: a **static level list 1–20** with a class-track
dropdown per track (choices come from the Overview's class table; "+ Class track"
adds a third for tristalt and beyond, and each track has a × to delete it), and
read-only **HP, ranks, Fort/Ref/Will per level** computed gestalt-style from the
classes chosen on that row (good ½, poor ⅓).

A track that runs one class the whole way is twenty identical dropdowns, so each
track header carries **Fill column…**: pick a class and it goes on every level of
that track at once. Individual rows can then be changed as usual.

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

---

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
