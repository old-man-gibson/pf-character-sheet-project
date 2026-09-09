/**
 * The monster block: what a creature has that a character has not.
 *
 * A monster is an ordinary document -- scores, AC columns, weapon rows, a
 * class row for its hit dice -- with one section more, `monster`, holding the
 * lines of a stat block the sheet has no other home for: CR and XP, senses
 * and aura, the spell-like abilities, the ecology, the description. A
 * character carries no such section at all, which is how the sheet tells the
 * two apart; a GM can give a character one (`emptyMonster`) to put a CR on an
 * NPC.
 *
 * Reading the block off a page is `monster-import.js`'s job; this file is
 * only the shape, so the model never depends on the converter.
 */

/** Is this document a monster -- one carrying a block? */
export const isMonster = (model) => !!model?.data?.monster;

/** The build bar a monster opens on: the block first, then what a GM reaches for. */
export const MONSTER_TAB_ORDER = ['statblock', 'overview', 'skills', 'features', 'gear', 'trackers', 'lore'];

/** The monster block's fields, every one present and a string where it is prose. */
export function normalizeMonster(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  const str = (k) => String(m[k] ?? '');
  return {
    cr: str('cr'),
    xp: m.xp === null || m.xp === undefined || m.xp === '' || !Number.isFinite(Number(m.xp)) ? null : Number(m.xp),
    source: str('source'),
    type: str('type'),
    // A list, or the comma-separated text the block's own field holds it as
    // between an edit and the next load.
    subtypes: Array.isArray(m.subtypes) ? m.subtypes.map(String)
      : String(m.subtypes ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    hitDie: Number(m.hitDie) || 8,
    hpText: str('hpText'),
    healing: str('healing'),
    senses: str('senses'),
    aura: str('aura'),
    saveNote: str('saveNote'),
    acNote: str('acNote'),
    defensiveAbilities: str('defensiveAbilities'),
    space: str('space'),
    reach: str('reach'),
    specialAttacks: str('specialAttacks'),
    spellLike: str('spellLike'),
    spells: str('spells'),
    cmbNote: str('cmbNote'),
    cmdNote: str('cmdNote'),
    racialModifiers: str('racialModifiers'),
    languagesNote: str('languagesNote'),
    sq: str('sq'),
    gear: str('gear'),
    environment: str('environment'),
    organization: str('organization'),
    treasure: str('treasure'),
    tactics: str('tactics'),
    description: str('description'),
    classLine: str('classLine'),
    nonabilities: Array.isArray(m.nonabilities) ? m.nonabilities.map(String) : [],
    meleeText: str('meleeText'),
    rangedText: str('rangedText'),
    unread: (Array.isArray(m.unread) ? m.unread : [])
      .map((u) => ({ text: String(u?.text ?? u ?? '') })).filter((u) => u.text),
    abp: !!m.abp,
  };
}

/** A monster block for a character that never had one: an NPC being given a CR. */
export const emptyMonster = () => normalizeMonster({});

/**
 * The fields of the block that are prose -- read for {…} tokens, so a save
 * DC written as `{= 10 + con.mod + floor(level / 2)}` moves with the score.
 */
export const MONSTER_PROSE_FIELDS = [
  'senses', 'aura', 'healing', 'saveNote', 'defensiveAbilities', 'specialAttacks',
  'spellLike', 'spells', 'racialModifiers', 'sq', 'gear', 'tactics', 'description',
];
