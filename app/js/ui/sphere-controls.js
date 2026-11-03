/**
 * ui/sphere-controls.js -- the sphere tabs' controls that are not plain
 * fields: a tradition pool's two halves, a class pool's reach, and the
 * customized weapons (which one is drawn, and what each track may learn).
 *
 * Every one of them edits the model and asks for a redraw: `rerender(el)` for
 * a change that leaves the caret where it was, `render()` for one that moves
 * what the tab shows.
 *
 * `on` is { render(), rerender(el) }.
 *
 * SPHERE_ACTIONS are the tabs' buttons, by their `data-action`: each edits
 * the model from the pressed button's data, and the sheet redraws.
 */

export const SPHERE_ACTIONS = {
  'add-training-class': (model, b) => model.addTrainingClass(b?.dataset.side === 'magic' ? 'magic' : 'combat'),
  'add-guile-class': (model) => model.addGuileClass(),
  // The button only exists while there is something to fill, so the redraw
  // that follows is also what takes it away.
  'fill-talent-notes': (model, b) => model.fillTalentNotes(b?.dataset.side),
  // Named when the button sits on a sphere in the All spheres list.
  'add-guile-sphere': (model, b) => model.addGuileSphere(b?.dataset.sphere || ''),
  'add-system-pool': (model, b) => model.addSystemPool(b?.dataset.pool),
  // Land-attuned magic: a sphere is attuned or not, kept as a list of names.
  'attune-sphere': (model, b) => {
    const sphere = b?.dataset.sphere;
    if (!sphere) return;
    const list = new Set(model.data.cardcasting?.attunedSpheres || []);
    if (list.has(sphere)) list.delete(sphere);
    else list.add(sphere);
    model.set('cardcasting.attunedSpheres', [...list]);
  },
};

export function bindSphereControls(root, model, on) {
  // The two halves of a tradition pool always add up to its steps, so typing
  // into either one is really moving the boundary between them.
  root.querySelectorAll('[data-split]').forEach((input) => {
    input.addEventListener('change', () => {
      const [target, total, kind] = input.dataset.split.split('|');
      const n = Math.max(0, Math.min(Number(total), Math.floor(Number(input.value) || 0)));
      model.set(target, kind === 'sp' ? n : Number(total) - n);
      on.rerender(input);
    });
  });

  // A "counts as" tick: which kinds of talent a class's pool reaches. It may
  // add or drop the class's block on another side, and it moves the class
  // into or out of the blended group, so the whole tab is redrawn rather
  // than the one control.
  root.querySelectorAll('[data-reach]').forEach((box) => {
    box.addEventListener('change', () => {
      const [home, index, system] = box.dataset.reach.split('|');
      model.setPoolReach(home, Number(index), system, box.checked);
      on.render();
    });
  });

  // Drawing a weapon moves every sphere number on the tab, so the tab is
  // redrawn rather than the radio.
  root.querySelectorAll('[data-custactive]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const [block, set] = radio.dataset.custactive.split('|');
      model.setCustomizationActive(Number(block), Number(set));
      on.rerender(radio);
    });
  });
  // Widening or narrowing what a track may learn changes every sphere
  // dropdown under it, so the tab is redrawn.
  root.querySelectorAll('[data-custspheres]').forEach((select) => {
    select.addEventListener('change', () => {
      model.setCustomizationRule(Number(select.dataset.custspheres), 'spheres', select.value);
      on.rerender(select);
    });
  });
  // A counting rule opens and shuts rows under the panel it is typed in.
  root.querySelectorAll('[data-custrule]').forEach((input) => {
    input.addEventListener('change', () => {
      const [block, key, field] = input.dataset.custrule.split('|');
      model.setCustomizationRule(Number(block), key, field, input.value);
      on.rerender(input);
    });
  });
  root.querySelectorAll('[data-remove-customization]').forEach((button) => {
    button.addEventListener('click', () => {
      model.removeCustomization(Number(button.dataset.removeCustomization));
      on.render();
    });
  });
}
