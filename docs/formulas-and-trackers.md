# Inline formulas and custom trackers

_Part of the [Pathfinder Character Sheet Program](../README.md) docs. The **ƒx Formulas** tab, the sandboxed formula language: `{name = expr}` and `{dest += expr}` in prose, custom trackers and meters, their appearance (zones, gradients, pips), the GM / inspector view and why player-written formulas are safe._

---

## The ƒx Formulas tab

The formula language is the most useful thing this app has that a paper sheet does not,
and it is worth exactly as much as a player's ability to find their way into it. So it
has a tab of its own, and a **ƒx** button in the header that opens it from wherever
you are. The tab sits at the end of the bar on every character and cannot be hidden or
dragged away — it is help, not character data — and unlike the Formula Audit it is not
an admin view: it is the player's.

It is five things, in the order a player needs them.

**Needs attention** — at the top, and only when there is something in it, because a
permanent empty box teaches a player to stop looking at that part of the page. It is
every name problem on the character, one entry each, with every place involved and a
number beside each so the fix is decidable from the list. The **&fnof;x** button in the
header carries the same count, from the same call, so the two can never disagree. What
it reports is [below](#when-names-go-wrong).

**Try one** — a scratchpad. Type an expression and watch it resolve against *this*
character; nothing typed there is saved or changes anything. It shows three lines:

```
written                     floor(level / 2) + wis.mod
with this character's values  floor(20 / 2) + 16
comes to                    26
reads  level 20   wis.mod 16
```

The middle line is the one that teaches. A number with no working shown is not legible,
and "where did 26 come from" is answered without going to look up two values on two
other tabs. Every name it reads is listed underneath as a chip with its current value;
click one to drop it into the box. **Enter** tidies the spacing of what you have typed
(and never while you are typing, which would move the caret out from under you).

**Formulas on this character** — every formula already written on the sheet, wherever it
lives: inline names, tracker maxima and minima, zone bounds, skill-rank and misc
formulas, weapon tokens, crafting numbers, speeds. Each is shown coloured, with what it
comes to and any problem it has, and clicking one opens it in the scratchpad. Most of
the time a player does not want to write a formula — they want to find the one they
wrote three sessions ago and copy the trick. This is the same list the GM's Formula
Audit shows, because formulas are text and there is nothing hidden in them.

**Values you can read** — the index. Every name the character publishes, grouped into
families, each with what it is worth right now, and clicking one puts it in the
scratchpad at the caret. **Named by you** is first and open by default: the `{name = …}`
values the player defined are the ones whose spelling they will not remember. The rest —
trackers, the character, abilities, health/armour/saves, attack, skills, magic and
sub-systems, companions — are folded until asked for, because a character publishes
around 250 names and an alphabetical wall of them is a list, not an answer.

**Bonuses you can send** — the same index for the other direction: every destination
`{… += …}` accepts on this character, grouped the same way, each with what it means.
**Weapons and damage** is first, because it is the half nobody can discover unaided —
every other destination is a number printed in a column somewhere, so a reader at least
knows it exists, while a weapon's damage channel is named nowhere on the sheet. Clicking
a row copies the whole token (`{weapon.melee.damage += 2}`), ready to paste into the feat
or talent that grants it; where the clipboard is refused, the name is selected on screen
instead so Ctrl+C still works. They are not offered to the scratchpad, because a
destination is written to rather than read and most of them will not resolve there — a
search for `damage` returns *0 of 287* readable values and a dozen destinations, which is
the distinction the panel exists to make. Under the list, the grammar the enumeration
cannot teach: `weapon.<which>.<what>`, and why a shape matching nothing today is still
right.

**Reference** — folded away underneath, because it is the part you need once: the four
token forms, a three-step walk-through of making a value and giving it pips, where
formulas work, every operator, every built-in function, what the built-in name families
mean, and the rules that are not guessable (a name cannot take one the sheet already
owns; the first definition of a duplicated name wins; a tracker's id is not its name; a
tracker note shows values but does not publish them), with a table of its own for the two
names that only work in one kind of field — `essence.self` and `self.*`. Every example in it is evaluated against the character reading
it, so `10 + con.mod * 2` shows what it means for *them* — and clicking any example
loads it into the scratchpad.

The **one search box** at the top narrows both the value index and the list of formulas
at once, which is what "pull it up" usually means in practice: type `burn` to get every
`tracker.burn.*` name and every formula that mentions burn.

The function and operator tables are generated from the engine's own `FUNCTIONS` map, and
`tests/formula-format.test.mjs` fails if a built-in is added without being documented (or
documented after being removed), so the guide cannot drift from what the language does.

### Formulas are shown, not just stored

Wherever a formula appears it is now coloured by the same rules, so one colour means one
thing across the whole sheet: **gold** is a name the character supplies (the same gold a
computed value already wears), **blue** a function, **green** a number, grey the
operators, and a red wavy underline a name or function the character does not have —
marked where it is written, not only in an error message underneath. A tracker's
`max = …` line, the Formula Audit, the guide and the scratchpad all use it.

**Brackets are coloured by how deep they are**, and a pair shares its colour, so
`floor(min(level, 20) / 2)` is read by matching teal to teal and pink to pink rather than
by counting inwards. The hues are outside the palette above on purpose — a bracket is
structure, not a value, and must never be mistaken for a name. Three depths get a colour
before the cycle repeats; a comma takes the colour of the call it separates.

### The bracket you are standing next to

Put the caret beside a `(`, `[` or `{` — before it or after it — **and that bracket and
the one that answers it light up** in the field you are typing in. It works in every field
that understands formulas: the scratchpad, the expression fields, and prose, where the
`{…}` of a token counts as a bracket like any other. A bracket with no partner is lit in
red instead, which is how a missing `)` shows itself while it is still being typed.

A native input cannot colour part of its own text, so the pair is drawn on a **mirror**: a
copy of the text in the same metrics, sitting behind the field, blank but for the two
marks. Nothing is inserted into what you typed and nothing is saved — a browser that fails
to draw it loses a hint and nothing else. The matching itself (`ui/brackets.js`) is a pure
function over text and a caret position: brackets inside a quoted string are characters
rather than nests, and a closer answers only the nearest opener of its own kind, since a
formula being written is unbalanced most of the time and a wrong guess would be worse than
no answer.

Hovering any of them shows the working on one line:

```
if(mythic.tier = 0, 0, 3 + mythic.tier * 2)  =  if(10 = 0, 0, 3 + 10 * 2)  =  23
```

The same is true of a computed value in the middle of a sentence, which is the one place
on the sheet where a bare number had no way at all of explaining itself: hovering a
`{= …}` shows its source and its working, and hovering a `{name}` reference shows the
formula from wherever that name was **defined**, so there is no hunting for it.

Displayed formulas are re-spaced (`floor(level/2)+wis.mod` reads as
`floor(level / 2) + wis.mod`, and brackets that do nothing are dropped) but never
reworded: a `=` written out of spreadsheet habit is shown back as `=`, not corrected to
`==`. The raw text is what the editor shows when you click into it, and the raw text is
what is stored.

The tracker add/edit preview shows the substitution rather than only the answer —
`max = floor((20 + 16) / 3) = 12` — because the formula itself is in the box directly
above it, and what a player cannot see from there is what their own numbers do to it.

### Names that only exist somewhere

Almost every value belongs to the character and can be read from anywhere. Two do not:

| Name | Only in | What it is |
|---|---|---|
| `essence.self` | a veil's own name or description | the essence invested in **that veil**. Elsewhere, name the slot — `essence.hands`, `essence.head` — or read `essence.total` for the pool. |
| `self.max` `.current` `.remaining` `.min` `.spent` `.pct` `.zone` | a tracker's own note, min and zone bounds | that tracker, without naming itself. Elsewhere use `tracker.<id>.max`; and a tracker's **max** cannot use `self` at all, since that would be defining itself. |

They are the sharpest edge in the language, because they read like ordinary values, work
perfectly where they belong, and are simply absent everywhere else — a formula that says
`essence.self` outside a veil throws every time.

So **a formula is judged where it lives**. The model works out, per formula, which names
were legal in the field it was written in (`audit()` reports them as
`unknownReferences`, and carries the field's own scope as `locals`), and the display
takes that verdict rather than checking against the character alone — otherwise a veil
reading its own invested essence would be drawn with a red underline and counted as
broken on a sheet where it works. The red underline means *this name does not work
here*, and hovering it says where the name does work rather than claiming it does not
exist. In the try-it box, which has no veil and no tracker around it, both are correctly
flagged — and the guide gives them a table of their own for the same reason.

---

## When names go wrong

Five things can go wrong with a set of names, and all five are reported the same way:
once, as a problem, in **Needs attention** on the Formulas tab — not as several formulas
each complaining about the others. Every one of them is also flagged in red where it is
written.

### One name, defined twice

**The first definition wins**, both are flagged, and the panel shows both with what each
comes to:

```
Defined more than once   qi.max
  in force   note 1 on Lore    floor(level / 2) + wis.mod    15
  ignored    a Monk class feature, level 4    wis.mod * 3     18
```

First rather than last, deliberately. Order across the sheet is a traversal order no
player can predict, so *which* one wins is arbitrary either way — but "the one already
there" means that pasting in a new class page, or importing a template, cannot quietly
change what an existing name is worth on a character that was working. The ignored
definition still shows its own number on the row, because that is the thing needed to
decide which of the two to delete.

### A loop

If `a` reads `b` and `b` reads `a`, neither can be worked out. The loop is detected
rather than followed — nothing hangs — and reported **once, naming every member**:

```
Goes round in a circle   a → b → a
  a   note 1 on Lore   b + 1
  b   note 2 on Lore   a + 1
```

Anything downstream of a broken definition says which one to go and fix — *Depends on
"a", which is not working* — rather than *Unknown value "a"*, which reads as though the
name did not exist when it is sitting right there.

### A name the sheet already owns

`{level = 30}` is **refused**, and says so. It used to be refused quietly: the token
showed 30 where it was written while every formula reading `level` went on getting the
real number, which is the worst of both worlds. Now it publishes nothing and is flagged.

That covers three shapes of collision — the name itself (`level`), something hung off one
(`level.bonus`, where `level` is a number and cannot hold anything), and the branch a
family lives on (`str`, which already holds `str.mod` and the rest). Dotted names of your
own — `ki.max`, `arms.hp` — never collide.

### A name nothing defines

Delete the feature that defined `{qi.max}` and the name vanishes from every list, because
nothing defines it any more; all that is left is a red token in a sentence somewhere.
**Orphans** walk the other way round, from the uses back:

```
Nothing defines it   qi.max
  quoted in   note 2 on Lore              {qi.max}
  used in     weapon 1, special properties   qi.max * 2
  used in     the Trackers tab             floor(qi.max / 2)
```

Everything asking for the name is listed, whether it is a `{name}` quotation, a name
inside a `{= …}` sum, or a tracker max — so the choice between putting the definition
back and editing the places that quote it can be made with all of them in view. A name
that was only ever a typo comes out the same way, which is right: the symptom and the fix
are identical. A name that *is* defined but is not working — one caught in a loop, one
whose formula does not parse — is never called an orphan; it has a definition, and that
definition has its own entry.

### A bonus that goes nowhere

A [forwarded bonus](#forwarded-bonuses--a-rule-written-once) aimed at something that
cannot take one fails more quietly than any of the above: the sentence still reads
perfectly, the number in it is still right, and the destination is simply never told. So
it is reported, and the two ways of getting it wrong are told apart, because the fixes
differ:

```
Bonus goes nowhere   skill.bluf +=
  "skill.bluf" is not something a bonus can be forwarded to.
  written in   Vigilante 5, Features    {skill.bluf += 3}

Bonus goes nowhere   caster.level +=
  "caster.level" is a value you can read, but the sheet has nowhere to put a bonus to it.
  written in   note 1 on Lore           {caster.level += 1}
```

The first is a misspelling, fixed in the token. The second is not the player's mistake at
all: the name is real and readable, it just has no slot for an arriving bonus, and the
list of names that do is in [Forwarded bonuses](#forwarded-bonuses--a-rule-written-once).

Anything else that does not work — a tracker max that does not parse, a skill formula
reading something it may not — is listed alongside them, so **Needs attention** really is
everything and the count beside it can be trusted.

---

## Inline formulas in prose

Any descriptive field — class features, template features, notes, background,
traits, the mythic ladder's two Effect columns and the mythic tradition, weapon
special properties, gear notes,
sphere talents, crafting resources and notes — can carry formulas inside the text:

| Form | Meaning |
|---|---|
| `{= expr}` | inline value: evaluates and displays the result |
| `{name = expr}` | **named** value: evaluates, displays, and defines `name` for use anywhere on the character |
| `{name}` | reference: displays a previously named value |
| `{dest += expr}` | **forwarded** bonus: evaluates, displays, and adds the answer to `dest` — a skill, a save, AC, an attack, an ability score. `as size` on the end gives it a type |

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
gives the pool pips. Cycles, duplicates, names nothing defines and bad references show
inline in red, in **Needs attention** on the Formulas tab and in the GM's Formula Audit;
a definition can never take the name of a built-in like `level`, and is told so rather
than being refused quietly. See [When names go wrong](#when-names-go-wrong).

### Forwarded bonuses — a rule written once

The three forms above all **publish**: they work a number out and leave it somewhere for
something else to come and read. That is the wrong way round for half of what a character
sheet actually contains. *Mythic Social Grace adds your tier to the skills Social Grace
picked* is one sentence in the rulebook; written as a definition it becomes one formula
in the feature and a copy of it pasted into the Misc column of every skill it touches,
where nothing says where it came from and nothing moves the other five when the rule is
read again.

The fourth form pushes instead:

```
Mythic Social Grace {skill.bluff, skill.diplomacy += if(level >= 4, 4 + if(level >= 8, level, 0), 0)}
```

The expression on the right is worked out exactly as any other formula is, and the answer
is **added to the destinations named on the left**. Several destinations, separated by
commas, because the point of the form is not writing the same expression twice; `-=` for
a penalty. `{target.skill.bluff = …}` says the same thing the long way, for anyone who
would rather name the destination than lean on two characters of punctuation.

The token still shows its value where it is written — `+19`, signed, because a bonus that
does not say which way it goes is not saying much — and carries a double underline rather
than the dotted one a plain value wears. Hovering it names the destination and shows the
working.

**Where it lands.** Reading and writing are not the same list. Several hundred names
publish themselves to a formula; only the totals the sheet rebuilds from their parts each
recompute have anywhere to *put* an arriving bonus:

| Destination | What it is |
|---|---|
| `skill.bluff`, `skill.craft_weapons_and_armor`, … | one skill, by the same slugged name a formula reads it under |
| `skill` | every skill |
| `saves.fortitude`, `saves.reflex`, `saves.will`, `saves` | one save, or all three |
| `ac.total`, `ac.touch`, `ac.flatFooted`, `ac.cmd`, `ac` | one armour class, or the three that are armour classes (not CMD) |
| `attack.melee`, `attack.ranged`, `attack.cmb`, `attack` | one attack total, or all three |
| `damage`, `damage.mult`, `damage.crit` | weapon damage — see below |
| `weapon.melee.attack`, `weapon.axes.damage`, … | the same, on some weapons only — see below |
| `speed.land`, `speed.fly`, … | one movement rate — see below |
| `speed` | every speed the character has |
| `class.<name>.level` | levels in one class — see below |
| `tracker.<id>.max`, `tracker.<id>.min` | how big a resource pool is — not how full it is |
| `initiative` | initiative |
| `hp.total` | maximum hit points |
| `str.score`, `dex.score`, … | an ability score — which is not a total but the thing a dozen totals are built from, so it cascades through the modifier into attacks, damage, skills, saves, CMD and carrying capacity. `as temp.…` makes it a temporary one |

Anything else is refused and **said so**, in *Needs attention* and beside the formula,
with the two mistakes told apart because the fixes differ: `skill.bluf` *is not something
a bonus can be forwarded to* (a misspelling), while `caster.level` *is a value you can
read, but the sheet has nowhere to put a bonus to it* (a real name, no slot). Neither
one moves a number, and neither one throws.

An ability score lands *beside* the Stats tab build rather than in it: the columns there
go on adding up to the number they add up to, and the forwarded part shows in a **Fwd**
column of its own — in the permanent table or the temporary one, depending on what the
bonus said it was.

**Damage, and the weapons a rule applies to.** Damage does not live on the character, it
lives on each weapon, so a damage destination is really two questions: *how much* and
*which weapons*. The channels are the three the `[[…]]` tokens already use, because they
are the same three rules written a different way:

| Channel | When it applies |
|---|---|
| `damage` | every hit, added once on a crit — the ordinary rider (flaming, sneak attack) |
| `damage.mult` | every hit, and multiplied on a crit — damage that behaves like the weapon's own |
| `damage.crit` | a confirmed crit only, and multiplied |
| `weapon.<sel>.attack` | to hit, and to the confirmation roll |

Written bare — `{damage += 2}`, `{damage.crit += 6}` — a bonus reaches **every** weapon.
Put a selector in front of it and it reaches only some:

```
Weapon Focus {weapon.melee.attack += 1}
Deadly Aim {weapon.ranged.damage += 4}
Axe specialist {weapon.axes.damage += 2}
That one knife {weapon.chefs_knife.damage.mult += 1d6}
```

A selector is **`melee`, `ranged` or `cmb`** (matched against the row's attack type), a
**fighter weapon group** written on the row, or a **single weapon's handle**. A selector
that names no group and no weapon on the character is a misspelling and is reported as
one; a shape that simply matches nothing today — `weapon.ranged` on a character carrying
no bow — is not, because the rule is right and will apply the moment one is bought.

**A weapon's handle** is the short name a formula calls it by, and it is a field in the
weapon's own header, beside its name and prefixed `weapon.` so it reads as what you would
type. A weapon's
*name* is written for the table, not for a formula — *Chef's Knife (Bastard Sword) &
Cutting Board* is the joke, the statistics and the off-hand all in one string — so the
default is that name cut at the first bracket, ampersand or comma, with the apostrophes
dropped: **`chefs_knife`**. Fill the field in and what you write wins, slugged the same
way, so *Big Knife* becomes `big_knife`; blank it and it goes back to following the name.
Two weapons never share one — the second gets a number — because a bonus aimed at a handle
two weapons answered to would land on both. A weapon also still answers to its whole
slugged name, so a rule written before the row had a handle keeps working.

The character's own `attack.melee`, `attack.ranged` and `attack.cmb` reach the weapon rows
too. One attack must not read two ways on two panels.

### Movement rates

Each row of the Speed panel publishes itself under the type it is typed into — *Land* is
`speed.land`, *Fly (average)* is `speed.fly`, the manoeuvrability being a note on the
speed rather than part of what it is called. The name is printed under the type on the
row, because a name nobody can see is a name nobody uses. A rate with no type has no
name: it is not a movement rate yet, and coining one would put a name on the sheet that
means nothing today and something else tomorrow.

What the name reads is the Final column **before conditions**, exactly as `saves.will`
and `ac.total` are read before them. What a condition does to it is the dashboard's
business and the panel's, not a formula's.

**A rate may read the rates above it, and not the ones below.** *Your fly speed is equal
to your land speed* is a real rule, and it wants writing down rather than copying out:

```
Fly    base 0    bonus  speed.land
```

The rows resolve top to bottom and the list of names grows as they do, which is what
makes a cycle impossible rather than merely unlikely — the same line the inline names
draw against the skills. Reading downward is refused out loud (*Unknown value
"speed.fly"*) instead of quietly handing back last time's number.

**Sending a bonus.** Naming a rate outright always lands, because that is how a rule
*grants* one:

```
Boots of striding and springing {speed.land += 10}
Wings {speed.fly += 60}
Caltrops {speed.land -= 20}
Fleet {speed.land += floor(level / 4) * 5}
```

`speed` on its own is **every speed the character has** — the rows reading above zero.
*+10 ft. to your speeds* must not conjure flight out of an empty Fly row, which is the
same line a buff's Speed row draws. What arrives is kept beside the bonus that was typed
into the row rather than folded into it, and shows in gold under the total with its
source in the tooltip.

A forwarded bonus lands in the rate itself, so a condition that halves movement halves
it too: entangled with the boots on, a 90-foot walk reads 100 and moves 50.

### Class levels

`class.<name>.level` is how many levels of one class the character has, under the same
slugging skills use — *Legendary Kineticist* is `class.legendary_kineticist`, and the
**The character** family in *Values you can read* lists every one of them with its number
beside it, which is the place to check the spelling. On a gestalt build each side is
counted separately, so a rule that scales off one class of three can say so:

```
Elemental Overflow is {= floor(class.legendary_kineticist.level / 5)} points of burn.
```

`level` is the character's level and always was; this is the class's. Writing the number
in by hand instead goes stale at the next level-up, which is the whole thing this language
exists to stop.

It is also a **destination**, because "counts as two levels higher" is a rule about
exactly this number:

```
Practiced Kineticist {class.legendary_kineticist.level += 2}
```

What that moves, and what it deliberately does not:

- **Moves**: the class's effective level everywhere it is read — the Vancian and psionic
  blocks that name the class, a companion's master level, `class.<name>.level` itself, and
  the sphere **caster level** and **magic skill bonus**, each at that class's own rate. Two
  class levels on a mid-caster is one caster level, which is what the boost is worth and
  not what the CL Bonus field would give.
- **Does not move**: the levels actually taken. Hit dice, base saves and BAB are built
  from which class ran at which character level, and so are the sphere **talent budget**
  and **spell points**. "Counts as two levels higher" is a rule about what a class can do,
  not about being handed two more levels' worth of it. A flat caster-level bonus that is
  not a class-level bonus already has its own field on the Magic Training tab.

A class the character has no levels in is refused rather than conjured: an effective level
is a multiplier on a class you have.

**Saying what kind of bonus it is.** End the expression with `as <type>` and the bonus
stops stacking with another of the same type at the same destination:

```
Kinetic form {str.score += 2 as size}. Enlarge person {str.score += 4 as size}.
```

is **+4**, not +6 — the largest bonus of each type counts, and the largest penalty, and
untyped bonuses all count as they always did. The one that lost stays on the list where
the number is explained, marked *does not stack with the other size*, because it is the
reason the winner is not adding to it and a reader who cannot see it will write it in
again by hand. The type is a stacking key and nothing else, so a house type works exactly
as a printed one does; `as size`, `as morale`, `as luck`, `as competence` all read the way
the rulebook says them.

This settles forwarded bonuses against **each other**. A size bonus typed into the Stats
tab's own Size column, or a save's Morale row, is a different number in a different place,
and the sheet adds both — those columns are where a bonus you are not deriving from a rule
belongs, and putting the same bonus in both places counts it twice.

**Permanent or temporary.** An ability score is the one number the sheet asks this of, and
it keeps a table for each answer: a permanent bonus moves the score, a temporary one moves
only the **Temp Score** every derived number is built from. Put `temp.` on the front of
the type and the bonus lands in the second table instead of the first:

```
Inherent bonus {str.score += 4 as size}.
Elemental Overflow, while burning {str.score += 4 as temp.size}.
```

`as temp` on its own says *when* and not *what kind*, so it is untyped and temporary — two
of them stack, the way two untyped bonuses do. A permanent size bonus and a temporary one
are different bonuses and both count, exactly as the sheet's own two Size columns do.
Anywhere other than an ability score there is no temporary half to land in, and `temp.`
is only part of the type's name.

Both Stats tables carry a **Fwd** column showing what arrived from elsewhere, with the
sentence that sent it in the tooltip; **Total** and **Score** include it, so the row adds
up either way.

**A tracker's range.** `tracker.<id>.max` and `tracker.<id>.min` take bonuses; the pool
itself does not, because how full a resource is at this moment is play state and nobody's
to push around. How *big* it is, on the other hand, is exactly the kind of thing a talent
says:

```
Improved Luck {tracker.luck.max += 1 + floor(class.vigilante.level / 4)}
```

written in the Vigilante feature that grants it, rather than typed into the max and left
to go stale at the next level-up. The tracker's own max formula is untouched — the
forwarded part shows beside it on the row, in gold, and names the feature that sent it.
The id is the one on the tracker's own row, which never follows a rename.

**A level you have not reached.** The feature grid is a twenty-level plan, so it holds rows
for levels the character has not got to yet. Those rows still read and still display —
being able to look ahead is the point of a plan — and a `{name = …}` written in one is
still defined, because a name is inert until something asks for it. A **bonus** written in
one is not applied. A talent taken at 16 adds nothing at 15, and starts adding the moment
the level is reached; it is not reported as broken in the meantime, because there is
nothing wrong with it.

**Where a bonus can be written.** Every field that takes `{…}` at all, plus one that takes
nothing else: a **tracker's note**. A note may not define a name — it is read after the
trackers it reads, so the name would be a pass behind — but a bonus is not a name, and the
note beside a resource is exactly where a rule that scales with it belongs:

```
Burn                                        ●●●○○○○○○○○○○
  Elemental Overflow {str.score += if(self.current >= 3, 2, 0) as size}
```

`self.*` works there as it does in any tracker note, so the rule can read its own pool
without naming it.

**Where it shows.** Half of forwarding is arriving; the other half is being findable
afterwards, because the column that used to hold the rule no longer does. So the amount
sits in gold beside the field it lands on — the **Misc** column of the skill, the
**Other** column of the save — and points back at the sentence that sent it:

```
Forwarded here
+2 from note 1 on Lore — += 2
+2 from Vigilante 4, Features — += 2
```

and the Formulas tab grows a **Forwarded bonuses** panel listing every one of them by
destination, amount and source. Two features aimed at the same number both count, and
both are named.

**What a bonus may read.** Anything the character publishes, and any `{name = …}` the
character defines — `{skill.stealth += skill_familiarity}` works. The one direction that
does not exist is the reverse: a *name* may not be written in terms of a bonus. Names are
resolved first and bonuses second, so nothing can loop.

**How it is worked out.** A forwarded bonus is written in prose, and prose is read late —
long after the saves and AC it may be aimed at have been totalled. So the sheet is worked
out, the bonuses are read off it, and it is worked out again with them in hand. Twice,
and never a third time: the second pass reuses the amounts the first arrived at, so a
bonus can never chase its own destination round a loop. A character with no forwarded
bonuses, or none aimed earlier than the skills, costs exactly what it always did.

**Dice from names.** A weapon's Dice field accepts a reference — `{kinetic.fist}`
(or `[[kinetic.fist]]` / `{= …}`) — beside literal dice. A number-valued name is
read as that many d6 (kineticist blast dice: `{kinetic.fist = floor(…)}` → 4 → 4d6);
for other die sizes define the name as dice text with the `dice()` helper:
`{kinetic.fist = dice(floor(ceil((min(level,20)+6)/2)/3), 8)}` → `4d8`. The field
shows the resolved dice in place — click it to see the reference again — and follows
level changes live. Function names are case-insensitive (`FLOOR`, `Min`, `IF` all fine).

---

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

A note is a readout and a place to write a rule, but not a definition site: a
`{name = …}` written in one displays its value but is **not** published to the rest of the
character, because the note is evaluated after the trackers it reads. A
[forwarded bonus](#forwarded-bonuses--a-rule-written-once) is a different matter and does
work there — a bonus is not a name, and `{str.score += if(self.current >= 3, 2, 0) as size}`
on the Burn tracker is exactly where that rule belongs. Put character-wide names in a class feature or a
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

_The same ground, in the app itself and against the character in front of you, is the
Reference section of the [ƒx Formulas tab](#ƒx-formulas-tab)._

Operators `+ - * / % ^`, comparisons `< > <= >= == !=` (a bare `=` is accepted as
equality, out of spreadsheet habit), `&& || ?:`, and parentheses.

Functions: `floor` `ceil` `round` `trunc` `abs` `sign` `min` `max` `sum` `clamp`
`if` `and` `or` `not` `mod` `iterations`.

`floor(n, step)` rounds down to a multiple, matching the sheet's `Floor(x, 1)` idiom.
`mod(score)` is the ability-modifier rule. `iterations(bab)` counts iterative attacks.

Readable values include `level`, `bab`, `hp.total`, `mythic.tier`, `initiative`,
`str.score` / `str.mod` / `str.temp` / `str.tempMod` (and the other five abilities),
`saves.*`, `ac.*`, `attack.*`, `skill.<name>`, and every tracker (below). The Formulas
tab lists every available name with its current value, searchable; the Trackers tab
lists them too, beside the box you are typing into.

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
other field on the character can see it — see
[Names that only exist somewhere](#names-that-only-exist-somewhere), which it shares with
a veil's `essence.self`.

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
(shown when `role="admin"`) lists, for every formula on the character — the same set the
player sees on their own Formulas tab, with the parsed detail a GM wants on top:

- the exact source text the player wrote
- every value it reads and every function it calls
- what it currently evaluates to
- whether it is valid, and why not if it isn't

The same data is available programmatically via `sheet.audit()`, which returns plain
objects — so a campaign site or an approval script can check submitted characters
server-side without running any player-supplied code.
