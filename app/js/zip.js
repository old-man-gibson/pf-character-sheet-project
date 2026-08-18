/*
 * A minimal .zip writer — the mirror of the reader in `xlsx.js`, and no more.
 *
 * `xlsx.js` opens the ZIP a workbook arrives in; this closes one for Export all
 * to hand back. The same argument applies in both directions: an archive is a
 * few fixed-layout records around DEFLATE payloads, and DEFLATE is built into
 * the platform — `CompressionStream` here, `DecompressionStream` there. So the
 * page can write a real archive with no dependency and no build step, which is
 * what keeps this app a folder of static files.
 *
 * It matters because the five bundled characters are ~620 KB of JSON and 97 KB
 * of ZIP. A bundle format would have been less code, but every reader in the
 * world already opens a ZIP, and each entry inside is a plain document that
 * drops straight back into Import — no new shape for `inspectDocument` to
 * learn, no second path to keep working.
 *
 * Written the boring way on purpose: entries are compressed up front, so the
 * sizes and CRCs are known before a header is written and nothing needs a data
 * descriptor. Not supported, because a character export never reaches it:
 * ZIP64 (an archive would need 4 GB or 65,535 entries), encryption, and folder
 * entries. Names are written UTF-8 with the language-encoding flag set, since
 * `Dōkei Saburō.json` is a realistic filename here.
 */

/** Ordinary CRC-32, table built once on first use rather than shipped. */
let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Compress with the platform's own DEFLATE, in the raw form a ZIP stores. */
export async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The MS-DOS date and time a ZIP records, which is local time with two-second
 * resolution and no zone. Anything before 1980 cannot be represented, so a
 * clock set absurdly early is clamped rather than written as a negative year.
 */
function dosStamp(when) {
  const year = Math.max(1980, when.getFullYear());
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

/**
 * Build a ZIP from `[{ name, data }]`, where `data` is a string or bytes.
 *
 * An entry is stored uncompressed when DEFLATE fails to make it smaller. That
 * is not an optimisation but a correctness habit: deflate can inflate already
 * compressed bytes, and a portrait pasted into a document would otherwise come
 * out of the archive bigger than it went in.
 */
export async function zip(files, { modified = new Date() } = {}) {
  const encoder = new TextEncoder();
  const { time, date } = dosStamp(modified);

  const entries = [];
  for (const { name, data } of files) {
    const raw = typeof data === 'string' ? encoder.encode(data) : data;
    const packed = await deflateRaw(raw);
    const deflated = packed.length < raw.length;
    entries.push({
      name: encoder.encode(name),
      crc: crc32(raw),
      size: raw.length,
      body: deflated ? packed : raw,
      method: deflated ? 8 : 0,
    });
  }

  const total = entries.reduce(
    (n, e) => n + 30 + e.name.length + e.body.length + 46 + e.name.length, 22,
  );
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let at = 0;

  // Local headers and payloads, remembering where each began: the central
  // directory has to point back at them.
  for (const e of entries) {
    e.at = at;
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true);            // version needed to extract
    view.setUint16(at + 6, 0x0800, true);        // names are UTF-8
    view.setUint16(at + 8, e.method, true);
    view.setUint16(at + 10, time, true);
    view.setUint16(at + 12, date, true);
    view.setUint32(at + 14, e.crc, true);
    view.setUint32(at + 18, e.body.length, true);
    view.setUint32(at + 22, e.size, true);
    view.setUint16(at + 26, e.name.length, true);
    view.setUint16(at + 28, 0, true);            // no extra field
    out.set(e.name, at + 30);
    out.set(e.body, at + 30 + e.name.length);
    at += 30 + e.name.length + e.body.length;
  }

  const cdStart = at;
  for (const e of entries) {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true);            // version made by
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, 0x0800, true);
    view.setUint16(at + 10, e.method, true);
    view.setUint16(at + 12, time, true);
    view.setUint16(at + 14, date, true);
    view.setUint32(at + 16, e.crc, true);
    view.setUint32(at + 20, e.body.length, true);
    view.setUint32(at + 24, e.size, true);
    view.setUint16(at + 28, e.name.length, true);
    view.setUint16(at + 30, 0, true);            // extra
    view.setUint16(at + 32, 0, true);            // comment
    view.setUint16(at + 34, 0, true);            // disk it starts on
    view.setUint16(at + 36, 0, true);            // internal attributes
    view.setUint32(at + 38, 0, true);            // external attributes
    view.setUint32(at + 42, e.at, true);
    out.set(e.name, at + 46);
    at += 46 + e.name.length;
  }

  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 4, 0, true);               // this disk
  view.setUint16(at + 6, 0, true);               // disk with the directory
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - cdStart, true);
  view.setUint32(at + 16, cdStart, true);
  view.setUint16(at + 20, 0, true);              // no archive comment

  return out;
}

/**
 * A filename that survives every filesystem an archive might be opened on.
 *
 * Character names are arbitrary text — `Nicodemus "Nico" Vincent Marcone` is a
 * real one — so the characters Windows forbids go, and so do leading dots and
 * trailing spaces or dots, which it also refuses. Letters outside ASCII stay:
 * the entry is flagged UTF-8, and `Dōkei Saburō.json` is the name a player
 * expects to see.
 */
export function safeName(text, fallback = 'character') {
  const cleaned = String(text ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}
