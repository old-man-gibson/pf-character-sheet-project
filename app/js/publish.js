/**
 * publish.js -- a character as a third party should receive it.
 *
 * A sheet in this app reads its content from whatever packs the browser has
 * switched on. Hand someone the JSON and they get a character whose veils have
 * no text and whose disciplines offer nothing, because the packs are not
 * theirs. The obvious fix -- ship the packs alongside -- is the wrong one: that
 * is not publishing a character, it is republishing a catalogue, and the engine
 * ships content-free on purpose.
 *
 * So a published document carries **only the entries the character has
 * equipped or listed**, and nothing that was merely available to it. A veil
 * sitting in a chakra slot travels; the sixteen hundred veils it was chosen
 * from do not. A discipline contributes its name and the two maneuvers this
 * character knows, not its catalogue. The test is what the sheet *displays*,
 * never what it could *offer* -- which costs nothing to apply, because a
 * published sheet is read-only and every picker in it is already dead weight.
 * A wiki cites a rule; it does not become the rulebook.
 *
 * The mechanism is one the subsystems already have. Each of them keeps what a
 * player wrote apart from what a pack supplies -- `veilOwn` beside
 * `veilDetails`, `maneuverOwn` beside `maneuverDetails` -- and merges them
 * own-wins at read time. Publishing runs that merge for the referenced entries
 * and stores the answer in the field the player's own text would have gone in.
 * The result is an ordinary character document that happens to have its own
 * text filled in: it opens in any copy of the app with no packs at all, and
 * nothing downstream needs to know it was published.
 *
 * The one rule is that this **never writes back**. akashic.js keeps the split
 * precisely so that "opening a veil can never copy the catalogue's text into
 * the character. A pack that fixes a typo has to be able to fix it on every
 * sheet, which it cannot do if the sheets took a copy." A published document is
 * a copy, deliberately, at one moment, for someone who has no pack to fix. It
 * is a derived artefact and it goes outward only.
 */

import { MANEUVER_FIELDS } from './rules.js';
import { veilDetails } from './model/subsystems/akashic.js';
import { disciplineEntries, maneuverDetails, noteKeyOf } from './model/subsystems/maneuvers.js';
import { featDetails, powerDetails, spellDetails } from './model/subsystems/catalogues.js';
import { castingTable } from './model/subsystems/vancian.js';
import { psionicCurve } from './model/subsystems/psionics.js';
import { deckManipulation } from './model/subsystems/cardcasting.js';
import { COMPANION_KINDS, abilityTextKey, companionAbilityText } from './companions.js';
import { Character } from './model.js';

/**
 * The catalogue's own words about a veil, kept beside the text.
 *
 * A citation without a source is the thing this file exists to avoid, so the
 * chakra, descriptors and book travel with the entry. The sheet never stored
 * them -- they were always read back out of the pack -- and they survive a
 * round trip through `Character` because normalization leaves unknown fields
 * on a veil alone.
 */
const VEIL_CITATION = ['slot', 'descriptor', 'bindEffect', 'source'];

const clone = (v) => JSON.parse(JSON.stringify(v ?? null));

/** One entry a reader can read, counted in all and under its kind. */
const carry = (report, kind) => {
  report.carried++;
  report.carriedBy[kind] = (report.carriedBy[kind] || 0) + 1;
};

/**
 * Fill in every veil the character has shaped.
 *
 * `veilDetails` answers with the player's own description where they wrote
 * one and the catalogue's underneath, so a veil the player has already
 * described is left exactly as it was.
 */
function publishVeils(doc, report) {
  // The chakra slots and the Kheshig's bound veils alike: both are veils the
  // character has shaped, and the Kheshig's used to leave without their text.
  for (const slot of [...(doc.akashic?.slots || []), ...(doc.akashic?.kheshig || [])]) {
    for (const veil of slot.veils || []) {
      if (!veil?.name) continue;
      const details = veilDetails(veil);
      if (!details.mine && details.desc) veil.desc = details.desc;
      for (const field of VEIL_CITATION) {
        if (details[field] && !veil[field]) veil[field] = details[field];
      }
      if (String(veil.desc ?? '').trim()) carry(report, 'veil');
      else if (details.known) report.blank.push(`veil: ${veil.name}`);
      else report.unknown.push(`veil: ${veil.name}`);
    }
  }
}

