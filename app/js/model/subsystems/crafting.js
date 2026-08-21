/**
 * Crafting: what a project costs, how long it takes, and the DC it is made at.
 *
 * The workbook's Crafting tab is a free-form sheet of labelled cells rather
 * than a table, so reading it is a matter of finding labels; the sums are
 * then recomputed from the parts so a changed skill or a raised DC moves them.
 */

import {
  CRAFT_BASE_COSTS, CRAFT_BASE_SPEED, CRAFT_DC_PER_BYPASS, CRAFT_SPEED_MULTIPLIER,
  craftingFraction, craftingSpeed, fmt, skillLabel,
} from '../../rules.js';
import { evaluateFormula } from '../../formula.js';

/** Labels whose value we keep, read from the cell immediately to their right. */
const CRAFT_LABELS = {
  'Base Crafting %': 'basePercent',
  Item: 'itemName',
  Value: 'itemValue',
  '% Discount': 'discount',
  'Zero Profit': 'zeroProfit',
  'Item DC': 'itemDC',
  'DC Notes': 'dcNotes',
  'Bypassed Reqs.': 'bypassText',
  'Resources Used': 'resources',
  'Buyer (Character)': 'buyerName',
  'Buyer (Player#WXYZ)': 'buyerTag',
  'Mana Remaining': 'remaining',
  Notes: 'notes',
  'Character Name': 'sellerName',
};

/** Labels the sheet computed and this tab now recomputes, so they are dropped. */
const CRAFT_DERIVED_LABELS = ['Final Crafting Cost', 'Gross Profit', 'Net Profit (w/ Discount)',
  'Final Sale', 'Crafting DC', 'Check Result', 'Compounding % CR', 'Final Value:Craft Ratio'];

const CRAFT_POST_LABELS = ['Crafting Post', 'Marketplace Post'];

/**
 * CEILING() with the spreadsheet's tolerance for float drift.
 *
 * 200000 x 0.5 x 0.9 lands on 90000.000000000015 in binary floating point,
 * which a plain Math.ceil would round up to 90001 -- a price a penny over the
 * one the workbook shows.
 */
const ceilExact = (n) => {
  const v = Number(n) || 0;
  return Math.ceil(Number(v.toPrecision(12)));
};

/**
 * Split a DC note into the adjustments it describes.
 *
 * The sheet could not add these up, so players wrote them as reminders next
 * to a base DC ("+5 Rush", "Rush +5, +2 exotic"). Each recognised piece
 * becomes a real adjustment that moves the total; anything unparsed stays as
 * free text.
 */
function parseDcNotes(text) {
  const adjustments = [];
  const rest = [];
  for (const part of String(text ?? '').split(/[,;\n]+/)) {
    const piece = part.trim();
    if (!piece) continue;
    const lead = piece.match(/^([+-]\s*\d+)\s*(.*)$/);
    const trail = piece.match(/^(.*?)\s*([+-]\s*\d+)$/);
    const hit = lead || trail;
    if (!hit) { rest.push(piece); continue; }
    const [value, label] = lead ? [hit[1], hit[2]] : [hit[2], hit[1]];
    adjustments.push({
      label: label.trim() || 'DC adjustment',
      value: Number(value.replace(/\s+/g, '')),
      enabled: true,
    });
  }
  return { adjustments, rest: rest.join(', ') };
}

/**
 * Read the workbook's Item Crafting tab into the structured block this tab
 * now edits.
 *
 * Everything is found by label rather than by cell address: Bryva's copy has
 * her speed increases as named toggles and her buyer block nine rows further
 * down than the other four, and both layouts fall out of the same scan. Cells
 * no label claims -- her Armiger/veil block in M2:S9 -- are kept verbatim in
 * `sourceExtras` so nothing from the workbook is silently dropped.
 */
