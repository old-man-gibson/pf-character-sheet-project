/**
 * diff.js -- what changed between two versions of a character, and where.
 *
 * A GM auditing a sheet is not asking "what is different". A structural walk
 * of two documents answers that question badly: `countChanges` in history.js
 * compares arrays by position, which is right for deciding when to take a
 * snapshot -- it only needs a magnitude -- and wrong here, because inserting
 * one skill row would report every row beneath it as changed.
 *
 * They are asking "is this legitimate", and that question wants the changes
 * sorted by where each number came from. So a document is projected into a
 * flat map of the things worth auditing, keyed by identity rather than by
 * position -- `skill:Stealth|.ranks`, never `skills[14]` -- and two such maps
 * are compared. Moving a row changes nothing. Renaming one is a removal and
 * an addition, which is what it is.
 *
 * Every entry says where its value came from:
 *
 *   authored   the player put it there: an ability score, a bought rank, a
 *              misc bonus, a named value, a tracker's formula.
 *   derived    the engine worked it out from other entries, which the entry
 *              names in `deps`.
 *
 * That second field is what makes this an audit rather than a delta. When a
 * derived stat moves, `compareRevisions` asks whether any input it declares
 * moved with it. A total that changed while every input stayed put is
 * reported `unexplained`, and that is exactly what an edited offset looks
 * like from the outside -- reconcile.js calls an offset "a number nobody can
 * account for", because a workbook's totals cannot be recomputed and the
 * difference is simply added back. It is the one change a GM most wants at
 * the top of the list rather than buried among consequences, and it can be
 * named structurally, without the model and without guessing.
 *
 * Both sides must be *normalized* documents -- `new Character(doc).toJSON()`,
 * or a live model's `toJSON()`. Stored revisions disagree about which keys
 * they carry (a converted workbook writes `feats` and `background`, the model
 * writes `featGroups` and `backgroundSections`), and comparing a raw document
 * against a normalized one reports the whole migration as the player's doing.
 *
 * Nothing here reads the model, the DOM or the network: two documents in,
 * plain data out, so a panel can render it and a test can check it without
 * either.
 */

import { ABILITIES, ABILITY_LABELS, DERIVED, skillLabel } from '../rules.js';
import { skillKey, slug } from './util.js';

/** Where a change shows up, in the order the sheet's tabs run. */
export const AUDIT_GROUPS = [
  'Overview', 'Stats', 'Combat', 'Skills', 'Progression', 'Gear', 'Trackers', 'Formulas',
];

/** What a GM does with each kind of change, which is how the view groups them. */
export const AUDIT_VERDICTS = ['unexplained', 'authored', 'structural', 'consequence'];

const clean = (v) => (v === undefined || v === '' ? null : v);

/**
 * One thing worth auditing.
 *
 * `deps` names other entries by key. It is only read for derived entries, and
 * a derived entry with no deps can never be explained -- which is the honest
 * answer when the engine will not say what fed it.
 */
function entry(map, key, group, label, value, { derived = false, deps = [] } = {}) {
  map.set(key, {
    key,
    group,
    label,
    value: clean(value),
    provenance: derived ? 'derived' : 'authored',
    deps,
  });
}

/** The summary key an ability modifier is published under. */
const modKey = (ability) => `ability.${ability}.mod`;

/**
 * A `DERIVED` dependency name, as a key in this summary.
 *
 * The table writes its deps in formula names (`dex.mod`, `attack.bab`), which
 * is what a player would type; everything else here is keyed by where the
 * document keeps it. Ability modifiers are the ones that collide, so they are
 * translated and the rest pass through as document paths, which they already
 * are.
 */
function depKey(dep) {
  const [head, tail] = String(dep).split('.');
  if (tail === 'mod' && ABILITIES.includes(head)) return modKey(head);
  return `doc.${dep}`;
}

/** `DERIVED` keeps initiative on the HP block; every other key is its own path. */
const derivedPath = (key) => (key === 'initiative' ? 'hp.initiative' : key);

/** How the inputs `DERIVED` names read to someone who did not write the table. */
const INPUT_LABELS = {
  'saves.fortitude.base': 'Fortitude base',
  'saves.reflex.base': 'Reflex base',
  'saves.will.base': 'Will base',
  'attack.bab': 'Base attack bonus',
  'equipment.armor': 'Armor worn',
};

/**
 * A row's key, kept distinct when two rows claim the same identity.
 *
 * Identity keying is the whole point of this file, and it has one failure that
 * matters: rows that are genuinely indistinguishable. A sheet carries four
 * blank Craft rows and four blank Lore rows waiting to be filled in, and every
 * one of them keys as `Craft|`. Left alone the last would overwrite the rest
 * and the audit would go quiet about fourteen of a character's skills, which
 * is the one thing an audit must never do.
 *
 * So the second row claiming a key takes `#2`, the third `#3`, and the reader
 * gets the same number after the label. Reordering two rows that were already
 * indistinguishable will now read as a change; that is the price, and it is
 * the right way round -- over-reporting on blank duplicates costs a glance,
 * under-reporting hides an edit.
 */
