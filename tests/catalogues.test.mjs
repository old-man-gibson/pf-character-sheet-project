/** Tests the three catalogue tables — feats, spells and powers — from the
 *  document a scraper writes all the way to the cell that picks one.
 *
 *  They are one mechanism with three names, and the thing worth guarding is
 *  the *arrangement* rather than any one of them: a catalogue entry is read
 *  where it stands and never copied onto the character, which is what lets a
 *  corrected pack correct every sheet and keeps an exported character a list
 *  of names. A test that only checked the parsing would let that go quietly.
 *
 *  Four steps, in the order a wiki page travels them: `readStructured` reads
 *  the entry off a document, `mergeTables` puts it in a pack's table,
 *  `registerTables` hands it to the model, and the panel draws a picker.
 *  Needs no fixtures.
 *  Run: node tests/catalogues.test.mjs */
import { readStructured } from '../app/js/paste-import.js';
import {
  mergeTables, applyBlock, normalizeBlock, EXTENSION_FORMAT,
} from '../app/js/extensions.js';
import { blankDocument } from '../app/js/convert.js';
import {
  Character, setVeilCatalogue,
  setFeatCatalogue, featCatalogue, featEntry, featsAvailable, featTypes, featDetails,
  setSpellCatalogue, spellCatalogue, spellEntry, spellsAvailable, spellClasses, spellDetails,
  setPowerCatalogue, powerCatalogue, powerEntry, powersAvailable, powerDetails,
} from '../app/js/model.js';
import { vancianPanel, psionicsPanel } from '../app/js/ui/panels/subsystems.js';
import { catalogueFace } from '../app/js/ui/html.js';
import { itemText } from '../app/js/ui/rows.js';
import { text as fieldText } from '../app/js/ui/fields.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${label}`); } };

/* ---------------- the document a scraper writes ---------------- */

const DOC = `# Catalogue

#### Power Attack
* **Feat type:** Combat
* **Prerequisites:** Str 13, base attack bonus +1
* **Source:** Core Rulebook p. 131

You can choose to take a penalty on melee attack rolls.

#### Acid Geyser
* **Spell level:** Wizard 3, Alchemist 4
* **School:** Conjuration
* **Components:** V, S
* **Casting time:** 1 standard action
* **Range:** Medium
* **Duration:** Instantaneous
* **Saving throw:** Reflex half
* **Spell resistance:** Yes
* **Source:** Book of Acid p. 7

A geyser of acid erupts from the ground.

#### Ability as One
* **Power level:** Psion 8
* **Power points:** 15
* **Discipline:** Telepathy
* **Display:** Mental
* **Source:** Pawns and Powers p. 15

You and another share one ability score between you.

#### Absentia
* **Wild talent type:** Utility (Sp)
* **Element:** Void
* **Burn:** 0
* **Source:** Psychic Anthology p. 22

You are always under the effect of nondetection.
`;

console.log('reading a scraper document');
{
  const r = readStructured(DOC);
  check('one of each, and a wild talent beside the power', [
    r.feats.length, r.spells.length, r.powers.length, r.blocks.length,
  ], [1, 1, 2, 0]);
  check('nothing was left unplaced', r.leftovers.length, 0);

  check('the feat kept its type and its prerequisites',
    [r.feats[0].name, r.feats[0].type, r.feats[0].prerequisites],
    ['Power Attack', 'Combat', 'Str 13, base attack bonus +1']);

  // The pair is the point: a spell is on a list, at a level, and both halves
  // have to survive for a picker to narrow on them.
  check('the spell knows whose lists it is on, and at what level',
    r.spells[0].classes, [{ name: 'Wizard', level: 3 }, { name: 'Alchemist', level: 4 }]);
  check('and its own level is the lowest of them', r.spells[0].level, 3);
  check('with the stat block beside it',
    [r.spells[0].school, r.spells[0].components, r.spells[0].save, r.spells[0].sr],
    ['Conjuration', 'V, S', 'Reflex half', 'Yes']);

  const power = r.powers.find((p) => p.kind === 'power');
  const wild = r.powers.find((p) => p.kind === 'wild talent');
  check('a psionic power has a discipline and points',
    [power.name, power.discipline, power.points, power.level], ['Ability as One', 'Telepathy', '15', 8]);
  check('a wild talent has an element and burn instead',
    [wild.name, wild.element, wild.burn, wild.type], ['Absentia', 'Void', '0', 'Utility (Sp)']);
}

