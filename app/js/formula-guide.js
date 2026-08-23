/**
 * formula-guide.js -- the Formulas tab.
 *
 * The formula language is the most useful thing this app has that a paper
 * sheet does not, and it is worth exactly as much as a player's ability to
 * find their way into it. So this tab is three things at once, in the order a
 * player needs them:
 *
 *   1. a scratchpad, because the fastest way to learn what floor() does is to
 *      type it and watch the answer,
 *   2. an index -- every value the character publishes and every formula
 *      already written on it, searchable, with live numbers,
 *   3. a reference, folded away underneath, that explains the four token
 *      forms, the operators, every built-in function and the handful of rules
 *      that are not guessable.
 *
 * It teaches by showing the character's own numbers rather than a tutorial's
 * invented ones: every example on this tab is evaluated against the character
 * looking at it, so "floor(level / 2)" says what it means for *them*.
 *
 * Pure string-building. State (the draft formula, the search box) lives in the
 * component, which passes it in and binds the controls it renders.
 */

import { resolvePath } from './formula.js';
import { isSheetAlias } from './rules.js';
import {
  highlight, highlightAgainst, highlightFlagging, workings, formatNumber, contextualNote,
  FUNCTION_HELP, OPERATOR_HELP, VALUE_GUIDE, PLACES_GUIDE, TOKEN_FORMS, CONTEXTUAL_VALUES,
} from './formula-format.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/* ------------------------------------------------------------------ *
 * Grouping the character's values
 *
 * scopeNames() hands back several hundred dotted names in one alphabetical
 * run, which is a list, not an answer. Families are what a player actually
 * asks for ("what can I read about my saves?"), so the browser groups them --
 * and puts the ones the player named themselves at the top, because those are
 * the ones they will not remember the spelling of.
 * ------------------------------------------------------------------ */

