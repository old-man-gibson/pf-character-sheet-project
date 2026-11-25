/*
 * The search list: what opens over a long picker in place of the browser's
 * own drop-down.
 *
 * A browser's list finds a choice by its first letters and forgets them
 * between keys, so "int" in two hundred destinations landed on whatever
 * starts with T. This one has a box to type in and keeps every choice that
 * holds what was typed, anywhere in its name, its formula name or its group.
 *
 * The picker stays a `<select>`: this reads its choices, and a pick sets its
 * value and fires its `change`, so nothing about saving is new. A touch
 * screen keeps its own picker. sheet-element.js opens and shuts it
 * (`#openSearchList`); the builders here are strings and plain data.
 *
 * A row is { value, label, side, group }: `side` is the small second name on
 * the right (a destination's formula name, a type's short form).
 */

import { esc } from './html.js';

/** The label of the choice that stands for a name of the player's own. */
export const OWN_CHOICE_LABEL = 'Custom…';

const lower = (v) => String(v ?? '').toLowerCase();

const parts = (v) => lower(v).split(/[^a-z0-9]+/).filter(Boolean);

/**
 * How well a row answers what was typed: lower is better, -1 is not at all.
 *
 * Every word typed must start a word of the row: of its label, its group or
 * its second name. Letters from the middle of a word do not count, or "int"
 * would find every "points". A word typed with punctuation in it
 * (`ac.touch`) is looked for as written. A label that starts with the whole
 * of what was typed comes first, then a label that holds every word, then
 * the rest.
 */
function score(row, query, words) {
  const label = lower(row.label);
  const text = [label, lower(row.side), lower(row.group)];
  const starts = text.map(parts);
  const found = (w, i) => (/[^a-z0-9]/.test(w) ? text[i].includes(w) : starts[i].some((p) => p.startsWith(w)));
  if (!words.every((w) => text.some((_, i) => found(w, i)))) return -1;
  if (label.startsWith(query)) return 0;
  if (words.every((w) => found(w, 0))) return 1;
  return 2;
}

/**
 * The rows to show for what was typed, best first. Nothing typed is every
 * row in the picker's own order.
 */
export function rankRows(rows, typed) {
  const query = lower(typed).trim().replace(/\s+/g, ' ');
  if (!query) return [...rows];
  const words = query.split(' ');
  return rows
    .map((row, at) => ({ row, at, s: score(row, query, words) }))
    .filter((r) => r.s >= 0)
    .sort((a, b) => a.s - b.s || a.at - b.at)
    .map((r) => r.row);
}

/**
 * Whether what was typed may be offered as a name of the player's own: it
 * is something, and no choice already goes by it.
 */
export function ownChoice(rows, typed) {
  const name = String(typed ?? '').trim();
  if (!name) return '';
  const taken = (v) => lower(v) === lower(name);
  return rows.some((r) => taken(r.label) || taken(r.value) || taken(r.side)) ? '' : name;
}

/** The box and the empty list. `label` says what is being picked. */
export function searchListHtml(label) {
  return `<input type="text" class="sl-input" role="combobox" aria-expanded="true" aria-controls="sl-list"
      aria-autocomplete="list" aria-label="${esc(label)}" placeholder="Search" autocomplete="off" spellcheck="false">
    <div class="sl-list" id="sl-list" role="listbox" aria-label="${esc(label)}"></div>`;
}

/**
 * The list's rows. `shown` is what `rankRows` gave; with nothing typed the
 * picker's groups are headings, and with something typed each row says its
 * group instead, since the best answers come from several. `own` is a name
 * to offer after them (see `ownChoice`). Row `i` is `shown[i]`; the own
 * name is row `shown.length`.
 */
export function searchRowsHtml(shown, { typed = '', current = '', at = 0, own = '' } = {}) {
  const flat = String(typed).trim() !== '';
  let group = '';
  const rows = shown.map((row, i) => {
    const head = !flat && row.group && row.group !== group ? `<div class="sl-group" role="presentation">${esc(row.group)}</div>` : '';
    group = row.group;
    const on = String(row.value) === String(current);
    return `${head}<div class="sl-row${on ? ' on' : ''}" role="option" id="sl-o-${i}" data-sl="${i}" aria-selected="${i === at}">
        <span class="sl-label">${esc(row.label)}</span>${
  flat && row.group ? `<span class="sl-in">${esc(row.group)}</span>` : ''}${
  row.side ? `<span class="sl-side">${esc(row.side)}</span>` : ''}
      </div>`;
  });
  if (own) {
    const i = shown.length;
    rows.push(`<div class="sl-row own" role="option" id="sl-o-${i}" data-sl="${i}" aria-selected="${i === at}">
        <span class="sl-label">Use “${esc(own)}”</span><span class="sl-in">your own</span>
      </div>`);
  }
  return rows.join('') || '<div class="sl-none">Nothing matches.</div>';
}
