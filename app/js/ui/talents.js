/**
 * ui/talents.js -- the sphere-talent cell.
 *
 * One cell, used by every sphere tab there is: a prose field holding
 * whatever the player wrote, and -- when a pack's sphere catalogue knows the
 * name -- a mark carrying what it does. It lived in `panels/combat.js` while
 * Spheres of Power and Might were the only two systems that wanted it; the
 * skill spheres want exactly the same cell, so it moved here rather than
 * being copied or reached for across panels.
 */
import { esc } from './html.js';
import { prose } from './prose.js';
import { basePickSphere, sphereBasePick, sphereTalent } from '../model.js';
import { isBasePick } from '../rules.js';

/**
 * A talent cell: the box it is typed in, and -- when a pack's sphere
 * catalogue knows what was typed -- a mark carrying what it does.
 *
 * The box stays a prose field. A talent is still whatever a player writes,
 * `{…}` formulas and all, and the catalogue is a second opinion rather than a
 * gate: a talent nobody has a pack for is simply unmarked, which is the state
 * every talent on every sheet was in before this. `extra` goes on the wrapper
 * so a caller can keep the cell's own classes.
 */
export function talentCell(model, binding, value, sphere, fill = null) {
  // `fill` names the row's own sphere and notes columns, which differ per
  // table -- a customized weapon and a martial tradition have no notes. The
  // element reads it to fill in what the catalogue can answer for free; left
  // off, the cell is an ordinary one that only ever writes the talent.
  const bind = fill ? `${binding} data-talent-fill="${esc(JSON.stringify(fill))}"` : binding;
  const field = prose(model, bind, value, 1, 'grow');
  // A base pick is the sphere itself; what it carries is the sphere's base
  // abilities, which is what somebody hovering the row wants to read.
  const base = isBasePick(value) ? sphereBasePick(basePickSphere(value, sphere)) : null;
  if (base) {
    return `<span class="tcell">${field}<i class="tmark"
        title="${esc(`${base.label}\n\n${base.text}`)}"
        aria-label="${esc(`${base.sphere} sphere — from the sphere catalogue`)}">✦</i></span>`;
  }
  const hit = sphereTalent(sphere, value);
  if (!hit) return field;
  // A pack written by hand may leave a tag on the name it also lists in
  // `tags` ("Deathful Form (form)" tagged `form`), and saying it twice reads
  // badly. Only an actual repeated suffix counts: an Acid Blast tagged `Acid`
  // is a blast-type group that happens to share a word with its name, and
  // dropping that would lose the tag a caster filters on.
  const suffix = hit.name.trim().match(/[([]([^)\]]+)[)\]]$/)?.[1]?.trim().toLowerCase();
  const tags = [...hit.tags, ...hit.sources]
    .filter((x) => String(x).trim().toLowerCase() !== suffix);
  // The hover is the whole entry, because a talent's text is the reason to
  // look it up at all and there is nowhere in a four-column table to put it.
  const title = [
    `${hit.name}${tags.length ? ` (${tags.join(', ')})` : ''}`,
    [hit.sphere, hit.group].filter(Boolean).join(' — '),
    hit.prerequisites ? `Prerequisites: ${hit.prerequisites}` : '',
    hit.text ? `\n${hit.text}` : '',
  ].filter(Boolean).join('\n');
  return `<span class="tcell">${field}<i class="tmark${hit.sources.length ? ' third' : ''}"
      title="${esc(title)}" aria-label="${esc(`${hit.name} — from the sphere catalogue`)}">✦</i></span>`;
}