const ABILITY_KEYS = new Set(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const COMPANION_KEYS = new Set(['familiar', 'animalCompanion', 'eidolon']);
const DEFENCE_KEYS = new Set(['hp', 'ac', 'saves']);
const MAGIC_KEYS = new Set(['caster', 'essence', 'pp', 'deck', 'practitioner', 'mana', 'unarmed']);
const CHARACTER_KEYS = new Set(['level', 'size', 'initiative', 'mythic', 'bab', 'class', 'speed']);

/** The groups, in the order the browser shows them. */
export const VALUE_SECTIONS = [
  { key: 'mine', label: 'Named by you', blurb: 'Every {name = …} written in prose on this character.' },
  { key: 'tracker', label: 'Trackers', blurb: 'Each tracker under the id on its own row — that id never changes when the tracker is renamed.' },
  { key: 'character', label: 'The character', blurb: 'Level, size, initiative, movement rates, mythic tier, base attack bonus, and levels in each class.' },
  { key: 'ability', label: 'Abilities', blurb: 'Score, modifier, and the temporary pair.' },
  { key: 'defence', label: 'Health, armour, saves', blurb: 'As the sheet totals them.' },
  { key: 'offence', label: 'Attack', blurb: 'The attack numbers.' },
  { key: 'skill', label: 'Skills', blurb: 'Each skill total, by its slugged name.' },
  { key: 'magic', label: 'Magic and sub-systems', blurb: 'Caster level, spell points, essence, power points, the deck.' },
  { key: 'companion', label: 'Companions', blurb: 'A familiar, animal companion or eidolon, when the character has one.' },
  { key: 'sheet', label: 'Spreadsheet names', blurb: 'The workbook’s own named ranges, kept so a formula pasted out of one still works — StrMod is str.tempMod, Fort is saves.fortitude. Nothing here is a number you cannot already get another way.' },
  { key: 'other', label: 'Everything else', blurb: '' },
];

/**
 * The groups the destination browser shows, in order.
 *
 * Weapons and damage come first because they are the half of forwarding a
 * player cannot discover any other way: every other destination is a number
 * printed somewhere on the sheet, so a reader at least knows it exists. A
 * weapon's damage channel is named nowhere, matches by shape or group as well
 * as by weapon, and is the one thing here that has to be taught.
 */
export const TARGET_SECTIONS = [
  { key: 'weapon', label: 'Weapons and damage', blurb: 'Attack and damage on the weapon rows — all of them, one kind of them, or one weapon.' },
  { key: 'attack', label: 'Attack', blurb: 'The three attack numbers on the Overview.' },
  { key: 'defence', label: 'Health, armour, saves', blurb: 'Hit points, the armour classes and the three saves.' },
  { key: 'ability', label: 'Ability scores', blurb: 'The score itself — so everything built on it moves with it.' },
  { key: 'skill', label: 'Skills', blurb: 'Each skill by its slugged name, and every skill at once.' },
  { key: 'character', label: 'The character', blurb: 'Initiative, movement rates, and levels in a class.' },
  { key: 'tracker', label: 'Trackers', blurb: 'How big a pool is — its max and min, never what is currently in it.' },
  { key: 'other', label: 'Everything else', blurb: '' },
];

/** Which group a destination belongs to. */
export function classifyTarget(name) {
  const head = String(name).split('.')[0];
  if (head === 'weapon' || head === 'damage') return 'weapon';
  if (head === 'attack') return 'attack';
  if (head === 'skill') return 'skill';
  if (head === 'tracker') return 'tracker';
  if (head === 'class' || head === 'initiative' || head === 'speed') return 'character';
  if (ABILITY_KEYS.has(head)) return 'ability';
  if (DEFENCE_KEYS.has(head)) return 'defence';
  return 'other';
}

/**
 * Every place a bonus may be sent, grouped and searchable.
 *
 * A destination that stands for several ("all saves", "every skill") carries
 * how many it reaches, because that is the difference between the two rows a
 * reader is choosing between.
 */
export function targetGroups(list, query = '') {
  const q = String(query || '').trim().toLowerCase();
  const buckets = new Map(TARGET_SECTIONS.map((sec) => [sec.key, []]));
  for (const t of list || []) {
    if (q && !t.name.toLowerCase().includes(q) && !String(t.label).toLowerCase().includes(q)) continue;
    buckets.get(classifyTarget(t.name)).push({
      name: t.name, label: t.label, reaches: t.family ? t.family.length : 0,
    });
  }
  return TARGET_SECTIONS
    .map((sec) => ({ ...sec, items: buckets.get(sec.key) }))
    .filter((sec) => sec.items.length);
}

/** Which family a dotted name belongs to. */
export function classify(name, inlineNames = {}) {
  if (Object.prototype.hasOwnProperty.call(inlineNames, name)) return 'mine';
  // Before anything else, and by shape rather than by list: the workbook's
  // names are PascalCase and undotted, this sheet's are neither, and the
  // per-character ones (VeilEssenceHands) are generated and so unlistable.
  if (isSheetAlias(name)) return 'sheet';
  const head = String(name).split('.')[0];
  if (head === 'tracker') return 'tracker';
  if (head === 'skill') return 'skill';
  if (head === 'attack') return 'offence';
  if (ABILITY_KEYS.has(head)) return 'ability';
  if (DEFENCE_KEYS.has(head)) return 'defence';
  if (COMPANION_KEYS.has(head)) return 'companion';
  if (MAGIC_KEYS.has(head)) return 'magic';
  if (CHARACTER_KEYS.has(head)) return 'character';
  return 'other';
}

/**
 * Every readable name, grouped and carrying its value now.
 *
 * An inline name may also be a prefix of others (`arms` holding `arms.hp`),
 * so a name that resolves to an object is dropped -- it is a branch, not a
 * value, and a formula reading it would get nothing.
 */
export function valueGroups(names, scope, inlineNames = {}, query = '') {
  const q = String(query || '').trim().toLowerCase();
  const buckets = new Map(VALUE_SECTIONS.map((s) => [s.key, []]));
  for (const name of names) {
    if (q && !name.toLowerCase().includes(q)) continue;
    const value = resolvePath(scope, name);
    if (value === undefined || (value && typeof value === 'object')) continue;
    buckets.get(classify(name, inlineNames)).push({ name, value, display: formatNumber(value) });
  }
  return VALUE_SECTIONS
    .map((s) => ({ ...s, items: buckets.get(s.key) }))
    .filter((s) => s.items.length);
}

/* ------------------------------------------------------------------ *
 * Pieces of the panel
 * ------------------------------------------------------------------ */

/** A formula shown the way this app shows formulas everywhere: coloured, spaced. */
export function formulaHtml(source, knownNames = null) {
  return knownNames ? highlightAgainst(source, knownNames) : highlight(source);
}

/**
 * The working, as rows: what was written, what it reads, what that comes to.
 *
 * The substitution line is dropped when it would only repeat the line above
 * it, so a formula with no names in it does not get a second identical row.
 */
export function workingHtml(source, scope, knownNames = null) {
  const w = workings(source, scope);
  const rows = [`<div class="fx-step"><span class="fx-label">written</span>
    <code class="fx-code">${formulaHtml(w.pretty, knownNames)}</code></div>`];

  if (w.substituted && w.substituted !== w.pretty) {
    rows.push(`<div class="fx-step"><span class="fx-label">with this character&#39;s values</span>
      <code class="fx-code">${formulaHtml(w.substituted)}</code></div>`);
  }
  rows.push(w.error
    ? `<div class="fx-step bad"><span class="fx-label">problem</span>
        <code class="fx-code">${esc(w.error)}</code></div>`
    : `<div class="fx-step out"><span class="fx-label">comes to</span>
        <code class="fx-code fx-answer">${esc(w.display)}</code></div>`);

  if (w.reads.length) {
    rows.push(`<div class="fx-reads">reads ${w.reads.map((r) => `<button type="button"
      class="tag fx-pick${r.known ? '' : ' fx-unknown'}" data-fx-insert="${esc(r.name)}"
      title="${esc(r.known ? `${r.name} = ${formatNumber(r.value)} — click to put it in the box above`
    : contextualNote(r.name) || `${r.name} is not a value this character has`)}">${esc(r.name)}${
  r.known ? `<span class="fx-val">${esc(formatNumber(r.value))}</span>` : ''}</button>`).join('')}</div>`);
  }
  return rows.join('');
}

