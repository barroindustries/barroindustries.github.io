'use strict';
// scripts/downloads/pdf-text.js — a small, dependency-free text extractor for the PDFs that headless Chrome (Skia/PDF 1.4) writes:
// it reads the page tree, inflates each page's content stream, and turns the glyph ids of every font back into Unicode with that font's ToUnicode map.
// It exists so tests/content-assets.test.mjs (and the build script) can scan what a reader would actually see in a PDF without pdftotext or a PDF library.
// It is NOT a general PDF reader: it understands the structure Chrome writes (no object streams, Type0 / Identity-H fonts, text drawn with Tj / TJ).
const fs = require('fs');
const zlib = require('zlib');

function parseObjects(buf) {
  const s = buf.toString('latin1');
  const objs = new Map();
  const re = /(\d+) (\d+) obj\s*/g;
  let pos = 0;
  for (;;) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m) break;
    const start = m.index + m[0].length;
    const endobj = s.indexOf('endobj', start);
    if (endobj < 0) break;
    const st = s.indexOf('stream', start);
    if (st >= 0 && st < endobj) {
      const dict = s.slice(start, st);
      let ds = st + 6;
      if (s[ds] === '\r') ds++;
      if (s[ds] === '\n') ds++;
      const lm = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      const de = lm ? ds + Number(lm[1]) : s.indexOf('endstream', ds);
      objs.set(Number(m[1]), { dict, stream: buf.subarray(ds, de) });
      pos = s.indexOf('endobj', de) + 6;
    } else {
      objs.set(Number(m[1]), { dict: s.slice(start, endobj) });
      pos = endobj + 6;
    }
  }
  return objs;
}
function streamOf(o) {
  if (!o || !o.stream) return '';
  if (/\/FlateDecode/.test(o.dict)) return zlib.inflateSync(o.stream).toString('latin1');
  return o.stream.toString('latin1');
}
const refNum = (str) => { const m = /(\d+)\s+0\s+R/.exec(str || ''); return m ? Number(m[1]) : null; };

function pageList(objs) {
  const out = [];
  const walk = (n) => {
    const o = objs.get(n);
    if (!o) return;
    if (/\/Type\s*\/Pages\b/.test(o.dict)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict);
      if (kids) for (const m of kids[1].matchAll(/(\d+)\s+0\s+R/g)) walk(Number(m[1]));
    } else if (/\/Type\s*\/Page\b/.test(o.dict)) out.push(n);
  };
  for (const [n, o] of objs) if (/\/Type\s*\/Pages\b/.test(o.dict) && !/\/Parent\b/.test(o.dict)) walk(n);
  return out;
}

function parseToUnicode(text) {
  const map = new Map();
  const hexToStr = (h) => {
    let out = '';
    for (let i = 0; i + 4 <= h.length; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    return out;
  };
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(m[1], 16), hexToStr(m[2]));
  }
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      if (m[3][0] === '[') {
        const arr = [...m[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => hexToStr(x[1]));
        for (let c = lo; c <= hi; c++) map.set(c, arr[c - lo] || '');
      } else {
        const base = m[3].slice(1, -1);
        const first = parseInt(base, 16);
        const w = base.length;
        for (let c = lo; c <= hi; c++) map.set(c, hexToStr((first + (c - lo)).toString(16).padStart(w, '0')));
      }
    }
  }
  return map;
}

function* tokens(s) {
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0') { i++; continue; }
    if (c === '%') { while (i < n && s[i] !== '\n') i++; continue; }
    if (c === '/') { let j = i + 1; while (j < n && !/[\s\/<>\[\]()]/.test(s[j])) j++; yield { t: 'name', v: s.slice(i + 1, j) }; i = j; continue; }
    if (c === '<' && s[i + 1] === '<') { yield { t: 'op', v: '<<' }; i += 2; continue; }
    if (c === '>' && s[i + 1] === '>') { yield { t: 'op', v: '>>' }; i += 2; continue; }
    if (c === '<') { const j = s.indexOf('>', i); yield { t: 'hex', v: s.slice(i + 1, j).replace(/\s+/g, '') }; i = j + 1; continue; }
    if (c === '(') {
      let j = i + 1, depth = 1, str = '';
      while (j < n && depth) {
        const d = s[j];
        if (d === '\\') { str += s[j + 1]; j += 2; continue; }
        if (d === '(') depth++;
        if (d === ')') { depth--; if (!depth) break; }
        str += d; j++;
      }
      yield { t: 'str', v: str }; i = j + 1; continue;
    }
    if (c === '[') { yield { t: 'op', v: '[' }; i++; continue; }
    if (c === ']') { yield { t: 'op', v: ']' }; i++; continue; }
    let j = i;
    while (j < n && !/[\s\/<>\[\]()]/.test(s[j])) j++;
    const w = s.slice(i, j);
    i = j > i ? j : i + 1;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) yield { t: 'num', v: parseFloat(w) };
    else yield { t: 'op', v: w };
  }
}

