/**
 * ui/datalist.js -- the suggestions a catalogue cell offers as it is typed in.
 *
 * A cell typed against a catalogue -- a feat, a spell, a power -- points at a
 * datalist whose `data-fill` names the catalogue, and `data-classes` the
 * classes to narrow a spell or power list to. FILLERS says, catalogue by
 * catalogue, where the entries come from and how each is labelled; the
 * element only puts the answer into the list. A list that names no filler
 * (the veil and class-feature menus, which their panels draw whole) is left
 * alone. Pure, so the tests can reach it.
 */
import { featsAvailable, powersAvailable, spellsAvailable } from '../model.js';

const DOT = ' · ';

export const FILLERS = {
  feats: {
    pool: () => featsAvailable(),
    label: (e) => e.type,
  },
  spells: {
    pool: ({ classes }) => spellsAvailable({ classes }),
    label: (e) => [e.school, e.classes.map((c) => `${c.name}${c.level === null ? '' : ` ${c.level}`}`).join(', ')]
      .filter(Boolean).join(DOT),
  },
  powers: {
    pool: ({ classes }) => powersAvailable({ classes }),
    label: (e) => [e.discipline || e.element, e.points ? `${e.points} pp` : '', e.burn ? `burn ${e.burn}` : '']
      .filter(Boolean).join(DOT),
  },
};

/**
 * The suggestions for a list asking for `fill`, as `{ value, label }`: what
 * is typed matches anywhere in a name, not only at its start ("blades" finds
 * Sigil of Blades), and at most `max` come back, which is what keeps it cheap
 * against thousands of feats. An empty query gives the first names in the
 * catalogue's order. Null for a list no filler serves.
 */
export function datalistOptions(fill, { classes = [], query = '', max = 40 } = {}) {
  const filler = Object.hasOwn(FILLERS, fill) ? FILLERS[fill] : null;
  if (!filler) return null;
  const q = String(query || '').trim().toLowerCase();
  const out = [];
  for (const e of filler.pool({ classes })) {
    if (q && !e.name.toLowerCase().includes(q)) continue;
    out.push({ value: e.name, label: filler.label(e) || '' });
    if (out.length >= max) break;
  }
  return out;
}
