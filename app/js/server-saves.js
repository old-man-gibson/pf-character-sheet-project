/*
 * server-saves.js -- keeps this browser's characters and the signed-in
 * account's server copies the same, for the picker page.
 *
 * What is sent is the version opening the character would show: the one last
 * saved, which is why a send follows each Save. Edits made after a Save stay
 * in this browser until the next one. On each page load, and when the page is
 * shown again after a minute away, every character here is read against the
 * server's list (account.js `syncPlan`): sent, loaded, or asked about when
 * both copies changed. A character the server has and this browser does not
 * is listed for the picker and loaded when it is pressed.
 *
 * The page owns the roster and the stored documents, so it hands in what this
 * needs (`host`) and gets back what its picker and its dialogs call.
 */

import { SCHEMA_VERSION } from './model.js';
import { historyFor } from './history.js';
import { esc } from './html-escape.js';
import {
  clearSync, deleteSave, listSaves, readSave, readSync, signInUrl, signOut, syncPlan, whoAmI, writeSave, writeSync,
} from './account.js';

const RECHECK_MS = 60 * 1000;

const NOT_MEMBER = 'This Discord account is not a member of the server. Characters are not saved to the server.';

/**
 * @param {object} host
 * @param {HTMLElement} host.root            the header element the sign-in button is drawn in
 * @param {HTMLElement} [host.help]          a help paragraph shown where sign-in is available
 * @param {Function} host.say                the page's banner: (kind, text, actions)
 * @param {Function} host.localEntries       the characters in this browser, as the library lists them
 * @param {Function} host.currentDocument    (entry) -> the version opening it would show
 * @param {Function} host.putDocument        (id, doc, options) -> store a document under an id; null if refused
 * @param {Function} host.redraw             draw the picker again
 */
