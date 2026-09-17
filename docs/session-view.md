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
