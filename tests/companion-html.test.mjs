import assert from 'node:assert/strict';
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import { companionPanel } from '../app/js/ui/panels/subsystems.js';
import { renderMartialPanel } from '../app/js/ui/panels/combat.js';

for (const payload of ['Custom " form"><svg/onload=x(1)>', "Custom ' form<svg/onload=x(1)>"]) {
  const model = new Character(blankDocument({ name: 'Companion HTML test' }));
  model.set('conjured.0.baseForm', payload);
  const html = companionPanel(model, 'conjured');
  assert(!html.includes('<svg/onload=x'), 'Base form must not break out of a tooltip');
  assert(html.includes('&lt;svg/onload=x'), 'Unknown form remains readable as text');
  model.addCustomization('Custom class', { unit: payload, sets: { start: 1 }, talents: { start: 1 } });
  const martial = renderMartialPanel(model);
  assert(!martial.includes('<svg/onload=x'), 'Custom track labels must be escaped in text and attributes');
  assert(martial.includes('&lt;svg/onload=x'), 'Custom track label remains readable');
}
console.log('imported HTML: all checks passed');
