/**
 * ui/progression-controls.js -- the Progression tab's controls: the class on
 * each level of a track, Fill column, aligned classes, and the class-feature
 * grid's column names, notes, menus and rule groups.
 *
 * Every one of them edits the model and asks for a redraw: `rerender(el)` for
 * a change that leaves the caret where it was, `render()` for one that moves
 * what the tab shows. The grid's column grips are bindColumnGrips
 * (ui/column-widths.js).
 *
 * `on` is { render(), rerender(el) }.
 *
 * PROGRESSION_ACTIONS are the tab's buttons, by their `data-action`: each
 * edits the model from the pressed button's data, and the sheet redraws.
 */

const num = (v) => Number(v);

export const PROGRESSION_ACTIONS = {
  'add-track': (model) => model.addProgressionTrack(),
  'remove-track': (model, b) => model.removeProgressionTrack(num(b?.dataset.track)),
  'remove-aligned': (model, b) => model.removeAligned(num(b?.dataset.index)),
  'add-aligned-gain': (model, b) => model.addAlignedGain(num(b?.dataset.index)),
  'remove-aligned-gain': (model, b) => model.removeAlignedGain(num(b?.dataset.index), num(b?.dataset.gain)),
  'add-cfnote': (model, b) => model.addClassFeatureNote(b?.dataset.class, { name: 'New feature' }),
  // One, or every one the panel is offering for this class.
  'add-cfnote-pack': (model, b) => {
    for (const s of b?.dataset.name !== undefined
      ? [{ name: b.dataset.name }] : model.classFeatureNoteSuggestions(b?.dataset.class)) {
      model.addClassFeatureNoteFromPack(b?.dataset.class, s.name);
    }
  },
  'remove-cfnote': (model, b) => model.removeClassFeatureNote(b?.dataset.class, num(b?.dataset.index)),
  'add-cf-column': (model, b) => {
    const cls = b?.dataset.class;
    const cols = model.data.progression.classFeatures?.[cls]?.columns || [];
    let n = 1;
    while (cols.includes(`Column ${n}`)) n += 1;
    model.addClassFeatureColumn(cls, cols.length ? `Column ${n}` : 'Features');
  },
  'remove-cf-column': (model, b) => model.removeClassFeatureColumn(b?.dataset.class, num(b?.dataset.col)),
  'remove-cf-group': (model, b) => model.removeClassFeatureGroup(b?.dataset.class),
  'add-rule-group': (model, b) => model.addClassFeatureRuleGroup(b?.dataset.class, num(b?.dataset.col)),
  'remove-rule-group': (model, b) => model.removeClassFeatureRuleGroup(b?.dataset.class,
    num(b?.dataset.col), num(b?.dataset.group)),
};

export function bindProgressionControls(root, model, on) {
  root.querySelectorAll('[data-prog]').forEach((select) => {
    select.addEventListener('change', () => {
      const [lvl, track] = select.dataset.prog.split('|');
      model.setProgressionClass(Number(lvl), Number(track), select.value || null);
      on.rerender(select);
    });
  });

  // Aligned classes: the block's classes, its gain rows, the class each gain
  // goes to, and starting a block on a class.
  root.querySelectorAll('[data-aligned]').forEach((select) => {
    select.addEventListener('change', () => {
      const { i, n } = JSON.parse(select.dataset.aligned);
      const names = [...(model.data.classes?.[i]?.aligned?.classes || [])];
      names[n] = select.value;
      const kept = names.map((x) => String(x ?? '').trim()).filter(Boolean);
      model.setAligned(i, { classes: kept.length ? kept : [''] });
      on.rerender(select);
    });
  });
  root.querySelectorAll('[data-alignedgain]').forEach((input) => {
    input.addEventListener('change', () => {
      const { i, g, k } = JSON.parse(input.dataset.alignedgain);
      model.setAlignedGain(i, g, { [k]: k === 'lowest' ? !!input.value : input.value });
      on.rerender(input);
    });
  });
  root.querySelectorAll('[data-alignedpick]').forEach((select) => {
    select.addEventListener('change', () => {
      const { i, kind, p, n } = JSON.parse(select.dataset.alignedpick);
      model.setAlignedPick(i, kind, p, n, select.value);
      on.rerender(select);
    });
  });
  root.querySelectorAll('[data-alignedadd]').forEach((select) => {
    select.addEventListener('change', () => {
      if (select.value === '') return;
      model.addAligned(Number(select.value));
      on.render();
    });
  });

  // "Fill column…": one class down every level of a track. The picker is an
  // action rather than a value, so it goes back to its prompt afterwards --
  // which the re-render does for it.
  root.querySelectorAll('[data-filltrack]').forEach((select) => {
    select.addEventListener('change', () => {
      if (!select.value) return;
      model.fillProgressionTrack(Number(select.dataset.filltrack), select.value);
      on.render();
    });
  });

  // The class-feature grid's column names.
  root.querySelectorAll('[data-cfcol]').forEach((input) => {
    input.addEventListener('change', () => {
      const sep = input.dataset.cfcol.lastIndexOf('|');
      const cls = input.dataset.cfcol.slice(0, sep);
      const idx = Number(input.dataset.cfcol.slice(sep + 1));
      model.renameClassFeatureColumn(cls, idx, input.value.trim());
      on.rerender(input);
    });
  });

  // A class's own feature text, under its ladder.
  root.querySelectorAll('[data-cfnote]').forEach((el) => {
    el.addEventListener('change', () => {
      const { c, i, k } = JSON.parse(el.dataset.cfnote);
      model.setClassFeatureNote(c, Number(i), { [k]: el.value });
      on.rerender(el);
    });
  });

  root.querySelectorAll('[data-cfmenu]').forEach((select) => {
    select.addEventListener('change', () => {
      const sep = select.dataset.cfmenu.lastIndexOf('|');
      const cls = select.dataset.cfmenu.slice(0, sep);
      const idx = Number(select.dataset.cfmenu.slice(sep + 1));
      model.setClassFeatureColumnOptions(cls, idx, select.value);
      on.render();
    });
  });

  // A column's rule groups: name, levels, colour and menu. Each re-renders,
  // because a rule decides which cells in the whole column are live.
  for (const [attr, field] of [['cfgname', 'name'], ['cfgrule', 'rule'], ['cfgcolor', 'color'], ['cfgmenu', 'optionsFrom']]) {
    root.querySelectorAll(`[data-${attr}]`).forEach((input) => {
      input.addEventListener('change', () => {
        const parts = input.dataset[attr].split('|');
        const gi = Number(parts.pop());
        const idx = Number(parts.pop());
        model.setClassFeatureRuleGroup(parts.join('|'), idx, gi, { [field]: input.value });
        on.rerender(input);
      });
    });
  }
}
