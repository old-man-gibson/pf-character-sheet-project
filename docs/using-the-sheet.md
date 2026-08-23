# Using the sheet: Overview, wealth, hit points, stats, skills

_Part of the [Pathfinder Character Sheet Program](../README.md) docs. How the sheet is edited and what its core tabs compute — the Overview and its panels, the d20 buttons that copy a roll for Roll20, the wallet, hit points, the Stats tab (point buy, enhancement cap, save and AC bonuses, progression picks, attunement), classes and traits, granted feats, skills, character colour, the Ctrl+K search palette, and the tab bar._

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
- A **d20 button** beside every ability, saving throw, attack, skill and weapon copies
  that roll in a form Roll20 will roll. See *Rolling it at the table* below.

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
- *Feats & Mythic* — two columns. On the left, one **Feats** panel holding the granted
  feats (drawback, specialty, oaths, attunement) and then every group after the first,
  each a section of it; on the right, the **first group** — the level-up list — standing
  on its own, because it is the one that fills up. Groups can be added, renamed and
  deleted. A feat is reordered by dragging it by the grip at the left of its row — up
  and down its own group, or onto another group to move it there — and deleted with the
  × at the right.
  Also: classes with hit die, saves and skill ranks; mythic path, tier and abilities.
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

Rows can be reordered with ↑ / ↓ and removed with × — except a feat, which is dragged
by its grip instead. Every change is saved as you make
it, and **Save** marks the version the sheet opens on — see
[Saving, and going back](importing-and-saving.md#saving-and-going-back). **Reset** returns the character to the
converted sheet, **Export JSON** downloads the current state and **Import JSON** brings
one back (see [Getting characters in](importing-and-saving.md#getting-characters-in)).

> Editing a value that nothing else depends on — a note, a planner cell, a sphere talent
> — updates the model without re-rendering the panel. The largest grids run to several
> thousand inputs, and rebuilding those on every keystroke was plainly laggy (143 ms per
> edit, now 4 ms).

---

## Rolling it at the table

Every ability, saving throw, attack, skill and weapon carries a **d20 button**, and
pressing one puts that roll on the clipboard in a form Roll20 will roll. Nothing is
sent anywhere and nothing is stored: it is a copy, and where it goes is your business.

What comes out by default is Roll20's built-in **default roll template**, which every
game has whether or not it uses a character sheet:

```
&{template:default} {{name=Angou — Perception}} {{Skill check=[[1d20+41]]}}
```

The card that appears after a copy shows what was taken and carries a switch for the
other shape — a bare `/roll 1d20+41 Angou — Perception` — and remembers which you
chose. That is a fact about your Roll20 game rather than about the character, so it is
kept per browser rather than in the document, and it applies to every character in it.

| Where | What it copies |
|---|---|
| *Overview* → **At a glance** | **Init**, off the tile itself. |
| *Overview* → **Ability scores** | An ability check: `1d20` plus the temporary modifier, which is the column the button sits in. |
| *Overview* → **Saving throws** | The save's total. |
| *Overview* → **Attack** | Melee and Ranged copy the whole iterative sequence, one row per attack; CMB copies the maneuver alone. The mode table below them does the same for all six slots, **alternates included**. |
| *Skills* | The skill's **Total** — ranks, ability, the class-skill bonus, armour check penalty and Misc, already summed. |
| *Equipment* → **Weapons** | The attack (iteratives included), the damage, the confirmation roll and the critical damage. |
| *Magic Spheres* → **Casting numbers** | The global **concentration** check, with the caster level behind it. |
| *Vancian* → each casting class | That class's own concentration. |
| *Familiar*, *Animal Companion*, *Eidolon* | Initiative, the three saves, an ability check off the Mod column, every skill, and every natural attack. |

**What the roll knows that a typed number would not**

- **It is the roll you would make, not always the one printed.** Ticked conditions move
  these numbers, and a roll that moved says so in a **Conditions** row — *Shaken (−2)*.
  Every button's tooltip is its formula, so what is about to be copied is readable
  before it is copied rather than after it is pasted.
- **Iteratives step down from the attack in full**: a BAB of 20 landing at +34 copies as
  +34/+29/+24/+19, never +20/+15/+10/+5.
- **An alternate is the same attack with a different ability in the slot** — Dex for a
  finessed blade, Wis for a monk's fist — so it takes the same BAB, misc, size and
  import reconciliation, and only the modifier moves. It says which ability in its
  title (*Melee attack (Dex)*), because that is the whole difference between the two
  and the reason a character keeps both.
- **A companion rolls on its own sheet.** Its rolls are titled *Angou's Hoot — Bite*, and
  the master's conditions stay the master's: a shaken summoner does not make their
  eidolon shaken. The damage column on those tabs is free text, so a row reading
  `1d6+7` is rolled and one reading `1d6 plus grab` is carried as a note instead of
  being quietly truncated to the dice.
- **Nothing moves a concentration check.** Shaken and its kin are worded at attack rolls,
  saving throws, skill checks and ability checks; a concentration check is none of
  those, so the number is the number.
- **A threat range is `cs>` on the die.** A 15–20 weapon copies as `1d20cs>15+40`, so
  Roll20 colours the threat rather than leaving you to spot it in the total.
- **Criticals follow the rules, not the multiplier alone.** The weapon's own damage and
  any `[[… Crit]]` damage multiply; untagged `[[…]]` riders and the bonus crit damage
  column are added once. A ×4 unarmed strike doing `12d8+26` copies its critical as
  `48d8+104`.
- **A dice field that is partly a note comes along whole.** `4d6 (8d6)` rolls the 4d6
  and carries the field itself in a **Dice** row, rather than quietly handing over the
  smaller of two numbers.
- **Names are escaped.** A weapon called *Longsword [holy]* would otherwise open an
  inline roll and truncate the message it is pasted into, so the braces, brackets,
  pipes and ats that Roll20 resolves before printing become the entities it prints as
  themselves.

> If the clipboard is refused — a page served over plain `http://`, or an embed without
> permission — the card says so and hands you the text selected instead, which is the
> same thing one <kbd>Ctrl</kbd>+<kbd>C</kbd> later.

---

## Finding things: the search palette

<kbd>Ctrl</kbd>+<kbd>K</kbd> (<kbd>⌘</kbd>+<kbd>K</kbd> on a Mac) opens one box over the
sheet that searches the whole character. Type three letters, press <kbd>↵</kbd>, and you
are standing on the thing you were looking for. **/** opens it too when you are not
typing into a field, and the **🔍 Search** button in the header is there for the first
time, before the shortcut is muscle memory.

It exists because the tab bar stops scaling somewhere around the twentieth tab. Knowing
a feat is *somewhere* on Feats & Mythic is not knowing where it is, and "what is my
Disguise modifier" should not cost a tab switch and a scan down sixty rows.

**Often you never leave the box.** Every row carries the number beside it, so the
question is usually answered by the list itself:

```
Disguise            SKILL     Skills · Cha · 12 ranks · class skill      +27   ↵ Jump
Bardic Performance  TRACKER   Trackers · Daily                          3/14   ↵ Jump
Guitar Axe          WEAPON    Equipment · Melee · S · Instrument       +17 · 1d12  Roll ↵
```

**What it searches.** Everything the sheet models, each row saying which tab it came
from: the vitals (hit points, AC, CMD, initiative, BAB, the three saves, the six
abilities, speeds, carrying capacity, DR/SR/resistances) · skills · weapons, armour and
every worn or carried item · feats, traits, race traits, granted feats and mythic
abilities · classes and archetypes · spheres, talents and traditions · veils and their
chakras · maneuvers and disciplines · spells, powers, cards and techniques · trackers,
resources, buffs and the conditions that are on · every progression cell and class
feature · templates · notes, background and approvals · the companions with their
attacks, feats, evolutions and tricks · the cells the converter kept under *From the
source tab* · the tabs themselves · and the header's own buttons as commands.

| Key | What it does |
|---|---|
| <kbd>↑</kbd> <kbd>↓</kbd> | Move down the list (<kbd>PgUp</kbd>/<kbd>PgDn</kbd>, <kbd>Home</kbd>/<kbd>End</kbd> as well) |
| <kbd>↵</kbd> | Jump to it — or run it, on a command row |
| <kbd>Ctrl</kbd>+<kbd>↵</kbd> | Copy that row's roll for Roll20, the same as pressing its d20 |
| <kbd>Esc</kbd> | Close, leaving the sheet exactly where it was |
| `>` | Commands only — *`>rest`*, *`>export`* |
| `#` | Tabs only — *`#gear`* finds Equipment, whatever you have renamed it to |

**What a jump does.** It switches to the tab, opens the collapsed group the row hides
inside if it is in one, scrolls it to the middle of the screen, lights it up for a
couple of seconds, and puts the caret in the field itself — so the next keystroke edits
the thing you went looking for. If the row lives on a tab this view's bar does not carry
— most of the sheet is off the bar in the session view — that tab joins the bar as a
**dashed guest** for as long as you are on it, and leaves when you go elsewhere. Your
saved tab order is not touched.

**How it matches.** A whole word beats a prefix beats a word inside the title beats an
abbreviation, and the shortest title that matches wins the tie: `heal` finds the Heal
skill before *Healing Hand of the Faithful*. Abbreviations work — `blndf` finds
Blind-Fight — but only from three letters up, only where the letters start a word, and
only where they stay close together, because a fuzzy search that answers `ac` with four
hundred rows has answered nothing. Two words both have to match, anywhere on the row:
`iron crown` finds the veil.

Opened with an empty box it offers the vitals, the tabs and the commands, with whatever
you picked last on top. That last list is per session rather than saved: one browser
holds many characters, and a palette opening on somebody else's last five choices would
be worse than one opening on this character's own numbers.

Searching writes nothing to the character. Opening a collapsed group to land in it is
the one exception, and that is the same edit the group's own **▸** makes.

---

## The tab bar and the ⚙ manager

A sheet opens with nine tabs across the top — **Overview, Stats, Lore, Skills, Progression,
Feats & Mythic, Primordia, Trackers, Equipment** — and everything else waits in the
**⚙** manager at the end of the bar. That order is a preference, not a rule: drag a
tab along the bar (or a row in the manager's *Tab bar* list) to move it, **Hide** it
to send it back to the manager, or **reset** to the default nine. The bar is saved
with the character (`uiPrefs.tabOrder`), so it survives a reload and travels with an
export.

### Session view and build view

The header's **Build view / Session view** button switches between two arrangements
of the same sheet. The *build* view is everything above. The *session* view is what
comes up at the table: its bar starts from **Overview, Skills, Feats & Mythic,
Primordia, Trackers, Equipment, Lore** plus every sub-system that is *in use* or
*marked* on a class (below), and a standing strip under the character's name shows
the numbers a table asks for mid-fight — **HP, AC (touch/FF), the three saves and
how far you move**, with a ticked condition's adjusted values in place of the base
ones. The movement shown is the fastest rate the character actually has; the rest
are on its tooltip, since a strip with four of them in it is a table.

In the session view the **Overview is a dashboard** rather than the full page:

- **Conditions** — what is on the character as chips; × takes one off, and
  **+ Add condition** opens the catalogue as short shelves (Fear, Worn down, Held,
  Addled, Senses, Footing) where a click puts one on already ticked — Energy Drain
  climbs a level per click. Under the chips, a line of tags sums what the ticked
  conditions do per stat — *Attack −2 · CMD −2 · Skills −2 · Dex 14 → 10* (an
  ability score floors at 0) — conditions alone, so a buff's bonus never muddies
  the read; the rules they carry follow as a readable list. Across the dashboard a
  moved number **replaces** the base in place — red down, green up — with the base
  in its tooltip: attacks, weapon damage, skills, AC, saves and the strip all read
  the same way.
- **Buffs** — see below.
- **Resources** — every tracker as a compact row (its meter, − / + and the count),
  packed two or three across as the width allows, in the same order as the Trackers
  tab, which stays the canonical detailed view.
- **Offense** — melee/ranged/CMB/initiative with their d20 buttons; each weapon's
  line, whose d20 copies a **full attack** (every iterative, damage and crit); and a
  Full attack line that names which weapon's damage rides along — pick one from its
  dropdown when the character carries several. **Expand** brings the full Attack
  and Weapons panels up in place.
- **Defense** — AC (touch/FF) and CMD, then **Fortitude, Reflex and Will with their
  roll buttons**, all buff- and condition-adjusted; Expand brings the armour and
  save breakdowns up.
- **Movement** — every rate the character has, with the two multiples anyone reaches
  for mid-fight beside each: ×2 for a double move (as far as a charge reaches) and ×4
  for a run. Entangled or exhausted, the halved figure is what shows, with the base in
  its tooltip. A rate at zero is a row waiting to be filled in rather than a movement
  rate, so it is not listed.
- **Key skills** — the six best by bonus with their roll buttons; Expand lists every
  trained skill.
- **Active effects** — a reminder list (name, note, on/off) for what is running.
  Reminders move no numbers — a bonus with numbers behind it is a **buff**.
- **Quick actions** — an amount plus **Damage** (temporary HP absorb first),
  **Heal** (raises current to the max and erases nonlethal alike) and **Rest**
  (every tracker whose refresh reads as daily goes back to unspent).

Expand states persist with the character; the full Overview is one Build-view click
away.

**The dashboard is yours to compose.** Its cards are fixed building blocks, but which
show, and in what order, is the player's: **Arrange cards** (top right of the
dashboard) lists the shown cards with move/hide and everything else one click from
joining. Left automatic, the caster cards come and go with what the character
actually uses; the first change pins the arrangement (`uiPrefs.dashCards`), and
**Reset to automatic** hands it back. Beyond the standing cards there are:

- **Spells & slots** — a row per Vancian casting class with its slot pips
  (spontaneous and hybrid casters spend here), the prepared list with its squares,
  each class's concentration d20 and a **New day** button — the same pools the
  Vancian tab spends, seen from the table. Automatic once a casting class exists.
- **Power points** — the psionic pool's meter with − / + and **New day**. Automatic
  for manifesters.
- **Casting numbers** — the Spheres figures a round asks for: caster level,
  concentration with its d20, MSB/MSD, save DC, spell points, practitioner DC.
  Automatic with magic training.
- **Reference lists**, opt-in for whatever a playstyle keeps reaching for:
  **Veils shaped** (slot, essence, DC each), **Readied maneuvers** (by discipline,
  ticked on the Maneuvers tab), and **Talents** (every sphere talent as a one-line
  entry, full text on hover).

In Spells &amp; slots the prepared list packs into columns, and every row's
squares hang off the same left edge — the first use is always top-left, spending
rightward. A readied maneuver carries **what you wrote about it** on the Maneuvers
tab — click its name to read it, the ✎ to fill it in: type, action, range, target,
duration, saving throw, DC and a description, every one of them reading `{…}` like
any prose. *"Allies heal `{5 * floor(level / 2)}`"* shows the resolved number, and
keeps up with the level. The dashboard runs the header cells together as one line
(*Standard · Close (40 ft.) · One ally · Will DC 19*) with the description under it,
and leaves out whatever you never filled in.

### Buffs

Buffs live on the session dashboard and on the build Overview (under Conditions).
Collapsed, a buff is one line — tick, name, and what it comes to ("+4 Attack ·
+4 AC"); **Edit** opens it into a roomy editor with six full-width dials —
**Attack, Damage, AC, Saves, Skills, Init** — and a note. A ticked buff rides the
same machinery as a ticked condition, so every number it moves shows its *now*
value beside the base — green when it went up — on the strip, the dashboard, the
Overview and in the d20 copies.

Every dial takes a plain number **or a formula** in the same sandbox as the
trackers: a Citadel banner's `1 + essence.shoulder` to Attack and AC keeps the
bonus right as shoulder essence is re-invested, without touching the buff again. A
broken formula degrades to 0 with the error shown on the row.

**Extra bonuses** reach what the dials do not: **+ Add bonus** in the editor adds a
[target, value] pair, as many as the buff needs, values taking formulas like the
dials. Targets: melee or ranged attacks alone, CMB, CMD, a single save, ability
checks, max hit points, speed (flat feet, applied before a condition halves and
never granting a movement type the character lacks) — and three special ones:

- **An ability score** (bull's strength as `Strength +4`) rides the same block
  conditions use, so the raised score cascades into everything built on its
  modifier — attacks, skills, saves, AC, initiative.
- **Size** is steps larger (+1 = one size up): attack and AC move by the size
  modifier, CMB and CMD by the special size modifier (which the plain attack
  channel rightly skips) — and every weapon's own damage dice **step along the
  official progression chart** (1d8 → 2d6 enlarged, 2d6 → 1d10 reduced), with the
  FAQ's remappings for d4s, d12s, d10 pools and off-chart d6/d8 counts, applied one
  size step at a time so multi-step changes read each step's own size and dice.
  Token riders (sneak, flaming) keep their dice, as the rules leave them; reach
  stays yours. The stepped dice show on the dashboard's weapon lines and ride the
  d20 copies, damage and crit alike. Size comes in three kinds — **true** (the four
  numbers and the dice), **effective** ("treated as larger", dice alone), and
  **stacking** for the odd item that makes size effects stack outright (wraps of
  suppressed size) — within true and effective only the largest counts, and the
  kinds stack with each other. Nothing grows past Colossal nor shrinks past Fine:
  the attack and AC penalties, the CMB and CMD bonuses and the dice all run off
  the capped steps.
- **Save DCs** and **Essence pool** are shown where those numbers are read — the
  Casting numbers and Veils cards — without re-running slot tables or investment
  math.

The **note** is prose that reads `{…}`: a definition written there — say
`{deathgrip.dmg.max = 2 * (1 + essence.shoulder) * if(hp.current / hp.total < 0.5,
if(hp.current < 0, 2, 1.5), 1)}` — becomes a name the whole sheet reads: a weapon's
dice, a tracker's maximum, another buff's dial. The definition stands whether the
buff is ticked or not (a reference must not break when the buff is off); a value
that should switch says so itself, with `if(…)`.

Each view keeps its own bar (`uiPrefs.tabOrder` and `uiPrefs.sessionTabOrder`): the
⚙ manager always edits the view you are in, says which one that is, and its reset
button re-seeds only that view — so hiding Crafting during play never touches the
build bar, and both arrangements survive a reload and travel with an export.

### Marking a class's systems

On the Overview's **Classes** table, the **Systems** column expands into a row of
toggles — Spheres of Power, Spheres of Might, Champion of the Spheres, Vancian magic,
Path of War, Psionics, Akashic, Cardcasting, the three companions, Techniques,
Cooking, Item crafting. Marking one says "this class plays with that machinery"
before anything is typed into its tab: the tab shows *marked* in the ⚙ manager and
joins the session view's bar. Extension-pack classes can carry these tags with them
(see [Extensions](extensions.md)).

Two tabs are not part of that arrangement and sit after it: **ƒx Formulas** — the
formula guide, scratchpad and value index, on every character, described in
[Formulas & trackers](formulas-and-trackers.md#ƒx-formulas-tab) — and **Formula
Audit**, which only appears under `role="admin"`. Neither can be hidden or dragged,
because help you cannot find is not help; the header's **ƒx** button opens the
Formulas tab from wherever you are, and wears a count when something on the character
is not working.

The manager lists what is off the bar **alphabetically**, in three groups:

- **Hidden tabs** — the rest of the built-in tabs (Extras & Notes), the modelled
  sub-systems (Martial Spheres, Magic Spheres, Crafting, Akashic, Maneuvers, Vancian, Psionics,
  Template, and the three companions), and the workbook's own worksheets. A
  sub-system that already holds the character's data is badged *in use*, so a
  character with veils sees which waiting tab has them; one a class names without
  data yet is badged *marked*; **Show** puts a tab at the end of the bar.
- **Extra — weird systems** — the odd machinery kept out of the way unless a
  character runs on it: **Cardcasting**, the **Technique List** and **AutoTechnique**
  pair, and **Auto-Cooking**.
- **Worksheets** — add a free grid tab of your own for a spellbook, a mount, or a
  homebrew system.

Every remaining worksheet of the workbook — the character-specific tabs like a
Technique List or an Auto-Cooking sheet — is its own tab, fully editable: **rename**
inline (in the manager or from the tab's own header), **delete** with a confirm, grow
it with rows and columns. Cells accept inline `{name = expr}` formulas, so a custom
tab can define character-wide values too. The big sphere-training panels can be
minimized; all of this persists per character.

> The `#ERROR!` cells in the exports sat in Animal Companion (16 per workbook) and
> Eidolon on **all five** workbooks. (Item Crafting, Akashic, Maneuvers and Vancian
> Magic had them too.) None of those is a grid any more — see *Item crafting*,
> *Akashic, Maneuvers and Vancian* and *Companions* above — so no raw tab shows an
> error cell now. The casting-number differences on Nico/Narockro/Saburo come from template
> revisions, not broken formulas; Saburo's cached CL 4, for instance, is his
> Advanced Magic Training flag, which the app now reproduces.

---

## The Overview

Top to bottom, the Overview reads: **At a glance** (the eight numbers a table asks
for), **Details** (what the player writes about the character) beside the ability
scores, **Specialty** beside **Languages**, the **Classes** table — the levels every
number below it comes out of — then two supergroups: **Defenses** (hit points, armor
class, saving throws) and **Offenses** (attack, speed and proficiencies, three panels
to a row where the width is there). Last come conditions beside carrying capacity, the
wallet, and traits.

**Conditions** are switches, not number boxes: all of them are on or off except
negative levels, which count. They are laid out three to a row — the standard
eighteen in six rows, the whole list in one look — falling to two and then one as the
panel narrows. Each chip says what the condition costs
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
Each chip has a grip: drag one past its neighbours to put the list in the order you
want it read. The caret in the heading folds the whole panel down to one line —
every language the character speaks, native ones first, in a box with a **Copy**
button beside it, which is the form a table or a post asks for.

**Base attack bonus** is worked out from the Classes table rather than typed: at each
character level the best BAB progression among the classes present at it, summed and
floored once at the end. Each class's progression — full, ¾, ½ — is a column on that
table, and the figure here is a read-out with an override behind it: type a number to
pin it, clear the box to hand it back. All five source workbooks reproduce their own
BAB to the point under that rule, so an import needs no override; one whose class
table cannot explain its BAB keeps the number it came with, pinned, rather than
losing it.

**Attack** reads Melee, Ranged and CMB as headline numbers, and under them a table of
all six slots the sheet keeps — each of the three plus its **alternate**, which is the
same attack with a different ability in it: Dex for a finessed blade, Wis for a monk's
fist. Each row shows its total and carries a **d20**. An alternate is folded into the
attack it belongs to and starts that way, so the table reads as three rows; the caret
on each says what is underneath it (*Show the alternate — Wis, +36*). An alternate is
not a second sum:
it is its own mode's total with one modifier swapped for the other, so it shares the
BAB, the misc bonus, the size modifier and the import reconciliation, and cannot drift
from the number above it. Its **Other** cell says *as melee* for the same reason — the
offset it carries belongs to the attack above it, and editing it in two places would be
editing one number twice.

**Other** on an attack row is the import reconciliation made visible: what the source
workbook's own attack cell claimed, less what this sheet can work out from BAB and the
ability in the slot. A workbook that added a weapon's enhancement, a size bonus or a
talent through a formula the export could not carry leaves the difference here. It is
the same column the AC and save tables have, and for the same reason — left hidden it
is the only place those bonuses live, so an attack bonus nobody can account for could
be neither found nor corrected. A bonus this sheet forwards itself is *not* folded into
it: that one is written down, so it stays forwarded and shows in gold beside the field.

**Speed** takes its bonus as a formula, because that is where class features land:
a monk's fast movement is `floor(level / 3) * 10`, and written that way it keeps up
with the level. The Final column is the model's and moves the moment either field
does; formula bonuses appear in the Formula audit like every other player formula.

Each rate also **answers to a name**, shown under the type it is typed into: *Land* is
`speed.land`, *Fly (average)* is `speed.fly`. A formula anywhere on the character reads
it, and a feature anywhere sends a bonus to it — `{speed.land += 10}` for the boots,
`{speed += 10}` for every speed the character has. What arrives is kept beside the
bonus that was typed in, gold under the total, never folded into the field. A rate with
no type has no name, and the row says so rather than coining one that would mean
something else the moment it was filled in. See
[Movement rates](formulas-and-trackers.md#movement-rates).

**Proficiencies** are lists rather than the workbook's three sentences, in the same
terms the weapon rows on Equipment carry: **familiarities** (simple, martial, exotic),
**handedness** (light, one-handed, two-handed — for the classes and traits that grant
"all light weapons"), the fighter **weapon groups**, and **specific weapons** typed in
one by one like languages — that last row folds away behind its caret, since a race's
list is written once and read after that, and folded it is the names in a sentence.
**Armor** is unarmored, light, medium and heavy; **shields**
are none, buckler, light, heavy and tower, where *None* is a statement — ticking it clears
the kinds and a kind clears it. A **Notes** field takes whatever the lists cannot say.
On import the sentences are read into the lists — *"all simple and double-chained kama,
katana…"* becomes the Simple chip and a weapon list, *"light and medium armor"* two
chips, *"shields (except tower shields)"* the three Shield Proficiency covers — and
what does not parse lands in Notes. A weapon on Equipment is read against these — by its
familiarity, handedness, groups, name, and **As**, the base weapon it is (*Bloodburst
Blade* as *katana*) — and shows **not proficient** in its heading when nothing covers it.
Two things sit above the lists: a weapon in the *Veil* group, or naming *[Enhanced]*, is
proficient by the Enhanced-veil rule (a veilweaver is always proficient with what a veil
creates), and the row's own **Proficient** field — Auto / Yes / No, with a *via* note for
Custom Training, a class feature, whatever the lists cannot say — overrides all of it. The
heading shows *proficient · veil* or *proficient · Custom Training* when the answer came
from one of those rather than the Overview. The −4 is not applied — it stays the player's
to write. The Armored Discipline prerequisite on Primordia reads the armor list.

**Race traits** have a table of their own under *Traits & drawbacks*, next to the
character traits — a race hands out anywhere from three to ten, so rows are added and
removed freely. The workbook's *"Darkvision: sees in the dark for 60 feet"* sentences
are split into name and effect on import.

---

## Wealth — the wallet in mana

The campaign's currency is mana, and the workbook's wallet block (Character Info, beside
the mythic path) is what the Overview's **Wealth** panel and its **Mana** stat in *At a
glance* read: the balance recorded after the last Oath of Offerings, whether the
character keeps the Oath and casts materially, when the last offering was made, the mana
earned a day and the mana earned in sessions since ("Sessions" on the sheet is that
sum, not a count), and the current balance. Both converters extract it
(`wealth`); a sheet with only the *Wallet* label, or none, starts an empty wallet.

What the next offering comes to is the most recent sheet's formula (Saburo's), with the
two switches the earlier one (Narockro's) had:

| | |
|---|---|
| OoO / day | Mana/Day ÷ 2 |
| owed under the Oath | days since the last offering × OoO/day + ⌊session mana ÷ 2⌋ — half of everything earned |
| owed for material casting | whole months since the last offering × 10 × caster level |
| **Mana after** | current − (the parts whose switch is on) |

Days and months are counted the way `TODAY() − date` and `DATEDIF(…, "M")` count them,
so the figure moves with the calendar exactly as the sheet's does. Formulas can read
`mana.current`, `mana.expected` and `mana.after`.

The panel says only as much as the character owes. **On hand**, **Current mana** and
**Mana / day** are everyone's. The rest — *Owed*, *After offering*, the baseline, the
date of the last offering, OoO/day and the session mana since — belongs to the two
switches, and with neither of them on those fields are readable but not writable:
there is no offering to keep a baseline for. The switches themselves say what they
cost on hover rather than in the row, since the answer to the formula is already the
*Owed* figure above them.

The panel is also the hook for what comes later: a **ledger**. Every reward, spend and
offering is a dated line with a label and an amount, and the wallet moves with it — a
*session* line is session income, so under the oath half of it is owed at the next
offering, a *spend* comes off,
and × on a line undoes it. **Record** writes one by hand; `addWealthEntry()` on the model
is what a session-reward automation will call. **Make offering** pays what is owed
today: the balance after it becomes the new baseline, today the last offering, and the
session mana starts over — with the payment on the ledger.

> Narockro's older sheet halved the gains since the baseline instead of counting days;
> under the current rule his 52 days at 140 a day come to a much larger offering than
> the 340 his own cell showed. The baseline is still kept (and *gains since baseline*
> computed) so that reading is one line away if the table wants it back.

---

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

## Classes (gestalt) & traits

The Classes table lives on the Overview, above the Defenses. **Levels** is a read-out
before it is a field: the number in the box is how many of the character's levels
feature that class in the Planner, which is what every other tab means by "class
level", and hovering it says so — *featured on 8 of 9 levels*. The name is matched
against the Planner's own spelling the way the casting blocks match it, so one
mistyped letter no longer answers "never" and quietly promotes the class to every
level. Type a number to pin it instead (for a sparse Planner), and clear the box to
hand it back. A class the Planner never names at all still runs all levels.

From that table the app derives, following gestalt rules (best progression among the
classes present each level):

- **Save bases** — good saves +2 once and +½/level, poor +⅓/level — written straight
  into the Saves panel.
- **Base attack bonus** — the best of the **BAB** column on each level, summed and
  floored once at the end, which is the workbook's own arithmetic: fifteen levels of ¾
  is 11, and ten of full plus one of ¾ is 10. It lands on the Attack panel, where an
  override can pin it.
- **HP/level** (best HD) and **skill ranks/level** (best class).

A character on one class track is not gestalt and is not told about it: the same
three numbers are shown without the best-of wording, and without the gestalt note.

Traits & drawbacks are structured slots: Traits 1–3 always; Drawback 1 unlocks
Trait 4, Drawback 2 unlocks Trait 5, and a Major Drawback buys a Drawback Feat —
locked slots grey out until their drawback is filled. Each row is slot, category,
**name** and effect. The workbook had two cells for those last three and every sheet
overloaded one: a trait was written *"Fate's Favored (+1 to any existing Luck
bonuses)"* with the name and the effect together, while a drawback's name went in the
category column — which is not a category, has never been shown, and so carried
*Pride* and *Overly Cautious* invisibly. The name is split out into its own column on
load, once, from whichever of the two was carrying it; a slot that reads as neither
keeps its text whole and starts with no name. Categories cover the standard
list (Campaign, Combat, Cosmic, Equipment, Faith, Family, Magic, Mount, Race,
Regional, Religion, Social) plus any the player adds (Akashic, Mythic, Psionic…).
Race traits sit beside them in their own list — see [The Overview](#the-overview).

---

## Granted feats

Some feats are not picked at a level — something hands them over — and those open the
**Feats** panel on Feats & Mythic, **source first and the feat second**, because that is
the order they are read in: you know what granted it and are answering with which feat
you took. The smaller feat groups are sections of the same panel, underneath.

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

---

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

**Class** sits beside Ranks, where its +3 is decided — a class skill is worth nothing
until the skill has a rank in it. **Trained only** sits at the far end, before the
notes: the workbook's Requires Training column, which the sheet carries per skill and
a d20 reads before it rolls. It is a checkbox like the others, so a skill you add
yourself can be marked. It does not change the total — a trained-only skill with no
ranks still sums the way the workbook sums it; what it changes is the roll, which says
so rather than being quietly wrong.

**Rolling one.** The **d20** beside each Total copies that check for Roll20 — see
[Rolling it at the table](#rolling-it-at-the-table). A skill with a situational note
carries it along, and a trained-only skill with no ranks says so.

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

**A bonus can also arrive from somewhere else.** A feature that grants the same bonus to
several skills is one rule, and it is written once, in the feature that grants it:
`Mythic Social Grace {skill.bluff, skill.diplomacy += mythic.tier}`. The amount shows in
gold beside the Misc column of every skill it lands on, and hovering it names the sentence
that sent it. Misc goes on saying what *you* typed. See
[Forwarded bonuses](formulas-and-trackers.md#forwarded-bonuses--a-rule-written-once).

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

---

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

---

## Ability colours

The six abilities keep the colours the workbook gave them — Str red, Dex green, Con
tan, Int yellow, Wis mauve, Cha blue — and two things wear them.

An **ability's name** is a chip in its own colour: the rows of the Ability scores
panel, the Ability checks card, and the ability column of every build table on Stats
and of a companion's scores.

A **dropdown that picks an ability** wears the colour of the ability it picked, and
changes colour when the pick changes. That is every one of them — the two stat slots
on armor class, each saving throw and each attack mode, a skill's key ability, a
weapon's damage ability, the casting and manifesting stats, a suit in the deck, an
ABP or level-4 or mythic pick, a companion's attack ability. A dropdown is treated as
an ability picker when its choices *are* abilities, so a slot added later is coloured
the day it lands rather than the day someone remembers to tag it.

A **weapon's Base** is coloured too, though its choices are attack modes rather than
abilities: *Alt Melee* wears the colour of whatever ability that mode is keyed to on the
Overview. It is the one place the two can disagree and the disagreement is the point —
a finessed rapier reads *Alt Melee* in Dex green beside *Str* in red, which is exactly
what a finesse weapon is: attacking off one ability and damaging off the other. A mode
keyed to two abilities takes the primary, since two colours would be no colour at all;
a mode with only its second slot filled takes that one, because it is still the only
ability that mode runs on.

Nothing here is a setting: the colours are fixed so that the same red always means
Strength. They are the workbook's own cell fills, worn thin over the dark theme and
washed over the light one, with the word inked dark enough to read on either.
Embedders can repaint them per instance with `--ab-str` and its five siblings; see
*[Embedding](embedding.md)*.