/* ---------------- into a pack, and out to the model ---------------- */

console.log('through a pack and into the catalogues');
{
  const r = readStructured(DOC);
  const packed = {
    format: EXTENSION_FORMAT,
    provides: {
      feats: { feats: r.feats }, spells: { spells: r.spells }, powers: { powers: r.powers },
    },
  };
  const merged = mergeTables([packed]);
  check('the tables merged', [
    merged.feats.feats.length, merged.spells.spells.length, merged.powers.powers.length,
  ], [1, 1, 2]);

  // A second pack correcting an entry replaces it rather than doubling it.
  const fix = {
    format: EXTENSION_FORMAT,
    provides: { feats: { feats: [{ name: 'power attack', type: 'Combat', text: 'corrected' }] } },
  };
  const twice = mergeTables([packed, fix]);
  check('a later pack corrects a feat rather than adding a second',
    [twice.feats.feats.length, twice.feats.feats[0].text], [1, 'corrected']);

  setFeatCatalogue(merged.feats);
  setSpellCatalogue(merged.spells);
  setPowerCatalogue(merged.powers);

  check('the catalogues hold what the pack carried', [
    featCatalogue().feats.length, spellCatalogue().spells.length, powerCatalogue().powers.length,
  ], [1, 1, 2]);
  ok('a name is found however it was capitalised', !!featEntry('POWER attack'));
  ok('and an unknown name is not', featEntry('Cleave') === null);
  check('the types and classes a picker groups by',
    [featTypes(), spellClasses()], [['Combat'], ['Alchemist', 'Wizard']]);
  ok('a spell is found by name', !!spellEntry('Acid Geyser'));
  ok('so is a power', !!powerEntry('Ability as One'));
}

/* ---------------- narrowing ---------------- */

console.log('what a picker offers');
{
  check('every feat, since a feat has no class list to narrow on',
    featsAvailable().map((f) => f.name), ['Power Attack']);
  check('narrowed by type', featsAvailable({ type: 'Combat' }).length, 1);
  check('and a type nobody has is empty', featsAvailable({ type: 'Metamagic' }).length, 0);

  check('a wizard is offered its 3rd-level spell',
    spellsAvailable({ classes: ['Wizard'], level: 3 }).map((s) => s.name), ['Acid Geyser']);
  check('but not at 4th, which is the alchemist\'s level for it',
    spellsAvailable({ classes: ['Wizard'], level: 4 }).length, 0);
  check('and a class with no list of its own is offered nothing',
    spellsAvailable({ classes: ['Cleric'] }).length, 0);

  /*
   * The rule that matters most, and the one a rewrite would break first:
   * narrowing on data nobody imported has to *widen* the answer. A catalogue
   * whose entries name no class at all knows no class for any of them, and a
   * picker that filtered on that would offer an empty list rather than
   * everything -- which reads, wrongly, as "this pack is broken".
   */
  setSpellCatalogue({ spells: [{ name: 'Unlisted Spell', text: 'x' }] });
  check('a spell on nobody\'s list is still offered to everyone',
    spellsAvailable({ classes: ['Wizard'], level: 3 }).map((s) => s.name), ['Unlisted Spell']);

  const merged = mergeTables([{
    format: EXTENSION_FORMAT,
    provides: { powers: { powers: readStructured(DOC).powers } },
  }]);
  setPowerCatalogue(merged.powers);
  check('powers and wild talents are told apart by kind',
    [powersAvailable({ kind: 'power' }).length, powersAvailable({ kind: 'wild talent' }).length], [1, 1]);
  check('a psion is offered its 8th-level power',
    powersAvailable({ classes: ['Psion'], level: 8 }).map((p) => p.name), ['Ability as One']);
}

