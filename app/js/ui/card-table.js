/**
 * ui/card-table.js -- the Card Casting tab's controls: its two faces, the
 * table in play, and the deck builder's pickers.
 *
 * A press on the table goes through the sheet's `tableAction`, because the
 * same press can arrive from a pop-out window or from the GM's page (see
 * sheet/sharing.js) and has to do the same thing from all three. Everything
 * else here edits the model and asks for a redraw.
 *
 * `on` is { deckView(view), tableAction(action, id, arg), render(), rerender(el) }.
 */

import { castPickArg, followCastPick } from './cast-pick.js';
import { appendDiceText, appendListText, deckManipulation } from '../model/subsystems/cardcasting.js';

export function bindCardTable(root, model, on) {
  // The Cardcasting tab's two faces.
  root.querySelectorAll('[data-deck-view]').forEach((b) => {
    b.addEventListener('click', () => on.deckView(b.dataset.deckView));
  });

  // The table in play: every button carries its action, the card and an
  // argument.
  root.querySelectorAll('[data-table]').forEach((b) => {
    b.addEventListener('click', () => {
      const [action, id, arg] = b.dataset.table.split('|');
      if (on.tableAction(action, id, castPickArg(b, arg))) on.render();
    });
  });
  // The mode chooser's points follow the mode picked, as its price.
  root.querySelectorAll('.castpick select[name="mode"]').forEach((sel) => {
    sel.addEventListener('change', () => followCastPick(sel));
  });
  // A named roll picked on a card: spends what its label says, then rolls.
  root.querySelectorAll('[data-table-roll]').forEach((sel) => {
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      if (on.tableAction('boost', sel.dataset.tableRoll, sel.value)) on.render();
    });
  });
  root.querySelectorAll('[data-table-move]').forEach((sel) => {
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      if (on.tableAction('move', sel.dataset.tableMove, sel.value)) on.render();
    });
  });
  // Who an ongoing card is affecting, typed beside it; blank clears it.
  root.querySelectorAll('[data-table-targets]').forEach((input) => {
    input.addEventListener('change', () => {
      if (on.tableAction('targets', input.dataset.tableTargets, input.value)) on.rerender(input);
    });
  });

  // The picker beside a card's Dice field, or its damage types: what it
  // picked joins the field -- as a roll, or as one more word in a list.
  root.querySelectorAll('select[data-append]').forEach((sel) => {
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      const [list, index, field] = sel.dataset.append.split('|');
      const current = model.list(list)[Number(index)]?.[field];
      const join = sel.dataset.join === ',' ? appendListText : appendDiceText;
      model.setItem(list, Number(index), field, join(current, sel.value));
      on.render();
    });
  });
  // A card moved or copied between the deck and the sideboard.
  root.querySelectorAll('[data-card-move]').forEach((b) => {
    b.addEventListener('click', () => {
      const [list, index, to, how] = b.dataset.cardMove.split('|');
      model.moveCard(list, Number(index), to, { copy: how === 'copy' });
      on.render();
    });
  });
  // One card's dice handed to every card with the same effect.
  root.querySelectorAll('[data-dice-share]').forEach((b) => {
    b.addEventListener('click', () => {
      const [list, index] = b.dataset.diceShare.split('|');
      model.shareCardDice(list, Number(index));
      on.render();
    });
  });

  // A deck manipulation picked from the catalogue: it lands in its own group
  // with a count of one, or bumps the count of the row that already has it
  // -- for whoever's deck view the picker is on, since a squad member takes
  // its own manipulations.
  root.querySelectorAll('select.manip-pick').forEach((sel) => {
    sel.addEventListener('change', () => {
      const entry = deckManipulation(sel.value);
      sel.value = '';
      if (!entry) return;
      const owner = sel.dataset.owner || '';
      const list = model.data.cardcasting?.manipulations || [];
      const idx = list.findIndex((m) => deckManipulation(m.name) === entry && String(m.owner || '') === owner);
      if (idx >= 0) model.setItem('cardcasting.manipulations', idx, 'count', (Number(list[idx].count) || 0) + 1);
      else model.listAdd('cardcasting.manipulations', { group: entry.group, name: entry.name, note: '', count: 1, owner });
      on.render();
    });
  });
  // One copy of a manipulation pick given to someone else: the row loses
  // one and the new owner's row of the same name gains it, so each copy is
  // moved on its own.
  root.querySelectorAll('select[data-manip-owner]').forEach((sel) => {
    sel.addEventListener('change', () => {
      model.moveManipulationPick(Number(sel.dataset.manipOwner), sel.value);
      on.render();
    });
  });
}
