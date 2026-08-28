/**
 * The four defence boxes that hold a list rather than a number: damage
 * reduction, energy resistance, vulnerability, and the immunities.
 *
 * Each is free text and always has been -- "5/magic", "fire 10, cold 5",
 * "sleep, paralysis" -- because that is how a stat block writes them and
 * because no two tables agree on the punctuation. That is fine to read and
 * useless to aim at: "your DR increases by 2" had nowhere to land, and a
 * player wrote 7 over the 5 and lost the rule that said why.
 *
 * So the text is parsed into the parts it is already made of. Every part
 * keeps the name it is written under -- `dr.magic`, `resistance.fire`,
 * `immune.sleep` -- which is at once what a formula reads and what a bonus
 * is forwarded to. Nothing here is stored: the boxes go on holding exactly
 * what was typed, and these are worked out from them on every recompute, the
 * same way the armour class is worked out from its columns.
 *
 * Every function is pure. The model hands in the text (with its {…} tokens
 * already resolved) and a lookup for what has been forwarded; what comes back
 * is the list to show and the names to publish.
 */

import { slug } from '../util.js';

/** The dashes a stat block writes for "nothing bypasses this". */
const DASH = /^[‐-―−-]+$/;

/** Entries are separated by commas, semicolons and newlines -- never by "/". */
const splitEntries = (text) => String(text ?? '')
  .split(/[,;\n]+/)
  .map((s) => s.trim())
  .filter(Boolean);

/** The name a part answers to: `dr.cold_iron`, `resistance.fire`. */
export const partKey = (family, name) => `${family}.${slug(name) === 'x' ? 'none' : slug(name)}`;

/* ------------------------------------------------------------------ *
 * Damage reduction
 * ------------------------------------------------------------------ */

/**
 * "5/magic; 10/—" as its parts.
 *
 * The bypass is kept as written -- "magic and silver" is one bypass and not
 * two, because a weapon has to be both -- and slugged for the name it
 * answers to. A dash means nothing bypasses it, and is `dr.none`: the entry
 * every "DR 10/—" on a monster is, and the one a bonus with no type named
 * finds when the box is empty.
 */
export function parseDr(text) {
  const out = [];
  for (const raw of splitEntries(text)) {
    // "DR 5/magic" and "5/magic" alike; the label is not part of the value.
    const body = raw.replace(/^\s*(dr|damage\s+reduction)\b[:\s]*/i, '').trim();
    const m = body.match(/^([+-]?\d+)\s*\/\s*(.*)$/) || body.match(/^([+-]?\d+)\s*$/);
    if (!m) { out.push({ amount: 0, bypass: body, key: partKey('dr', body), text: raw, kept: true }); continue; }
    const bypass = DASH.test(String(m[2] ?? '').trim()) ? '—' : String(m[2] ?? '').trim();
    out.push({
      amount: Number(m[1]) || 0,
      bypass,
      key: partKey('dr', bypass === '—' || bypass === '' ? 'none' : bypass),
      text: raw,
    });
  }
  return out;
}

/** The parts as one line again: "5/magic, 10/—". */
export const formatDr = (parts) => parts
  .map((p) => (p.kept ? p.text : `${p.amount}/${p.bypass || '—'}`))
  .join(', ');

/* ------------------------------------------------------------------ *
 * Energy resistance and vulnerability
 * ------------------------------------------------------------------ */

/** Words a stat block puts around an energy type that are not its name. */
const ENERGY_NOISE = /\b(resist(?:ance|s)?|immunity|vulnerabilit(?:y|ies)|vulnerable|weakness|energy|to|against|vs\.?)\b/gi;

/**
 * "fire 10, cold 5" as its parts, whichever side the number is written on.
 *
 * Vulnerabilities are the same shape ("fire 5" is 5 more damage from fire),
 * so the one parser reads both boxes and the family it belongs to is the
 * caller's to say.
 */