/* ---------------- what the sheet keeps ---------------- */

console.log('the character keeps the name, not the book');
{
  setFeatCatalogue({
    feats: [{
      name: 'Power Attack', type: 'Combat', prerequisites: 'Str 13', text: 'Long rules text.', source: 'CRB p. 131',
    }],
  });
  const row = { name: 'Power Attack', detail: '', note: '' };
  const d = featDetails(row);
  check('the catalogue is read where it stands',
    [d.known, d.text, d.source, d.fields],
    [true, 'Long rules text.', 'CRB p. 131', [['Type', 'Combat'], ['Prerequisites', 'Str 13']]]);
  check('and nothing of it was copied onto the row', row, { name: 'Power Attack', detail: '', note: '' });
  check('the player\'s own writing is the only thing there is to save', d.own, { detail: '', note: '' });

  const unknown = featDetails({ name: 'A feat nobody published', note: 'mine' });
  check('a feat no pack carries is not known, and keeps what was written',
    [unknown.known, unknown.text, unknown.own.note], [false, '', 'mine']);
  check('a face is drawn for a known entry and not for an unknown one',
    [catalogueFace(d).includes('catface'), catalogueFace(unknown)], [true, '']);
}

/* ---------------- the pickers on the tabs ---------------- */

console.log('the pickers render');
{
  const r = readStructured(DOC);
  setSpellCatalogue(mergeTables([{ format: EXTENSION_FORMAT, provides: { spells: { spells: r.spells } } }]).spells);
  setPowerCatalogue(mergeTables([{ format: EXTENSION_FORMAT, provides: { powers: { powers: r.powers } } }]).powers);

  const doc = blankDocument();
  doc.vancian = {
    classes: [{ name: 'Wizard' }],
    prepared: [
      { prepUsed: '', classLevel: 'Wiz 3', name: 'Acid Geyser', uses: 1, used: 0, note: '' },
      { prepUsed: '', classLevel: 'Wiz 3', name: 'Acid Geyser', uses: 1, used: 0, note: 'my own note' },
    ],
    spells: [],
  };
  doc.psionics = {
    classes: [{
      name: 'Psion', stat: '', curveTotal: 0, powers: [{ name: 'Ability as One', level: '8', note: '' }],
    }],
    bonusPoints: 0,
  };
  const model = new Character(doc);
  const v = vancianPanel(model);
  const p = psionicsPanel(model, {});

  ok('the spell list carries its catalogue', v.includes('<datalist id="cat-spells"'));
  ok('and its name cells point at it', v.includes('list="cat-spells"'));

  /*
   * The box is declared empty and filled while somebody types into it.
   *
   * It used to carry every option, which at 8,912 feats was 91% of the Feats
   * tab's DOM and 61 ms of every render of that tab -- and the sheet
   * re-renders wholesale, so that was 61 ms on each edit. What the panel
   * emits now is the box and the two attributes saying which catalogue fills
   * it; `#fillDatalist` in the element does the rest, capped.
   */
  ok('but does not carry the options', !/<datalist id="cat-spells"[^>]*>\s*<option/.test(v));

  /*
   * Both kinds of cell can point at a catalogue.
   *
   * A feat is typed into three different shapes of cell on Feats & Mythic: a
   * list item (`data-item`) in a group, a plain field (`data-set`) in the
   * granted-feat rows, and a list item again for a mythic ability. Only the
   * first could take a `list` when the pickers were built, so the granted
   * rows and the mythic table offered nothing at all -- which is exactly what
   * they turned out to do.
   */
  ok('a list-item cell can point at a catalogue',
    itemText('feats', 0, 'name', '', '', { list: 'cat-feats' }).includes('list="cat-feats"'));
  ok('and so can a plain field',
    fieldText('grantedFeats.specialty.name', '', '', { list: 'cat-feats' }).includes('list="cat-feats"'));
  ok('neither grows one uninvited',
    !itemText('feats', 0, 'name', '').includes('list=') && !fieldText('a.b', '').includes('list='));
  ok('it says which catalogue fills it', v.includes('data-fill="spells"'));
  ok('and how to narrow it', v.includes('data-classes="Wizard"'));
  ok('the spell\'s school is shown from the catalogue', v.includes('Conjuration'));
  /*
   * Both rows, not one.
   *
   * The reference used to give way the moment a player wrote anything, which
   * had it backwards: a note is usually *about* the rule, so hiding the rule
   * took the reference away exactly when it had become useful. Their note and
   * the pack's text are both on the row now, the note above and editable.
   */
  check('the catalogue shows beside the note, not instead of it',
    (v.match(/catface/g) || []).length, 2);
  ok('and their own words are still there', v.includes('my own note'));

  /*
   * Three shapes, and which one a row gets depends only on what there is to
   * show: a caret and the pack's words, a caret alone once it is folded, and
   * -- for a row no pack knows -- the full-width box that was always there.
   * The fold is keyed on the entry's name, so it survives a row moving.
   */
  ok('an open row offers a caret to fold it', v.includes('data-collapse="catref:vancian.prepared|0"'));
  ok('and the caret says it is open', v.includes('aria-expanded="true"'));

  /*
   * A row at a time, and this is the case that says so.
   *
   * Both rows of this panel hold *Acid Geyser*. The fold was first keyed on
   * the entry's name, which made the two rows one as far as the caret was
   * concerned -- folding either folded both. A player who takes a feat twice
   * hits that immediately, so the key is the row's path.
   */
  const folded = new Character({
    ...doc,
    uiPrefs: { ...(doc.uiPrefs || {}), collapsed: { 'catref:vancian.prepared|0': true } },
  });
  const f = vancianPanel(folded);
  check('folding one row of a repeated entry leaves the other open',
    (f.match(/catface/g) || []).length, 1);
  ok('the folded row keeps its caret, so it can be opened again',
    f.includes('data-collapse="catref:vancian.prepared|0"'));
  ok('and says it is shut', f.includes('aria-expanded="false"'));
  ok('while the other still says it is open', f.includes('aria-expanded="true"'));
  ok('the player\'s own note is untouched by folding', f.includes('my own note'));

  // A row whose spell no pack carries gets no caret and no wrapper at all.
  const lone = new Character({
    ...doc,
    vancian: {
      ...doc.vancian,
      prepared: [{ prepUsed: '', classLevel: '', name: 'A spell I invented', uses: 1, used: 0, note: 'mine' }],
    },
  });
  const l = vancianPanel(lone);
  ok('an entry no pack knows keeps the full-width box', !l.includes('notecell') && !l.includes('catfold'));
  ok('and still shows what was written in it', l.includes('mine'));

  ok('a manifesting class carries its own list', p.includes('<datalist id="cat-powers-psion"'));
  ok('and points its cells at it', p.includes('list="cat-powers-psion"'));
  ok('the power\'s discipline is shown', p.includes('Telepathy'));

  // A sheet with no packs at all must render exactly as it always did.
  setSpellCatalogue({ spells: [] });
  setPowerCatalogue({ powers: [] });
  const bare = vancianPanel(model);
  ok('no pack, no datalist', !bare.includes('<datalist id="cat-spells"'));
  ok('no pack, no face', !bare.includes('catface'));
  ok('and the cell is the free-text box it has always been', bare.includes('data-item="vancian.prepared|0|name"'));
}

