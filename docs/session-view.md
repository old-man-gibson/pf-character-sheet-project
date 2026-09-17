# Session view

The session Overview puts an action board beside health, resources and effects.
Character reference panels sit below and no longer stretch to match the tallest
panel. Existing reference-card choices remain available through **Arrange cards**.
The automatic arrangement puts resources immediately below health.

## Options and turns

Add custom options or link attacks, feats, talents, veils and known maneuvers from
the selectors under each action group. Choose the action type yourself; unusual
abilities and house rules can change it. Titles open details; **Edit option** sets
the title, notes, action type and optional tracker cost (a number or formula).
Move earlier/later orders cards within a group. Each group can be collapsed.

Drag an option by its ⠿ handle to reorder it. Drop above or below another card,
or on an action-type heading to move it there (including a collapsed section).
The highlighted edge shows where it will land. Move earlier/later and the Action
selector provide keyboard alternatives.

**+ Choice group** creates a compact collection such as Kinetic blasts or Full
attack variants. Give it a title, then drag options into its marked drop area,
or assign them using **Choice group** in each option's editor. The group displays
all choice titles as buttons. Clicking one highlights it and opens that option's
rolls, details and Use button beneath the choices.
Switching choices spends nothing. Edit choice group can add a custom choice or
ungroup while keeping all options. A group dragged to another action type moves
all its choices together. Groups cannot be nested. Selection, grouping and order
are saved with the character; layout edits can be undone.

Attack and damage values stay visible on closed cards, with separate Roll20 copy
buttons. Linked weapons use the same condition-adjusted rolls as the sheet. Any
option can have an attack formula (`attack.melee`, `bab + dex.mod`, or `12`) and a
damage expression (`2d6 + str.mod`, or `{floor(level / 2)}d6`). Add dice with plus
or minus; put calculated dice counts in braces. Invalid expressions show an error
and disable roll copying. Custom rolls do not automatically add other bonuses;
`attack.melee`, `attack.ranged` and `attack.cmb` include current conditions.

Range, targets/area, save/DC, duration and notes are editable and accept inline
values such as `{caster.dc}`. Blank fields inherit available linked details.
An attack or damage override replaces that part of the linked roll and omits its
critical rolls. Clearing the override restores the linked calculation.

**Use** spends the action and configured tracker cost together. If either is
unavailable, neither is spent. Resource costs increase the tracker's spent or
accumulated count; draining meters therefore show less remaining. Undo restores
both. Using a card does not automatically roll, select targets, apply damage,
expend spell slots or mark a maneuver expended. Attack shortcuts offer separate
Roll20 copy buttons: a single attack normally, all iterative attacks for a
full-round card. These retain the sheet's condition adjustments.

Movement uses a movement action first, then an unused standard action. Full round
uses both. On your turn, immediate actions also spend swift actions. Between turns,
an immediate reserves a swift on the next turn and blocks another immediate until
that turn ends. **End turn** and **Start my turn** make this distinction explicit;
**Next turn** is a shortcut from one turn to the next. Actions and AoOs refresh at
the start of your turn. **Reset encounter** restores all actions and clears any
reserved swift; it preserves cards and does not reset daily resources.

Counter **−** uses the same action rules. **+** restores only the selected counter.
The settings also expose spent-count overrides and reserved swift for exceptions.
Conditions, movement distance, flat-footed restrictions and special action rules
still need the player's judgment.

## Extra actions and AoOs

Every maximum accepts a number or character formula. For Combat Reflexes, set the
AoO maximum to `1 + max(0, dex.mod)`. Alternatively, keep its base at 1 and put
`{actions.aoo += max(0, dex.mod)}` in the feat's existing description. Use one method
to avoid double counting. Other bonus destinations are `actions.standard`,
`actions.move`, `actions.swift` and `actions.immediate`.

Action relationships follow the [Pathfinder action types](https://www.aonprd.com/Rules.aspx?ID=129),
[immediate-action rules](https://aonprd.com/Rules.aspx?ID=159) and
[attacks of opportunity rules](https://www.aonprd.com/Rules.aspx?ID=102).

The `session` property saves card choices, folds, turn state, spent counts and
maximum formulas in the character export. Linked entries resolve by kind and name
so rearranging the source list does not silently change a shortcut. If a source is
removed, renamed or ambiguous, the card is disabled; **Make custom** retains its
title and any available details. Duplicate source names are omitted from the picker.

## Checks

Run `node tests/session.test.mjs` for action relationships, formulas, atomic costs,
undo, persistence and shortcut resolution. Serve the repository and open
`tests/session-browser.html` to exercise real component bindings, editing and folds.