export function importCrafting(tab, identity = {}) {
  const rows = (tab?.rows || []).map((r) => [...(r.cells || [])]);
  const used = new Set();
  const mark = (ri, ci) => used.add(`${ri}:${ci}`);
  const at = (ri, ci) => (rows[ri] ? rows[ri][ci] ?? null : null);
  const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
  /** A cell carrying an amount: numbers as numbers, anything else verbatim. */
  const amount = (raw) => {
    if (text(raw) === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : text(raw);
  };

  const find = (label) => {
    for (let ri = 0; ri < rows.length; ri++) {
      const ci = rows[ri].findIndex((v) => typeof v === 'string' && v.trim() === label);
      if (ci >= 0) return [ri, ci];
    }
    return null;
  };
  /** Consume a label, the value beside it, and any derived cells after that. */
  const take = (label, derived = 0) => {
    const hit = find(label);
    if (!hit) return null;
    for (let n = 0; n <= derived + 1; n++) mark(hit[0], hit[1] + n);
    return at(hit[0], hit[1] + 1);
  };

  const found = {};
  for (const [label, key] of Object.entries(CRAFT_LABELS)) {
    // Base Crafting % keeps its fraction (the sheet's G2) in the next cell over.
    found[key] = take(label, label === 'Base Crafting %' ? 1 : 0);
  }
  for (const label of CRAFT_DERIVED_LABELS) take(label);
  for (const label of CRAFT_POST_LABELS) {
    const hit = find(label);
    if (!hit) continue;
    mark(hit[0], hit[1]);
    mark(hit[0] + 1, hit[1]);   // the generated post text sits on the next row
  }

  // The bypassed-requirement count sits one row above its notes. Its own label
  // ("# of Bypassed Reqs.") starts with a #, which the converter strips as a
  // spreadsheet error marker, so it is located from the row below instead.
  let bypassCount = 0;
  const bypassAt = find('Bypassed Reqs.');
  if (bypassAt) {
    const above = at(bypassAt[0] - 1, bypassAt[1] + 1);
    if (Number.isFinite(Number(above)) && text(above) !== '') {
      bypassCount = Math.max(0, Math.trunc(Number(above)));
      mark(bypassAt[0] - 1, bypassAt[1] + 1);
    }
  }

  // Speed increases: the rows under "Crafting Speed/day", in its own column.
  // A numeric entry is a flat bonus to progress per day; a ticked box is one
  // of Bryva's named crafting bonuses, each worth x2.
  const speedIncreases = [];
  const speedAt = find('Crafting Speed/day');
  if (speedAt) {
    const [top, col] = speedAt;
    mark(top, col);
    mark(top, col + 1);
    for (let ri = top + 1; ri < rows.length; ri++) {
      const label = text(at(ri, col));
      if (CRAFT_POST_LABELS.includes(label)) break;
      if (!label) continue;
      const raw = at(ri, col + 1);
      mark(ri, col);
      mark(ri, col + 1);
      if (typeof raw === 'boolean') {
        speedIncreases.push({
          label, kind: 'multiplier', value: CRAFT_SPEED_MULTIPLIER, enabled: raw,
        });
      } else if (amount(raw) !== null) {
        speedIncreases.push({
          // "Speed Increase" is the template's placeholder, not a name.
          label: label === 'Speed Increase' ? '' : label,
          kind: 'flat',
          value: amount(raw),
          enabled: true,
        });
      }
    }
  }

  // Cost reductions: every "% Cost Reduction" row. The sheet had no room for
  // names, so imported ones start unnamed.
  const costReductions = [];
  rows.forEach((cells, ri) => cells.forEach((cell, ci) => {
    if (text(cell) !== '% Cost Reduction') return;
    mark(ri, ci);
    mark(ri, ci + 1);
    const pct = amount(at(ri, ci + 1));
    if (pct !== null && pct !== 0) costReductions.push({ label: '', value: pct, enabled: true });
  }));

  // A percentage the sheet formatted as a percent comes through as a fraction.
  const asPercent = (v, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n) || text(v) === '') return fallback;
    return n > 0 && n <= 1 ? n * 100 : n;
  };

  const basePercent = asPercent(found.basePercent, CRAFT_BASE_COSTS[0].percent);
  const baseCosts = CRAFT_BASE_COSTS.map((b) => ({ ...b }));
  if (!baseCosts.some((b) => b.percent === basePercent)) {
    baseCosts.push({ label: 'From the sheet', percent: basePercent });
  }

  const notes = parseDcNotes(found.dcNotes);
  const bypassed = String(found.bypassText ?? '').split(/[,;\n]+/)
    .map((s) => s.trim()).filter(Boolean)
    .map((label) => ({ label, enabled: true }));
  while (bypassed.length < bypassCount) bypassed.push({ label: '', enabled: true });

  const sourceExtras = [];
  rows.forEach((cells, ri) => {
    const kept = cells.map((cell, ci) => (used.has(`${ri}:${ci}`) ? null : cell));
    while (kept.length && kept[kept.length - 1] === null) kept.pop();
    if (kept.some((v) => v !== null && v !== undefined && v !== '')) sourceExtras.push({ cells: kept });
  });
  // Drop the columns every leftover row shares as empty, so the block keeps its
  // own alignment instead of trailing a dozen blank cells from the sheet.
  const lead = Math.min(...sourceExtras.map(({ cells }) => cells.findIndex((v) => v !== null)), Infinity);
  if (Number.isFinite(lead) && lead > 0) for (const row of sourceExtras) row.cells = row.cells.slice(lead);

  const project = {
    name: text(found.itemName),
    value: Number(found.itemValue) || 0,
    discountOverride: null,
    zeroProfit: found.zeroProfit === true,
    itemDC: Number(found.itemDC) || 0,
    checkMod: 0,
    dcAdjustments: notes.adjustments,
    bypassed,
    dcNotes: notes.rest,
    resources: text(found.resources),
    notes: text(found.notes),
    buyerName: text(found.buyerName),
    buyerTag: text(found.buyerTag),
    remaining: text(found.remaining),
  };

  return {
    baseSpeed: CRAFT_BASE_SPEED,
    speedIncreases,
    baseCosts,
    baseCostIndex: Math.max(0, baseCosts.findIndex((b) => b.percent === basePercent)),
    costReductions,
    discount: asPercent(found.discount, 0),
    dcPerBypass: CRAFT_DC_PER_BYPASS,
    timeBasis: 'value',
    checkMode: 'take10',
    checkSkill: null,
    checkMisc: 0,
    checkRoll: 0,
    currency: 'mana',
    sellerName: text(found.sellerName) || text(identity.name),
    // Everything the sheet held that no label claimed -- Bryva's Armiger
    // customisation block. Kept, shown, but not modelled.
    sourceExtras,
    projects: [project],
  };
}

