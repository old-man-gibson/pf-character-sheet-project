/**
 * A wiki race's page, in the shape every pack writes a race in.
 *
 * Used by `wiki-docs.mjs`. Kept apart from it so the rules can be tested
 * without running the tool.
 *
 * The wiki lists a race's traits as bullets, which a reader takes as text
 * rather than as traits; every other pack writes each trait as a labelled
 * paragraph, and so does this. The Languages trait is also stated as a field,
 * as the other packs state it. Traits to take instead ("Alternate Racial
 * Traits") and favored class options are entries of their own, as they are
 * elsewhere: "Corsath - Trampler" with its Race, "Corsath - Bard" with its
 * Race and Class. They cite the race's book.
 */

import { unwrapTemplates, delink, templateEnd, splitArgs } from './wikitext.mjs';

/** A value on one line and without markup, as `wiki-docs.mjs` writes a field. */
const field = (v, title = '') => delink(unwrapTemplates(String(v ?? ''), title))
  .replace(/'{2,5}/g, '').replace(/\s+/g, ' ').trim();

/** The headings a race's page lists its traits under ("Corsath Racial Traits"). */
const RACE_TRAITS = /\b(?:racial|race|species|ancestral) traits?\b/i;
/** The one that lists traits to take in place of those ("Alternate Racial Traits"). */
const ALTERNATE = /^alternat(?:e|ive)\b/i;
/** A trait as a race's page lists it: `* '''Low-Light Vision:''' text`, the bullet optional. */
const TRAIT_ITEM = /^(?:\*+[ \t]*)?'{2,3}([^'\n]{1,70}?)[ \t]*:?[ \t]*'{2,3}[ \t]*:?[ \t]*(.*)$/;

/**
 * The classes `{{FCO}}` takes, by argument, read off its source: it writes
 * one `{{Format FCO|Psychic Warrior|{{{psychicwarrior|}}}…}}` line a class.
 */
export const fcoClassesFrom = (source) => new Map([...String(source ?? '')
  .matchAll(/\{\{\s*Format FCO\s*\|([^|}]+)\|\{\{\{(\w+)\|/g)].map((m) => [m[2].toLowerCase(), m[1].trim()]));

/**
 * A page's lines with its traits picked out: `{name, text}` for each labelled
 * trait (a line under one that is not a trait is more of its text), and
 * `{line}` for the rest. A race builder's cost after a name ("Darkvision
 * (2)", "Size (0)") is what the trait costs, not what it is called; it goes
 * after the text.
 */
function traitItems(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.match(TRAIT_ITEM);
    let name = m ? field(m[1]).replace(/:\s*$/, '').trim() : '';
    const cost = name.match(/\s*\((-|—|\d+)(?:\s*RP)?\)$/i);
    if (cost) name = name.slice(0, cost.index).trim();
    if (name && m[2].trim()) out.push({ name, text: `${m[2].trim()}${cost && /\d/.test(cost[1]) ? ` (${cost[1]} RP)` : ''}` });
    else if (out.length && out[out.length - 1].name && line.trim() && !/^[=*{|]/.test(line.trim())) out[out.length - 1].text += `\n${line}`;
    else out.push({ line });
  }
  return out;
}

/** The languages a race starts with, off its Languages trait: "begin play speaking Common and Elven". */
export function startingLanguages(text) {
  const plain = field(text);
  const said = plain.match(/\b(?:begin play|start(?:s)? (?:play|the game)?)\s+(?:speaking|knowing|with)\s+([^.;]+)/i);
  const list = said ? said[1] : (plain.match(/^([^.;:]+)/)?.[1] || '');
  const names = list.split(/,\s*(?:and\s+|or\s+)?|\s+and\s+/).map((s) => s.trim().replace(/^the\s+/i, '')).filter(Boolean);
  // A list is names; anything else is a sentence this cannot read.
  return names.length && names.every((n) => /^[A-Z][\w'-]*(?:\s[A-Z(][\w'()-]*){0,2}$/.test(n)) ? names.join(', ') : '';
}

/**
 * A race's record as records: the race, then its alternate racial traits and
 * its favored class options. `fcoClasses` (from `fcoClassesFrom`) names the
 * classes `{{FCO}}` takes; without it the options are left where they are.
 * Any other record comes back as it is.
 */
export function splitRacePage(rec, fcoClasses = null) {
  if (rec.kind !== 'race') return [rec];
  const race = field(rec.title, rec.title);
  const source = Object.fromEntries(Object.entries(rec.fields || {}).filter(([k]) => /^source/.test(k)));
  const extra = [];
  let languages = '';

  let body = String(rec.body ?? '');
  // Favored class options: `{{FCO|bard = +1 bardic performance round…}}`.
  const at = fcoClasses ? body.search(/\{\{\s*FCO\s*\n?\|/) : -1;
  if (at !== -1) {
    const end = templateEnd(body, at);
    if (end !== -1) {
      const byClass = new Map();
      for (const arg of splitArgs(body.slice(at + 2, end - 2)).slice(1)) {
        const eq = arg.indexOf('=');
        const key = eq > 0 ? arg.slice(0, eq).trim().toLowerCase() : '';
        const text = eq > 0 ? arg.slice(eq + 1).trim() : '';
        if (!key || !text || /source$/.test(key)) continue;
        const base = key.replace(/\d+$/, '');
        const cls = base === 'all' ? 'All' : fcoClasses.get(base);
        if (!cls) continue;
        if (!byClass.has(cls)) byClass.set(cls, []);
        byClass.get(cls).push(text);
      }
      for (const [cls, texts] of byClass) {
        extra.push({ ...rec, kind: 'favored class option', title: `${race} - ${cls}`, fields: { race, class: cls, ...source }, body: texts.join('\n\n') });
      }
      if (byClass.size) body = body.slice(0, at) + body.slice(end);
    }
  }

  const parts = [{ head: '', level: 0, lines: [] }];
  for (const line of body.split('\n')) {
    const h = line.match(/^(={2,6})\s*(.+?)\s*\1\s*$/);
    if (h) parts.push({ head: field(h[2], rec.title), level: h[1].length, lines: [line] });
    else parts[parts.length - 1].lines.push(line);
  }
  const kept = [];
  let alternateAt = 0;
  for (const part of parts) {
    if (part.level && alternateAt && part.level <= alternateAt) alternateAt = 0;
    if (part.level && ALTERNATE.test(part.head) && RACE_TRAITS.test(part.head)) alternateAt = part.level;
    // A heading left with nothing under it once its options are entries of their own.
    if (part.level && /^favou?red class options?$/i.test(part.head) && !part.lines.slice(1).join('').trim()) continue;
    const items = traitItems(part.lines.slice(part.level ? 1 : 0));
    const traits = items.filter((it) => it.name);
    if (alternateAt && traits.length) {
      for (const t of traits) {
        extra.push({ ...rec, kind: 'alternate racial trait', title: `${race} - ${t.name}`, fields: { race, ...source }, body: t.text });
      }
      continue;
    }
    if (part.level && RACE_TRAITS.test(part.head) && traits.length) {
      kept.push(part.lines[0]);
      for (const it of items) {
        if (!it.name) { kept.push(it.line); continue; }
        kept.push('', `'''${it.name}:''' ${it.text}`, '');
        if (/^languages?$/i.test(it.name) && !languages) languages = startingLanguages(it.text);
      }
      continue;
    }
    kept.push(...part.lines);
  }
  const fields = languages && !rec.fields?.languages ? { ...rec.fields, languages } : rec.fields;
  return [{ ...rec, fields, body: kept.join('\n') }, ...extra];
}
