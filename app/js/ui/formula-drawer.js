/**
 * formula-drawer.js -- the pull-out formula lookup at the side of the sheet.
 *
 * The ƒx Formulas tab is where the whole guide lives, and going there means
 * leaving the field you were writing in. This is the part of it a player wants
 * mid-sentence: what is a name called, what does it read right now, where can a
 * bonus be sent, what does a function take. It slides over the sheet from the
 * right edge and never changes the tab.
 *
 * Everything it lists comes from the same places the Formulas tab reads: the
 * names the scope publishes (with their values), the bonus destinations
 * (`forwardTargets`), and the written guide (VALUE_GUIDE, FUNCTION_HELP), so
 * the two cannot disagree about what exists.
 */

import { esc } from './html.js';
import { evaluateFormula } from '../formula.js';
import { FUNCTION_HELP, VALUE_GUIDE, formatNumber } from '../formula-format.js';

/** How many of each kind are shown at once; the search narrows the rest. */
const LIMIT = { names: 60, targets: 30, functions: 12, guide: 12 };

const words = (q) => String(q ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
const matches = (text, terms) => {
  const t = String(text ?? '').toLowerCase();
  return terms.every((w) => t.includes(w));
};

/**
 * Everything the search finds, kind by kind. `query` is words, each of which
 * must appear (in a name, a label or a description); empty finds the guide
 * alone, which is where a player who does not know the name yet starts.
 */
export function formulaLookup(model, query) {
  const terms = words(query);
  const guide = VALUE_GUIDE.filter((g) => !terms.length || matches(`${g.prefix} ${g.what}`, terms));
  if (!terms.length) {
    return { terms, names: [], targets: [], functions: [], guide: guide.slice(0, LIMIT.guide), more: {} };
  }
  const scope = model.scope();
  // Closest first: the name itself, then one that starts with what was typed,
  // then one with a part that does; the workbook's own spellings (StrMod,
  // ABPWill) after the sheet's, since they are aliases of names above them.
  const rank = (n) => {
    const low = n.toLowerCase();
    const first = terms[0];
    const fit = low === first ? 0 : low.startsWith(first) ? 1
      : low.split('.').some((p) => p.startsWith(first)) ? 2 : 3;
    // A companion's numbers come after the character's own.
    const companion = /^(?:familiar|animalCompanion|eidolon|conjured)\d*\./.test(n);
    return fit + (companion ? 5 : 0) + (/^[A-Z]/.test(n) ? 10 : 0);
  };
  const allNames = model.scopeNames().filter((n) => matches(n, terms))
    .sort((a, b) => rank(a) - rank(b) || a.split('.').length - b.split('.').length || a.localeCompare(b));
  const names = allNames.slice(0, LIMIT.names).map((name) => {
    let value = null;
    try { value = evaluateFormula(name, scope); } catch { value = null; }
    return { name, value };
  });
  const allTargets = (model.forwardTargets?.()?.list || []).filter((t) => matches(`${t.name} ${t.label}`, terms));
  const functions = FUNCTION_HELP.filter((f) => matches(`${f.name} ${f.sig} ${f.what} ${f.group || ''}`, terms));
  return {
    terms,
    names,
    targets: allTargets.slice(0, LIMIT.targets),
    functions: functions.slice(0, LIMIT.functions),
    guide: guide.slice(0, LIMIT.guide),
    more: {
      names: Math.max(0, allNames.length - LIMIT.names),
      targets: Math.max(0, allTargets.length - LIMIT.targets),
      functions: Math.max(0, functions.length - LIMIT.functions),
    },
  };
}

const shown = (v) => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'string') return v;
  return '…';
};

/** The results under the search box. A name is a button: pressing it copies the name. */
export function formulaDrawerResults(model, query) {
  const r = formulaLookup(model, query);
  const more = (n) => (n ? `<p class="hint">${n} more — keep typing to narrow it.</p>` : '');
  const section = (title, body) => (body ? `<section class="fxsec"><h4>${esc(title)}</h4>${body}</section>` : '');
  const names = r.names.map((n) => `<button type="button" class="fxname" data-fxcopy="${esc(n.name)}"
      title="Copy ${esc(n.name)}"><code>${esc(n.name)}</code><span class="fxval">${esc(shown(n.value))}</span></button>`).join('');
  const targets = r.targets.map((t) => `<button type="button" class="fxname" data-fxcopy="${esc(`{${t.name} += }`)}"
      title="Copy a bonus to ${esc(t.label || t.name)}"><code>${esc(t.name)}</code><span class="fxval">${esc(t.label || '')}</span></button>`).join('');
  const fns = r.functions.map((f) => `<div class="fxfn"><code>${esc(f.sig)}</code><p>${esc(f.what)}</p>
      ${f.eg ? `<button type="button" class="fxeg" data-fxcopy="${esc(f.eg)}" title="Copy the example"><code>${esc(f.eg)}</code></button>` : ''}</div>`).join('');
  const guide = r.guide.map((g) => `<div class="fxfn"><code>${esc(g.prefix)}</code><p>${esc(g.what)}</p>
      ${g.eg ? `<button type="button" class="fxeg" data-fxcopy="${esc(g.eg)}" title="Copy the example"><code>${esc(g.eg)}</code></button>` : ''}</div>`).join('');
  if (r.terms.length && !names && !targets && !fns && !guide) {
    return '<p class="empty">Nothing by that name. Try part of it: “will”, “ac”, “skill”.</p>';
  }
  return [
    r.terms.length ? '' : '<p class="hint">Type part of a name — <code>will</code>, <code>ac.armor</code>, <code>essence</code> — to see what it reads now. Press one to copy it.</p>',
    section('Names, and what they read now', names + more(r.more.names)),
    section('Where a bonus can be sent', targets + more(r.more.targets)),
    section('Functions', fns + more(r.more.functions)),
    section(r.terms.length ? 'In the guide' : 'What there is to read', guide),
  ].join('');
}

/** The drawer itself: its handle, and the panel the handle pulls out. */
export function formulaDrawerHtml() {
  return `<button type="button" class="fxhandle" data-fxtoggle aria-expanded="false"
      aria-controls="fxpanel" title="Formula lookup — names, values and functions (stays on this tab)">ƒx</button>
    <aside id="fxpanel" class="fxpanel" aria-label="Formula lookup" hidden>
      <div class="fxhead">
        <input type="search" data-fxquery placeholder="Search names, bonuses, functions…" aria-label="Search formulas" spellcheck="false">
        <button type="button" class="tiny" data-fxtoggle aria-label="Close the formula lookup">×</button>
      </div>
      <div class="fxresults" aria-live="polite"></div>
      <p class="fxcopied hint" hidden>Copied.</p>
    </aside>`;
}