/** Examples the try-it box offers when it is empty — real, and worth stealing. */
const STARTERS = [
  'floor(level / 2) + wis.mod',
  'if(mythic.tier = 0, 0, 3 + mythic.tier * 2)',
  'min(level, 20) * 2',
  'max(1, floor(bab / 5))',
];

/** The scratchpad: type a formula, watch it resolve against this character. */
export function scratchpadHtml(draft, scope, knownNames) {
  const src = String(draft ?? '');
  return `<section class="panel span2">
    <h3>Try one</h3>
    <p class="hint">Nothing typed here is saved or changes the character — it is a place to see what
      an expression comes to before committing it to a tracker or a feature. Every value below is
      this character&#39;s own.</p>
    <input class="mono fx-try" data-fx-draft placeholder="floor(level / 2) + wis.mod"
      value="${esc(src)}" aria-label="Try a formula" spellcheck="false">
    ${src.trim()
    ? `<div class="fx-working">${workingHtml(src, scope, knownNames)}</div>`
    : `<div class="fx-starters">${STARTERS.map((s) => `<button type="button" class="fx-starter"
        data-fx-insert="${esc(s)}" data-fx-replace="1">${formulaHtml(s)}</button>`).join('')}</div>`}
  </section>`;
}

/** The searchable index of everything this character publishes. */
export function browserHtml(groups, total, query) {
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  return `<section class="panel span2" data-fx-section="values">
    <h3>Values you can read
      <span class="badge">${query ? `${shown} of ${total}` : `${total}`}</span>
    </h3>
    <p class="hint">Every name this character publishes, with what it is worth right now.
      Click one to drop it into the box above.</p>
    ${shown ? groups.map((g) => `<details class="fx-group" ${g.key === 'mine' || query ? 'open' : ''}>
      <summary><strong>${esc(g.label)}</strong> <span class="badge">${g.items.length}</span>
        ${g.blurb ? `<span class="hint"> ${esc(g.blurb)}</span>` : ''}</summary>
      <div class="fx-names">${g.items.map((it) => `<button type="button" class="fx-name-chip"
        data-fx-insert="${esc(it.name)}" title="${esc(`${it.name} = ${it.display}`)}">
        <span class="n">${esc(it.name)}</span><span class="v">${esc(it.display)}</span>
      </button>`).join('')}</div>
    </details>`).join('')
    : `<p class="empty">No value on this character matches “${esc(query)}”.</p>`}
  </section>`;
}

/**
 * The searchable index of everywhere a bonus may be sent.
 *
 * The other half of the values browser, and the half that was missing: a name
 * you can read is printed somewhere on the sheet, so a player at least knows
 * to look for it, but a destination is invisible until someone says it exists.
 * A weapon's damage was reachable all along and simply undiscoverable.
 *
 * These do not go in the try-it box. It evaluates an expression and a
 * destination is not one -- most of them cannot be read at all -- so clicking
 * copies the whole token instead, ready to paste into the feature that grants
 * it.
 */