export function mountServerSaves(host) {
  const { root, say } = host;
  let me = { available: false };
  /** The server's saves by id, as last listed. */
  let rows = new Map();
  /** Ids whose copy here is the server's. */
  const same = new Set();
  /** Characters waiting for the player to pick a copy. */
  let asks = [];
  let queue = Promise.resolve();
  let checked = 0;

  const active = () => Boolean(me.signedIn && me.member && me.saves);
  /** One job at a time, so a Save and a check never send the same character twice. */
  const run = (job) => { queue = queue.then(job).catch(() => {}); return queue; };
  const local = (id) => host.localEntries().find((c) => c.id === id) || null;
  const savedAtOf = async (id) => (await historyFor(id).readSaved())?.savedAt ?? null;
  const when = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? 'earlier' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  };
  const why = (err) => (err?.status ? String(err.message).replace(/\.$/, '') : 'the server could not be reached');

  /** The published link's id for a character, which rides with the save so another device can publish to it. */
  function publishedId(id) {
    try { return JSON.parse(localStorage.getItem(`published-link:${id}`) || 'null')?.id || ''; } catch { return ''; }
  }

  function adoptLink(id, published) {
    if (!published || publishedId(id)) return;
    try { localStorage.setItem(`published-link:${id}`, JSON.stringify({ id: published, token: '', rev: 0 })); } catch { /* publishing makes a new link */ }
  }

  const summaryFor = (entry, doc) => ({
    name: doc.identity?.name || entry.name || entry.id,
    level: Number(doc.identity?.level) || Number(entry.level) || 0,
    classes: (doc.classes || []).map((c) => c?.name).filter(Boolean),
    race: doc.identity?.race || '',
    color: doc.identity?.color || '',
    origin: entry.origin || 'import',
    schema: doc.schemaVersion || 0,
    published: publishedId(entry.id),
  });

  function ended() {
    me = { ...me, signedIn: false };
    rows = new Map();
    same.clear();
    asks = [];
    drawButton();
    host.redraw();
    say('info', 'Your sign-in has ended. Sign in again to save characters to the server.');
  }

  /** Send the version of a character that opening it would show. True when the server took it. */
  async function push(entry, { force = false } = {}) {
    const doc = await host.currentDocument(entry);
    if (!doc) return false;
    const savedAt = await savedAtOf(entry.id);
    const summary = summaryFor(entry, doc);
    let out;
    try {
      out = await writeSave(entry.id, doc, { base: readSync(entry.id, me.id)?.rev || 0, force, summary });
    } catch (err) {
      same.delete(entry.id);
      if (err.status === 401) ended();
      else say('err', `Could not save ${summary.name} to the server: ${why(err)}. It is sent again on the next Save.`);
      return false;
    }
    if (out.conflict) {
      same.delete(entry.id);
      rows.set(entry.id, out.conflict);
      asks = [...asks.filter((a) => a.id !== entry.id), { id: entry.id, name: summary.name, saved: out.conflict.saved }];
      return false;
    }
    writeSync(entry.id, { owner: me.id, rev: out.rev, savedAt });
    rows.set(entry.id, { id: entry.id, rev: out.rev, saved: out.saved, summary });
    same.add(entry.id);
    return true;
  }

  /** Load the server's copy of a character over the one here, or under an id that is not here. */
  async function pull(id, name, { label = null, open = false } = {}) {
    let row;
    try {
      row = await readSave(id);
    } catch (err) {
      if (err.status === 401) ended();
      else say('err', `Could not load ${name} from the server: ${why(err)}.`);
      return null;
    }
    if (row.doc?.schemaVersion !== SCHEMA_VERSION) {
      say('err', `${name} on the server was saved by a different version of the app and cannot be loaded here.`);
      return null;
    }
    const put = await host.putDocument(id, row.doc, { label, keepEdits: true, origin: local(id)?.origin || row.summary?.origin || 'import', open });
    if (!put) return null;
    writeSync(id, { owner: me.id, rev: row.rev, savedAt: put.savedAt });
    rows.set(id, { id, rev: row.rev, saved: row.saved, summary: row.summary });
    same.add(id);
    adoptLink(id, row.summary?.published);
    return put;
  }

  /** Put the next waiting question to the player. */
  function ask() {
    const next = asks[0];
    if (!next) return;
    const settle = (job) => () => run(async () => {
      asks = asks.filter((a) => a.id !== next.id);
      await job();
      host.redraw();
      ask();
    });
    say('info', `The server has a different copy of ${next.name}, saved ${when(next.saved)}.`, [
      {
        label: 'Load it',
        run: settle(async () => {
          const put = await pull(next.id, next.name, { label: 'before the server copy' });
          if (put) say('ok', `Loaded ${next.name} from the server.${put.kept ? ' The version that was here is in History as “before the server copy”.' : ''}`);
        }),
      },
      {
        label: 'Keep this one',
        run: settle(async () => {
          const entry = local(next.id);
          if (entry && await push(entry, { force: true })) say('ok', `Saved ${next.name} to the server.`);
        }),
      },
    ]);
  }

  /** Read every character here against the server's list, and act on each. */
  async function check() {
    if (!active()) return;
    checked = Date.now();
    let list;
    try {
      list = await listSaves();
    } catch (err) {
      if (err.status === 401) ended();
      return;
    }
    rows = new Map(list.map((s) => [s.id, s]));
    same.clear();
    asks = [];
    const loaded = [];
    for (const entry of [...host.localEntries()]) {
      if (!active()) return;
      if (!local(entry.id)) continue;       // removed while this ran
      const server = rows.get(entry.id) || null;
      const plan = syncPlan({ server, sync: readSync(entry.id, me.id), savedAt: await savedAtOf(entry.id) });
      if (plan === 'none') same.add(entry.id);
      else if (plan === 'push') await push(entry);
      else if (plan === 'pull') {
        const put = await pull(entry.id, entry.name);
        if (put) loaded.push({ name: put.summary.name, edits: put.edits });
      } else asks.push({ id: entry.id, name: entry.name, saved: server.saved });
    }
    host.redraw();
    if (asks.length) ask();
    else if (loaded.length) {
      say('ok', `Loaded a newer copy of ${loaded.map((l) => l.name).join(', ')} from the server.`
        + (loaded.some((l) => l.edits) ? ' Unsaved edits made here are in History.' : ''));
    }
  }

  /* ---- the sign-in button ---- */

  function drawButton() {
    root.hidden = !me.available;
    if (host.help) host.help.hidden = !me.available;
    root.classList.remove('open');
    if (!me.available) { root.innerHTML = ''; return; }
    if (!me.signedIn) {
      root.innerHTML = `<a class="btn" href="${esc(signInUrl())}"
        title="Sign in to save characters to the server and open them on other devices.">Sign in with Discord</a>`;
      return;
    }
    const note = !me.saves ? 'This copy of the app has no server saves.'
      : !me.member ? NOT_MEMBER
        : 'Characters are saved to the server when you press Save.';
    root.innerHTML = `<button type="button" class="btn" id="accountBtn" aria-haspopup="true" aria-expanded="false"
        aria-controls="accountDrop" title="${esc(note)}">${esc(me.name)} ▾</button>
      <div class="drop" id="accountDrop">
        <p class="hint">${esc(note)}</p>
        <button type="button" id="signOutBtn">Sign out</button>
      </div>`;
    const button = root.querySelector('#accountBtn');
    const setOpen = (open) => { root.classList.toggle('open', open); button.setAttribute('aria-expanded', String(open)); };
    button.addEventListener('click', () => setOpen(!root.classList.contains('open')));
    root.querySelector('#signOutBtn').addEventListener('click', async () => {
      setOpen(false);
      try {
        await signOut();
      } catch (err) {
        say('err', `Could not sign out: ${why(err)}.`);
        return;
      }
      me = await whoAmI({ again: true });
      rows = new Map();
      same.clear();
      asks = [];
      drawButton();
      host.redraw();
      say('ok', 'Signed out. Your characters are still in this browser.');
    });
  }
  const doc = root.ownerDocument;
  doc.addEventListener('click', (e) => { if (!e.target.closest?.(`#${root.id}`)) root.classList.remove('open'); });
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !root.classList.contains('open')) return;
    root.classList.remove('open');
    root.querySelector('#accountBtn')?.focus();
  });
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible' && active() && Date.now() - checked > RECHECK_MS) run(check);
  });

  /** What the sign-in page sent the browser back with, said once and taken off the address. */
  function sayOutcome() {
    const url = new URL(location.href);
    const outcome = url.searchParams.get('signin');
    if (!outcome) return;
    url.searchParams.delete('signin');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    if (outcome === 'ok' && me.signedIn) say('ok', `Signed in as ${me.name}.`);
    else if (outcome === 'not-member') say('info', NOT_MEMBER);
    else if (outcome === 'canceled') say('info', 'Sign-in was canceled.');
    else if (outcome === 'failed') say('err', 'Could not sign in with Discord.');
  }

  const ready = (async () => {
    me = await whoAmI();
    drawButton();
    sayOutcome();
    if (active()) await run(check);
  })();

  return {
    ready,
    /** Whether characters here are being saved to the server. */
    active,
    /** 'synced' for a character whose copy here is the server's, else null. */
    tag: (id) => (active() && same.has(id) ? 'synced' : null),
    /** The server's characters that are not in this browser, for the picker. */
    remote() {
      if (!active()) return [];
      const here = new Set(host.localEntries().map((c) => c.id));
      return [...rows.values()].filter((s) => !here.has(s.id)).map((s) => ({
        id: s.id, name: s.summary?.name || s.id, level: s.summary?.level || 0, color: s.summary?.color || null,
      }));
    },
    /** A character here was saved, added or replaced: send it. */
    saved(id) {
      if (!active()) return;
      same.delete(id);
      run(async () => {
        const entry = local(id);
        if (!entry) return;
        await push(entry);
        host.redraw();
        ask();
      });
    },
    /** A character here was published: send it again if its link is not with the save yet. */
    published(id) {
      if (active() && same.has(id) && rows.get(id)?.summary?.published !== publishedId(id)) this.saved(id);
    },
    /** Load a character the server has into this browser, and open it. */
    open(id) {
      const row = rows.get(id);
      if (!active() || !row) return;
      const name = row.summary?.name || id;
      run(async () => {
        const put = await pull(id, name, { label: 'before the server copy', open: true });
        if (put) say('ok', `Loaded ${name} from the server.`);
        host.redraw();
      });
    },
    /** Delete the server's copy of a character. */
    remove(id) {
      const row = rows.get(id);
      if (!active() || !row) return;
      const name = row.summary?.name || id;
      run(async () => {
        try {
          await deleteSave(id);
        } catch (err) {
          if (err.status === 401) ended();
          else say('err', `Could not delete ${name} from the server: ${why(err)}.`);
          return;
        }
        rows.delete(id);
        same.delete(id);
        clearSync(id);
        host.redraw();
        say('ok', `Deleted ${name} from the server.`);
      });
    },
    /** A character was erased from this browser: drop what was known of its server copy. */
    forget: (id) => clearSync(id),
  };
}