/**
 * Fill in every maneuver the character knows, and no others.
 *
 * `known` is the list on the sheet and `custom` is what the player invented,
 * whose text is already their own. A discipline's remaining maneuvers are not
 * touched: the name of the discipline is all that leaves with the character.
 */
function publishManeuvers(doc, report) {
  for (const discipline of doc.maneuvers?.disciplines || []) {
    const listed = [...(discipline.known || []), ...(discipline.custom || [])];
    if (!listed.length) continue;
    const shared = disciplineEntries(discipline.name);
    discipline.notes = discipline.notes || {};
    for (const name of listed) {
      const from = shared.find((e) => e.name === name) || null;
      const details = maneuverDetails(discipline, name, from);
      const written = {};
      for (const { key } of MANEUVER_FIELDS) {
        const value = String(details[key] ?? '').trim();
        if (value) written[key] = value;
      }
      if (Object.keys(written).length) {
        // `written` already holds the player's own cells over the pack's. A
        // note saved as a bare string (the description alone) is replaced
        // rather than spread, and one saved under another spelling is reused.
        discipline.notes[noteKeyOf(discipline, name) ?? name] = written;
        // Classification is not description. The bundled Path of War catalogue
        // fills in `type` and nothing else on purpose -- the rest is a
        // publisher's rules text -- so an entry can travel complete as far as
        // this file is concerned and still reach a reader as a name with a
        // badge beside it. Counting that as carried is how an author ends up
        // sending out a sheet they believe is readable.
        if (String(written.text ?? '').trim()) carry(report, 'maneuver');
        else report.outline.push(`maneuver: ${discipline.name} / ${name}`);
      } else if (from) {
        report.blank.push(`maneuver: ${discipline.name} / ${name}`);
      } else {
        report.unknown.push(`maneuver: ${discipline.name} / ${name}`);
      }
    }
  }
}

/**
 * Fill in every feat, spell and power the character lists, and no others.
 *
 * These keep the player's own writing (`detail`, `note`) apart from the
 * pack's text, and the sheet shows the pack's beside the player's rather than
 * instead of it (ui/html.js, `catalogueFace`). So the pack's words travel as
 * `cited` on the row -- never into the player's fields -- and the sheet reads
 * `cited` only where no pack answers for the name. The rows are the ones the
 * sheet displays: the feat groups, the granted feats, the prepared spells and
 * each manifesting class's powers.
 */
function publishCatalogueRows(doc, report) {
  const granted = doc.grantedFeats || {};
  const rows = [
    ...(doc.featGroups || []).flatMap((g) => (g?.entries || []).map((r) => ['feat', r, featDetails])),
    ...[granted.drawback, granted.specialty, ...(granted.others || [])].map((r) => ['feat', r, featDetails]),
    ...(doc.vancian?.prepared || []).map((r) => ['spell', r, spellDetails]),
    ...(doc.psionics?.classes || []).flatMap((c) => (c?.powers || []).map((r) => ['power', r, powerDetails])),
  ];
  for (const [kind, row, read] of rows) {
    if (!row || typeof row !== 'object' || !String(row.name ?? '').trim()) continue;
    const details = read(row);
    if (details.entry) {
      const cited = { text: details.text, source: details.source, fields: details.fields };
      if (cited.text.trim() || cited.fields.length || cited.source.trim()) row.cited = cited;
    }
    if (String(row.cited?.text ?? '').trim()) carry(report, kind);
    else if (row.cited) report.outline.push(`${kind}: ${row.name}`);
    else if (details.known) report.blank.push(`${kind}: ${row.name}`);
    else report.unknown.push(`${kind}: ${row.name}`);
  }
}

/**
 * The numbers a pack's tables supply: each Vancian class's casting-table row
 * and each manifesting class's power-point curve, as `cited` on the class.
 * Without them a reader with no casting packs saw no spell slots and no power
 * points. The model reads them only where no pack here answers.
 */
function publishTables(doc, report) {
  for (const c of doc.vancian?.classes || []) {
    const table = c && castingTable(c.slotType);
    if (!table) continue;
    c.cited = { ...(c.cited || {}), table: clone(table) };
    carry(report, 'casting table');
  }
  for (const c of doc.psionics?.classes || []) {
    const curve = c && psionicCurve(c.curveTotal);
    if (!curve) continue;
    c.cited = { ...(c.cited || {}), curve: clone(curve) };
    carry(report, 'power-point curve');
  }
}

