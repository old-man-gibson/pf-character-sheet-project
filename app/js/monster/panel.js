/**
 * ui/panels/statblock.js -- the Stat Block tab: the character as a Bestiary
 * would print it, worked out live.
 *
 * Every number on it is the model's, so a score edited on the Stats tab or a
 * buff ticked on the dashboard moves the block the way it moves everything
 * else. What a monster has that a character has not -- CR, senses, aura, the
 * spell-like abilities, the ecology -- comes off `data.monster`, the block a
 * pasted stat block leaves behind (see monster-import.js); a character with
 * no such block still prints, as an NPC would, with those lines left out.
 *
 * Under the block: the cards of every sub-system the creature uses, borrowed
 * from the session dashboard, so a monster given the Vancian or Maneuvers tab
 * shows its slots and readied maneuvers here; the block's own fields, to
 * edit; and whatever the reader could not place, to file or discard.
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc } from '../ui/html.js';
import { collapsible, itemText, movedInline, rowTools } from '../ui/rows.js';
import { prose, renderedProse } from '../ui/prose.js';
import { check, field, num, text } from '../ui/fields.js';
import { hasTokens } from '../inline.js';
import { proseText } from '../model/scope.js';
import { dashSystemCards } from '../ui/panels/overview.js';
import {
  ABILITIES, ABILITY_LABELS, AC_BONUS_TYPES, SIZE_MODIFIERS, armorParts, fmt, statMod,
} from '../rules.js';
import { group } from '../ui/format.js';

/** The two-letter alignment a block prints, from the sheet's full words. */
function alignmentCode(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const m = t.match(/^(Lawful|Neutral|Chaotic)\s+(Good|Neutral|Evil)$/i);
  if (m) {
    const a = m[1][0].toUpperCase();
    const b = m[2][0].toUpperCase();
    return a === 'N' && b === 'N' ? 'N' : `${a}${b}`;
  }
  if (/^neutral$/i.test(t)) return 'N';
  return t;
}

/** Text that may carry {…} tokens, rendered; plain text escaped. */
const shown = (model, value) => {
  const t = String(value ?? '');
  return hasTokens(t) ? renderedProse(model, t) : esc(t);
};

/** One labelled run on a block line: "Init +14". Nothing when the value is empty. */
const run = (label, html) => (html ? `<span class="sb-run"><b>${esc(label)}</b> ${html}</span>` : '');

/** A block line out of its runs, joined by the block's own semicolons. */
const lineOf = (...runs) => {
  const parts = runs.filter(Boolean);
  return parts.length ? `<div class="sb-line">${parts.join('; ')}</div>` : '';
};

/** A speed row as the block writes it: "fly 120 ft. (perfect)", "30 ft.". */
function speedText(sp, at) {
  const m = String(sp.type || '').match(/^(\w+)(?:\s*\((.*)\))?/);
  const kind = m ? m[1].toLowerCase() : '';
  const note = m?.[2] ? ` (${m[2]})` : '';
  const head = !kind || kind === 'land' || kind === 'speed' || kind === 'base' ? '' : `${kind} `;
  return `${head}${at} ft.${note}`;
}

/**
 * The AC's parenthetical: every column that holds something, in the order a
 * block lists them, with Dex and size worked out the way the total is.
 */
function acParts(model) {
  const c = model.data;
  const d = c.defenses;
  const r = d.acBonusesResolved || {};
  const a = armorParts(c);
  const parts = [];
  const push = (n, label) => { if (n) parts.push(`${fmt(n)} ${label}`); };
  push(a.armor, 'armor');
  push((r.abpDeflection || 0) + (r.deflection || 0), 'deflection');
  push(Math.min(a.maxDex, statMod(c, d.acStat1, d.acStat2)), 'Dex');
  push(r.dodge, 'dodge');
  push((r.abpNatural || 0) + (r.enhancedNatural || 0) + (r.natural || 0), 'natural');
  push(a.shield, 'shield');
  for (const [key, label] of AC_BONUS_TYPES) {
    if (['abpDeflection', 'deflection', 'dodge', 'abpNatural', 'enhancedNatural', 'natural'].includes(key)) continue;
    push(r[key], label.replace(/\.$/, '').toLowerCase());
  }
  push(d.miscAC, 'misc');
  // Size last, where a Bestiary puts it.
  push(SIZE_MODIFIERS[c.identity.size] ?? 0, 'size');
  return parts.join(', ');
}

