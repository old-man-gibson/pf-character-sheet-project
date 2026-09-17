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
The **Choices** heading collapses the buttons while keeping the selected action
visible. This setting is saved per group and follows it when dragged.
Switching choices spends nothing. Edit choice group can add a custom choice or
ungroup while keeping all options. A group dragged to another action type moves
all its choices together. Groups cannot be nested. Selection, grouping and order
are saved with the character; layout edits can be undone.

Attack and damage values stay visible on closed cards, with separate Roll20 copy
buttons. Linked weapons use the same condition-adjusted rolls as the sheet. Any
option can have an attack formula (`attack.melee`, `bab + dex.mod`, or `12`) and a
damage expression (`2d6 + str.mod`, or `{floor(level / 2)}d6`). Add dice with plus
or minus; put calculated dice counts in braces. A value the character defines as
dice text, such as `{kinetic.fist.simple = dice(4, 6)}` in a description, can be
named in a damage field directly (`2d6 + kinetic.fist.simple`) and is spliced in
as written; a number field rejects it and says so. Invalid expressions show an error
and disable roll copying. Custom rolls do not automatically add other bonuses;
`attack.melee`, `attack.ranged` and `attack.cmb` include current conditions.

Range, targets/area, save/DC, duration and notes are editable and accept inline
values such as `{caster.dc}`. Blank fields inherit available linked details.
An attack or damage override replaces that part of the linked roll and omits its
critical rolls. Clearing the override restores the linked calculation.

Four more fields build multi-attack routines without retyping the weapon.
**Extra attacks** repeats the highest attack: a count (`3`, or a formula) for a
flurry, Haste or Rapid Shot, or comma-separated groups with their own modifier
(`1 @ -2, 2 @ -6`) for off hands and grown arms at different penalties. Extras
land after the weapon's own iteratives. **Attack modifier** shifts every attack
roll and crit confirmation, such as `-2` for a two-weapon style. **Extra damage**
adds dice and a formula to each hit as a rider: on the Damage roll, and once,
unmultiplied, on the crit damage line, the way the weapon's own riders behave. **Attack set** as *Highest bonus only* drops the
reduced-bonus iteratives, as a legendary monk's flurry requires. A monk's routine
is then one choice group: *Full attack* (the linked unarmed strike, full round),
*Flurry of blows* (the same link, highest bonus only, extra attacks `3` from 16th
level, plus `1` while hasted), an *Elemental flurry* that adds the kinetic fist as
extra damage, and a veil's special attack action as a standard action with extra
attacks `1` and attack modifier `-2`, one card per arm count. A multiweapon
routine with grown arms is one card too: the primary hand keeps its iteratives
at the two-weapon penalty in the attack modifier, and each further arm is a
group, such as `1 @ 0, 2 @ -max(0, 4 - essence.shoulders), 2 @ -8`. Every field
accepts inline values such as `{class.legendary_monk.level}`; a veil's essence
reads by its slot, `essence.hands` or `essence.shoulders`. The fields also apply
to a custom attack formula and to class features defined in Progression.

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
title and any available details. Attack rows that share a name are listed by
attack type, and rows of the same name and type by their order among themselves
(`Blade (Alt Melee 2)`). Other duplicate source names are omitted from the picker.

## Class features and ability chains

Progression has a **Class features · abilities & actions** area for each class.
Define an ability's description, rolls, resource cost and follow-ups there, then
**Pin to session**. The session shortcut uses the same definition, so edits stay
connected. Its placement and card width remain independent.

In an ability or choice group's editor, **Link ability or group** selects what
becomes available after **Use**. A link can point to a class feature, a session
card, or a choice group. Selecting one option in a linked group uses only that
option; its own links (and the group's links) can continue the chain.

For example, link Infernal Musician to a Totems choice group, set the follow-up's
action cost to **Free**, and record the feat granting it in the reminder.
Free changes only the action cost. **Waive resource cost too** is a separate,
explicit setting. Neither override permanently changes the target ability.

Pending follow-ups appear above the action board with their details and values.
Optional steps can be skipped. Resolve or cancel the chain before other actions
or a new turn. Cancel keeps costs already paid; Undo reverses the last activation.
Pending steps survive saving and reloading. Missing targets and cycles cannot
spend costs, and can be recovered through editing, Undo, or cancellation.
These links record player-configured rules; they do not interpret feat text.

Cards use one column by default, two for choice groups or linked abilities, and
three for multiple links. The card editor can override this with **1, 2, or 3
columns**. Spans shrink automatically when the available screen space is narrow.

## Chain checks

Run `node tests/session-chains.test.mjs` for costs, chaining, cycle prevention,
undo and persistence. Open `tests/session-chains-browser.html` through the local
server for class-feature editing, pinning, widths and linked choice interactions.

Run `node tests/session.test.mjs` for action relationships, formulas, atomic costs,
undo, persistence and shortcut resolution. Serve the repository and open
`tests/session-browser.html` to exercise real component bindings, editing and folds.
