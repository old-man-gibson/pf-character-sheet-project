/** A wiki race's page written the way every pack writes a race: `tools/wiki-races.mjs`.
 *
 *  Traits as labelled paragraphs, Languages as a field, alternate racial
 *  traits and favored class options as entries of their own.
 *
 *  Run: node tests/wiki-races.test.mjs */
import { splitRacePage, startingLanguages, fcoClassesFrom } from '../tools/wiki-races.mjs';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else { fail++; console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
};

const fco = fcoClassesFrom('{{Format FCO|Bard|{{{bard|}}}|{{{bardsource|}}}}}\n{{Format FCO|Psychic Warrior|{{{psychicwarrior|}}}}}');
check('the classes {{FCO}} takes, from its source', [...fco], [['bard', 'Bard'], ['psychicwarrior', 'Psychic Warrior']]);

const page = {
  title: 'Ridgeling', kind: 'race',
  fields: { size1: 'Medium', sourcebook: 'Book of Ridges', sourcepage: '4' },
  body: [
    'Ridgelings live on ridges.',
    '',
    '=={{PAGENAME}} Racial Traits==',
    "* '''Size (0):''' Ridgelings are Medium.",
    "* '''Darkvision (2):''' Ridgelings see in the dark up to 60 feet.",
    "* '''Languages:''' Ridgelings begin play speaking Common and Ridge. Others may be learned.",
    '',
    '===Alternate Racial Traits===',
    'The following may replace standard traits.',
    "* '''Cliff Climber:''' Ridgelings gain a climb speed.",
    "''This replaces darkvision.''",
    "* '''Echo Sense:''' Ridgelings hear well. ''This replaces darkvision.''",
    '',
    '==Favored Class Options==',
    '{{FCO',
    '|bard = +1 round of bardic performance.',
    '|bardsource = Book of Ridges',
    '|psychicwarrior = +1/4 power point.',
    '|psychicwarrior2 = +1/6 of a new power.',
    '|druid = Not a class the template knows.',
    '}}',
  ].join('\n'),
};
const [race, ...rest] = splitRacePage(page, fco);
check('the race: its languages a field, its traits labelled paragraphs, a builder cost after the text',
  [race.fields.languages, race.body.includes("'''Darkvision:''' Ridgelings see in the dark up to 60 feet. (2 RP)"), race.body.includes('* '), race.body.includes('FCO')],
  ['Common, Ridge', true, false, false]);
check('alternate traits and favored class options are entries of their own, citing the race\'s book',
  rest.map((r) => [r.kind, r.title, r.fields]),
  [
    ['favored class option', 'Ridgeling - Bard', { race: 'Ridgeling', class: 'Bard', sourcebook: 'Book of Ridges', sourcepage: '4' }],
    ['favored class option', 'Ridgeling - Psychic Warrior', { race: 'Ridgeling', class: 'Psychic Warrior', sourcebook: 'Book of Ridges', sourcepage: '4' }],
    ['alternate racial trait', 'Ridgeling - Cliff Climber', { race: 'Ridgeling', sourcebook: 'Book of Ridges', sourcepage: '4' }],
    ['alternate racial trait', 'Ridgeling - Echo Sense', { race: 'Ridgeling', sourcebook: 'Book of Ridges', sourcepage: '4' }],
  ]);
check('a trait\'s next line is more of its text; two options for one class are one entry',
  [rest[2].body, rest[1].body], ["Ridgelings gain a climb speed.\n''This replaces darkvision.''", '+1/4 power point.\n\n+1/6 of a new power.']);
check('without the template\'s classes the options stay on the page', splitRacePage(page).length, 3);
check('any other page comes back as it is', splitRacePage({ kind: 'feat', title: 'X', body: 'y' }), [{ kind: 'feat', title: 'X', body: 'y' }]);
check('starting languages are names, or nothing', [
  startingLanguages('Corsath begin play knowing Common and Corsath. Others may choose from Goblin.'),
  startingLanguages('Common, Elven'),
  startingLanguages('Ridgelings speak whatever their parents spoke.'),
], ['Common, Corsath', 'Common, Elven', '']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
