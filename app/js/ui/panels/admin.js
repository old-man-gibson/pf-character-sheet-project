/**
 * ui/panels/admin.js -- the two tabs for looking at the sheet rather than playing it.
 *
 * The Formulas tab is the player's: every name the character defines, what it
 * resolves to, and the guide to writing more. The Formula Audit is the GM's --
 * it lists what the sheet worked out and what it could not, and it only appears
 * for role="admin".
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc } from '../html.js';
import { targetLabels, tokenScope } from '../prose.js';
import { describeSource } from '../../model.js';
import { highlightFlagging, workingLine } from '../../formula-format.js';
import { formulaPanelHtml } from '../../formula-guide.js';

  /**
   * The Formulas tab: a scratchpad, an index of everything this character can
   * read, every formula already written on it, and the reference underneath.
   *
   * Built in formula-guide.js from plain data, so the whole thing is a pure
   * function of the character plus three pieces of view state -- which is what
   * lets the search box and the try-it box refresh their own sections in
   * place, without a re-render taking the caret with it.
   */
export function renderFormulaPanel(model, ctx) {
    const audit = model.audit();
    return formulaPanelHtml({
      names: model.scopeNames(),
      scope: model.scope(),
      inlineNames: model.inlineNames || {},
      audit,
      problems: model.formulaProblems(audit),
      forwarded: forwardedRows(model, model),
      targets: model.forwardTargetList || [],
      draft: ctx.formulaDraft,
      query: ctx.formulaQuery,
      refOpen: ctx.formulaRefOpen,
    });
  }

  /** Every forwarded bonus, as the tab lists them: destination, amount, source. */
export function forwardedRows(model) {
    return (model.contributions?.entries || []).map((e) => ({
      to: targetLabels(model, e.targets),
      value: e.value,
      expr: e.expr,
      type: e.type,
      where: describeSource(e.path),
      error: e.error,
      dropped: e.dropped,
    }));
  }

  /**
   * How much on this character needs attention, for the ƒx button.
   *
   * The same count the tab's own "Needs attention" panel shows, from the same
   * call -- one cycle is one problem in both places. Two numbers for the same
   * thing would just send a player looking for a fault that is not there.
   */
function brokenFormulas(model) {
    return model.formulaProblems().length;
  }

  /**
   * The way into the formula system from wherever you happen to be.
   *
   * It sits in the header rather than only on the tab bar because the moment
   * a player wants it is the moment they are part-way through typing
   * something on another tab -- and because a broken formula has to be
   * findable from anywhere, which is what the count is for.
   */
export function formulaButton(model, ctx) {
    const broken = brokenFormulas(model, model);
    return `<button data-action="formulas" aria-pressed="${ctx.tab === 'formulas'}"
      class="${broken ? 'danger' : ''}"
      title="${broken
    ? `Formulas — ${broken} on this character ${broken === 1 ? 'is' : 'are'} not working`
    : 'Formulas: what you can read, what you have written, and how to write more'}"
      >&fnof;x${broken ? ` (${broken})` : ''}</button>`;
  }


export function renderAuditPanel(model, ctx) {
    const rows = model.audit();
    const bad = rows.filter((r) => r.status === 'error').length;
    return `<div class="grid"><section class="panel span2">
      <h3>Formula audit
        <span class="badge ${bad ? 'err' : 'ok'}">${rows.length} formula(s), ${bad} problem(s)</span>
      </h3>
      <p class="hint" style="margin-bottom:10px">
        Every formula a player has entered on this character, exactly as written.
        Formulas are parsed, never executed as code, and can only read the values listed
        under “reads”. Nothing here can reach the page, the network, or other characters.
      </p>
      ${rows.length ? rows.map((r) => `
        <div class="audit-row ${r.status === 'error' ? 'error' : ''}">
          <div>
            <strong>${esc(r.name)}</strong>
            <span class="badge ${r.status === 'error' ? 'err' : 'ok'}">${r.status}</span>
            <span class="badge ${r.source === 'player' ? 'player' : ''}">${esc(r.source)}</span>
          </div>
          <div class="audit-formula" title="${esc(workingLine(r.formula, tokenScope(model, r.locals)))}"
            >${highlightFlagging(r.formula, r.unknownReferences)}</div>
          <div class="hint">
            reads: ${r.reads.length ? r.reads.map((v) => `<span class="tag">${esc(v)}</span>`).join('') : '<em>nothing</em>'}
            ${r.functions.length ? ` &middot; functions: ${r.functions.map((f) => `<span class="tag">${esc(f)}()</span>`).join('')}` : ''}
          </div>
          <div class="hint">evaluates to: <strong>${r.error ? '—' : esc(r.value)}</strong>
            ${r.error ? `<span style="color:var(--cs-bad)"> ${esc(r.error)}</span>` : ''}</div>
        </div>`).join('')
        : '<p class="empty">No player-authored formulas on this character.</p>'}
    </section></div>`;
  }