/** Every deck manipulation taken, with the catalogue's entry beside it. */
function publishManipulations(doc, report) {
  for (const m of doc.cardcasting?.manipulations || []) {
    if (!m || !String(m.name ?? '').trim()) continue;
    const entry = deckManipulation(m.name);
    if (entry) {
      m.cited = clone(entry);
      if (entry.text.trim()) carry(report, 'manipulation');
      else report.blank.push(`manipulation: ${m.name}`);
    } else if (!m.cited) report.unknown.push(`manipulation: ${m.name}`);
  }
}

/**
 * The text of every ability a companion shows, by the ability's name. The
 * list is the companion table's, up to its level, which only the model works
 * out -- so it is read off a Character built from the document.
 */
function publishCompanionAbilities(doc, report) {
  let model;
  try { model = new Character(clone(doc)); } catch { return; }
  for (const kind of COMPANION_KINDS) {
    (doc[kind] || []).forEach((b, i) => {
      const gains = model.data[kind]?.[i]?.calc?.gains || [];
      const names = gains.flatMap((g) => g.abilities || [g.text]).filter(Boolean);
      for (const name of new Set(names)) {
        const key = abilityTextKey(name);
        if (String(b.abilityNotes?.[key] ?? '').trim()) continue;   // their own words travel already
        const shared = companionAbilityText(name);
        if (!shared) continue;
        b.citedAbilities = { ...(b.citedAbilities || {}), [key]: clone(shared) };
        carry(report, 'companion ability');
      }
    });
  }
}

/**
 * Drop what describes a session rather than the character.
 *
 * The card table is an encounter in progress: a deck order, a hand, a round.
 * A reader is shown the character, not the author's last fight.
 *
 * `cardcasting.manipulationsAvailable` is not in this list. It reads like a
 * catalogue slice, but it is the player's own count of manipulations (a
 * number or a formula, blank for the table's), and dropping it showed a
 * reader the table's number where the author's sheet showed theirs.
 */
function dropOffered(doc, report) {
  const offered = [['cardcasting', 'table']];
  for (const [block, field] of offered) {
    if (doc[block] && doc[block][field] !== undefined && doc[block][field] !== null) {
      doc[block][field] = null;
      report.dropped.push(`${block}.${field}`);
    }
  }
}

/**
 * A character document as it should leave this browser.
 *
 * Takes a normalized document -- `model.toJSON()` -- with the packs the player
 * uses registered, since that is what there is to read from. Returns a fresh
 * document and a report of what travelled, and never touches the one passed in.
 *
 * The report counts what a reader will actually be able to read, which is the
 * only count worth printing. An entry lands in one of three places:
 *
 *   carried   there is description on it now, the player's own or a pack's.
 *   outline   something travelled but no rules text did -- the bundled Path of
 *             War catalogue is deliberately like this, filling in `type` and
 *             nothing else, because the rest is a publisher's rules text and
 *             not this project's to ship. A reader gets a name and a badge.
 *   blank     a pack here knows the entry but had nothing at all to give.
 *   unknown   no pack here knows it.
 *
 * The last three are the half worth showing before anyone publishes. None is
 * an error -- a player may name a veil from a book nobody has packed -- but
 * each means a reader gets less than the author sees, and the author is the
 * one person who cannot notice that on their own screen, because their packs
 * fill in the gaps for them.
 */
export function publishDocument(doc) {
  const out = clone(doc);
  const report = { carried: 0, carriedBy: {}, outline: [], blank: [], unknown: [], dropped: [] };
  if (!out || typeof out !== 'object') return { doc: out, report };
  publishVeils(out, report);
  publishManeuvers(out, report);
  publishCatalogueRows(out, report);
  publishTables(out, report);
  publishManipulations(out, report);
  publishCompanionAbilities(out, report);
  dropOffered(out, report);
  return { doc: out, report };
}

/**
 * The report as one line, for a button that has to say what it did.
 *
 * The empty entries are named before the full ones are counted, because they
 * are the ones the author cannot see for themselves: on their screen a veil
 * with no text still looks like a veil.
 */
export function describePublish(report) {
  const n = report.carried;
  const parts = [n
    ? `carrying ${n} entr${n === 1 ? 'y' : 'ies'} of pack content`
    : 'carrying no pack content'];
  if (report.outline.length) {
    parts.push(`${report.outline.length} with no rules text behind the name`);
  }
  const short = report.blank.length + report.unknown.length;
  if (short) parts.push(`${short} with nothing at all`);
  return `${parts.join('; ')}.`;
}
