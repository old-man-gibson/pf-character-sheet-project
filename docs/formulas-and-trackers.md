# Inline formulas and custom trackers

_Part of the [Pathfinder Character Sheet Program](../README.md) docs. The sandboxed formula language: `{name = expr}` in prose, custom trackers and meters, their appearance (zones, gradients, pips), the GM / inspector view and why player-written formulas are safe._

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
