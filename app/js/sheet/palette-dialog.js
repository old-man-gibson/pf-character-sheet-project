/**
 * sheet/palette-dialog.js -- the search palette's dialog (Ctrl+K): opening and
 * shutting it, typing, the keys that move the selection, and the rows that
 * arrive as the list scrolls.
 *
 * What it searches and how rows look are ui/palette.js's. What choosing a row
 * does -- landing on a tab, running an action, copying a roll -- is the
 * sheet's, through the `host`:
 *
 *   root()           the sheet's shadow root, which the dialog lives in
 *   index()          a fresh index of the character, or null when none is open
 *   placeholder()    the search box's placeholder
 *   choose(entry, { roll })
 *                    the row taken; the dialog has already shut
 *
 * It lived in sheet-element.js. Its state was nine fields of that class;
 * here it is the dialog's own, and the sheet holds one of these.
 */

import * as palette from '../ui/palette.js';

/**
 * The palette's three numbers: how many rows a page of results is, what one
 * costs in pixels (for PageUp/PageDown, which have to guess), and how many
 * picks it remembers. The recent list is held for the session rather than
 * saved -- one browser holds many characters, and a palette that opens on
 * somebody else's last five choices would be worse than one that opens on the
 * character's own vitals.
 */
const PALETTE_PAGE = 40;
const PALETTE_ROW_PX = 46;
const PALETTE_RECENT = 8;

export class PaletteDialog {
  constructor(host) { this.host = host; }

  /**
   * The <dialog> is built once per opening and kept here rather than looked up,
   * because a render throws every node in the shadow root away and this one has
   * to survive it: the reference keeps it alive with its listeners, and the
   * sheet puts it back after each render (`reattach`). Everything else is what
   * the open palette is showing -- the index it searched, the rows it found,
   * and where the selection sits.
   */
  #dialog = null;
  #index = null;
  #rows = [];
  #at = 0;
  #shown = 0;
  #terms = [];
  #frame = 0;
  #returnTo = null;    // what had focus when it opened
  /** The last few things picked, newest first: an empty box opens on them. */
  recent = [];

