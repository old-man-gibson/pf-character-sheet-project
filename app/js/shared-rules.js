/**
 * shared-rules.js -- the campaign rules every character in this browser
 * follows, kept beside the extension packs and switched on in the page's
 * Extensions and Rules dialog.
 *
 * One localStorage entry, `{ on, rules, updatedAt }`: `rules` is a campaign
 * block exactly as a character carries one (see model/campaign.js). While it
 * is on, every character follows it unless it is set to its own rules
 * (`campaignOwn` on the document); each character still keeps a copy in its
 * own `campaign`, which is what its numbers are worked out from and what a
 * published sheet shows.
 *
 * The sheet and the dialog both read and write here. `sharedRules` fires
 * `change` for a write on this page and for one in another window (the
 * storage event), so every open sheet can take the new rules at once.
 */
import { campaignPreset } from './model/campaign.js';

const KEY = 'character-sheet:campaign-rules';

/** Says `change` whenever the shared rules are written, here or in another window. */
export const sharedRules = new EventTarget();

/** The shared rules, `{ on, rules, updatedAt }`, or null when none were ever set. */
export function readShared() {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return null;
    return { on: raw.on === true, rules: campaignPreset({ campaign: raw.rules }).campaign, updatedAt: Number(raw.updatedAt) || 0 };
  } catch {
    return null;
  }
}

/** Write the shared rules (any part left out keeps what was there), and say so. */
export function writeShared({ on, rules } = {}) {
  const now = readShared() || { on: false, rules: {} };
  const next = {
    on: on === undefined ? now.on : !!on,
    rules: campaignPreset({ campaign: rules === undefined ? now.rules : rules }).campaign,
    updatedAt: Date.now(),
  };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    return null;
  }
  sharedRules.dispatchEvent(new Event('change'));
  return next;
}

// Another window's write arrives as a storage event; a write here does not.
globalThis.addEventListener?.('storage', (e) => {
  if (e.key === KEY) sharedRules.dispatchEvent(new Event('change'));
});
