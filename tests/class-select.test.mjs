/**
 * Every cell that names one of the character's classes is the one class
 * picker (ui/class-select.js): the same select, the same list, the same
 * handling of a name that is not a class.
 * Run: node tests/class-select.test.mjs
 */
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import { classNames, classSelect } from '../app/js/ui/class-select.js';
import { itemSelect } from '../app/js/ui/rows.js';
import * as combat from '../app/js/ui/panels/combat.js';
import * as gear from '../app/js/ui/panels/gear.js';
import * as subsystems from '../app/js/ui/panels/subsystems.js';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else {
    fail++;
    console.log(`  FAIL ${label}\n       expected ${JSON.stringify(expected)}\n            got ${JSON.stringify(actual)}`);
  }
}

/** The options of the select bound by `binding` (`data-item="…"` or `data-set="…"`), or null when there is none. */
function optionsOf(html, binding) {
  const at = html.indexOf(`<select ${binding}`);
  if (at < 0) return null;
  const body = html.slice(at, html.indexOf('</select>', at));
  return [...body.matchAll(/<option value="([^"]*)"/g)].map((x) => x[1]);
}

console.log('the list: the Classes table, the Planner, and names training blocks hold');
const c = new Character(blankDocument({ name: 'Picker', level: 6 }));
c.set('classes', [{ name: 'Druid', levelsOverride: 3 }]);
c.setProgressionClass(1, 0, 'Incanter');
check('a class on either list can be picked', classNames(c), ['Druid', 'Incanter']);

console.log('the picker');
{
  const html = classSelect(c, 'x', 0, 'name', 'Simple Harbinger', { more: [{ group: 'Templates', options: ['Simple Harbinger'] }, { group: 'Feats', options: [] }] });
  check('classes, then a group per kind; an empty group is left out',
    [...html.matchAll(/<option value="([^"]*)"|<optgroup label="([^"]*)"/g)].map((x) => x[1] ?? `[${x[2]}]`), ['', 'Druid', 'Incanter', '[Templates]', 'Simple Harbinger']);
  check('a name in a group is selected, not marked', [html.includes('Simple Harbinger *'), /value="Simple Harbinger"[^>]* selected/.test(html)], [false, true]);
  check('a name in none of them stays, marked',
    itemSelect('x', 0, 'name', 'Roil Dancer', ['Druid', { group: 'Feats', options: ['Power Attack'] }]).includes('>Roil Dancer *<'), true);
}

console.log('every class cell offers the same list');
{
  const want = ['', 'Druid', 'Incanter'];
  c.listAdd('training.magic.classes', { name: '' });
  check('a sphere training block', optionsOf(combat.renderMagicPanel(c), 'data-item="training.magic.classes|0|name"'), want);

  c.listAdd('akashic.classes', { name: '', added: true });
  check('a veilweaving class row', optionsOf(subsystems.akashicPanel(c, {}), 'data-item="akashic.classes|0|name"'), want);

  c.listAdd('vancian.classes', { name: '', slotType: 'Wizard' });
  check('a casting block', optionsOf(subsystems.vancianPanel(c, {}), 'data-item="vancian.classes|0|name"'), want);

  c.listAdd('psionics.classes', { name: '', stat: 'Int', stat2: '', curveTotal: 0, manifesterLevelOverride: null, powers: [] });
  check('a manifesting block', optionsOf(subsystems.psionicsPanel(c, {}), 'data-item="psionics.classes|0|name"'), want);

  c.listAdd('maneuvers.sources', { name: '', known: '', readied: '', stances: '' });
  check('a maneuver source, which can also name a template or a feat',
    optionsOf(subsystems.maneuversPanel(c, {}), 'data-item="maneuvers.sources|0|name"')?.slice(0, 3), want);

  c.addCompanion('eidolon');
  const eidolon = subsystems.companionPanel(c, 'eidolon');
  const master = eidolon.match(/<select data-set="([^"]*\.masterClass)"/)?.[1];
  check('a companion’s master class, a Classes table class included', optionsOf(eidolon, `data-set="${master}"`), want);

  c.listAdd('equipment.weapons', { name: 'Fist', useUnarmedDice: true });
  c.set('training.combat.unarmed.nativeProgression', true);
  c.data.uiPrefs.collapsed['unarmed-setup'] = false;
  c.data.uiPrefs.collapsed['unarmed-practitioner'] = false;
  const unarmed = gear.renderGearPanel(c, {});
  const native = unarmed.match(/<select data-set="([^"]*native\.className)"/)?.[1];
  check('a class’s own unarmed table, blank meaning character level',
    [optionsOf(unarmed, `data-set="${native}"`), /<option value=""[^>]*>— character level —</.test(unarmed)], [want, true]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
