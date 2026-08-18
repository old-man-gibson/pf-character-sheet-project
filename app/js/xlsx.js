/*
 * A minimal .xlsx reader — enough of OOXML to convert a character workbook,
 * and nothing more.
 *
 * The point of this file is that it has no dependencies. An .xlsx is a ZIP of
 * XML, and both halves are now built into the platform: `DecompressionStream`
 * does raw DEFLATE, and the XML we need is regular enough to scan directly. So
 * the browser can transcribe a workbook without a library, a build step, or an
 * upload — which is what lets a player convert their own sheet on a page served
 * from static hosting.
 *
 * It reads the same things `openpyxl.load_workbook(data_only=True)` gives the
 * Python converter, and only those:
 *
 *   - worksheet names, order and visibility
 *   - cell *values*, including the cached results of formulas (a Google-only
 *     ARRAYFORMULA has no recoverable formula, but its last computed value is
 *     right there in the file)
 *   - workbook-global defined names, which is how the template's ~476 named
 *     ranges are found
 *
 * Values come back raw — string, number, boolean, Date or null. Normalising
 * them is `convert.js`'s job, exactly as `clean()` is the Python Book's.
 *
 * Not supported, because the character workbooks never use it: ZIP64 (a
 * 4 GB spreadsheet is not a thing), encrypted workbooks, and the .xls binary
 * format that predates OOXML. Each fails with a message saying so.
 */

/* ---------------------------------------------------------------------- *
 * ZIP
 * ---------------------------------------------------------------------- */

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** Decompress a raw DEFLATE stream using the platform's own implementation. */
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Index a ZIP's central directory.
 *
 * Returns `read(name)`, which inflates one entry on demand. That laziness is
 * not premature: a workbook carries 300-odd entries, most of them images and
 * drawings this converter never looks at.
 *
 * Exported for `tests/zip.test.mjs`, which reads back what `zip.js` writes:
 * the writer and this reader are two halves of one format, so the honest test
 * of either is the other.
 */
export function openZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The end-of-central-directory record sits at the back, after a comment of
  // up to 64 KB, so it has to be found by scanning backwards for its signature.
  let eocd = -1;
  const floor = Math.max(0, bytes.length - 0xffff - 22);
  for (let i = bytes.length - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) {
    throw new Error(bytes.length >= 8 && view.getUint16(0, true) === 0xcfd0
      ? 'this is an old .xls workbook — re-export it as .xlsx'
      : 'not a .xlsx file (no ZIP directory found)');
  }

  const cdSize = view.getUint32(eocd + 12, true);
  const cdStart = view.getUint32(eocd + 16, true);
  if (cdStart === 0xffffffff || cdSize === 0xffffffff) {
    throw new Error('ZIP64 workbooks are not supported');
  }

  // Walk the directory by size rather than by the entry count, which saves
  // caring whether the count overflowed its 16 bits.
  const entries = new Map();
  const decoder = new TextDecoder();
  let p = cdStart;
  const cdEnd = cdStart + cdSize;
  while (p < cdEnd && view.getUint32(p, true) === SIG_CENTRAL) {
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localAt = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, compressed, localAt });
    p += 46 + nameLen + extraLen + commentLen;
  }

  async function read(name) {
    const e = entries.get(name);
    if (!e) return null;
    // The local header repeats the name and may carry different extra data, so
    // the payload offset has to be read from it rather than assumed.
    if (view.getUint32(e.localAt, true) !== SIG_LOCAL) {
      throw new Error(`corrupt ZIP entry: ${name}`);
    }
    const start = e.localAt + 30
      + view.getUint16(e.localAt + 26, true)
      + view.getUint16(e.localAt + 28, true);
    const raw = bytes.subarray(start, start + e.compressed);
    if (e.method === 0) return raw;
    if (e.method === 8) return inflateRaw(raw);
    throw new Error(`unsupported ZIP compression method ${e.method} for ${name}`);
  }

  async function text(name) {
    const data = await read(name);
    if (data === null) return null;
    // XML parsers normalise line endings before anything else sees them, so a
    // cell authored on Windows reads the same here as it does through Python's.
    // This runs on the raw text, which is why an escaped &#13; still survives.
    return new TextDecoder('utf-8').decode(data).replace(/\r\n?/g, '\n');
  }

  return { has: (n) => entries.has(n), names: () => [...entries.keys()], read, text };
}