export function targetsHtml(groups, total, query) {
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  return `<section class="panel span2" data-fx-section="targets">
    <h3>Bonuses you can send
      <span class="badge">${query ? `${shown} of ${total}` : `${total}`}</span>
    </h3>
    <p class="hint">Every destination <code>{… += …}</code> accepts on this character. Click one
      to copy the whole token — paste it into the feat, talent or feature that grants the bonus
      and it lands here, showing in gold beside the field. A destination is written to, not read:
      these names are not values and will not resolve in the box above.</p>
    ${shown ? groups.map((g) => `<details class="fx-group" ${query ? 'open' : ''}>
      <summary><strong>${esc(g.label)}</strong> <span class="badge">${g.items.length}</span>
        ${g.blurb ? `<span class="hint"> ${esc(g.blurb)}</span>` : ''}</summary>
      <div class="fx-names">${g.items.map((it) => `<button type="button" class="fx-name-chip fx-target"
        data-fx-copy="{${esc(it.name)} += 2}"
        title="${esc(`{${it.name} += 2} — ${it.label}${it.reaches ? ` (reaches ${it.reaches})` : ''}. Click to copy.`)}">
        <span class="n">${esc(it.name)}</span><span class="v">${esc(it.label)}</span>
        ${it.reaches ? `<span class="badge">${it.reaches}</span>` : ''}
      </button>`).join('')}</div>
    </details>`).join('')
    : `<p class="empty">No destination on this character matches “${esc(query)}”.</p>`}
    <p class="hint"><strong>A weapon destination is a shape, not a list.</strong>
      <code>weapon.&lt;which&gt;.&lt;what&gt;</code> — where <em>which</em> is
      <code>melee</code>, <code>ranged</code> or <code>cmb</code>, a weapon group
      (<code>heavy_blades</code>), or one weapon’s own short name, and <em>what</em> is
      <code>attack</code>, <code>damage</code>, <code>damage.crit</code> (on a crit only) or
      <code>damage.mult</code> (multiplied by the crit). Leave <em>which</em> out to reach every
      weapon: <code>{damage += 2}</code>, <code>{weapon.attack += 1}</code>. A shape that matches
      nothing today is still right — <code>{weapon.ranged.damage += 2}</code> on a character
      carrying no bow starts working the day one is bought.</p>
  </section>`;
}

/** What each kind of problem is called, and the one-line version of the fix. */
const PROBLEM_KINDS = {
  cycle: {
    label: 'Goes round in a circle',
    lead: 'These wait on each other, so none of them can be worked out.',
  },
  duplicate: {
    label: 'Defined more than once',
    lead: 'One name, two meanings — only the first is in force.',
  },
  shadow: {
    label: 'Name already taken',
    lead: 'The sheet works this one out itself, so a definition cannot take it.',
  },
  orphan: {
    label: 'Nothing defines it',
    lead: 'Something still asks for this name after whatever defined it went away.',
  },
  misdirected: {
    label: 'Bonus goes nowhere',
    lead: 'A forwarded bonus with nothing at the other end of it.',
  },
  broken: {
    label: 'Does not work',
    lead: 'A formula the sheet cannot work out.',
  },
};

/**
 * What is wrong with the names on this character, above the formulas so it is
 * the first thing seen when something is wrong -- and absent entirely when
 * nothing is, because a permanent empty "Problems" box teaches a player to
 * stop reading that part of the page.
 *
 * A cycle appears once, naming its members, rather than as three formulas
 * each complaining about the others; a duplicate shows both definitions and
 * what each comes to, which is the thing needed to decide which to delete.
 */
export function problemsHtml(problems) {
  if (!problems.length) return '';
  return `<section class="panel span2 fx-problems" data-fx-section="problems">
    <h3>Needs attention <span class="badge err">${problems.length}</span></h3>
    ${problems.map((p) => {
    const kind = PROBLEM_KINDS[p.kind] || { label: p.kind, lead: '' };
    return `<div class="fx-problem ${esc(p.kind)}">
      <div class="fx-problemhead">
        <span class="badge err">${esc(kind.label)}</span>
        <code class="fx-code fx-problemname">${esc(p.name)}</code>
      </div>
      <p class="hint">${esc(p.detail)}</p>
      <div class="fx-places">
        ${p.places.map((pl) => `<div class="fx-place${pl.inForce ? ' inforce' : ''}">
          <span class="fx-placelabel">${esc(pl.label)}</span>
          <span class="fx-placewhere">${esc(pl.where)}</span>
          ${pl.formula ? `<code class="fx-code" data-fx-insert="${esc(pl.formula)}" data-fx-replace="1"
            title="Click to open this in the box above">${highlight(pl.formula)}</code>` : ''}
          ${pl.value === null || pl.value === undefined ? '' : `<span class="fx-placeval">${esc(formatNumber(pl.value))}</span>`}
        </div>`).join('')}
      </div>
    </div>`;
  }).join('')}
  </section>`;
}

