/** Tests for the setup guide: its steps, the systems a player picks, what is
 *  saved, and that every panel a step names is still on the tab it names.
 *  Run: node tests/wizard.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import { GAME_SYSTEMS, STORE_BASE, WIKI_BASE, storeUrl, wikiUrl } from '../app/js/rules.js';
import { WIZARD_FIXED_STEPS, WIZARD_TAB } from '../app/js/model/wizard.js';
import { renderWizardSystemsPanel, stepLabel, wizardBar } from '../app/js/ui/panels/wizard.js';
import * as overview from '../app/js/ui/panels/overview.js';
import * as manager from '../app/js/ui/panels/manager.js';
import { blankView } from '../app/js/ui/view-state.js';
import { foldValue } from '../app/js/ui/folds.js';
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
const ok = (label, actual) => check(label, !!actual, true);

const blank = () => new Character(blankDocument({ name: 'Guide check', level: 3 }));
const ids = (model) => model.wizardSteps().map((s) => s.id);
const CTX = { ...blankView(), tabEntries: [], barEntries: [] };
const LABELS = { magic: 'Magic Spheres', martial: 'Martial Spheres', akashic: 'Akashic' };

console.log('the steps of a new character');
{
  const m = blank();
  check('the guide is closed until it is started', m.wizardState().on, false);
  check('no system is picked', m.wizardSystems(), []);
  check('the fixed steps, in order', ids(m),
    ['rules', 'details', 'abilities', 'traits', 'classes', 'progression', 'systems', 'skills', 'feats', 'gear']);
  m.startWizard();
  check('started, it is on the first step', [m.wizardState().on, m.wizardState().step.id], [true, 'rules']);
  check('the first step has no step before it', m.wizardState().back, null);
  check('and the campaign rules are followed by the details', m.wizardState().next.id, 'details');
  m.setWizardStep('gear');
  check('the last step has no step after it', m.wizardState().next, null);
  m.setWizardStep('no-such-step');
  check('an id that is not a step changes nothing', m.wizardState().step.id, 'gear');
  m.closeWizard();
  check('closed', m.wizardState().on, false);
  m.startWizard();
  check('opened again, it is where it was left', m.wizardState().step.id, 'gear');
  m.startWizard('classes');
  check('or on the step asked for', m.wizardState().step.id, 'classes');
}

console.log('\npicking systems');
{
  const m = blank();
  m.startWizard();
  const bar = m.tabOrder();
  m.toggleWizardSystem('akashic');
  check('a picked system is listed', m.wizardSystems(), ['akashic']);
  check('its tab joins the bar', m.tabOrder(), [...bar, 'akashic']);
  check('and it has a step after Systems', ids(m).slice(6, 9), ['systems', 'system:akashic', 'skills']);
  m.toggleWizardSystem('spheres-of-power');
  check('systems are kept in table order, whatever order they were picked in',
    m.wizardSystems(), ['spheres-of-power', 'akashic']);
  m.toggleWizardSystem('champion-of-the-spheres');
  const magic = m.wizardSteps().find((s) => s.id === 'system:magic');
  check('two systems on one tab share its step', magic.systems, ['spheres-of-power', 'champion-of-the-spheres']);
  check('a system on two tabs has a step for each',
    ids(m).filter((id) => id.startsWith('system:')), ['system:magic', 'system:martial', 'system:akashic']);
  check('a step is called by its system', stepLabel(magic, { tabLabels: LABELS }), 'Spheres of Power');
  check('and by its tab too where the system has several',
    stepLabel(m.wizardSteps().find((s) => s.id === 'system:martial'), { tabLabels: LABELS }),
    'Champion of the Spheres: Martial Spheres');
  m.toggleWizardSystem('champion-of-the-spheres');
  check('unpicked, a system takes off the tabs no other pick uses',
    [m.tabOrder().includes('martial'), m.tabOrder().includes('magic')], [false, true]);
  m.toggleWizardSystem('no-such-system');
  check('an id that is not a system changes nothing', m.wizardSystems(), ['spheres-of-power', 'akashic']);

  // A tab that holds data stays on the bar when its system is unpicked.
  m.data.akashic.classes = [{ name: 'Vizier' }];
  m.recompute();
  ok('a veilweaving class puts Akashic in use', m.systemTabsInUse().akashic);
  m.toggleWizardSystem('akashic');
  check('unpicked while in use, the tab stays', [m.wizardSystems(), m.tabOrder().includes('akashic')],
    [['spheres-of-power'], true]);

  const again = new Character(JSON.parse(JSON.stringify(m.toJSON())));
  check('the guide is saved with the character',
    [again.wizardState().on, again.wizardState().step.id, again.wizardSystems()], [true, 'rules', ['spheres-of-power']]);
}

console.log('\na character that already uses systems');
{
  const m = blank();
  m.data.classes.push({ name: 'Stalker', hd: 8, bab: 0.75, systems: ['path-of-war'] });
  m.data.akashic.classes = [{ name: 'Vizier' }];
  m.recompute();
  check('a marked class and a tab in use are picked from the start', m.wizardSystems(), ['path-of-war', 'akashic']);
  m.startWizard();
  m.toggleWizardSystem('path-of-war');
  check('and a system unpicked after that stays unpicked', m.wizardSystems(), ['akashic']);

  const monster = blank();
  monster.data.monster = { name: 'Ogre' };
  monster.startWizard();
  check('a monster has no guide', monster.wizardState().on, false);

  const session = blank();
  session.setViewMode('session');
  session.startWizard();
  check('starting the guide switches to the build view', session.viewMode(), 'build');
}

console.log('\nevery system says what it is and where its rules are');
for (const s of GAME_SYSTEMS) {
  ok(`${s.id} has its parts in one sentence`, typeof s.parts === 'string' && /^[A-Z].*\.$/.test(s.parts) && !/\.\s/.test(s.parts));
  if (s.wiki) ok(`${s.id} links to a wiki page`, wikiUrl(s.wiki).startsWith(WIKI_BASE));
  if (s.store !== undefined) check(`${s.id} links to a product page`, storeUrl(s.store), `${STORE_BASE}${s.store}`);
}
check('no product, no store link', [storeUrl(undefined), storeUrl(''), storeUrl(0)], [null, null, null]);

console.log('\nthe Systems step and the strip');
{
  const m = blank();
  m.startWizard('systems');
  m.toggleWizardSystem('spheres-of-power');
  const html = renderWizardSystemsPanel(m, { ...CTX, tabLabels: LABELS });
  check('a box for every system', (html.match(/data-wizard-system="/g) || []).length, GAME_SYSTEMS.length);
  check('one of them ticked', (html.match(/data-wizard-system="[^"]*" checked/g) || []).length, 1);
  ok('the picked one is Spheres of Power', /data-wizard-system="spheres-of-power" checked/.test(html));
  ok('each box sits in a label', !/<input type="checkbox"(?![\s\S]*?<\/label>)/.test(html));
  const hrefs = [...html.matchAll(/<a class="weblink" href="([^"]*)"/g)].map((x) => x[1]);
  check('a link for every wiki page and every product',
    hrefs.length, GAME_SYSTEMS.filter((s) => s.wiki).length + GAME_SYSTEMS.filter((s) => s.store).length);
  ok('all of them http links, opened in a new tab', hrefs.every((h) => /^https:\/\//.test(h))
    && !/<a\b(?![^>]*target="_blank")/.test(html));
  ok('a tab reads as the bar calls it', html.includes('Tab: Magic Spheres'));

  check('the strip is not drawn while the guide is closed', wizardBar(blank(), CTX), '');
  const bar = wizardBar(m, { ...CTX, tab: WIZARD_TAB, tabLabels: LABELS });
  ok('the strip counts the steps', bar.includes(`Step 7 of ${m.wizardSteps().length}`));
  ok('names the next one', bar.includes('Next: Spheres of Power'));
  ok('and marks the step it is on', /data-step="systems"\s+aria-current="step"/.test(bar));
  m.setWizardStep('system:magic');
  const sys = wizardBar(m, { ...CTX, tab: 'magic', tabLabels: LABELS });
  ok('a system\'s step says what the system consists of', sys.includes(GAME_SYSTEMS[0].parts));
  ok('and links to its wiki page and its book',
    sys.includes(`href="${wikiUrl('Spheres of Power (system)')}"`) && sys.includes(`href="${storeUrl(300249)}"`));
  ok('on another tab the strip offers the way back', wizardBar(m, { ...CTX, tab: 'gear', tabLabels: LABELS }).includes('Show this step'));
  m.setWizardStep('gear');
  ok('the last step finishes', wizardBar(m, { ...CTX, tab: 'gear' }).includes('>Finish<'));
}

console.log('\nevery panel a step names is on the tab it names');
{
  // The headings of the panels a tab draws, as the sheet reads them: the
  // heading's own words, without the badges and buttons beside them.
  const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const headings = (html) => [...html.matchAll(/<section class="panel[^"]*"[^>]*>\s*<h3[^>]*>([^<]*)/g)]
    .map((x) => unesc(x[1]).replace(/\s+/g, ' ').trim());
  const draw = {
    overview: (m) => overview.renderOverviewPanel(m, CTX),
    systabs: (m) => manager.renderSystemManagerPanel(m, CTX),
  };
  const withPanels = WIZARD_FIXED_STEPS.filter((s) => s.panels);
  ok('some steps show part of a tab', withPanels.length > 0);
  for (const step of withPanels) {
    ok(`${step.id}: its tab is one this test can draw`, draw[step.tab]);
    if (!draw[step.tab]) continue;
    const m = blank();
    for (const key of step.folds || []) m.data.uiPrefs.collapsed[key] = foldValue(key, true);
    const drawn = headings(draw[step.tab](m));
    for (const name of step.panels) ok(`${step.id}: "${name}" is on the ${step.tab} tab`, drawn.includes(name));
    ok(`${step.id}: the tab has more than the step shows`, drawn.length > step.panels.length);
  }
  // A fold a step opens is one its panel is behind.
  const classes = WIZARD_FIXED_STEPS.find((s) => s.id === 'classes');
  const m = blank();
  m.data.uiPrefs.collapsed['sg-defenses'] = foldValue('sg-defenses', false);
  ok('with its group folded, Hit points is not drawn', !headings(draw.overview(m)).includes('Hit points'));
  ok('and the step opens that group', classes.folds.includes('sg-defenses'));
}

console.log('\nthe roster');
for (const id of fixtureIds()) {
  const m = new Character(loadCharacter(id));
  const inUse = m.systemTabsInUse();
  const marked = new Set((m.data.classes || []).flatMap((c) => c.systems || []));
  const picked = m.wizardSystems();
  ok(`${id}: every system picked from the start is marked or in use`,
    picked.every((p) => marked.has(p) || inUse[GAME_SYSTEMS.find((s) => s.id === p).tabs[0]]));
  m.startWizard();
  const steps = m.wizardSteps();
  check(`${id}: a step for each tab of each picked system`,
    steps.filter((s) => s.systems).map((s) => s.tab),
    [...new Set(GAME_SYSTEMS.filter((s) => picked.includes(s.id)).flatMap((s) => s.tabs))]);
  ok(`${id}: the strip draws on every step`, steps.every((s) => {
    m.setWizardStep(s.id);
    return wizardBar(m, { ...CTX, tab: s.tab }).includes('class="wizard"');
  }));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
