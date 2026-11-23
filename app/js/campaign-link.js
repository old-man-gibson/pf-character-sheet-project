/**
 * campaign-link.js -- campaign rules carried in a link to the app.
 *
 * The rules ride after the `#` of the app's own address, as the rules file's
 * campaign block (model/campaign.js, `campaignPreset`) in base64url:
 * `…/app/#rules=eyJnZXN0YWx0IjpmYWxzZX0`. Nothing is sent to a server; the
 * page reads the link when it opens (app/index.html), asks, and makes them
 * the rules every character shares (shared-rules.js).
 *
 * Only the rules a campaign changed are in the block, so a link stays short.
 * What comes out of a link goes through `campaignPreset` again: only keys the
 * rules know are kept, as with a rules file.
 */
import { fromBase64, toBase64 } from './base64.js';
import { campaignPreset } from './model/campaign.js';

/** The longest rules text a link may carry; anything longer is not read. */
const MAX_LENGTH = 20000;

/** A link to the app at `base` that carries the campaign block `rules`. */
export function campaignLink(rules, base = new URL('../', import.meta.url)) {
  const json = JSON.stringify(campaignPreset({ campaign: rules }).campaign);
  const url = new URL(base);
  url.search = '';
  url.hash = `rules=${toBase64(new TextEncoder().encode(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  return url.href;
}

/** The campaign block a link's hash carries, or null when it carries none. */
export function linkRules(hash) {
  const found = /^#?rules=([A-Za-z0-9_-]+)$/.exec(String(hash ?? ''));
  if (!found || found[1].length > MAX_LENGTH) return null;
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(fromBase64(found[1].replace(/-/g, '+').replace(/_/g, '/')));
    const block = JSON.parse(json);
    if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
    return campaignPreset({ campaign: block }).campaign;
  } catch {
    return null;
  }
}
