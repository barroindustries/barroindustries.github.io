'use strict';
// scripts/downloads/pdf-meta.js — copyright and document metadata for the PDFs that headless Chrome writes (owner approved, 2026-10-22).
//
// Chrome (Skia/PDF 1.4) writes the document information dictionary with the page title and its own user-agent string as the Creator, and no
// author, subject, keywords or XMP. stampPdf() adds them as a standard PDF INCREMENTAL UPDATE: it appends a new information dictionary, an XMP
// metadata stream and a new version of the catalogue that points at it, then a new cross-reference section whose trailer names /Prev. Not one byte
// of the original file changes, so the pages, fonts and images are exactly what Chrome wrote, and every reader (Preview, Acrobat, Chrome, the
// text extractors) takes the newest information. No dependency; it understands the structure Chrome writes (a classic xref table, no object streams).
//
//   Info dictionary : Title, Author, Subject, Keywords, Creator, Producer, CreationDate, ModDate, and a custom Copyright line
//   XMP packet      : dc:title / creator / description / rights / subject, pdf:Producer / Keywords, xmp:CreatorTool and dates,
//                     xmpRights:Marked / WebStatement / UsageTerms (what Acrobat's "Additional Metadata" and image search tools read)
// readMeta() reads back the NEWEST information (what a reader shows), for the build's own check and for the tests.
const fs = require('fs');
const { parseObjects, streamOf } = require('./pdf-text');

const hex16 = (s) => '<FEFF' + Buffer.from(String(s), 'utf16le').swap16().toString('hex').toUpperCase() + '>';   // a PDF text string: UTF-16BE with a byte-order mark
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pdfDate = (d) => `D:${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}+00'00'`;
const isoDate = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z');
const parsePdfDate = (t) => { const m = /^D:(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)/.exec(t || ''); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null; };

// the XMP packet (UTF-8). The structure follows the one scripts/watermark-images.py writes into the website's photographs.
function xmpPacket(m, created, modified) {
  return Buffer.from(`<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
    pdf:Producer="${xmlEsc(m.producer)}"
    pdf:Keywords="${xmlEsc(m.keywords)}"
    xmp:CreatorTool="${xmlEsc(m.creator)}"
    xmp:CreateDate="${isoDate(created)}"
    xmp:ModifyDate="${isoDate(modified)}"
    xmp:MetadataDate="${isoDate(modified)}"
    xmpRights:Marked="True"
    xmpRights:WebStatement="${xmlEsc(m.webStatement)}">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(m.title)}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>${xmlEsc(m.author)}</rdf:li></rdf:Seq></dc:creator>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(m.subject)}</rdf:li></rdf:Alt></dc:description>
   <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(m.rights)}</rdf:li></rdf:Alt></dc:rights>
   <dc:subject><rdf:Bag>${m.keywords.split(',').map((k) => `<rdf:li>${xmlEsc(k.trim())}</rdf:li>`).join('')}</rdf:Bag></dc:subject>
   <xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(m.usage)}</rdf:li></rdf:Alt></xmpRights:UsageTerms>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`, 'utf8');
}