/** How an audit row's source reads on a player-facing list. */
const SOURCE_LABEL = {
  inline: 'named in prose',
  skill: 'skill',
  weapon: 'weapon',
  crafting: 'crafting',
  player: 'field',
  sheet: 'tracker (from the sheet)',
};

/**
 * Every formula already on this character, which is the other half of "pull
 * it up": most of the time a player does not want to write a formula, they
 * want to find the one they wrote three sessions ago and copy the trick.
 */
export function myFormulasHtml(rows, query) {
  const q = String(query || '').trim().toLowerCase();
  const matches = rows.filter((r) => !q
    || String(r.formula).toLowerCase().includes(q)
    || String(r.name).toLowerCase().includes(q));
  const broken = matches.filter((r) => r.status === 'error');

  return `<section class="panel span2" data-fx-section="formulas">
    <h3>Formulas on this character
      <span class="badge">${query ? `${matches.length} of ${rows.length}` : rows.length}</span>
      ${broken.length ? `<span class="badge err">${broken.length} not working</span>` : ''}
    </h3>
    <p class="hint">Everything written on this sheet, wherever it lives. This is the same list your
      GM sees — formulas are text, so there is nothing hidden in them.</p>
    ${rows.length === 0
    ? `<p class="empty">Nothing yet. Name a value in any description — write
        <code>{qi.max = wis.mod + level}</code> into a class feature — and it appears here,
        and in the list below, for the rest of the character to read.</p>`
    : matches.length === 0
      ? `<p class="empty">No formula here matches “${esc(query)}”.</p>`
      : matches.map((r) => `<div class="fx-row${r.status === 'error' ? ' bad' : ''}">
          <div class="fx-rowhead">
            <strong>${esc(r.name)}</strong>
            <span class="badge">${esc(r.where || SOURCE_LABEL[r.source] || r.source)}</span>
            ${r.status === 'error' ? '<span class="badge err">not working</span>' : ''}
            <span class="fx-rowval">${r.value === null || r.value === undefined ? '—' : esc(formatNumber(r.value))}</span>
          </div>
          <code class="fx-code fx-rowsrc" data-fx-insert="${esc(r.formula)}" data-fx-replace="1"
            title="Click to open this in the box above">${
  highlightFlagging(r.formula, r.unknownReferences)}</code>
          ${r.error ? `<div class="fx-err">${esc(r.error)}</div>` : ''}
        </div>`).join('')}
  </section>`;
}

/**
 * Every bonus this character forwards somewhere, and where each one lands.
 *
 * The whole point of forwarding is that the rule stops living in the column
 * it affects -- so this is the list that answers the question the column can
 * no longer answer on its own: what is arriving on this sheet from somewhere
 * else, and what sent it. Grouped by destination, because "why is Bluff +46?"
 * is the question a player actually arrives with.
 *
 * Absent when the character forwards nothing, like the problems panel: an
 * empty box that is always there teaches a player to stop looking at it.
 */