  get isOpen() { return !!this.#dialog?.open; }

  /** After a render took the dialog's node away with everything else: put it back. */
  reattach() { if (this.#dialog) this.host.root().append(this.#dialog); }

  /**
   * Open the palette, or shut it if it is already up.
   *
   * The index is built here, on the way in: a couple of milliseconds on the
   * heaviest character in the roster, against the certainty that what it holds
   * is what the sheet holds right now. Keeping one in step with every edit
   * would cost more and could still be wrong.
   */
  open() {
    if (this.#dialog?.open) return;
    const index = this.host.index();
    if (!index) return;
    // The browser shut it without us hearing about it (Esc reaches the
    // dialog directly). Tidy the node away before putting up another.
    if (this.#dialog) this.close();
    const root = this.host.root();
    const dlg = root.ownerDocument.createElement('dialog');
    dlg.className = 'cmdk';
    dlg.innerHTML = palette.paletteHtml({ placeholder: this.host.placeholder() });
    this.#dialog = dlg;
    this.#index = index;
    this.#returnTo = root.activeElement;
    root.append(dlg);
    this.#bind(dlg);
    dlg.showModal();
    this.#search('');
    const input = dlg.querySelector('.cmdk-input');
    input?.focus();
    input?.select();
  }

  close() {
    const dlg = this.#dialog;
    if (!dlg) return;
    // Cleared first: closing the dialog fires `close`, which comes back here.
    this.#dialog = null;
    this.#index = null;
    this.#rows = [];
    this.#terms = [];
    cancelAnimationFrame(this.#frame);
    if (dlg.open) dlg.close();
    dlg.remove();
    const back = this.#returnTo;
    this.#returnTo = null;
    if (back?.isConnected) back.focus?.();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  /**
   * Everything the open palette listens to.
   *
   * All of it hangs off the dialog, which is thrown away when it closes, so
   * nothing here has to be taken down and nothing accumulates over a session's
   * worth of openings.
   */
  #bind(dlg) {
    const input = dlg.querySelector('.cmdk-input');
    const list = dlg.querySelector('.cmdk-list');

    // Typing redraws the list and nothing else -- not the panel behind it, not
    // even the input -- and does it once per frame however fast the typing is.
    input.addEventListener('input', () => {
      cancelAnimationFrame(this.#frame);
      this.#frame = requestAnimationFrame(() => this.#search(input.value));
    });

    input.addEventListener('keydown', (e) => {
      const page = Math.max(1, Math.floor(list.clientHeight / PALETTE_ROW_PX) - 1);
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); this.#move(1, true); break;
        case 'ArrowUp': e.preventDefault(); this.#move(-1, true); break;
        case 'PageDown': e.preventDefault(); this.#move(page, false); break;
        case 'PageUp': e.preventDefault(); this.#move(-page, false); break;
        case 'Home': e.preventDefault(); this.#move(-1e6, false); break;
        case 'End': e.preventDefault(); this.#move(1e6, false); break;
        case 'Enter':
          e.preventDefault();
          this.#choose(this.#at, { roll: e.ctrlKey || e.metaKey });
          break;
        default: break;
      }
    });

    list.addEventListener('click', (e) => {
      const row = e.target.closest?.('.cmdk-row');
      if (!row) return;
      this.#choose(Number(row.dataset.i), { roll: !!e.target.closest('.cmdk-roll') });
    });

    // Hover follows the mouse, but only once the mouse has actually moved:
    // arrowing a row under a resting cursor must not hand the selection back.
    let last = null;
    list.addEventListener('pointermove', (e) => {
      if (last && last[0] === e.clientX && last[1] === e.clientY) return;
      last = [e.clientX, e.clientY];
      const row = e.target.closest?.('.cmdk-row');
      if (row) this.#select(Number(row.dataset.i), { scroll: false });
    });

    // More rows arrive as you reach them; the first frame draws one screenful.
    list.addEventListener('scroll', () => {
      if (list.scrollTop + list.clientHeight > list.scrollHeight - PALETTE_ROW_PX * 4) {
        this.#grow();
      }
    });

    dlg.querySelector('[data-cmdk-close]')?.addEventListener('click', () => this.close());
    // A click on the backdrop lands on the dialog itself, never on its box.
    dlg.addEventListener('click', (e) => { if (e.target === dlg) this.close(); });
    // Esc is the browser's to handle, and it fires both of these on the way
    // out. Either one is enough; taking both means a browser that skips the
    // second still leaves the sheet in a state that knows the palette is gone.
    dlg.addEventListener('cancel', () => this.close());
    dlg.addEventListener('close', () => this.close());
  }

  /** Run the query and redraw the list under the box. */
  #search(query) {
    if (!this.#dialog) return;
    const found = palette.searchIndex(this.#index, query, { recent: this.recent });
    this.#rows = found.rows;
    this.#terms = found.terms;
    this.#at = 0;
    this.#shown = Math.min(found.rows.length, PALETTE_PAGE);
    const list = this.#dialog.querySelector('.cmdk-list');
    list.innerHTML = found.rows.length
      ? palette.resultsHtml(found.rows.slice(0, this.#shown), found.terms, { at: 0 })
      : palette.emptyHtml(found.query, found.scope);
    list.scrollTop = 0;
    this.#foot(found.total);
  }

  /** Draw the next page of a long result list. */
  #grow() {
    const rows = this.#rows;
    if (!this.#dialog || this.#shown >= rows.length) return;
    const from = this.#shown;
    const to = Math.min(rows.length, from + PALETTE_PAGE);
    this.#dialog.querySelector('.cmdk-list')
      .insertAdjacentHTML('beforeend', palette.resultsHtml(
        rows.slice(from, to), this.#terms, { at: this.#at, from },
      ));
    this.#shown = to;
    this.#foot();
  }

  /**
   * Move the selection.
   *
   * Rows are not redrawn to move it -- two class changes are -- which is what
   * keeps holding an arrow key down smooth on a list of hundreds.
   */
  #move(delta, wrap) {
    const n = this.#rows.length;
    if (!n) return;
    let next = this.#at + delta;
    if (wrap) next = (next + n) % n;
    this.#select(Math.max(0, Math.min(n - 1, next)));
  }

  #select(i, { scroll = true } = {}) {
    if (!this.#dialog || i === this.#at || !this.#rows[i]) return;
    while (i >= this.#shown && this.#shown < this.#rows.length) this.#grow();
    const list = this.#dialog.querySelector('.cmdk-list');
    list.querySelector(`.cmdk-row[data-i="${this.#at}"]`)?.setAttribute('aria-selected', 'false');
    const row = list.querySelector(`.cmdk-row[data-i="${i}"]`);
    row?.setAttribute('aria-selected', 'true');
    this.#at = i;
    if (scroll) row?.scrollIntoView({ block: 'nearest' });
    this.#foot();
  }

  /** The line along the bottom: what Enter would do, and how much matched. */
  #foot(total = null) {
    const dlg = this.#dialog;
    if (!dlg) return;
    if (total !== null) dlg.dataset.total = String(total);
    const count = Number(dlg.dataset.total) || 0;
    const entry = this.#rows[this.#at] || null;
    dlg.querySelector('[data-cmdk-count]').textContent = palette.countText(this.#shown, count);
    dlg.querySelector('[data-cmdk-primary]').textContent = entry?.action ? 'Run' : 'Jump';
    dlg.classList.toggle('has-roll', !!entry?.roll);
    dlg.querySelector('.cmdk-input')
      ?.setAttribute('aria-activedescendant', entry ? `cmdk-o-${this.#at}` : '');
  }

  /**
   * Take the row. The palette always closes first: a roll's toast and a
   * jump's landing are both behind the dialog, and showing neither of them is
   * not much of an answer to having chosen.
   */
  #choose(i, { roll = false } = {}) {
    const entry = this.#rows[i];
    if (!entry) return;
    this.recent = [entry.id, ...this.recent.filter((id) => id !== entry.id)].slice(0, PALETTE_RECENT);
    this.close();
    this.host.choose(entry, { roll });
  }
}