/* ---------------- what leaves in an export ---------------- */

/*
 * The guarantee, stated once and checked against the thing that actually
 * leaves the app.
 *
 * The engine ships no content, and a character exported out of it must not
 * become the place the content ends up instead. What a player typed is
 * theirs and goes with them -- that is no different from having copied the
 * paragraph out of the book by hand -- but a catalogue's own prose stays in
 * the pack, so that the file a player sends a friend is a list of names.
 *
 * `toJSON()` is what every route out shares: Export JSON, the autosave, a
 * history checkpoint, and `publishDocument`. Checking it here covers all of
 * them, and it is a *string* search rather than a walk of known fields on
 * purpose -- a new field that quietly copied the text would pass any check
 * that only looked where the text was expected to be.
 */
console.log('an exported sheet carries only what was typed into it');
{
  const PROSE = 'A geyser of acid erupts from the ground and everything nearby is dissolved.';
  const FEAT_PROSE = 'You can choose to take a penalty on melee attack rolls of enormous length.';
  const POWER_PROSE = 'You and another share one ability score between you, at length.';
  setFeatCatalogue({ feats: [{ name: 'Power Attack', type: 'Combat', text: FEAT_PROSE, source: 'CRB p. 131' }] });
  setSpellCatalogue({ spells: [{ name: 'Acid Geyser', classes: [{ name: 'Wizard', level: 3 }], text: PROSE }] });
  setPowerCatalogue({ powers: [{ name: 'Ability as One', kind: 'power', text: POWER_PROSE }] });

  const doc = blankDocument();
  doc.featGroups = [{ name: 'Level-up', entries: [{ name: 'Power Attack', detail: '1st', note: '' }] }];
  doc.vancian = {
    classes: [{ name: 'Wizard' }],
    prepared: [{ prepUsed: '', classLevel: 'Wiz 3', name: 'Acid Geyser', uses: 1, used: 0, note: '' }],
    spells: [],
  };
  doc.psionics = {
    classes: [{ name: 'Psion', stat: '', curveTotal: 0, powers: [{ name: 'Ability as One', level: '8', note: '' }] }],
    bonusPoints: 0,
  };
  const model = new Character(doc);
  const exported = JSON.stringify(model.toJSON());

  ok('a picked feat leaves no pack prose behind', !exported.includes(FEAT_PROSE));
  ok('nor a picked spell', !exported.includes(PROSE));
  ok('nor a picked power', !exported.includes(POWER_PROSE));
  ok('the pack\'s source line does not travel either', !exported.includes('CRB p. 131'));
  ok('but the names do, which is what makes the sheet readable', exported.includes('Acid Geyser'));
  ok('and so does what the player typed', exported.includes('Level-up'));

  // The other half of the bargain: what a player writes is theirs, and has to
  // survive the trip. A rule that dropped their words would be no better.
  model.set('featGroups.0.entries.0.note', 'Mine: remember the -1 per BAB step.');
  const written = JSON.stringify(model.toJSON());
  ok('a note the player wrote is exported', written.includes('Mine: remember the -1 per BAB step.'));
  ok('and still no pack prose beside it', !written.includes(FEAT_PROSE));
}