export function forwardedHtml(rows, query) {
  if (!rows.length) return '';
  const q = String(query || '').trim().toLowerCase();
  const matches = rows.filter((r) => !q
    || String(r.expr).toLowerCase().includes(q)
    || String(r.to).toLowerCase().includes(q)
    || String(r.where).toLowerCase().includes(q));

  return `<section class="panel span2" data-fx-section="forwarded">
    <h3>Forwarded bonuses
      <span class="badge">${query ? `${matches.length} of ${rows.length}` : rows.length}</span>
    </h3>
    <p class="hint">Bonuses written as <code>{skill.bluff += …}</code> in one place and added
      somewhere else. Each lands on the number named here, and shows in gold beside the field
      it lands on.</p>
    ${matches.length === 0
    ? `<p class="empty">No forwarded bonus here matches &ldquo;${esc(query)}&rdquo;.</p>`
    : matches.map((r) => `<div class="fx-row${r.error ? ' bad' : ''}">
        <div class="fx-rowhead">
          <strong>${esc(r.to)}</strong><code class="fx-into">${r.value < 0 ? '-=' : '+='}</code>
          ${r.type ? `<span class="badge">${esc(r.type)}</span>` : ''}
          <span class="badge">${esc(r.where)}</span>
          ${r.error ? '<span class="badge err">not working</span>' : ''}
          ${!r.error && r.dropped?.length
    ? `<span class="badge err">${esc(r.dropped.join(', '))} goes nowhere</span>` : ''}
          <span class="fx-rowval">${r.error ? '—'
    : esc(`${r.value > 0 ? '+' : ''}${formatNumber(r.value)}`)}</span>
        </div>
        <code class="fx-code fx-rowsrc" data-fx-insert="${esc(r.expr)}" data-fx-replace="1"
          title="Click to open this in the box above">${highlight(r.expr)}</code>
        ${r.error ? `<div class="fx-err">${esc(r.error)}</div>` : ''}
      </div>`).join('')}
  </section>`;
}

/* ------------------------------------------------------------------ *
 * The reference
 * ------------------------------------------------------------------ */

/** An example, coloured, with what it comes to on this character beside it. */
function egHtml(source, scope) {
  const w = workings(source, scope);
  return `<code class="fx-code fx-eg" data-fx-insert="${esc(source)}" data-fx-replace="1"
    title="Click to try it above">${highlight(source)}${w.ok
  ? `<span class="fx-eg-val">${esc(w.display)}</span>` : ''}</code>`;
}

/** The four token forms — the only syntax there is to learn. */
function formsHtml(scope) {
  return `<section class="panel span2">
    <h3>Making your own value</h3>
    <p class="hint">Anywhere you can type a description — a class feature, a note, a trait, a veil,
      a weapon&#39;s properties — braces turn part of the sentence into a number the sheet keeps up
      to date. There are four of them, and that is the whole of the syntax.</p>
    <div class="fx-forms">
      ${TOKEN_FORMS.map((f) => `<div class="fx-form">
        <code class="fx-code fx-formcode">${esc(f.form)}</code>
        <div class="fx-formname">${esc(f.name)}</div>
        <p class="hint">${esc(f.what)}</p>
        <code class="fx-code fx-formeg">${esc(f.eg)}</code>
      </div>`).join('')}
    </div>
    <p class="hint">A name may be a dotted label — <code>qi.max</code>, <code>arms.hp</code> — and
      names may read each other in any order, wherever on the character they are written. Define
      <code>{burn.max = 18}</code> in one feature and
      <code>{qi.max = floor((burn.max + qi.base) / 4)}</code> in another, and they resolve.
      A field that understands formulas carries a soft gold bar down its right edge.</p>
    <div class="fx-walk">
      <div class="fx-walkstep"><span class="fx-stepno">1</span>
        <div><strong>Write it once, in the ability it belongs to.</strong>
          <code class="fx-code">Ki pool ${'{'}ki.max = floor(level / 2) + wis.mod${'}'}</code>
          <p class="hint">The feature now reads &ldquo;Ki pool ${
  esc(formatNumber(workings('floor(level / 2) + wis.mod', scope).value ?? 0))}&rdquo; and follows
          the character. Hover it to see the formula, click to edit it.</p></div></div>
      <div class="fx-walkstep"><span class="fx-stepno">2</span>
        <div><strong>Use the name anywhere else.</strong>
          <code class="fx-code">${'{'}ki.max${'}'}</code> in another feature,
          <code class="fx-code">ki.max</code> in any formula field — no braces there, because the
          whole field is already an expression.</div></div>
      <div class="fx-walkstep"><span class="fx-stepno">3</span>
        <div><strong>Give it pips.</strong>
          <p class="hint">On the Trackers tab, add a tracker with <code>ki.max</code> as its max.
          It is now a pool you can spend, and it resizes itself when your Wisdom or level changes.</p></div></div>
    </div>
  </section>`;
}

/** Where formulas may be written. */
function placesHtml() {
  return `<section class="panel">
    <h3>Where they work</h3>
    <div class="rowlist">
      ${PLACES_GUIDE.map((p) => `<div class="item">
        <div class="t">${esc(p.where)}</div>
        <div class="d">${esc(p.what)}</div>
        <code class="fx-code">${esc(p.eg)}</code>
      </div>`).join('')}
    </div>
  </section>`;
}