// meta: { title, author, subject, keywords, creator, producer, rights, usage, webStatement }
function stampPdf(file, meta, now = new Date()) {
  const buf = fs.readFileSync(file);
  const s = buf.toString('latin1');
  const sx = s.lastIndexOf('startxref');
  if (sx < 0 || !/%%EOF\s*$/.test(s)) throw new Error(`${file}: not a PDF this tool understands (no startxref / %%EOF)`);
  const prev = parseInt(s.slice(sx + 9).trim().split(/\s+/)[0], 10);
  const tr = s.lastIndexOf('trailer', sx);
  const trailer = s.slice(tr, sx);
  const size = +(/\/Size\s+(\d+)/.exec(trailer) || [])[1];
  const root = +(/\/Root\s+(\d+)\s+0\s+R/.exec(trailer) || [])[1];
  if (!size || !root || !prev) throw new Error(`${file}: the trailer is not one this tool understands`);
  const objs = parseObjects(buf);
  const oldInfo = /\/Info\s+(\d+)\s+0\s+R/.exec(trailer);
  const created = (oldInfo && parsePdfDate((/\/CreationDate\s*\(([^)]*)\)/.exec((objs.get(+oldInfo[1]) || {}).dict || '') || [])[1])) || now;
  const metaNum = size, infoNum = size + 1;

  const xmp = xmpPacket(meta, created, now);
  const info = `<</Title ${hex16(meta.title)}\n/Author ${hex16(meta.author)}\n/Subject ${hex16(meta.subject)}\n/Keywords ${hex16(meta.keywords)}\n/Creator ${hex16(meta.creator)}\n/Producer ${hex16(meta.producer)}\n/Copyright ${hex16(meta.rights)}\n/CreationDate (${pdfDate(created)})\n/ModDate (${pdfDate(now)})>>`;
  const oldRoot = (objs.get(root) || {}).dict;
  if (!oldRoot || !/>>\s*$/.test(oldRoot)) throw new Error(`${file}: the catalogue is not one this tool understands`);
  const newRoot = oldRoot.trim().replace(/\/Metadata\s+\d+\s+0\s+R/g, '').replace(/>>\s*$/, `\n/Metadata ${metaNum} 0 R>>`);

  const parts = [];
  let off = buf.length;
  const push = (b) => { const x = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); parts.push(x); off += x.length; };
  const at = {};
  if (buf[buf.length - 1] !== 0x0a) push('\n');
  at[metaNum] = off; push(`${metaNum} 0 obj\n<</Type /Metadata /Subtype /XML /Length ${xmp.length}>>\nstream\n`); push(xmp); push('\nendstream\nendobj\n');
  at[infoNum] = off; push(`${infoNum} 0 obj\n${info}\nendobj\n`);
  at[root] = off; push(`${root} 0 obj\n${newRoot}\nendobj\n`);
  const xrefAt = off;
  const entry = (n) => `${String(at[n]).padStart(10, '0')} 00000 n \n`;
  const id = /\/ID\s*\[[^\]]*\]/.exec(trailer);
  push(`xref\n0 1\n0000000000 65535 f \n${root} 1\n${entry(root)}${metaNum} 2\n${entry(metaNum)}${entry(infoNum)}trailer\n<</Size ${size + 2}\n/Root ${root} 0 R\n/Info ${infoNum} 0 R\n/Prev ${prev}${id ? '\n' + id[0] : ''}>>\nstartxref\n${xrefAt}\n%%EOF\n`);
  fs.writeFileSync(file, Buffer.concat([buf, ...parts]));
}

// a PDF string value of a dictionary text: a literal (with its escapes) or a hex string (UTF-16BE with a BOM, else Latin-1)
function stringValue(dict, key) {
  const m = new RegExp(`/${key}\\s*([(<])`).exec(dict);
  if (!m) return null;
  let i = m.index + m[0].length;
  if (m[1] === '<') {
    const hex = dict.slice(i, dict.indexOf('>', i)).replace(/\s+/g, '');
    const b = Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex');
    return b.length >= 2 && b[0] === 0xfe && b[1] === 0xff ? Buffer.from(b.subarray(2)).swap16().toString('utf16le') : b.toString('latin1');
  }
  let depth = 1, out = '';
  while (i < dict.length && depth) {
    const c = dict[i];
    if (c === '\\') { const n = dict[i + 1]; out += n === 'n' ? '\n' : n === 'r' ? '\r' : n === 't' ? '\t' : n; i += 2; continue; }
    if (c === '(') depth++;
    if (c === ')') { depth--; if (!depth) break; }
    out += c; i++;
  }
  return out;
}

// the NEWEST document information: the last trailer's Info dictionary and Root's /Metadata stream
function readMeta(file) {
  const buf = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
  const s = buf.toString('latin1');
  const objs = parseObjects(buf);
  const trailer = s.slice(s.lastIndexOf('trailer'));
  const info = /\/Info\s+(\d+)\s+0\s+R/.exec(trailer);
  const root = /\/Root\s+(\d+)\s+0\s+R/.exec(trailer);
  const infoDict = info ? (objs.get(+info[1]) || {}).dict || '' : '';
  const out = {};
  for (const [k, key] of [['title', 'Title'], ['author', 'Author'], ['subject', 'Subject'], ['keywords', 'Keywords'], ['creator', 'Creator'], ['producer', 'Producer'], ['copyright', 'Copyright'], ['creationDate', 'CreationDate'], ['modDate', 'ModDate']]) out[k] = stringValue(infoDict, key);
  const rootDict = root ? (objs.get(+root[1]) || {}).dict || '' : '';
  const md = /\/Metadata\s+(\d+)\s+0\s+R/.exec(rootDict);
  out.xmp = md && objs.get(+md[1]) ? Buffer.from(streamOf(objs.get(+md[1])), 'latin1').toString('utf8') : null;
  out.startxrefOk = (() => { const sx = s.lastIndexOf('startxref'); const at = parseInt(s.slice(sx + 9).trim(), 10); return s.slice(at, at + 4) === 'xref'; })();
  return out;
}

module.exports = { stampPdf, readMeta, stringValue };