/* ---------------- a veil applied as a block ---------------- */

/*
 * Veils became a table before the other three did, but the *block* path
 * survives for a page somebody pastes, and it used to write the pack's
 * paragraph into `desc` -- the one cell `veilOwn` treats as the player's own.
 * That made the sheet claim they had written it, and put the text beyond the
 * reach of a pack correcting it.
 */
console.log('a veil applied from a block');
{
  const TEXT = 'Shaping this veil conjures blades of magic, at two and a half kilobytes.';
  const block = normalizeBlock({
    kind: 'veil', name: 'Sigil of Blades', slot: 'Wrists', text: TEXT,
  });

  setVeilCatalogue({ veils: [{ name: 'Sigil of Blades', slot: 'Wrists', text: TEXT }] });
  const known = new Character(blankDocument());
  applyBlock(known, block);
  check('the board keeps the name and an empty cell of the player\'s own',
    known.toJSON().akashic.slots[0].veils[0], { name: 'Sigil of Blades', desc: '', essence: 0 });
  ok('so the export carries none of the pack\'s text',
    !JSON.stringify(known.toJSON()).includes(TEXT));

  /*
   * And the other way: a veil no catalogue has is a page the player pasted
   * themselves, and its block is the only copy of the text there is. Text a
   * player copied is theirs, so dropping it would be the wrong kind of tidy.
   */
  setVeilCatalogue({ veils: [] });
  const alone = new Character(blankDocument());
  applyBlock(alone, block);
  ok('a veil nothing else can speak for keeps the text it came with',
    JSON.stringify(alone.toJSON()).includes(TEXT));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
