/**
 * The site's legal notice and its donation link, in one place for every page
 * that shows them: the app's Help dialog and header, and the published
 * viewer's footer.
 *
 * The first paragraph is the notice Paizo's Community Use Policy requires,
 * word for word with "This website" as the project name
 * (paizo.com/licenses/communityuse). The policy also requires contact
 * details where people can see them, and allows donations.
 */
import { esc } from './html-escape.js';

/** The donation page (Ko-fi or similar). While it is empty, every Donate link stays hidden. */
export const DONATE_URL = '';

/** Where people can reach the maintainer. */
export const CONTACT_URL = 'https://github.com/old-man-gibson/pf-character-sheet-project/issues';

const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;

/** The notice, as paragraphs. */
export function legalHtml() {
  return [
    'This website uses trademarks and/or copyrights owned by Paizo Inc., used under Paizo\'s'
      + ` Community Use Policy (${link('https://paizo.com/licenses/communityuse', 'paizo.com/licenses/communityuse')}).`
      + ' We are expressly prohibited from charging you to use or access this content. This website is'
      + ' not published, endorsed, or specifically approved by Paizo. For more information about Paizo'
      + ` Inc. and Paizo products, visit ${link('https://paizo.com', 'paizo.com')}.`,
    'Pathfinder is a registered trademark of Paizo Inc. Other product names are trademarks of their'
      + ' owners. This website is not affiliated with any game publisher.',
    'This website is provided as is, without warranty of any kind.',
    `Contact: ${link(CONTACT_URL, 'GitHub issues')}.`,
  ].map((p) => `<p>${p}</p>`).join('');
}

/** Point a Donate link at DONATE_URL and show it, or hide it while there is none. */
export function showDonate(anchor) {
  if (!anchor) return;
  anchor.hidden = !DONATE_URL;
  if (DONATE_URL) anchor.href = DONATE_URL;
}
