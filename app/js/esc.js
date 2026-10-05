/**
 * Escape text for HTML. In a module of its own, with nothing imported, so a
 * module that only needs this does not load the rules or the model with it.
 */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