/* ---------------------------------------------------------------------- *
 * XML
 * ---------------------------------------------------------------------- */

/**
 * Match one element's start tag.
 *
 * The attribute pattern steps over quoted values so that a `>` inside one — a
 * conditional number format like `[>100]#,##0` is the realistic case — does not
 * end the tag early.
 */
const startTag = (name) =>
  new RegExp(`<${name}(?=[\\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>`, 'g');

const ATTR = /([\w:.-]+)\s*=\s*"([^"]*)"/g;

function attrs(source) {
  const out = {};
  ATTR.lastIndex = 0;
  let m;
  while ((m = ATTR.exec(source))) out[m[1]] = decodeEntities(m[2]);
  return out;
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body] ?? whole;
  });
}

/** Iterate `<name ...>body</name>` elements, self-closing ones included. */
function* elements(xml, name) {
  const re = startTag(name);
  const close = `</${name}>`;
  let m;
  while ((m = re.exec(xml))) {
    // The attribute run is greedy, so a self-closing tag's slash lands at the
    // end of it. Anything quoted was consumed whole, so a trailing slash here
    // is always the tag's own.
    if (m[1].endsWith('/')) {
      yield { attrs: m[1], body: '' };
      continue;
    }
    const end = xml.indexOf(close, re.lastIndex);
    if (end < 0) return;
    yield { attrs: m[1], body: xml.slice(re.lastIndex, end) };
    re.lastIndex = end + close.length;
  }
}

/** The text of the first `<name>` element in `xml`, or null. */
function firstText(xml, name) {
  for (const el of elements(xml, name)) return decodeEntities(el.body);
  return null;
}

/* ---------------------------------------------------------------------- *
 * Number formats and dates
 * ---------------------------------------------------------------------- */

// Built-in formats that mean "this number is a date". Every other built-in id
// is numeric, and ids >= 164 are custom and carry their own format code.
const BUILTIN_DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/**
 * Whether a format code renders a date, by openpyxl's rule: look at the first
 * section only, drop bracketed conditions, escaped characters and quoted
 * literals, then see if any date/time placeholder survives.
 */
function isDateFormat(code) {
  if (!code) return false;
  const bare = code.split(';')[0]
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\.|"[^"]*"/g, '');
  return /[dmyhs]/i.test(bare);
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86400000;

/**
 * Convert an Excel serial number to a Date.
 *
 * Serials below 60 are shifted by a day to absorb the 1900-leap-year bug that
 * Excel keeps for compatibility with Lotus 1-2-3 and openpyxl reproduces.
 */
function fromExcelSerial(value) {
  let day = Math.floor(value);
  const ms = Math.round((value - day) * MS_PER_DAY);
  if (value > 0 && value < 60) day += 1;
  return new Date(EXCEL_EPOCH_UTC + day * MS_PER_DAY + ms);
}

/** Read styles.xml into a per-cell-format "is this a date" lookup. */
function readStyles(xml) {
  if (!xml) return [];
  const custom = new Map();
  for (const el of elements(xml, 'numFmt')) {
    const a = attrs(el.attrs);
    custom.set(Number(a.numFmtId), a.formatCode);
  }
  // Only cellXfs is indexed by a cell's `s` attribute; cellStyleXfs is a
  // separate list that would otherwise be picked up by the same tag name.
  const block = firstText(xml, 'cellXfs');
  if (block === null) return [];
  const out = [];
  for (const el of elements(block, 'xf')) {
    const id = Number(attrs(el.attrs).numFmtId ?? 0);
    out.push(BUILTIN_DATE_IDS.has(id) || isDateFormat(custom.get(id)));
  }
  return out;
}

