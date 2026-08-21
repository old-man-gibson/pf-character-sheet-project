/**
 * Iron Chef: ingredients, and the dishes they make.
 *
 * A dish is a course plus an entree, flavour, side, aroma and garnish; each
 * contributes a templated effect that is filled in from the character's level.
 */

import { evaluateFormula } from '../../formula.js';
import { sheetReader } from '../document.js';
import { cleanText, pad } from '../util.js';

export const COOKING_COURSES = [
  ['entrees', 'Entrees', 2],
  ['flavors', 'Flavors', 3],
  ['sides', 'Side Dishes', 2],
  ['aroma', 'Aroma', 1],
  ['garnish', 'Garnish', 1],
];

let COOKING_TABLES = { durationHours: 'floor(level / 3) + 1', entrees: [], flavors: [], sides: [], aroma: [], garnish: [] };

/** Register the shared ingredient list. Call before constructing a Character. */
export function setCookingTables(doc) {
  const list = (v) => (Array.isArray(v) ? v : []).map((x) => ({
    name: String(x?.name || ''), effect: String(x?.effect || ''), combo: String(x?.combo || ''),
  })).filter((x) => x.name);
  COOKING_TABLES = {
    durationHours: String(doc?.durationHours || 'floor(level / 3) + 1'),
    entrees: list(doc?.entrees), flavors: list(doc?.flavors), sides: list(doc?.sides),
    aroma: list(doc?.aroma), garnish: list(doc?.garnish),
  };
}

export function cookingTables() {
  return COOKING_TABLES;
}

/** A dish with nothing on it. */
export function emptyDish() {
  const d = { level: null, chef: '', dishName: '' };
  for (const [key, , slots] of COOKING_COURSES) d[key] = pad([], slots, '');
  return d;
}

export function normalizeDish(dish) {
  const src = dish && typeof dish === 'object' ? dish : {};
  const d = emptyDish();
  d.level = src.level === null || src.level === undefined || src.level === '' ? null : (Number(src.level) || 0);
  d.chef = cleanText(src.chef);
  d.dishName = cleanText(src.dishName);
  for (const [key, , slots] of COOKING_COURSES) d[key] = pad(src[key], slots, '').map(cleanText);
  return d;
}

/**
 * Read the workbook's Auto-Cooking tab: the chef's level in B1 and the dish
 * beside the course labels (Entrees C:D, Flavors C:E, Side Dishes C:D, Aroma
 * C with the Garnish label and value further along the same row).
 */
export function importCooking(tab) {
  const d = emptyDish();
  if (!tab) return d;
  const g = sheetReader(tab);
  const { rows, text, find } = g;
  const first = rows[0] || [];
  const lvl = Number(first[1]);
  d.level = Number.isFinite(lvl) && text(first[1]) !== '' ? lvl : null;
  const cellsAt = (label) => { const hit = find(label); return hit ? rows[hit[0]] : []; };
  const after = (cells, label, n) => {
    const i = cells.findIndex((v) => text(v) === label);
    return i < 0 ? [] : cells.slice(i + 1, i + 1 + n).map(text);
  };
  for (const [key, label, slots] of COOKING_COURSES) {
    const cells = cellsAt(label);
    if (!cells.length) continue;
    // Aroma and Garnish share a row: "Aroma | Fetid | Garnish | Ginger".
    const vals = after(cells, label, key === 'aroma' ? 1 : key === 'garnish' ? 1 : slots)
      .filter((v) => !COOKING_COURSES.some(([, l]) => l === v));
    d[key] = pad(vals, slots, '');
  }
  return normalizeDish(d);
}

/** How many of each ingredient the dish uses, plus the level, for the effect templates. */
function cookingScope(dish, level) {
  const count = (course, name) => dish[course].filter((v) => v.toLowerCase() === name).length;
  return {
    level,
    rice: count('sides', 'rice'),
    avocados: count('sides', 'avocados'),
    spicy: count('flavors', 'spicy'),
    sweet: count('flavors', 'sweet'),
    sour: count('flavors', 'sour'),
    salty: count('flavors', 'salty'),
    savory: count('flavors', 'savory'),
    redMeat: count('entrees', 'red meat'),
    mycoprotein: count('entrees', 'mycoprotein'),
    fish: count('entrees', 'fish'),
    fowl: count('entrees', 'fowl'),
  };
}

/** Fill a template's `{expr}` holes from a scope; a bad formula shows as its own text. */
function fillTemplate(template, scope) {
  return String(template || '').replace(/\{([^{}]+)\}/g, (_, expr) => {
    try {
      const v = evaluateFormula(expr.trim(), scope);
      return v === null || v === undefined ? '' : String(v);
    } catch {
      return `{${expr}}`;
    }
  });
}

/**
 * The dish as it lands on the table: duration, and every ingredient's effect
 * with the numbers worked out for this chef and this combination.
 */
export function cookingDish(dish, { level = 0, characterName = '' } = {}) {
  const d = normalizeDish(dish);
  const lvl = d.level === null ? Number(level) || 0 : d.level;
  const scope = cookingScope(d, lvl);
  const hours = (() => { try { return Number(evaluateFormula(COOKING_TABLES.durationHours, scope)) || 0; } catch { return 0; } })();
  const effects = [];
  for (const [key, course] of COOKING_COURSES) {
    for (const name of d[key]) {
      if (!name) continue;
      const entry = COOKING_TABLES[key].find((x) => x.name.toLowerCase() === name.toLowerCase());
      effects.push({
        course, name,
        text: entry ? fillTemplate(entry.effect, scope) : '',
        combo: entry?.combo || '',
        unknown: !entry,
      });
    }
  }
  return {
    level: lvl, chef: d.chef || characterName, dishName: d.dishName, hours, scope, effects,
    courses: COOKING_COURSES.map(([key, label]) => ({ key, label, picks: d[key].filter(Boolean) })),
  };
}

/** The dish as a Discord post: what is in it, how long it lasts, and each effect as a bullet. */
export function cookingExport(view) {
  const head = view.dishName ? `**${view.dishName}**` : '**Iron Chef Dish**';
  const by = view.chef ? ` — cooked by ${view.chef}` : '';
  const lines = [
    `${head}${by} (iron chef level ${view.level})`,
    view.courses.filter((c) => c.picks.length).map((c) => `${c.label}: ${c.picks.join(', ')}`).join(' · '),
    `Duration: ${view.hours} Hours`,
    ...view.effects.map((e) => `• ${e.text || `${e.name} (no rule text)`}`),
  ];
  return lines.filter(Boolean).join('\n');
}

/** The iron chef's dish as it lands on the table, and as a Discord post. */
export function cookingView(model) {
  const view = cookingDish(model.data.cooking, {
    level: Number(model.data.identity?.level) || 0,
    characterName: String(model.data.identity?.name || ''),
  });
  return { ...view, export: cookingExport(view) };
}
