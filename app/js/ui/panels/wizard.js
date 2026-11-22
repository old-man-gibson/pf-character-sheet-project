/**
 * ui/panels/wizard.js -- the setup guide (model/wizard.js), drawn.
 *
 * Two pieces. `wizardBar` is the strip above the open tab: the steps, the one
 * the guide is on, what to do there, and Back and Next. `renderWizardSystemsPanel`
 * is the Systems step, the one page the guide has of its own: every rules
 * system as a box to tick, with what it consists of and where its rules are.
 *
 * `ctx.tabLabels` is the element's own tab names by id, so a step reads as
 * the tab it opens does, a player's rename included.
 */
import { esc } from '../html.js';
import { linkHtml } from '../links.js';
import { GAME_SYSTEMS, storeUrl, wikiUrl } from '../../rules.js';
import { WIZARD_TAB, wizardState, wizardSystems } from '../../model/wizard.js';

const SYSTEMS = new Map(GAME_SYSTEMS.map((s) => [s.id, s]));

/** What a tab is called on the bar. */
const tabLabel = (ctx, id) => ctx?.tabLabels?.[id] || id;

/**
 * What a step is called. A system's step takes the system's name, with the
 * tab's after it where the system is drawn on more than one.
 */
export function stepLabel(step, ctx) {
  if (step.label) return step.label;
  const system = SYSTEMS.get(step.systems?.[0]);
  if (!system) return tabLabel(ctx, step.tab);
  return system.tabs.length > 1 ? `${system.label}: ${tabLabel(ctx, step.tab)}` : system.label;
}

/** A system's two links: its rules on the wiki, and its book in the store. */
function systemLinks(system) {
  const wiki = system.wiki ? wikiUrl(system.wiki) : null;
  const store = storeUrl(system.store);
  const links = [
    wiki ? linkHtml(wiki, 'Wiki', '', `${system.label} on the wiki`) : '',
    store ? linkHtml(store, 'DriveThruRPG', '', `The book for ${system.label} on DriveThruRPG`) : '',
  ].filter(Boolean);
  return links.length ? `<p class="wzlinks">${links.join('')}</p>` : '';
}

/**
 * What a system consists of and its links, for the strip of a system's step.
 * `named` puts the system's name first, for a step two systems share.
 */
function systemGuide(id, named) {
  const system = SYSTEMS.get(id);
  if (!system) return '';
  return `<div class="wzguide">
      <p>${named ? `<strong>${esc(system.label)}:</strong> ` : ''}${esc(system.parts)}</p>
      ${systemLinks(system)}
    </div>`;
}

/**
 * The strip above the tab while the guide is open.
 *
 * `ctx.tab` is the tab that is up. On any tab but the step's own the strip
 * offers the way back to it; the bar's tabs all keep working while the guide
 * is open.
 */
export function wizardBar(model, ctx = {}) {
  const w = wizardState(model);
  if (!w.on) return '';
  const { steps, index, step, back, next } = w;
  const here = ctx.tab === step.tab;
  const chip = (s, i) => `<li><button data-view data-action="wizard-step" data-step="${esc(s.id)}"
        ${i === index ? 'aria-current="step"' : ''} title="${esc(`Step ${i + 1}: ${stepLabel(s, ctx)}`)}"
        ><span class="wznum">${i + 1}</span> ${esc(stepLabel(s, ctx))}</button></li>`;
  return `<section class="wizard" aria-label="Setup guide">
      <div class="wzhead">
        <strong>Setup guide</strong>
        <span class="badge">Step ${index + 1} of ${steps.length}</span>
        <button data-view data-action="wizard-close"
          title="Close the guide. Open it again from the ⋯ menu.">Close guide</button>
      </div>
      <ol class="wzsteps">${steps.map(chip).join('')}</ol>
      <div class="wzbody">
        <h3 class="wztitle"${step.tab === WIZARD_TAB ? ' id="tab-wizard"' : ''}>${esc(stepLabel(step, ctx))}</h3>
        ${step.text ? `<p>${esc(step.text)}</p>` : ''}
        ${(step.systems || []).map((id) => systemGuide(id, step.systems.length > 1)).join('')}
        <div class="wznav">
          <button data-view data-action="wizard-step" data-step="${esc(back?.id || '')}" ${back ? '' : 'disabled'}>Back</button>
          ${next
    ? `<button data-view class="primary" data-action="wizard-step" data-step="${esc(next.id)}">Next: ${esc(stepLabel(next, ctx))}</button>`
    : '<button data-view class="primary" data-action="wizard-close">Finish</button>'}
          ${here ? '' : `<button data-view data-action="wizard-step" data-step="${esc(step.id)}">Show this step</button>`}
          ${here && step.panels ? `<button data-view data-action="wizard-all" aria-pressed="${!!ctx.wizardAll}"
            title="Show every panel on this tab, or only the panels for this step.">Whole tab</button>` : ''}
        </div>
      </div>
    </section>`;
}

/**
 * The Systems step: every system as a box to tick.
 *
 * A system whose tab already holds data says so, as the ⚙ manager does:
 * taking its tick off leaves that tab and its data where they are.
 */
export function renderWizardSystemsPanel(model, ctx = {}) {
  const picked = new Set(wizardSystems(model));
  const inUse = model.systemTabsInUse();
  const row = (s) => {
    const on = picked.has(s.id);
    const tabs = s.tabs.map((t) => tabLabel(ctx, t)).join(', ');
    return `<div class="wzsys${on ? ' on' : ''}">
        <label class="chk">
          <input type="checkbox" data-wizard-system="${esc(s.id)}" ${on ? 'checked' : ''}>
          <span>${esc(s.label)}</span>
        </label>
        ${s.tabs.some((t) => inUse[t]) ? '<span class="badge ok">in use</span>' : ''}
        <p class="wzparts">${esc(s.parts)}</p>
        <p class="wztabs">${s.tabs.length > 1 ? 'Tabs' : 'Tab'}: ${esc(tabs)}</p>
        ${systemLinks(s)}
      </div>`;
  };
  return `<div class="grid"><section class="panel span2 wzsystems">
      <h3>Systems <span class="badge">${picked.size} selected</span></h3>
      <div class="wzlist">${GAME_SYSTEMS.map(row).join('')}</div>
    </section></div>`;
}

/**
 * The heading a panel is known by: its own words, without the badges and
 * buttons that sit in the heading with them.
 */
export function panelHeading(h3) {
  if (!h3) return '';
  return [...h3.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Show only a step's panels on its tab.
 *
 * Works on the drawn tab, after it is bound: the panels are the sheet's own
 * and stay where the tab put them, and the others are hidden by class. A
 * group left with nothing to show is hidden with them. Nothing is hidden
 * when none of the step's panels is found, so a panel that has since moved
 * or been renamed costs the step its focus and not its content.
 *
 * @returns {boolean} whether anything was hidden
 */
export function focusPanels(body, names) {
  if (!body || !names?.length) return false;
  const panels = [...body.querySelectorAll('section.panel')].filter((p) => !p.parentElement?.closest('section.panel'));
  const keep = panels.filter((p) => names.includes(panelHeading(p.querySelector(':scope > h3'))));
  if (!keep.length || keep.length === panels.length) return false;
  for (const p of panels) if (!keep.includes(p)) p.classList.add('wz-off');
  for (const box of body.querySelectorAll('.band, .supergroup, .foldsub')) {
    if (!box.closest('section.panel') && !box.querySelector('section.panel:not(.wz-off)')) box.classList.add('wz-off');
  }
  return true;
}