function rowId(seen, base) {
  const n = (seen.get(base) || 0) + 1;
  seen.set(base, n);
  return n === 1 ? { id: base, tag: '' } : { id: `${base}#${n}`, tag: ` (${n})` };
}

function readPath(doc, path) {
  let cur = doc;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

/* ---------------------------------------------------------------------- *
 * the projection
 * ---------------------------------------------------------------------- */

/** Who the character is, before any of it is worked out. */
function addIdentity(out, doc) {
  const id = doc.identity || {};
  const fields = [
    ['name', 'Name'], ['player', 'Player'], ['race', 'Race'], ['size', 'Size'],
    ['alignment', 'Alignment'], ['deity', 'Deity'], ['level', 'Character level'],
    ['mythicPath', 'Mythic path'], ['mythicTier', 'Mythic tier'],
  ];
  for (const [field, label] of fields) {
    entry(out, `identity.${field}`, 'Overview', label, id[field] ?? null);
  }
}

/** What the Stats tab adds up to a score, in the order that tab lists them. */
const BUILD_PARTS = [
  ['pointBuy', 'point buy'], ['array', 'array'], ['race', 'racial'], ['level4', 'level-up'],
  ['mythic', 'mythic'], ['inherent', 'inherent'], ['abp', 'ABP'], ['gear', 'gear'],
  ['attunement', 'attunement'], ['size', 'size'], ['untyped', 'untyped'],
  ['alchemical', 'alchemical'], ['circumstance', 'circumstance'], ['morale', 'morale'],
  ['tempEnhancement', 'temporary enhancement'], ['tempSize', 'temporary size'],
];

/**
 * The Stats-tab build, the scores it comes to, and the modifiers under those.
 *
 * A score is only sometimes a thing a player typed. abilities.js recomputes it
 * from the build where there is one -- `score = resolved.total + forwarded` --
 * and leaves it as a plain number where there is not, and the audit has to
 * agree with that or it accuses the wrong edit. So with a build the score is
 * derived from the parts, which are what the player actually moves; without
 * one it is authored, because then it really was typed in.
 *
 * The forwarded bonus is authored wherever it came from: some formula on some
 * other tab wrote `{dex.score += 2}`, and naming it here is what keeps a score
 * that moved because of one from reading as unexplained.
 */
function addAbilities(out, doc) {
  const build = doc.statsBuild || {};
  for (const key of ABILITIES) {
    const block = (doc.abilities || {})[key] || {};
    const label = ABILITY_LABELS[key] || key;
    const row = build[key];
    const parts = [];

    for (const [field, word] of BUILD_PARTS) {
      if (!row || row[field] === undefined) continue;
      const partKey = `build.${key}.${field}`;
      entry(out, partKey, 'Stats', `${label} ${word}`, row[field]);
      parts.push(partKey);
    }
    const forwarded = `ability.${key}.forwarded`;
    entry(out, forwarded, 'Stats', `${label} forwarded bonus`, block.forwarded?.permanent ?? null);
    parts.push(forwarded);

    const score = `ability.${key}.score`;
    const temp = `ability.${key}.temp`;
    const built = row ? { derived: true, deps: parts } : {};
    entry(out, score, 'Stats', `${label} score`, block.score ?? null, built);
    entry(out, temp, 'Stats', `${label} working score`, block.tempScore ?? null, built);
    entry(out, modKey(key), 'Stats', `${label} modifier`, block.totalMod ?? null, {
      derived: true,
      deps: [score, temp],
    });
  }
}

/**
 * The eleven stats `DERIVED` describes, and the inputs they declare.
 *
 * The inputs are summarized too, whether or not anything else names them: an
 * input that is never compared cannot explain the total that reads it, and a
 * total nothing can explain is reported as though a player had edited it.
 * That is why an input holding a subtree rather than a number
 * (`equipment.armor`) is stringified rather than skipped -- swapping armour
 * has to register as movement somewhere, or flat-footed AC follows it and
 * lands at the top of the GM's list every time anyone changes their kit.
 */
function addDerived(out, doc) {
  const inputs = new Set();
  for (const d of DERIVED) {
    const deps = (d.deps || []).map(depKey);
    deps.forEach((key) => inputs.add(key));
    entry(out, d.key, 'Combat', d.label, readPath(doc, derivedPath(d.key)) ?? null, {
      derived: true,
      deps,
    });
  }
  for (const key of inputs) {
    if (out.has(key) || !key.startsWith('doc.')) continue;
    const path = key.slice('doc.'.length);
    const value = readPath(doc, path);
    const scalar = value === null || value === undefined || typeof value !== 'object';
    entry(out, key, 'Combat', INPUT_LABELS[path] || path,
      scalar ? value ?? null : JSON.stringify(value));
  }
}

/**
 * Every skill row, as its three auditable numbers.
 *
 * Ranks and the misc bonus are what a player enters, and either may be a
 * formula: the string is compared rather than what it resolved to, so a
 * rewrite that lands on the same total still shows up. The bonus is the total
 * the sheet works out, and it names the three things that move it.
 */
function addSkills(out, doc) {
  const seen = new Map();
  for (const row of doc.skills || []) {
    const { id, tag } = rowId(seen, skillKey(row));
    const label = `${skillLabel(row.name, row.spec)}${tag}`;
    const ranks = `skill:${id}.ranks`;
    const misc = `skill:${id}.misc`;
    entry(out, ranks, 'Skills', `${label} ranks`, row.rankSources?.bought ?? null);
    entry(out, misc, 'Skills', `${label} misc bonus`, row.offset ?? null);
    const abilities = (row.abilities || []).map((a) => modKey(String(a).toLowerCase()));
    entry(out, `skill:${id}.bonus`, 'Skills', `${label} total`, row.bonus ?? null, {
      derived: true,
      deps: [ranks, misc, ...abilities],
    });
  }
}

/** Each class, its levels and the archetypes on it. */
function addClasses(out, doc) {
  const seen = new Map();
  for (const row of doc.classes || []) {
    const { id, tag } = rowId(seen, slug(row.name));
    const label = `${row.name || 'Class'}${tag}`;
    entry(out, `class:${id}.levels`, 'Progression', `${label} levels`, row.gestaltLevels ?? null);
    entry(out, `class:${id}.archetypes`, 'Progression', `${label} archetypes`, row.archetypes || null);
    entry(out, `class:${id}.hd`, 'Progression', `${label} hit die`, row.hd ?? null);
    entry(out, `class:${id}.ranks`, 'Progression', `${label} ranks per level`, row.skillRanks ?? null);
  }
}

/**
 * Feats, by the group they sit in and the name they were taken under.
 *
 * The value is the level it was taken at, so moving a feat up the ladder is a
 * change rather than a removal and an addition.
 */
function addFeats(out, doc) {
  const seen = new Map();
  for (const group of doc.featGroups || []) {
    const gid = slug(group.name);
    for (const feat of group.entries || []) {
      if (!feat || !feat.name) continue;
      const { id, tag } = rowId(seen, `${gid}:${slug(feat.name)}`);
      entry(out, `feat:${id}`, 'Progression',
        `${feat.name}${tag} (${group.name || 'feats'})`, feat.detail ?? null);
    }
  }
  const granted = doc.grantedFeats || {};
  for (const kind of ['drawback', 'specialty']) {
    const name = granted[kind]?.name;
    if (name) entry(out, `feat:granted:${kind}`, 'Progression', `Granted ${kind}`, name);
  }
  for (const other of granted.others || []) {
    if (other?.name) {
      entry(out, `feat:granted:${slug(other.name)}`, 'Progression', other.name, other.note || null);
    }
  }
}

/**
 * Weapons, worn armour, and whatever else is carried with a name on it.
 *
 * Armour is one row rather than a list -- a character wears at most a suit --
 * and it gets its own entries because `DERIVED` names it as what AC and
 * flat-footed AC are built from, so a GM reading either of those wants to see
 * the armour beside them rather than a stringified subtree.
 */
function addGear(out, doc) {
  const eq = doc.equipment || {};
  const seen = new Map();
  for (const w of eq.weapons || []) {
    if (!w || !w.name) continue;
    const { id, tag } = rowId(seen, slug(w.name));
    const label = `${w.name}${tag}`;
    entry(out, `weapon:${id}.attack`, 'Gear', `${label} attack`, w.sheetAttack ?? null);
    entry(out, `weapon:${id}.damage`, 'Gear', `${label} damage`, w.sheetTotalDamage ?? null);
    entry(out, `weapon:${id}.crit`, 'Gear', `${label} critical`,
      `${w.critRange ?? ''}/${w.critMult ?? ''}`);
  }
  const armor = eq.armor;
  if (armor && armor.name) {
    entry(out, 'armor.name', 'Gear', 'Armour worn', armor.name);
    entry(out, 'armor.acBonus', 'Gear', 'Armour AC bonus', armor.acBonus ?? null);
    entry(out, 'armor.maxDex', 'Gear', 'Armour max Dex', armor.maxDex ?? null);
    entry(out, 'armor.acp', 'Gear', 'Armour check penalty', armor.acp ?? null);
    entry(out, 'armor.active', 'Gear', 'Armour worn now', armor.active ?? null);
  }
  for (const kind of ['gear', 'other', 'shields']) {
    for (const row of eq[kind] || []) {
      if (!row || !row.name) continue;
      const { id, tag } = rowId(seen, `${kind}:${slug(row.name)}`);
      entry(out, `gear:${id}.weight`, 'Gear', `${row.name}${tag} weight`, row.weight ?? null);
      entry(out, `gear:${id}.cost`, 'Gear', `${row.name}${tag} cost`, row.cost ?? null);
    }
  }
}

/** Trackers a player added, which are formulas wearing a meter. */
function addTrackers(out, doc) {
  const seen = new Map();
  for (const t of doc.customTrackers || []) {
    const { id, tag } = rowId(seen, t.id || slug(t.name));
    const label = `${t.name || id}${tag}`;
    entry(out, `tracker:${id}.name`, 'Trackers', `Tracker ${label}`, t.name ?? null);
    entry(out, `tracker:${id}.max`, 'Trackers', `${label} maximum`, t.maxFormula ?? t.max ?? null);
    entry(out, `tracker:${id}.min`, 'Trackers', `${label} minimum`, t.minFormula ?? t.min ?? null);
    entry(out, `tracker:${id}.refresh`, 'Trackers', `${label} refresh`, t.refresh ?? null);
  }
}

/** Named values, which are the plainest authored thing on the sheet. */
function addNamed(out, doc) {
  for (const [name, value] of Object.entries(doc.named || {})) {
    if (value !== null && typeof value === 'object') continue;
    entry(out, `name:${name}`, 'Formulas', name, value);
  }
}

/**
 * A character as the flat map of everything worth auditing.
 *
 * The document must be normalized -- see the note at the top of this file.
 */
export function auditSummary(doc) {
  const out = new Map();
  if (!doc || typeof doc !== 'object') return out;
  addIdentity(out, doc);
  addAbilities(out, doc);
  addDerived(out, doc);
  addSkills(out, doc);
  addClasses(out, doc);
  addFeats(out, doc);
  addGear(out, doc);
  addTrackers(out, doc);
  addNamed(out, doc);
  return out;
}

/* ---------------------------------------------------------------------- *
 * the comparison
 * ---------------------------------------------------------------------- */

const same = (a, b) => Object.is(a, b);

/**
 * What a GM should do with one change.
 *
 * A derived stat that moved while none of its inputs did is `unexplained`,
 * and nothing outranks it. Everything a player typed is `authored`. Things
 * that arrived or left are `structural`. What is left is arithmetic following
 * its inputs, which is a `consequence` and folds away.
 */
function verdictFor(change, moved) {
  if (change.kind !== 'changed') return 'structural';
  if (change.provenance !== 'derived') return 'authored';
  return (change.deps || []).some((dep) => moved.has(dep)) ? 'consequence' : 'unexplained';
}

/**
 * Compare two normalized characters.
 *
 * Returns every change with its verdict, hardest question first: totals
 * nothing accounts for, then what the player wrote, then what came and went,
 * then the arithmetic that followed. `counts` is the same thing tallied, for
 * the line a toast can show without opening the view.
 */
export function compareRevisions(before, after) {
  const a = auditSummary(before);
  const b = auditSummary(after);
  const changes = [];
  const moved = new Set();

  for (const [key, was] of a) {
    const now = b.get(key);
    if (!now) {
      changes.push({ ...was, kind: 'removed', was: was.value, now: null });
      moved.add(key);
    } else if (!same(was.value, now.value)) {
      changes.push({ ...now, kind: 'changed', was: was.value, now: now.value });
      moved.add(key);
    }
  }
  for (const [key, now] of b) {
    if (a.has(key)) continue;
    changes.push({ ...now, kind: 'added', was: null, now: now.value });
    moved.add(key);
  }

  for (const change of changes) change.verdict = verdictFor(change, moved);

  const rank = (c) => AUDIT_VERDICTS.indexOf(c.verdict);
  const order = (c) => AUDIT_GROUPS.indexOf(c.group);
  changes.sort((x, y) => rank(x) - rank(y) || order(x) - order(y) || x.label.localeCompare(y.label));

  const counts = Object.fromEntries(AUDIT_VERDICTS.map((v) => [v, 0]));
  for (const c of changes) counts[c.verdict]++;
  counts.total = changes.length;

  return { changes, counts };
}

/**
 * The same changes, gathered under the group each belongs to.
 *
 * Only groups with something in them come back, in tab order, so a view can
 * render the result without knowing which groups exist.
 */
export function changesByGroup(changes) {
  const out = new Map();
  for (const group of AUDIT_GROUPS) {
    const rows = changes.filter((c) => c.group === group);
    if (rows.length) out.set(group, rows);
  }
  return out;
}