/* ---------------------------------------------------------------------- *
 * Worksheets
 * ---------------------------------------------------------------------- */

/** "BC" -> 55. Column letters are the only base-26 in the format. */
export function columnIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
}

/** 55 -> "BC". */
export function columnLetter(index) {
  let out = '';
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const CELL_REF = /^([A-Z]+)(\d+)$/;

/**
 * One worksheet as a dense grid of raw values.
 *
 * The grid runs to the last row the file mentions, matching openpyxl's
 * `max_row` — including rows declared but left empty, which is what keeps the
 * label-anchored scans in the converter walking exactly as far as they do in
 * Python.
 */
function readSheet(xml, shared, dateFormats) {
  const rows = new Map();
  let maxRow = 0;
  let maxCol = 0;

  for (const row of elements(xml, 'row')) {
    const rowAttr = attrs(row.attrs);
    let r = Number(rowAttr.r || 0);
    if (r) maxRow = Math.max(maxRow, r);

    for (const cell of elements(row.body, 'c')) {
      const a = attrs(cell.attrs);
      const ref = CELL_REF.exec(a.r || '');
      // A cell may omit its reference, in which case it continues the run.
      let c;
      if (ref) {
        c = columnIndex(ref[1]);
        r = Number(ref[2]);
      } else {
        c = (rows.get(r)?.lastCol ?? 0) + 1;
      }
      maxRow = Math.max(maxRow, r);
      maxCol = Math.max(maxCol, c);

      const value = cellValue(a, cell.body, shared, dateFormats);
      let line = rows.get(r);
      if (!line) { line = { cells: new Map(), lastCol: 0 }; rows.set(r, line); }
      line.lastCol = c;
      if (value !== null) line.cells.set(c, value);
    }
  }

  // A merged range materialises every cell it covers, so one reaching past the
  // last written row still enlarges the sheet. The extra cells are empty — only
  // the extent changes, and it has to, or a label-anchored scan in the
  // converter stops short of where the Python one does.
  for (const el of elements(xml, 'mergeCell')) {
    const end = CELL_REF.exec((attrs(el.attrs).ref || '').split(':').pop());
    if (!end) continue;
    maxCol = Math.max(maxCol, columnIndex(end[1]));
    maxRow = Math.max(maxRow, Number(end[2]));
  }

  const grid = [];
  for (let r = 1; r <= maxRow; r++) {
    const line = rows.get(r);
    const out = new Array(maxCol).fill(null);
    if (line) for (const [c, v] of line.cells) out[c - 1] = v;
    grid.push(out);
  }
  return grid;
}

/**
 * A cell's value, as openpyxl reports it with `data_only=True`.
 *
 * `<f>` is deliberately ignored: what the converter wants is the cached result
 * sitting in `<v>` beside it.
 */
function cellValue(a, body, shared, dateFormats) {
  const type = a.t || 'n';

  if (type === 'inlineStr') {
    const is = firstText(body, 'is');
    return is === null ? null : runText(is);
  }

  const raw = firstText(body, 'v');
  if (raw === null || raw === '') return null;

  switch (type) {
    case 's': {
      const s = shared[Number(raw)];
      return s === undefined ? null : s;
    }
    case 'b':
      return raw !== '0';
    case 'str':   // a formula that returned text
    case 'e':     // #REF!, #NAME?, ... — the converter drops these downstream
      return raw;
    case 'd':
      return new Date(raw);
    default: {
      const n = Number(raw);
      if (!Number.isFinite(n)) return raw;
      return dateFormats[Number(a.s || 0)] ? fromExcelSerial(n) : n;
    }
  }
}

/** Concatenate the text runs of a shared string, ignoring phonetic guides. */
function runText(chunk) {
  const body = chunk.replace(/<rPh\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const t of elements(body, 't')) out += decodeEntities(t.body);
  return out;
}

function readSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  for (const si of elements(xml, 'si')) out.push(runText(si.body));
  return out;
}

