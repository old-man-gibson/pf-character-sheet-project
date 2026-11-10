/**
 * ui/datalist.js -- the suggestions a catalogue cell offers as it is typed in.
 *
 * A cell typed against a catalogue -- a feat, a spell, a power, a sphere
 * talent, a class's archetypes -- points at a datalist whose `data-fill`
 * names the catalogue, `data-classes` the classes to narrow a spell or power
 * list to (or the class row an archetype list is for), and `data-sphere` the
 * sphere to narrow a talent list to. FILLERS says, catalogue by catalogue,
 * where the entries come from and how each is labelled; the element only
 * puts the answer into the list. A list that names no filler (the veil and
 * class-feature menus, which their panels draw whole) is left alone. No DOM,
 * so the tests can reach it.
 */
import { featsAvailable, powersAvailable, spellsAvailable, talentsAvailable } from '../model.js';
import { runtime as extensionRuntime } from '../extension-runtime.js';
import { archetypesForClassRow } from '../extensions.js';

const DOT = ' · ';
const lower = (s) => String(s ?? '').trim().toLowerCase();

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
  // A row with its sphere picked is offered that sphere's talents, and the
  // label leaves the sphere out; a row without one names each talent's sphere.
  talents: {
    pool: ({ sphere }) => talentsAvailable({ sphere }),
    label: (e, { sphere }) => (e.base ? 'base sphere'
      : [sphere ? '' : e.sphere, ...e.tags].filter(Boolean).join(DOT)),
  },
  // The archetypes the active packs offer for a class row, named by its
  // class. The cell names several, comma-separated (`several`). The label
  // gives the pack, and the archetype's class when it is not the row's name.
  archetypes: {
    several: true,
    pool: ({ classes, model }) => {
      const index = model ? model.list('classes').findIndex((c) => lower(c?.name) === lower(classes[0])) : -1;
      return index === -1 ? []
        : [...archetypesForClassRow(model, extensionRuntime.blocks(), index)].sort((a, z) => a.name.localeCompare(z.name));
    },
    label: (b, { classes }) => [lower(b.class) === lower(classes[0]) ? '' : b.class, b.extName].filter(Boolean).join(DOT),
  },
};

/**
 * The suggestions for a list asking for `fill`, as `{ value, label }`: what
 * is typed matches anywhere in a name, not only at its start ("blades" finds
 * Sigil of Blades), and at most `max` come back, which is what keeps it cheap
 * against thousands of feats. An empty query gives the first names in the
 * catalogue's order. Null for a list no filler serves.
 *
 * A cell that names several, comma-separated (a filler marked `several`),
 * matches what is typed after the last comma, leaves out the names already
 * before it, and offers each suggestion with those names kept in front.
 * `model` is the character, for a filler that reads it.
 */
export function datalistOptions(fill, { classes = [], sphere = '', query = '', max = 40, model = null } = {}) {
  const filler = Object.hasOwn(FILLERS, fill) ? FILLERS[fill] : null;
  if (!filler) return null;
  const narrow = { classes, sphere: String(sphere || '').trim(), model };
  let typed = String(query || '');
  let head = '';
  if (filler.several && typed.includes(',')) {
    const cut = typed.lastIndexOf(',');
    head = `${typed.slice(0, cut + 1)} `;
    typed = typed.slice(cut + 1);
  }
  const before = new Set(head.split(',').map(lower).filter(Boolean));
  const q = typed.trim().toLowerCase();
  const out = [];
  for (const e of filler.pool(narrow)) {
    if (q && !e.name.toLowerCase().includes(q)) continue;
    if (before.has(lower(e.name))) continue;
    out.push({ value: head + e.name, label: filler.label(e, narrow) || '' });
    if (out.length >= max) break;
  }
  return out;
}
