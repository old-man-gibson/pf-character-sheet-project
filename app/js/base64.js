/*
 * base64.js -- bytes to base64 text and back.
 *
 * Shared by the app (account.js) and the Worker (functions/api/saves.js): a
 * server save travels as gzipped bytes in a JSON body.
 */

/** Bytes to base64, in pieces: one call with a megabyte of arguments overflows the stack. */
export function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** Base64 to bytes. Throws on text that is not base64. */
export function fromBase64(text) {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