export function parseEnergy(text, family = 'resistance') {
  const out = [];
  for (const raw of splitEntries(text)) {
    const m = raw.match(/([+-]?\d+)/);
    if (!m) {
      // "immune to fire" in the resistance box: a named energy with no
      // number. Kept as written rather than read as a 0 nobody typed.
      const name = raw.replace(ENERGY_NOISE, ' ').replace(/\s+/g, ' ').trim();
      out.push({ energy: name || raw, amount: 0, key: partKey(family, name || raw), text: raw, kept: true });
      continue;
    }
    const name = raw.replace(m[0], ' ').replace(ENERGY_NOISE, ' ')
      .replace(/[^A-Za-z0-9' -]+/g, ' ').replace(/\s+/g, ' ').trim();
    out.push({
      energy: name,
      amount: Number(m[1]) || 0,
      key: partKey(family, name || 'all'),
      text: raw,
    });
  }
  return out;
}

/** The parts as one line again: "fire 10, cold 5". */
export const formatEnergy = (parts) => parts
  .map((p) => (p.kept ? p.text : `${p.energy || 'all'} ${p.amount}`))
  .join(', ');

/* ------------------------------------------------------------------ *
 * Immunities
 * ------------------------------------------------------------------ */

/**
 * "sleep, paralysis and poison" as the names it holds.
 *
 * An immunity has no number, so unlike its neighbours it is a switch: a name
 * is on the list or it is not. "and" separates as surely as a comma does
 * here, which it does not in a DR bypass -- "magic and silver" is one
 * condition on one reduction, while "sleep and poison" is two immunities.
 */
export function parseImmunities(text) {
  const out = [];
  for (const raw of splitEntries(text)) {
    for (const part of raw.split(/\s+and\s+|\s*&\s*/i)) {
      const name = part.replace(/^\s*immunit(?:y|ies)\b[:\s]*/i, '')
        .replace(/^\s*immune\s+to\s+/i, '').trim();
      if (name) out.push({ name, key: partKey('immune', name), text: name });
    }
  }
  return out;
}

export const formatImmunities = (parts) => parts.map((p) => p.name).join(', ');

/* ------------------------------------------------------------------ *
 * Spell resistance
 * ------------------------------------------------------------------ */

/**
 * The number in the spell-resistance box, and the text around it.
 *
 * The box holds anything from "17" to "Yes (17)" to "11 + character level",
 * and the sentence is worth keeping -- so the number is found in place and
 * the rest of the line is remembered around it. A bonus lands on the number
 * and the line reads back the way it was written.
 */
export function parseSpellResistance(text) {
  const s = String(text ?? '');
  const m = s.match(/[+-]?\d+/);
  return {
    amount: m ? Number(m[0]) : 0,
    has: !!m || /\byes\b/i.test(s),
    before: m ? s.slice(0, m.index) : s,
    after: m ? s.slice(m.index + m[0].length) : '',
  };
}

/** The same line with the number replaced by what it now comes to. */
export function formatSpellResistance(parsed, total) {
  if (!parsed.has && !total) return '';
  const body = String(parsed.before ?? '').trim() || String(parsed.after ?? '').trim()
    ? `${parsed.before}${total}${parsed.after}` : String(total);
  return body.trim();
}

/* ------------------------------------------------------------------ *
 * Applying what was forwarded
 * ------------------------------------------------------------------ */

/**
 * The parts a box holds, with every forwarded bonus added on.
 *
 * Three things happen here, and the third is the point of the whole file:
 *
 * 1. The bonus aimed at the family ("+2 to your damage reduction") lands on
 *    every part the box already holds.
 * 2. The bonus aimed at one part (`{dr.magic += 2}`) lands on that one.
 * 3. A bonus aimed at a part the box has *not* got grants it. "Energy
 *    resistance (fire) 10" on a character with no resistances is the rule
 *    creating one, not a rule with nowhere to go -- and a sheet that
 *    silently dropped it would be worse than no sheet at all. The part is
 *    marked `granted` so the panel can say where it came from.
 *
 * @param parts   from parseDr / parseEnergy
 * @param family  'dr' | 'resistance' | 'weakness'
 * @param all     the total forwarded at the family as a whole
 * @param at      (key) => the total forwarded at one part
 * @param keys    every `<family>.<name>` anything was forwarded to
 * @param label   (name) => how a granted part is written ("magic", "fire")
 */
export function applyForwarded(parts, family, all, at, keys, label) {
  const out = parts.map((p) => {
    const bonus = (p.kept ? 0 : all) + at(p.key);
    return { ...p, bonus, amount: p.amount + bonus };
  });
  const held = new Set(out.map((p) => p.key));
  for (const key of keys) {
    if (held.has(key)) continue;
    const bonus = at(key);
    if (bonus <= 0) continue;
    const name = label(key.slice(family.length + 1));
    out.push(family === 'dr'
      ? { amount: bonus, bonus, bypass: name, key, text: '', granted: true }
      : { amount: bonus, bonus, energy: name, key, text: '', granted: true });
  }
  return out;
}

/**
 * The immunities the box lists, plus the ones a rule grants and minus the
 * ones a rule takes away.
 *
 * A positive total grants; a negative one suppresses, which is what a
 * template that strips an immunity needs and what `-=` already means
 * everywhere else. A suppressed immunity stays on the list, struck through,
 * for the same reason a superseded bonus does: it is still written on the
 * character, and a reader who cannot see it will type it in again.
 */
export function applyImmunities(parts, at, keys) {
  const out = parts.map((p) => ({ ...p, bonus: at(p.key), off: at(p.key) < 0 }));
  const held = new Set(out.map((p) => p.key));
  for (const key of keys) {
    if (held.has(key)) continue;
    const bonus = at(key);
    if (bonus <= 0) continue;
    const name = key.slice('immune.'.length).replace(/_/g, ' ');
    out.push({ name, key, text: '', bonus, off: false, granted: true });
  }
  return out;
}

/** A slugged part name back as a word: `cold_iron` -> `cold iron`. */
export const unslug = (s) => String(s || '').replace(/_/g, ' ');
