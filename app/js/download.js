/**
 * download.js -- hand the browser a file to save.
 *
 * The one copy of the anchor trick every export uses. The link is put in the
 * page for the click, which Firefox wants, and its object URL is let go a
 * second later rather than straight after: some browsers start the download
 * after click() returns, and a URL revoked by then gives them nothing to fetch.
 */

/** Save `content` (a Blob, or text of the given type) as `filename`. */
export function downloadFile(filename, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
