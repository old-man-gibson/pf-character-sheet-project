/**
 * ui/panels/system-tabs.js -- what every sub-system tab shares.
 *
 * Which of the tabs a character has in use, for the tab bar, and the cells
 * from a source tab that no heading claimed, which the Akashic, Maneuvers,
 * Vancian, Psionics, Cardcasting, Item Crafting and Extras & Notes tabs keep
 * at the bottom.
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc } from '../html.js';
import { gridCell, rowTools } from '../rows.js';

  /**
   * The sub-system tabs with an "in use" state, keyed by tab id. The data
   * checks live on the model (`systemTabsInUse` -- the sphere tabs and
   * Crafting included); `tagged` says a class on the Overview marks the
   * system even though nothing is typed into its tab yet.
   */
export function modelledSystems(model) {
    const has = model.systemTabsInUse();
    const tagged = model.taggedSystemTabs();
    const out = {};
    for (const [id, h] of Object.entries(has)) out[id] = { id, has: h, tagged: tagged.has(id) };
    return out;
  }

  /**
   * Cells from a source tab that no label claimed. Kept and shown; a {…}
   * formula in one works as it does in any cell, and shows what it comes to,
   * but nothing on the tab reads the cells themselves.
   */
export function systemExtrasPanel(model, block, path, tabName) {
    const rows = block?.sourceExtras || [];
    if (!rows.length) return '';
    const list = `${path}.sourceExtras`;
    const width = Math.min(14, Math.max(...rows.map((r) => r.cells.length), 2));
    return `<section class="panel span2">
      <h3>From the source tab <span class="badge">${rows.length} rows</span></h3>
      <p class="hint">
        Cells from the workbook's ${esc(tabName)} tab that no heading claimed. They are kept as
        written. Nothing above reads them. A <code>{…}</code> formula in one of them works as in
        any other cell.
      </p>
      <div class="tablewrap" style="margin-top:8px"><table class="gridtab"><tbody>
        ${rows.map((r, ri) => `<tr>
          ${Array.from({ length: width }, (_, ci) => `<td>${gridCell(model, list, ri, `cells.${ci}`, r.cells[ci])}</td>`).join('')}
          ${rowTools(list, ri)}
        </tr>`).join('')}
      </tbody></table></div>
    </section>`;
  }
