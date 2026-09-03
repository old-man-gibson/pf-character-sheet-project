/**
 * ui/html.js -- the primitives every piece of rendered markup is built from.
 *
 * Escaping, the em dash a missing value shows as, and the `data-ab` hook that
 * colours anything naming an ability. They live here rather than in
 * sheet-element.js because the panel modules need them too, and a control
 * builder that cannot escape a string is not much of a control builder.
 *
 * Nothing in this file knows about the character or the element: give it a
 * value, it gives you a string.
 */
import { ABILITIES, ABILITY_LABELS } from '../rules.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** A value as a cell shows it: an em dash where there is nothing to show. */
export const val = (v) => (v === null || v === undefined || v === '' ? '—' : esc(v));

/** The six abilities as the pick selectors label them. */
export const ABILITY_LABELS_LIST = ABILITIES.map((k) => ABILITY_LABELS[k]);

/** The ability a value names ('Str' -> 'str'), or '' if it names none. */
export const abilityKey = (value) => {
  const k = String(value ?? '').trim().toLowerCase();
  return ABILITIES.includes(k) ? k : '';
};

/**
 * Is this list of choices abilities -- all six, or one track's three?
 *
 * Asked of the options rather than declared at each of the two dozen call
 * sites, because an ability slot goes by a different name at nearly every one
 * (a save's stat, a weapon's damage ability, a card's suit) while the choices
 * are always these. So a slot written tomorrow is coloured the day it lands.
 */
export const picksAbility = (values) => values.length > 1 && values.every((v) => abilityKey(v));

/**
 * The hook a dropdown and its options hang their colour on; see "ability
 * colour coding" in the stylesheet. It stays on a picker with nothing picked,
 * empty, so the change handler has something to find and repaint.
 */
export const abAttr = (on, value) => (on ? ` data-ab="${abilityKey(value)}"` : '');

/**
 * The same hook where the caller knows the ability rather than the value
 * naming it -- an attack mode is called "Alt Melee", and which stat it runs
 * on is a fact about the character rather than about the word.
 */
export const abKeyAttr = (key) => ` data-ab="${abilityKey(key)}"`;

export const EXPR_HINT = 'Formulas work here: write an expression (level * 100, 3 + con.mod) '
  + 'instead of a number.';

/**
 * What a catalogue knows about the thing a row just named.
 *
 * Three tables pick out of a catalogue now -- feats on Feats & Mythic, spells
 * on Vancian, powers on Psionics -- and each wants the same two things said
 * in the same order: the stat line the book prints above a rule, and the rule.
 * One renderer, so the three cannot drift into three house styles.
 *
 * It shows the *catalogue's* text and never the player's, and it shows it
 * **beside** their note rather than instead of it. It used to give way the
 * moment they wrote anything, which had it exactly backwards: a note is
 * usually *about* the rule -- "9 additional attacks of opportunity" only
 * means something next to the rule it is counting -- so hiding the rule the
 * moment somebody worked something out from it took the reference away
 * exactly when it had become useful.
 *
 * Nothing here is ever copied onto the character. The player's own writing
 * has its own editable cell and is the only thing the sheet saves; this is
 * read where it stands, so that a corrected pack corrects every sheet and an
 * exported character stays a list of names.
 */
export function catalogueFace(details, { compact = true } = {}) {
  if (!details?.known) return '';
  const fields = (details.fields || [])
    .map(([k, v]) => `<span class="catfield"><i>${esc(k)}</i> ${esc(v)}</span>`).join('');
  const text = String(details.text ?? '').trim();
  const shown = compact && text.length > 400 ? `${text.slice(0, 400).replace(/\s+\S*$/, '')}…` : text;
  return `<div class="catface">
    ${fields ? `<div class="catfields">${fields}</div>` : ''}
    ${shown ? `<div class="cattext">${esc(shown).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>')}</div>` : ''}
    ${details.source ? `<div class="catsource">${esc(details.source)}</div>` : ''}
  </div>`;
}

/**
 * A `<datalist>` a name cell picks from -- declared here, filled when someone
 * types into it.
 *
 * It used to carry every option. That was fine at a few hundred and wrong at
 * 8,912: the feats list alone was **91% of the Feats tab's DOM** (8,912 nodes
 * of 9,828, 617 KB of markup) and cost **61 ms of every render** of that tab
 * -- and the sheet re-renders wholesale, so that was 61 ms on each edit.
 *
 * So the element emits the box and nothing in it, and `#fillDatalist` puts a
 * few dozen matches in when there is a query to match against. Which
 * catalogue to ask, and how to narrow it, is stated here and read there:
 * these panels are string builders that touch no DOM, and filling one is DOM
 * work that belongs in the element.
 *
 * Emitted only when there is a catalogue behind it, so a sheet with no packs
 * has the free-text box it always had.
 */
export function nameDatalist(id, fill, { classes = [], has = true } = {}) {
  if (!has) return '';
  const narrow = classes.filter(Boolean).join(',');
  return `<datalist id="${esc(id)}" data-fill="${esc(fill)}"${
    narrow ? ` data-classes="${esc(narrow)}"` : ''}></datalist>`;
}

/**
 * The fold key for one row's reference.
 *
 * Keyed on **where the row is**, not on what it holds. Keying it on the
 * entry's name looked tidier and survived a drag between groups, but it made
 * two rows of the same feat one row as far as the caret was concerned: taking
 * Extra Rage twice and folding one folded the other, which reads as a bug
 * because it is one. A path is unique per row, which is the whole requirement.
 *
 * The cost is the ordinary one for an index-keyed fold: reorder a list and
 * the fold stays with the position rather than the row. Every other fold on
 * this sheet behaves that way (`mythic:${i}:effect`, `veil:${slot || i}`), it
 * loses nothing but a caret's position, and it is much the smaller surprise.
 */
export const catFoldKey = (path) => `catref:${path}`;

/**
 * A notes cell: what the player wrote, and the pack's own words under it.
 *
 * Three shapes rather than two, and which one you get depends only on
 * whether there is anything to show:
 *
 *  - **no pack note** — the cell is the prose box it has always been, full
 *    width, with nothing beside it. Most rows on most sheets.
 *  - **a pack note, open** — the box gives up a little width to a caret, and
 *    the pack's text sits underneath it.
 *  - **a pack note, folded** — the caret alone, and the row is as short as it
 *    was before any of this existed.
 *
 * The caret is what makes the reference optional without making it a setting:
 * a player who has written their own note on a feat they know well can put
 * the book away for that row and leave it open on the next one. `path` is
 * what tells the rows apart -- see `catFoldKey`.
 */
export function noteCell(proseHtml, details, collapsed = {}, path = '') {
  const face = catalogueFace(details);
  if (!face) return proseHtml;
  const key = catFoldKey(path);
  const shut = !!collapsed[key];
  return `<div class="notecell">
    <div class="noteline">
      <div class="notebox">${proseHtml}</div>
      <button class="disclose catfold" data-collapse="${esc(key)}" data-collapse-to="${!shut}"
        aria-expanded="${!shut}" title="${shut ? 'Show what the pack says' : 'Hide what the pack says'}"
        >${shut ? '▸' : '▾'}</button>
    </div>
    ${shut ? '' : face}
  </div>`;
}