/**
 * The attack lines, grouped the way they were pasted -- "A or B", each group
 * its attacks joined with "and" -- and worked out from the rows as they
 * stand now. A character's weapons, which were never grouped, print one to
 * a group.
 */
function attackLines(model, type) {
  const c = model.data;
  const weapons = (c.equipment?.weapons || []).map((w, i) => ({ w, i }))
    .filter(({ w }) => (type === 'Melee'
      ? /melee|cmb/i.test(String(w.attackType || 'Melee'))
      : /ranged/i.test(String(w.attackType || ''))));
  if (!weapons.length) return '';
  const groups = new Map();
  for (const { w, i } of weapons) {
    const key = w.attackGroup ?? `w${i}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }
  const one = (w) => {
    const total = Number(w.calc?.totalAtk ?? w.attackTotal) || 0;
    const n = Array.isArray(w.iteratives) ? w.iteratives.length : 1;
    const atk = Array.from({ length: n }, (_, k) => fmt(total - 5 * k)).join('/');
    const crit = `${Number(w.critRange) > 1 ? `/${21 - Number(w.critRange)}-20` : ''}${Number(w.critMult) > 2 ? `/×${w.critMult}` : ''}`;
    // The rider is prose, and prose takes formulas: a weapon whose special
    // says `{bloodburst.dmg}` prints the number here, as it does on
    // Equipment. The damage string can carry one too.
    const special = proseText(model, String(w.special || '').replace(/\[\[|\]\]|\{\{|\}\}/g, '')).trim();
    const rider = special ? ` plus ${special}` : '';
    const count = Number(w.count) > 1 ? `${w.count} ` : '';
    const name = `${w.enhancement && !w.natural ? `+${w.enhancement} ` : ''}${w.name || 'attack'}${Number(w.count) > 1 && w.natural ? 's' : ''}`;
    return `${count}${esc(name)} ${atk} (${esc(proseText(model, w.damageTotal || '—'))}${crit}${esc(rider)})`;
  };
  return [...groups.values()].map((g) => g.map(one).join(' and ')).join(' or ');
}

export function renderStatBlockPanel(model, ctx = {}) {
    const c = model.data;
    const m = c.monster || null;
    const i = c.identity;
    const d = c.defenses;
    const s = c.saves;
    const cs = model.conditionState;
    const hp = model.hpState;
    const level = Number(i.level) || 0;
    const moved = (key, base) => movedInline(cs, key, base, fmt, model);
    const movedPlain = (key, base) => movedInline(cs, key, base, String, model);

    // The head: name and CR, then XP, then the alignment line as a block
    // prints it. A character shows its level and classes where a monster
    // shows its type.
    const classes = (c.classes || []).map((x) => x.name).filter(Boolean).join(' / ');
    const typeLine = m
      ? `${esc(alignmentCode(i.alignment))} ${esc(i.size || 'Medium')} ${esc(m.type || String(i.race || '').toLowerCase())}${m.subtypes?.length ? ` (${esc(Array.isArray(m.subtypes) ? m.subtypes.join(', ') : m.subtypes)})` : ''}`
      : `${esc(alignmentCode(i.alignment))} ${esc(i.size || 'Medium')} ${esc(i.race || 'humanoid')}${classes ? ` ${esc(classes)} ${level}` : ''}`;
    const perception = (c.skills || []).find((sk) => /^Perception$/i.test(sk.name));

    // Defense.
    const hdText = m
      ? `${level}d${m.hitDie}${c.gestalt?.hp ? (c.gestalt.hp.abilityMod * level ? fmt(c.gestalt.hp.abilityMod * level) : '') : ''}`
      : `${level} HD`;
    const maxNow = movedInline(cs, 'hp', hp.max, String);
    const hpLine = `${hp.current < hp.max ? `<strong class="bad">${hp.current}</strong>/` : ''}${maxNow} (${esc(hdText)})${hp.temp > 0 ? `; ${hp.temp} temporary` : ''}`;
    const defLists = d.calc || {};
    const savesLine = `<b>Fort</b> ${moved('fortitude', s.fortitude.total)}, <b>Ref</b> ${moved('reflex', s.reflex.total)}, <b>Will</b> ${moved('will', s.will.total)}${m?.saveNote ? `; ${shown(model, m.saveNote)}` : ''}`;

    // Offense.
    const speeds = (i.speeds || [])
      .map((sp, k) => ({ sp, adj: (cs.speeds || [])[k] }))
      .filter(({ sp }) => (Number(sp.final) || 0) > 0)
      .map(({ sp, adj }) => speedText(sp, adj ? adj.adjusted : Number(sp.final) || 0))
      .join(', ');

    // Statistics.
    const scores = ABILITIES.map((k) => {
      const a = c.abilities[k] || {};
      const none = m?.nonabilities?.includes(k);
      const base = Number(a.tempScore) || 0;
      const now = cs.changed ? (cs.scores[k] ?? base) : base;
      return `<b>${ABILITY_LABELS[k]}</b> ${none ? '—' : now !== base
        ? `<strong class="adj ${now > base ? 'up' : ''}" title="${esc(`Base ${base} — with ${cs.sources} applied`)}">${now}</strong>` : now}`;
    }).join(', ');
    const feats = [
      ...(c.featGroups || []).flatMap((g) => g.entries || []),
      ...[c.grantedFeats?.drawback, c.grantedFeats?.specialty, ...(c.grantedFeats?.others || [])],
    ].filter((f) => f && String(f.name || '').trim())
      .map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    // A condition's skill penalty moves every skill alike, so it is one delta.
    const skillDelta = cs.changed ? (Number(cs.delta?.skills) || 0) : 0;
    const skillNow = (sk) => {
      const base = Number(sk.bonus) || 0;
      return skillDelta
        ? `<strong class="adj ${skillDelta > 0 ? 'up' : ''}" title="${esc(`Base ${fmt(base)} — with ${cs.sources} applied`)}">${fmt(base + skillDelta)}</strong>`
        : fmt(base);
    };
    const skills = (c.skills || [])
      .filter((sk) => (Number(sk.totalRanks) || 0) > 0 || sk.situational)
      .map((sk) => `${esc(sk.name)}${sk.spec ? ` (${esc(sk.spec)})` : ''} ${skillNow(sk)}${sk.situational ? ` (${esc(sk.situational)})` : ''}`)
      .join(', ');
    const languages = (i.languages || []).filter((l) => String(l).trim()).join(', ');

    const block = `<section class="panel span2 statblock">
      <div class="sb-head">
        <span class="sb-name">${esc(i.name || 'Unnamed')}</span>
        <span class="sb-cr">${m ? `CR ${esc(m.cr || '—')}` : `Level ${level}`}</span>
      </div>
      ${m?.source ? `<div class="sb-line dim">Source ${esc(m.source)}</div>` : ''}
      ${m && m.xp != null ? `<div class="sb-line"><b>XP</b> ${group(m.xp)}</div>` : ''}
      <div class="sb-line">${typeLine}</div>
      ${lineOf(run('Init', moved('initiative', c.hp.initiative)), m?.senses ? run('Senses', shown(model, m.senses)) : '',
    perception ? run('Perception', skillNow(perception)) : '')}
      ${lineOf(m?.aura ? run('Aura', shown(model, m.aura)) : '')}
      <h4 class="sb-section">Defense</h4>
      <div class="sb-line"><b>AC</b> ${movedPlain('ac', d.ac)}, touch ${movedPlain('touch', d.touch)}, flat-footed ${movedPlain('flatFooted', d.flatFooted)}
        <span class="dim">(${esc(acParts(model))}${m?.acNote ? `; ${esc(m.acNote)}` : ''})</span></div>
      ${lineOf(`<b>hp</b> ${hpLine}`, m?.healing ? shown(model, m.healing) : '')}
      <div class="sb-line">${savesLine}</div>
      ${lineOf(m?.defensiveAbilities ? run('Defensive Abilities', shown(model, m.defensiveAbilities)) : '',
    defLists.drText ? run('DR', esc(defLists.drText)) : '',
    defLists.immunitiesText ? run('Immune', esc(defLists.immunitiesText)) : '',
    defLists.resistanceText ? run('Resist', esc(defLists.resistanceText)) : '',
    defLists.sr?.has ? run('SR', esc(defLists.sr.text)) : '')}
      ${lineOf(defLists.weaknessText ? run('Weaknesses', esc(defLists.weaknessText)) : '')}
      <h4 class="sb-section">Offense</h4>
      ${lineOf(speeds ? run('Speed', esc(speeds)) : '')}
      ${lineOf(attackLines(model, 'Melee') ? run('Melee', attackLines(model, 'Melee')) : '')}
      ${lineOf(attackLines(model, 'Ranged') ? run('Ranged', attackLines(model, 'Ranged')) : '')}
      ${lineOf(m?.space ? run('Space', esc(m.space)) : '', m?.reach ? run('Reach', esc(m.reach)) : '').replace('; <span', ', <span')}
      ${lineOf(m?.specialAttacks ? run('Special Attacks', shown(model, m.specialAttacks)) : '')}
      ${m?.spellLike ? `<div class="sb-line sb-prose">${shown(model, m.spellLike)}</div>` : ''}
      ${m?.spells ? `<div class="sb-line sb-prose">${shown(model, m.spells)}</div>` : ''}
      <h4 class="sb-section">Statistics</h4>
      <div class="sb-line">${scores}</div>
      <div class="sb-line"><b>Base Atk</b> ${fmt(c.attack.bab)}; <b>CMB</b> ${moved('cmb', c.attack.totalCmb)}${m?.cmbNote ? ` (${esc(m.cmbNote)})` : ''}; <b>CMD</b> ${movedPlain('cmd', d.cmd)}${m?.cmdNote ? ` (${esc(m.cmdNote)})` : ''}</div>
      ${lineOf(feats.length ? run('Feats', esc(feats.join(', '))) : '')}
      ${lineOf(skills ? run('Skills', skills) : '', m?.racialModifiers ? run('Racial Modifiers', shown(model, m.racialModifiers)) : '')}
      ${lineOf(languages || m?.languagesNote ? run('Languages', [esc(languages), m?.languagesNote ? esc(m.languagesNote) : ''].filter(Boolean).join('; ')) : '')}
      ${lineOf(m?.sq ? run('SQ', shown(model, m.sq)) : '')}
      ${lineOf(m?.gear ? run('Gear', shown(model, m.gear)) : '')}
      ${m && (m.environment || m.organization || m.treasure) ? `<h4 class="sb-section">Ecology</h4>
      ${lineOf(m.environment ? run('Environment', esc(m.environment)) : '')}
      ${lineOf(m.organization ? run('Organization', esc(m.organization)) : '')}
      ${lineOf(m.treasure ? run('Treasure', esc(m.treasure)) : '')}` : ''}
      ${m?.tactics ? `<h4 class="sb-section">Tactics</h4><div class="sb-line sb-prose">${shown(model, m.tactics)}</div>` : ''}
      ${(c.raceTraits || []).some((t) => String(t.name || '').trim() || String(t.text || '').trim()) ? `<h4 class="sb-section">${m ? 'Special Abilities' : 'Race traits'}</h4>
      ${(c.raceTraits || []).filter((t) => String(t.name || '').trim() || String(t.text || '').trim()).map((t) => `<div class="sb-ability"><b>${esc(t.name || '—')}</b> ${shown(model, t.text)}</div>`).join('')}` : ''}
      ${m?.description ? `<h4 class="sb-section">Description</h4><div class="sb-line sb-prose">${shown(model, m.description)}</div>` : ''}
      <p class="hint">Every figure here is the sheet's own, worked out now: a score changed on the Stats tab, a buff ticked on the dashboard or a condition on the Overview moves this block the way it moves everything else. Hover a number for its working.</p>
    </section>`;

    const systems = dashSystemCards(model);
    const systemsPanel = systems ? `<section class="panel span2 sb-systems">
      <h3>From the sub-systems</h3>
      <p class="hint">What the creature carries on its sub-system tabs, as the session dashboard shows it; the pips and squares spend from the one pool the tab holds. The ⚙ tab manager turns a sub-system's tab on, and the class row's <em>Systems</em> toggles on the Overview mark one before anything is typed into it.</p>
      <div class="grid dashboard">${systems}</div>
    </section>` : '';

    return `<div class="grid">
      <style>${STATBLOCK_CSS}</style>
      ${block}
      ${systemsPanel}
      ${editPanel(model, m, ctx)}
      ${unreadPanel(model, m)}
    </div>`;
  }

/**
 * The tab's own styles, carried in its markup rather than in the sheet's
 * stylesheet, so the feature adds nothing to a file the rest of the sheet
 * edits. A Bestiary entry's layout: runs of "Label value" on one line,
 * sections as small-caps rules, the special abilities as paragraphs led by
 * their name. Dense on purpose -- a block is read at a glance at the table
 * -- and it prints as it shows.
 */
const STATBLOCK_CSS = `
.statblock { font-size: 0.86rem; line-height: 1.45; }
.statblock .sb-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  border-bottom: 2px solid var(--cs-accent); padding-bottom: 4px; margin-bottom: 6px;
}
.statblock .sb-name { font-size: 1.15rem; font-weight: 700; letter-spacing: 0.01em; }
.statblock .sb-cr { font-size: 1rem; font-weight: 700; color: var(--cs-accent); white-space: nowrap; }
.statblock .sb-section {
  margin: 10px 0 4px; padding-bottom: 2px; font-size: 0.72rem; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase; color: var(--cs-accent);
  border-bottom: 1px solid var(--cs-line);
}
.statblock .sb-line { margin: 2px 0; }
.statblock .sb-line b, .statblock .sb-ability b { font-weight: 700; }
.statblock .sb-run { display: inline; }
.statblock .sb-prose, .statblock .sb-ability { white-space: pre-wrap; margin: 4px 0; }
.statblock .sb-ability { padding-left: 1em; text-indent: -1em; }
.statblock .dim { color: var(--cs-muted); }
.statblock .prose-view { display: inline; }
.sb-edit .sb-fields {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 6px 14px;
}
.sb-edit .sb-fields.wide { grid-template-columns: 1fr; margin-top: 10px; }
.sb-edit .sb-fields .fld { display: flex; flex-direction: column; gap: 2px; font-size: 0.78rem; color: var(--cs-muted); }
.sb-edit .sb-fields .fld > span { font-weight: 600; }
.sb-systems .dashboard { margin-top: 8px; }
@media print {
  .statblock .sb-head { border-bottom-color: #000; }
  .statblock .sb-section, .statblock .sb-cr { color: #000; }
}`;

  /**
   * The block's own fields, to edit -- or, on a character with no block, the
   * one button that gives it one. A block put on a character keeps the
   * Automatic Bonus Progression on, because that is what the character had;
   * a monster read off a page starts with it off, because it never did.
   */
function editPanel(model, m, ctx) {
    if (!m) {
      return `<section class="panel span2">
        <h3>Monster fields</h3>
        <p class="hint">This character has no monster block, so the lines a Bestiary entry carries and a character sheet does not — CR and XP, senses and aura, spell-like abilities, ecology, description — are left off. Giving it one puts them on this tab to fill in; nothing else about the character changes.</p>
        <button data-action="monster-block">Give this character a monster block</button>
      </section>`;
    }
    const p = (key, rows = 2) => prose(model, `data-set="monster.${key}"`, m[key], rows, 'grow');
    const t = (key, placeholder = '') => text(`monster.${key}`, m[key], placeholder);
    const subtypes = Array.isArray(m.subtypes) ? m.subtypes.join(', ') : String(m.subtypes || '');
    const body = `<section class="panel span2 sb-edit">
      <h3>Monster fields</h3>
      <p class="hint">What the block prints that no other tab holds. Scores, AC columns, saves, hit points, attacks, feats, skills and the special abilities are on their own tabs — Stats, Overview, Equipment, Feats &amp; Mythic, Skills, and the race-trait rows on the Overview — and this block reads them from there. Prose fields take <code>{…}</code> formulas, so a DC written as <code>{= 10 + con.mod + floor(level / 2)}</code> follows the score.</p>
      <div class="sb-fields">
        ${field('CR', t('cr', '1/2, 5, 30…'))}
        ${field('XP', num('monster.xp', m.xp ?? 0))}
        ${field('Source', t('source'))}
        ${field('Type', t('type', 'outsider'))}
        ${field('Subtypes', text('monster.subtypes', subtypes, 'devil, evil, extraplanar'))}
        ${field('Hit die', num('monster.hitDie', m.hitDie))}
        ${field('Space', t('space', '10 ft.'))}
        ${field('Reach', t('reach', '10 ft.'))}
        ${field('AC note', t('acNote'))}
        ${field('CMB note', t('cmbNote'))}
        ${field('CMD note', t('cmdNote', 'can’t be tripped'))}
        ${field('Languages note', t('languagesNote', 'telepathy 100 ft.'))}
        ${field('Environment', t('environment'))}
        ${field('Organization', t('organization'))}
        ${field('Treasure', t('treasure'))}
      </div>
      <div class="sb-fields wide">
        ${field('Senses', p('senses', 1))}
        ${field('Aura', p('aura', 1))}
        ${field('Regeneration / fast healing', p('healing', 1))}
        ${field('Save note', p('saveNote', 1))}
        ${field('Defensive abilities', p('defensiveAbilities', 1))}
        ${field('Special attacks', p('specialAttacks', 1))}
        ${field('Spell-like abilities', p('spellLike', 5))}
        ${field('Spells', p('spells', 5))}
        ${field('Racial modifiers', p('racialModifiers', 1))}
        ${field('SQ', p('sq', 1))}
        ${field('Gear', p('gear', 1))}
        ${field('Tactics', p('tactics', 3))}
        ${field('Description', p('description', 5))}
      </div>
      <div class="pair" style="margin-top:8px">
        ${check('monster.abp', m.abp, 'Automatic Bonus Progression applies', 'Off for a creature read off a page — its natural armour and saves are its own. On for an NPC built like a character, who has the ladder like anyone else.')}
        <button class="danger" style="margin-left:auto" data-action="monster-unblock" title="Take the monster block off this sheet; every other tab is untouched">Remove the block</button>
      </div>
    </section>`;
    void ctx;
    return collapsible(model, 'statblock-edit', body);
  }

  /** What the reader could not place, kept for the GM to file or discard. */
function unreadPanel(model, m) {
    const rows = m?.unread || [];
    if (!rows.length) return '';
    return `<section class="panel span2">
      <h3>Not read <span class="badge">${rows.length}</span></h3>
      <p class="hint">Lines of the pasted block the reader could not place. Copy one into the field it belongs in above, or on the Overview, then remove it; a line kept here is kept with the creature.</p>
      <div class="tablewrap"><table class="gridtab"><tbody>
        ${rows.map((r, ri) => `<tr><td>${itemText('monster.unread', ri, 'text', r.text)}</td>${rowTools('monster.unread', ri)}</tr>`).join('')}
      </tbody></table></div>
    </section>`;
  }