/** Operators. */
function operatorsHtml(scope) {
  return `<section class="panel">
    <h3>Operators</h3>
    <table class="fx-table"><tbody>
      ${OPERATOR_HELP.map((o) => `<tr>
        <td class="fx-op-cell"><code class="fx-code">${esc(o.op)}</code></td>
        <td>${esc(o.what)}<div>${egHtml(o.eg, scope)}</div></td>
      </tr>`).join('')}
    </tbody></table>
  </section>`;
}

/** Every built-in, grouped, each with what it comes to here. */
function functionsHtml(scope) {
  const groups = [];
  for (const f of FUNCTION_HELP) {
    const last = groups[groups.length - 1];
    if (last && last.name === f.group) last.items.push(f);
    else groups.push({ name: f.group, items: [f] });
  }
  return `<section class="panel span2">
    <h3>Functions <span class="badge">${FUNCTION_HELP.length}</span></h3>
    <p class="hint">These are all of them. Names are not case-sensitive, so
      <code>FLOOR</code> and <code>floor</code> are the same call.</p>
    ${groups.map((g) => `<div class="fx-fngroup">
      <h4>${esc(g.name)}</h4>
      ${g.items.map((f) => `<div class="fx-fn-row">
        <code class="fx-code fx-sig">${esc(f.sig)}</code>
        <div class="fx-fn-what">${esc(f.what)}</div>
        <div class="fx-fn-eg">${egHtml(f.eg, scope)}</div>
      </div>`).join('')}
    </div>`).join('')}
  </section>`;
}

/** The value families — what a name means, which the live list cannot say. */
function familiesHtml() {
  return `<section class="panel span2">
    <h3>What the built-in names mean</h3>
    <table class="fx-table"><tbody>
      ${VALUE_GUIDE.map((v) => `<tr>
        <td class="fx-fam"><code class="fx-code">${esc(v.prefix)}</code></td>
        <td>${esc(v.what)}</td>
      </tr>`).join('')}
    </tbody></table>
  </section>`;
}

/**
 * Names that only work in one kind of field.
 *
 * Its own section because it is the sharpest edge in the language: these read
 * like ordinary values, work perfectly where they belong, and are simply
 * absent everywhere else -- including in the try-it box above, which has no
 * veil and no tracker around it.
 */
function contextualHtml() {
  return `<section class="panel span2">
    <h3>Names that only exist somewhere</h3>
    <p class="hint">Almost every value belongs to the character and can be read from anywhere.
      These two belong to the <em>field they are written in</em>, and will not resolve outside it —
      not in another feature, not in a tracker, and not in the try-it box at the top of this tab.
      When one is flagged in red, that is what has happened.</p>
    <table class="fx-table"><tbody>
      ${CONTEXTUAL_VALUES.map((v) => `<tr>
        <td class="fx-fam"><code class="fx-code">${esc(v.names)}</code></td>
        <td><strong>Only in ${esc(v.where)}</strong> — ${esc(v.what)}</td>
      </tr>`).join('')}
    </tbody></table>
  </section>`;
}

/**
 * The rules that are not guessable.
 *
 * Every one of these is a thing that will otherwise be discovered as a bug at
 * the table: a name that silently did not publish, a tracker id that is not
 * the tracker's name, a note that reads `self` where nothing else can.
 */
