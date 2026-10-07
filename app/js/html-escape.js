/**
 * Escape text for HTML. In a module of its own, with nothing imported, so a
 * module that only needs this does not load the rules or the model with it.
 *
 * Not `esc.js`: uBlock Origin's default "Badware risks" list blocks any
 * github.io path ending in `/js/esc.js`, the name of a tech-support scam's
 * script, and nearly every module imports this one -- so under that name the
 * published app loaded nothing for anyone running uBlock.
 */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