/**
 * The Craft skills the crafting check may key off, with the live bonus from
 * the Skills tab. Labels are unique so they can be stored as the choice.
 */
export function craftSkills(model) {
  const seen = new Map();
  return (model.data.skills || [])
    .filter((s) => /^Craft\b|^Craft\(/i.test(s.name))
    .map((s) => {
      const base = skillLabel(s.name, s.spec);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return {
        key: n > 1 ? `${base} ${n}` : base,
        label: n > 1 ? `${base} ${n}` : base,
        bonus: Number(s.bonus) || 0,
        ranks: Number(s.totalRanks) || 0,
      };
    });
}

/**
 * The crafting calculator.
 *
 * Speed, base cost and the cost reductions are the crafter's standing setup;
 * each project then costs `CEILING(value x ratio)`, sells for the discounted
 * price or its cost, and takes `CEILING(basis / speed per day)` days. Every
 * number a player types may instead be a formula, resolved in the same
 * sandbox as the trackers, so a bonus that scales with the character does.
 */
export function recomputeCrafting(model) {
  const cr = model.data.crafting;
  if (!cr) return;
  const scope = model.scope();
  const errors = [];

  /** A plain number, or a player formula; resolved into `<field>Num`. */
  const resolve = (obj, field, where) => {
    const raw = obj[field];
    obj[`${field}Error`] = null;
    let out = 0;
    if (typeof raw === 'number') {
      out = raw;
    } else {
      const src = String(raw ?? '').trim();
      if (src !== '') {
        try {
          const v = Number(evaluateFormula(src, scope));
          out = Number.isFinite(v) ? v : 0;
        } catch (err) {
          obj[`${field}Error`] = err.message;
          errors.push(`${where}: ${err.message}`);
        }
      }
    }
    obj[`${field}Num`] = out;
    return out;
  };

  for (const s of cr.speedIncreases || []) resolve(s, 'value', s.label || 'Speed increase');
  const speedPerDay = craftingSpeed(cr.baseSpeed, cr.speedIncreases || []);

  const presets = cr.baseCosts || [];
  const preset = presets[Number(cr.baseCostIndex) || 0] || presets[0] || { percent: 0 };
  const basePercent = Number(preset.percent) || 0;
  const baseFraction = craftingFraction(basePercent);

  let compounding = 1;
  for (const r of cr.costReductions || []) {
    const pct = resolve(r, 'value', r.label || 'Cost reduction');
    if (r.enabled !== false) compounding *= 1 - pct / 100;
  }
  const ratio = compounding * baseFraction;

  // Crafting check: take 10 by default, off the Craft skill's live total.
  // An unset choice takes the sheet's own default (the first Craft skill the
  // character actually has ranks in); "None" is a real choice and stays one.
  const skills = model.craftSkills();
  const skill = cr.checkSkill === null || cr.checkSkill === undefined
    ? skills.find((s) => s.ranks > 0) || skills[0] || null
    : skills.find((s) => s.key === cr.checkSkill) || null;
  const roll = cr.checkMode === 'take20' ? 20
    : cr.checkMode === 'manual' ? (Number(cr.checkRoll) || 0) : 10;
  const checkBase = roll + (skill?.bonus || 0) + (Number(cr.checkMisc) || 0);

  const unit = String(cr.currency || '').trim();
  const suffix = unit ? ` ${unit}` : '';

  for (const p of cr.projects || []) {
    const where = p.name || 'Project';
    const value = resolve(p, 'value', `${where} value`);
    const cost = ceilExact(value * ratio);
    const discount = p.discountOverride === null || p.discountOverride === undefined
      ? Number(cr.discount) || 0
      : Number(p.discountOverride) || 0;
    const sale = p.zeroProfit ? cost : Math.max(ceilExact(value * (1 - discount / 100)), cost);

    const itemDC = resolve(p, 'itemDC', `${where} item DC`);
    for (const a of p.dcAdjustments || []) resolve(a, 'value', `${where} DC — ${a.label || 'adjustment'}`);
    const adjustments = (p.dcAdjustments || []).filter((a) => a.enabled !== false);
    const bypasses = (p.bypassed || []).filter((b) => b.enabled !== false);
    const perBypass = Number(cr.dcPerBypass) || 0;
    const dc = itemDC + adjustments.reduce((t, a) => t + a.valueNum, 0) + bypasses.length * perBypass;
    const check = checkBase + (Number(p.checkMod) || 0);

    const basis = cr.timeBasis === 'cost' ? cost : value;
    const daysExact = speedPerDay > 0 ? basis / speedPerDay : 0;

    // The DC line explains itself: every adjustment and bypass that moved it.
    const dcParts = [
      ...adjustments.map((a) => `${a.label || 'adjustment'} ${fmt(a.valueNum)}`),
      ...bypasses.map((b) => `bypass${b.label ? `: ${b.label}` : ''} ${fmt(perBypass)}`),
    ];
    if (String(p.dcNotes ?? '').trim()) dcParts.push(String(p.dcNotes).trim());

    p.calc = {
      value,
      cost,
      basis,
      gross: value - cost,
      sale,
      net: sale - cost,
      discount,
      dc,
      dcParts,
      check,
      succeeds: check >= dc,
      days: speedPerDay > 0 ? Math.ceil(Number(daysExact.toPrecision(12))) : 0,
      daysExact: Math.round(daysExact * 100) / 100,
    };
    const dcLine = dcParts.length ? `${dc} (${dcParts.join(', ')})` : `${dc}`;

    // The workbook's own two Discord posts, regenerated from live values.
    p.calc.craftPost = [
      `**Crafting**: ${p.name ?? ''}`,
      `**Value**: ${value}${suffix}`,
      `**Cost**: ${cost}${suffix}`,
      `**Profit**: ${p.zeroProfit ? 'No Profit' : `${p.calc.net}${suffix}`}`,
      `**DC**: ${dcLine}`,
      `**Check**: ${check}`,
      `**Time to Completion**: ${p.calc.days} (${p.calc.daysExact}) days`,
      `**Resources used:** ${p.resources ?? ''}`,
      `**Notes/Description**: ${p.notes ?? ''}`,
    ].join('\n');

    p.calc.marketPost = [
      `**Character Name:** ${cr.sellerName ?? ''}`,
      `**Item:** ${p.name ?? ''}`,
      `**Market Value:** ${value}`,
      `**Price Sold:** ${sale}`,
      `**Sold To:** ${p.buyerName ?? ''} (@${p.buyerTag ?? ''})`,
      `**Gold or Mana Remaining:** ${p.remaining ?? ''}${suffix}`,
    ].join('\n');
  }

  cr.calc = {
    speedPerDay,
    basePercent,
    baseFraction,
    compounding,
    ratio,
    checkBase,
    skill: skill?.key ?? null,
    skillBonus: skill?.bonus || 0,
    roll,
    errors,
  };
}