function rulesHtml() {
  const rules = [
    ['A name is character-wide.',
      'Defined once, readable everywhere — trackers, weapon tokens, skill formulas, other prose. Order does not matter; the sheet works out what depends on what.'],
    ['A name cannot take one the sheet already owns.',
      'Writing {level = 30} is refused outright and told to you, rather than showing 30 where it is written while every formula reading level goes on getting the real number. That goes for a branch of one too — str already holds str.mod, so it cannot be redefined either.'],
    ['One name, defined once.',
      'Define a name twice and the first one wins, both are flagged, and Needs attention shows you both so you can delete the one you did not mean. First rather than last, so that pasting in a new page cannot quietly change what an existing name is worth.'],
    ['Definitions must not wait on each other.',
      'If a reads b and b reads a, neither can be worked out; the loop is reported once, naming every member, rather than as several unrelated faults.'],
    ['A total is also a family.',
      'Where a number has parts, the parts hang off its own name and the name goes on meaning the number: saves.will is the save, saves.will.luck is what luck is worth in it, and ac.total and ac are the same thing. So a formula written before a total grew parts never has to be revisited.'],
    ['Capitals do not matter.',
      'Level, level and LEVEL are the same value, and so are skill.senseMotive and skill.sense_motive’s spelling in either case. Names are shown in the list the way the sheet publishes them, but nothing is ever refused for the case it was typed in.'],
    ['Spreadsheet names still work.',
      'The workbook this sheet was imported from had its own names — StrMod, Fort, MythicTier, VeilEssenceHands — and they are published alongside. A formula you already had working can be pasted in as it stands. They are listed under Spreadsheet names, with the value each one is another name for.'],
    ['A tracker’s id is not its name.',
      'The id is slugged from the name the tracker was created with and never changes afterwards, so renaming a tracker cannot break a formula pointing at it. Each tracker’s ✎ editor spells out its own id.'],
    ['A few names only exist in one kind of field.',
      'self inside a tracker, essence.self inside a veil. They are the easiest thing here to get wrong, so they have a table of their own above.'],
    ['A tracker’s note shows values but does not publish them.',
      'Notes are worked out after the trackers they read, so a {name = …} in one displays but is not readable elsewhere. Put character-wide names in a feature or a note on Lore instead.'],
    ['Comparisons are worth 1 and 0.',
      'So (level >= 11) + (level >= 14) counts how many thresholds have been passed — which is usually shorter than nesting if()s.'],
    ['Nothing here can reach the page.',
      'Formulas are parsed and walked, never executed as code: no eval, no network, no DOM, no other characters. Length, size and depth are capped, so a formula cannot hang the sheet. That is why you are allowed to write them at all.'],
  ];
  return `<section class="panel span2">
    <h3>Rules worth knowing</h3>
    <div class="rowlist">
      ${rules.map(([t, d]) => `<div class="item"><div class="t">${esc(t)}</div>
        <div class="d">${esc(d)}</div></div>`).join('')}
    </div>
  </section>`;
}

/** The whole reference, folded away under the working parts of the tab. */
export function referenceHtml(scope, open) {
  return `<section class="panel span2 fx-ref">
    <details ${open ? 'open' : ''} data-fx-ref>
      <summary><h3 style="display:inline">Reference</h3>
        <span class="hint"> — the four forms, where they work, every operator and function,
        and the rules that are not guessable</span></summary>
      <div class="grid" style="margin-top:10px">
        ${formsHtml(scope)}
        ${placesHtml()}
        ${operatorsHtml(scope)}
        ${functionsHtml(scope)}
        ${familiesHtml()}
        ${contextualHtml()}
        ${rulesHtml()}
      </div>
    </details>
  </section>`;
}

/**
 * The tab.
 *
 * @param {object} o
 * @param {string[]} o.names        every readable name (model.scopeNames())
 * @param {object}   o.scope        the character's formula scope
 * @param {object}   o.inlineNames  the {name = …} the player defined
 * @param {object[]} o.audit        model.audit() rows
 * @param {object[]} o.targets      model.forwardTargetList -- every {… += …} destination
 * @param {string}   o.draft        what is in the try-it box
 * @param {string}   o.query        what is in the search box
 * @param {boolean}  o.refOpen      whether the reference is unfolded
 */
export function formulaPanelHtml({
  names, scope, inlineNames = {}, audit = [], problems = [], forwarded = [],
  targets = [], draft = '', query = '', refOpen = false,
}) {
  const known = new Set(names);
  const groups = valueGroups(names, scope, inlineNames, query);
  const total = names.length;
  const tgroups = targetGroups(targets, query);
  return `<div class="grid fx-tab">
    <section class="panel span2 fx-intro">
      <h3>Formulas</h3>
      <p class="hint">A formula is an expression written where a number would go — in a tracker&#39;s
        max, in a field, or inside braces in the middle of a sentence. The sheet keeps it up to
        date: change your Wisdom and everything that read it moves. You can name your own values
        and build on them, and everything you write stays as text you (and your GM) can read.</p>
      <input class="fx-search" data-fx-query placeholder="Search values, destinations and formulas — wis, damage, tracker.burn"
        value="${esc(query)}" aria-label="Search values, destinations and formulas" spellcheck="false">
    </section>
    ${problemsHtml(problems)}
    ${scratchpadHtml(draft, scope, known)}
    ${myFormulasHtml(audit, query)}
    ${forwardedHtml(forwarded, query)}
    ${browserHtml(groups, total, query)}
    ${targets.length ? targetsHtml(tgroups, targets.length, query) : ''}
    ${referenceHtml(scope, refOpen)}
  </div>`;
}