/* ---------------------------------------------------------------------- *
 * Defined names
 * ---------------------------------------------------------------------- */

// 'Character Info'!$C$15  — the sheet name is quoted when it contains a space,
// and a literal apostrophe inside it is doubled.
const SHEET_RANGE = /(?:'((?:[^']|'')*)'|([A-Za-z_\\][\w.]*))!(\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)/g;

/**
 * Split a defined name's value into (sheet, range) pairs, as openpyxl's
 * `destinations` does. A name that points at a constant or a formula yields
 * nothing, which is the caller's cue to skip it.
 */
export function destinations(value) {
  const out = [];
  SHEET_RANGE.lastIndex = 0;
  let m;
  while ((m = SHEET_RANGE.exec(value))) {
    out.push([m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2], m[3]]);
  }
  return out;
}

/* ---------------------------------------------------------------------- *
 * Entry point
 * ---------------------------------------------------------------------- */

/**
 * Read a workbook.
 *
 * @param {Uint8Array|ArrayBuffer} input raw .xlsx bytes
 * @returns {Promise<{sheets: Array<{name: string, state: string, grid: any[][]}>,
 *                    definedNames: Array<{name: string, value: string}>}>}
 */
export async function readWorkbook(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const zip = openZip(bytes);

  const workbookXml = await zip.text('xl/workbook.xml');
  if (workbookXml === null) {
    throw new Error(zip.has('mimetype')
      ? 'this is an OpenDocument spreadsheet — re-export it as .xlsx'
      : 'not a spreadsheet: xl/workbook.xml is missing');
  }

  // r:id -> part name, so sheets are matched to files by relationship rather
  // than by assuming <sheet> order matches sheet1.xml, sheet2.xml, ...
  const rels = new Map();
  const relsXml = await zip.text('xl/_rels/workbook.xml.rels');
  if (relsXml) {
    for (const rel of elements(relsXml, 'Relationship')) {
      const a = attrs(rel.attrs);
      const target = a.Target.startsWith('/')
        ? a.Target.slice(1)
        : (a.Target.startsWith('xl/') ? a.Target : `xl/${a.Target}`);
      rels.set(a.Id, target.replace(/^xl\/\.\.\//, ''));
    }
  }

  const shared = readSharedStrings(await zip.text('xl/sharedStrings.xml'));
  const dateFormats = readStyles(await zip.text('xl/styles.xml'));

  const sheets = [];
  for (const el of elements(workbookXml, 'sheet')) {
    const a = attrs(el.attrs);
    const part = rels.get(a['r:id']);
    // Charts and dialog sheets are listed here too; only worksheets have cells.
    if (!part || !part.includes('worksheets/')) continue;
    const sheetXml = await zip.text(part);
    if (sheetXml === null) continue;
    sheets.push({
      name: a.name,
      state: a.state || 'visible',
      grid: readSheet(sheetXml, shared, dateFormats),
    });
  }

  if (!sheets.length) throw new Error('the workbook has no worksheets');

  // Sheet-local names (those with a localSheetId) are not part of
  // `Workbook.defined_names` in openpyxl, and the converter never asks for
  // them; reserved `_xlnm.*` names are print ranges, not character data.
  const definedNames = [];
  for (const el of elements(workbookXml, 'definedName')) {
    const a = attrs(el.attrs);
    if (a.localSheetId !== undefined) continue;
    if (!a.name || a.name.startsWith('_xlnm.')) continue;
    definedNames.push({ name: a.name, value: decodeEntities(el.body) });
  }

  return { sheets, definedNames };
}