function pageText(content, fonts) {
  const parts = [];
  let font = null;
  let stack = [];
  const showHex = (hex) => {
    if (!font) return;
    for (let i = 0; i + 4 <= hex.length; i += 4) {
      const code = parseInt(hex.slice(i, i + 4), 16);
      const u = font.get(code);
      parts.push(u === undefined ? '' : u);
    }
  };
  for (const tk of tokens(content)) {
    if (tk.t === 'op') {
      switch (tk.v) {
        case 'Tf': { const nm = stack.find((x) => x.t === 'name'); font = nm ? fonts.get(nm.v) || null : font; break; }
        case 'Tm': { const nums = stack.filter((x) => x.t === 'num').map((x) => x.v); if (nums.length >= 6) parts.push('\n'); break; }
        case 'Td': case 'TD': { const nums = stack.filter((x) => x.t === 'num').map((x) => x.v); if (nums.length >= 2 && Math.abs(nums[1]) > 0.01) parts.push('\n'); break; }
        case 'T*': case "'": case '"': parts.push('\n'); break;
        case 'BT': parts.push('\n'); break;
        case 'Tj': { const h = stack.find((x) => x.t === 'hex'); if (h) showHex(h.v); break; }
        case 'TJ': {
          for (const x of stack) {
            if (x.t === 'hex') showHex(x.v);
            else if (x.t === 'num' && x.v < -250) parts.push(' ');
          }
          break;
        }
        default: break;
      }
      if (tk.v !== '[' && tk.v !== ']') stack = [];
      continue;
    }
    stack.push(tk);
  }
  // the ligatures Chrome draws as single glyphs ("fi", "ff", "fl"...) read back as the letters a reader sees
  const unlig = (t) => t.replace(/\uFB00/g, 'ff').replace(/\uFB01/g, 'fi').replace(/\uFB02/g, 'fl').replace(/\uFB03/g, 'ffi').replace(/\uFB04/g, 'ffl').replace(/[\uFB05\uFB06]/g, 'st');
  return unlig(parts.join('')).replace(/\n{2,}/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

function pdfPages(file) {
  const buf = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
  const objs = parseObjects(buf);
  const pages = pageList(objs);
  const fontCache = new Map();
  const fontOf = (n) => {
    if (fontCache.has(n)) return fontCache.get(n);
    const o = objs.get(n);
    let map = new Map();
    const tu = o && /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(o.dict);
    if (tu) map = parseToUnicode(streamOf(objs.get(Number(tu[1]))));
    fontCache.set(n, map);
    return map;
  };
  return pages.map((pn) => {
    const po = objs.get(pn);
    const fonts = new Map();
    let res = po.dict;
    const rr = /\/Resources\s+(\d+)\s+0\s+R/.exec(po.dict);
    if (rr) res = objs.get(Number(rr[1])).dict;
    const fm = /\/Font\s*<<([\s\S]*?)>>/.exec(res);
    if (fm) for (const m of fm[1].matchAll(/\/([A-Za-z0-9_+-]+)\s+(\d+)\s+0\s+R/g)) fonts.set(m[1], fontOf(Number(m[2])));
    const cm = /\/Contents\s*(\[[^\]]*\]|\d+\s+0\s+R)/.exec(po.dict);
    const nums = cm ? [...cm[1].matchAll(/(\d+)\s+0\s+R/g)].map((x) => Number(x[1])) : [];
    const content = nums.map((n) => streamOf(objs.get(n))).join('\n');
    return pageText(content, fonts);
  });
}
const pdfText = (file) => pdfPages(file).join('\n\f\n');
// the number of pages and the size of each (the MediaBox, in points: A4 is 595 x 842)
function pdfInfo(file) {
  const buf = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
  const objs = parseObjects(buf);
  const boxes = pageList(objs).map((n) => {
    const m = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(objs.get(n).dict);
    return m ? [Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2])] : null;
  });
  return { pageCount: boxes.length, boxes, head: buf.subarray(0, 8).toString('latin1') };
}
// letters and digits only, lower case: "Brilliant Steel", "brilliant-steel" and a name broken over two lines all become "brilliantsteel"
const compact = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

module.exports = { pdfPages, pdfText, pdfInfo, compact, parseObjects, streamOf };
