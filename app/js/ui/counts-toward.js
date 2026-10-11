/**
 * counts-toward.js -- the "Counts toward" marks under a caster level.
 *
 * The three casting systems' levels are separate unless a player says one
 * counts toward another (model/transparency.js). This draws the say: one
 * toggle per other caster level on the character, under the level that
 * would count, on the Magic, Vancian and Psionics tabs alike.
 */

import { esc } from './html.js';
import { casterLevelSources, countsToward } from '../model/transparency.js';

/**
 * The marks for the caster level called `name` (`spheres.cl`,
 * `vancian.wizard.cl`, `manifester.psion.level`), or '' when there is no
 * other caster level to count toward. A mark left pointing at a level the
 * character no longer has stays shown, pressed, so it can be taken off.
 */
export function countsTowardLine(model, name) {
  const sources = casterLevelSources(model);
  const me = sources.find((s) => s.name === name);
  if (!me) return '';
  const marked = new Set(countsToward(me.holder));
  const others = sources.filter((s) => s.name !== name);
  const gone = [...marked].filter((to) => to !== name && !others.some((s) => s.name === to));
  if (!others.length && !gone.length) return '';
  const button = (to, label, on, missing = false) => `<button class="tiny" data-action="counts-toward"
      data-source="${esc(name)}" data-target="${esc(to)}" aria-pressed="${on}"
      title="${esc(missing
    ? `${label} is no longer on the sheet. Press to take the mark off.`
    : on
      ? `${me.label} is added to ${label}, as {${to} += ${name}} would add it. Press to keep them separate.`
      : `Separate. Press to add ${me.label} to ${label}.`)}">${esc(label)}</button>`;
  return `<p class="hint countstoward"><span>Counts toward</span>
      ${others.map((s) => button(s.name, s.label, marked.has(s.name))).join('')}
      ${gone.map((to) => button(to, to, true, true)).join('')}
    </p>`;
}
