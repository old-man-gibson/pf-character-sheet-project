/** Crafting: who crafts, and which skill the check uses.
 *
 *  Run: node tests/crafting.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import { craftCrafter, craftCrafters, craftSkills } from '../app/js/model/subsystems/crafting.js';
import { renderCraftingPanel } from '../app/js/ui/panels/gear.js';
import { fixtureIds, loadCharacter } from './fixtures.mjs';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

console.log('the character crafts by default, with a Craft skill');
{
  const c = new Character(blankDocument({ name: 'Smith', level: 5 }));
  check('only the character while no companion is in use', craftCrafters(c).map((x) => x.id), ['']);
  check('no crafter select then', renderCraftingPanel(c, { draft: {}, openPosts: new Map() }).includes('data-set="crafting.crafter"'), false);
  const skills = craftSkills(c);
  check('Craft skills first, then every other skill', [skills[0].craft, skills.some((s) => s.key === 'Spellcraft')], [true, true]);
  check('the default is a Craft skill', c.data.crafting.calc.skill.startsWith('Craft'), true);
  c.set('crafting.checkSkill', 'Spellcraft');
  check('any skill may be chosen', c.data.crafting.calc.skill, 'Spellcraft');
  c.set('crafting.checkSkill', '');
  check('None stays none', [c.data.crafting.calc.skill, c.data.crafting.calc.skillBonus], [null, 0]);
  check('no crafter written for the character', 'crafter' in c.data.crafting.calc, false);
}

console.log('\na companion crafts with its own skills');
{
  const c = new Character(blankDocument({ name: 'Smith', level: 5 }));
  c.set('eidolon.0.name', 'Brute');
  const id = c.data.eidolon[0].id;
  check('a companion in use is offered', craftCrafters(c).map((x) => x.label), ['Smith', 'Eidolon: Brute']);
  const html = renderCraftingPanel(c, { draft: {}, openPosts: new Map() });
  check('the crafter select is drawn', html.includes('data-set="crafting.crafter"'), true);
  c.set('crafting.checkSkill', 'Spellcraft');
  c.set('crafting.crafter', id);
  const own = c.data.eidolon[0].skills.find((s) => s.name === 'Spellcraft');
  check('the companion is the crafter', [craftCrafter(c).id, c.data.crafting.calc.crafter], [id, 'Eidolon: Brute']);
  check('its skill, its bonus', [c.data.crafting.calc.skill, c.data.crafting.calc.skillBonus], ['Spellcraft', Number(own?.total) || 0]);
  const post = () => c.data.crafting.projects[0].calc;
  check('both posts name the companion', [post().craftPost.includes('**Crafter**: Brute'), post().marketPost.includes('**Character Name:** Brute')], [true, true]);
  c.set('crafting.crafter', '');
  check('back to the character', [craftCrafter(c).id, 'crafter' in c.data.crafting.calc], ['', false]);
  check('both posts name the character', [post().craftPost.includes('**Crafter**: Smith'), post().marketPost.includes('**Character Name:** Smith')], [true, true]);
  c.set('crafting.sellerName', 'Smith the Elder');
  check('the typed name is the character\'s on both posts', [post().craftPost.includes('**Crafter**: Smith the Elder'), post().marketPost.includes('**Character Name:** Smith the Elder')], [true, true]);
}

console.log('\nevery character works out the same as before');
for (const id of fixtureIds()) {
  const doc = loadCharacter(id);
  const m = new Character(JSON.parse(JSON.stringify(doc)));
  check(`${id}: crafter is the character`, craftCrafter(m).id, '');
  check(`${id}: no crafter written`, 'crafter' in (m.data.crafting?.calc || {}), false);
}

console.log('\nspeed multipliers add, or multiply where the campaign says');
{
  const c = new Character(blankDocument({ name: 'Smith', level: 5 }));
  c.set('crafting.baseSpeed', 1000);
  c.set('crafting.speedIncreases', [1, 2, 3, 4].map((n) => ({ label: `x${n}`, kind: 'multiplier', value: 2, enabled: true })));
  const speed = () => c.data.crafting.calc.speedPerDay;
  const draw = () => renderCraftingPanel(c, { draft: {}, openPosts: new Map() });
  check('four x2 add to x8', [speed(), draw().includes('Multipliers add together')], [8000, true]);
  c.set('campaign.craftSpeed', 'multiply');
  check('and multiply to x16', [speed(), draw().includes('Multipliers multiply')], [16000, true]);
  c.setItem('crafting.speedIncreases', 3, 'enabled', false);
  check('one switched off is left out', speed(), 8000);
  c.listAdd('crafting.speedIncreases', { label: 'flat', kind: 'flat', value: 500, enabled: true });
  check('a flat increase still adds to the base first', speed(), 12000);
  c.set('crafting.speedIncreases', []);
  check('none is the base rate', speed(), 1000);
  c.set('campaign.craftSpeed', 'add');
}

console.log('\nan item made to keep, and a post in the crafter\u2019s own words');
{
  const c = new Character(blankDocument({ name: 'Smith', level: 5 }));
  c.set('crafting.currency', 'gp');
  c.set('crafting.projects', [{ name: 'Cloak', value: 1000, discountOverride: null, zeroProfit: false, itemDC: 15, checkMod: 0,
    dcAdjustments: [], bypassed: [], dcNotes: '', resources: 'silk', notes: 'for me', buyerName: '', buyerTag: '', remaining: '' }]);
  const calc = () => c.data.crafting.projects[0].calc;
  const draw = () => renderCraftingPanel(c, { draft: {}, openPosts: new Map() });
  const lines = () => calc().craftPost.split('\n');
  check('a project for sale reports its profit and has a marketplace post',
    [lines().some((l) => l.startsWith('**Profit**:')), calc().marketPost.includes('**Price Sold:**'), draw().includes('Marketplace post')], [true, true, true]);
  const before = lines();
  c.setItem('crafting.projects', 0, 'kept', true);
  check('kept, the post leaves the profit line out and nothing else', lines(), before.filter((l) => !l.startsWith('**Profit**:')));
  check('and there is no marketplace post or buyer', [calc().marketPost, draw().includes('Marketplace post'), draw().includes('Buyer (character)')], ['', false, false]);
  c.setItem('crafting.projects', 0, 'kept', false);

  c.set('crafting.postTemplate', 'Made [item] in [days] days for [cost] [currency]. [Notes] [nothing]\nSold at [sale] [currency], profit [profit]');
  check('a template of the crafter\u2019s own is filled in, and an unknown word is left',
    lines(), [`Made Cloak in ${calc().days} days for ${calc().cost} gp. for me [nothing]`, `Sold at ${calc().sale} gp, profit ${calc().net} gp`]);
  c.setItem('crafting.projects', 0, 'kept', true);
  check('kept, its sale line goes too', lines().length, 1);
  c.set('crafting.currency', '');
  check('no currency takes its space along', lines()[0].includes(`for ${calc().cost}. for me`), true);
  c.set('crafting.postTemplate', '   ');
  check('blank is the usual post again', lines()[0], '**Crafting**: Cloak');
  check('the panel shows the usual text to start from', draw().includes('placeholder="**Crafting**: [item]'), true);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
