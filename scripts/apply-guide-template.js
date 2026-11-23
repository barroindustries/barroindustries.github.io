#!/usr/bin/env node
/**
 * apply-guide-template.js — keeps the shared template parts of every guide (guides/<slug>/index.html) in step with scripts/guides-hub.json,
 * the photo manifests (scripts/guide-photos-*.json) and the Quick answers (scripts/guide-answers.json).
 *
 *   node scripts/apply-guide-template.js            rewrite the template parts of every guide (reports each file it touched)
 *   node scripts/apply-guide-template.js --check    exit 1 and name what is stale (CHECK 9 of scripts/ci-invariants.sh runs this)
 *
 * IT CHANGES ONLY these regions, idempotently (a second run changes nothing):
 *   1. the kicker above the H1 (link and text)            ← the article's section in scripts/guides-hub.json (a topic with fewer than 3 articles is not shown, so no kicker points at it)
 *   2. the hero <figure> (picture, caption, credit)       ← the photo manifest, only for a slug that has an entry (spec §4.1–4.2)
 *   3. p.art-meta-note under the byline                   ← "Updated <date>" only when the article was modified after it was published, always the Editorial standards link
 *      JSON-LD "dateModified" and <meta property="article:modified_time">  ← "modified" in scripts/guides-hub.json
 *   4. div.art-answer (the Quick answer) and the has-answer class on div.art-wrap   ← scripts/guide-answers.json; an article with no entry gets no block
 *   5. #related: a picture on each card, the kg-related class, and the two links under the cards (Start with the pillar guide, More in <topic>)
 *   6. the copyright sentence p.art-copy
 * It never touches the article's text, FAQ, References, the head's title or description, or the PAGE-CSS block. (One exception, once: a guide that carries its own
 * "Quick answer" box in div.art-keys — the pillar — has that paragraph lifted into div.art-answer, so no guide shows two.)
 *
 * Run order after any change to a guide: node scripts/apply-guide-template.js && node scripts/build-guides-hub.js && node scripts/inline-page-css.js && node scripts/sitemap-lastmod.js
 * The spec is specs/KITCHEN-GUIDE-JOURNAL-SPEC.md (§4 the template, §8.3 this script).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const L = require('./guides-lib.js');

const { ROOT, esc, longDate } = L;
const RELEASE_COPY = '© 2026 Barro Industries OPC. All rights reserved. The text and designs on this page are our own work and may not be copied or reused without written permission. Photographs are credited where they appear.';
const WORDS = [40, 60];                                   // the Quick answer: 2-3 sentences, 40-60 words, plain text
const NOT_FIRST = /^(this guide|in this article|barro)/i;
const SIZES_RELATED = '(min-width:1024px) 370px, (min-width:720px) 46vw, 92vw';

class TemplateError extends L.GuidesError {}

// ── the six regions ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function mustReplace(html, re, to, what) {
  if (!re.test(html)) throw new TemplateError(`${what} not found`);
  return html.replace(re, () => to);
}

function kicker(html, sec) {
  return mustReplace(html, /<p class="eyebrow kg-kicker"><a href="[^"]*">[^<]*<\/a><\/p>/, `<p class="eyebrow kg-kicker"><a href="/guides/#${sec.id}">${esc(sec.title)}</a></p>`, 'the section kicker');
}

function hero(html, photo) {
  if (!photo) return html;                                  // no manifest entry: the page keeps its own picture and caption
  return mustReplace(html, /<figure class="pg-hero-media">[\s\S]*?<\/figure>/, L.heroFigure(photo), 'the hero figure');
}

function byline(html, art) {
  const link = `<a href="${L.STANDARDS_PATH}">How we research and cite</a>`;
  const note = art.modified > art.published
    ? `<p class="art-meta-note">Updated <time datetime="${art.modified}">${longDate(art.modified)}</time><span aria-hidden="true">·</span>${link}</p>`
    : `<p class="art-meta-note">${link}</p>`;
  let out = html.replace(/\n      <p class="art-meta-note">[\s\S]*?<\/p>/, '');
  if (!/<p class="art-meta">[\s\S]*?<\/p>/.test(out)) throw new TemplateError('the byline (p.art-meta) not found');
  out = out.replace(/<p class="art-meta">[\s\S]*?<\/p>/, (m0) => `${m0}\n      ${note}`);
  // JSON-LD dateModified and the article:modified_time meta take the new date; the published date never moves
  const ld = (out.match(/"dateModified": "[^"]*"/g) || []).length;
  if (ld !== 1) throw new TemplateError(`expected one "dateModified" in the JSON-LD, found ${ld}`);
  out = out.replace(/"dateModified": "[^"]*"/, `"dateModified": "${art.modified}T08:00:00+08:00"`);
  return mustReplace(out, /<meta property="article:modified_time" content="[^"]*">/, `<meta property="article:modified_time" content="${art.modified}">`, 'the article:modified_time meta');
}

function checkAnswer(slug, entry) {
  const a = entry && entry.answer;
  if (typeof a !== 'string' || !a.trim()) throw new TemplateError(`${slug}: guide-answers.json has an entry with no answer`);
  const n = L.wordCount(a);
  if (n < WORDS[0] || n > WORDS[1]) throw new TemplateError(`${slug}: the Quick answer is ${n} words (${WORDS[0]}-${WORDS[1]})`);
  if (/[<>&]/.test(a) || /\*\*|\[|\]|\n/.test(a)) throw new TemplateError(`${slug}: the Quick answer must be plain text (no links, lists, bold or citations)`);
  if (NOT_FIRST.test(a.trim())) throw new TemplateError(`${slug}: the Quick answer must not start with "This guide", "In this article" or the brand name`);
  if (/\bwe\b|\bour\b/i.test(a)) throw new TemplateError(`${slug}: the Quick answer says "we"/"our" (no sales line)`);
  return a.trim();
}

function answer(html, slug, entry) {
  const WRAP = /<div class="site-wrap art-wrap( has-answer)?">\n(    <div class="art-answer">[\s\S]*?<\/div>\n)?/;
  if (!WRAP.test(html)) throw new TemplateError('div.art-wrap not found');
  const had = (html.match(WRAP) || [])[2] || '';
  let block = had;
  let out = html;
  if (entry) {
    block = `    <div class="art-answer">\n      <p class="art-answer-title">Quick answer</p>\n      <p>${esc(checkAnswer(slug, entry))}</p>\n    </div>\n`;
    // a guide that has its own "Quick answer" box inside the article (the pillar) shows only the new block
    out = out.replace(/\n      <div class="art-keys">\s*<p class="art-keys-title">Quick answer<\/p>[\s\S]*?<\/div>(?=\n)/, '');
  } else if (!had) {
    // no entry: a guide with its own Quick answer box has it lifted to the standard place, once; any other guide gets no block
    const m = out.match(/\n      <div class="art-keys">\s*<p class="art-keys-title">Quick answer<\/p>\s*<p>([\s\S]*?)<\/p>\s*<\/div>(?=\n)/);
    if (m) {
      block = `    <div class="art-answer">\n      <p class="art-answer-title">Quick answer</p>\n      <p>${m[1].trim()}</p>\n    </div>\n`;
      out = out.replace(m[0], '');
    }
  }
  return out.replace(WRAP, () => `<div class="site-wrap art-wrap${block ? ' has-answer' : ''}">\n${block}`);
}

// the three related cards get a picture, but only when every one of them is a guide with a photograph
function related(html, reg, art, sec) {
  const m = html.match(/<section id="related"[\s\S]*?<\/section>/);
  if (!m) throw new TemplateError('section#related not found');
  let sect = m[0];
  const cards = [...sect.matchAll(/<article class="pg-card">\s*(?:<div class="pg-card-media">[\s\S]*?<\/div>\s*)?<div class="pg-card-body">([\s\S]*?)<\/div>\s*<\/article>/g)];
  if (cards.length !== 3) throw new TemplateError(`section#related has ${cards.length} cards (3 expected)`);
  const targets = cards.map((c) => (c[1].match(/<h3><a href="\/guides\/([a-z0-9-]+)\/">/) || [])[1]);
  const photos = targets.map((t) => (t && reg.bySlug[t] ? L.photoOf(t, reg.manifest) : null));
  const links = `<p class="kg-up">${art.slug !== reg.cfg.pillar && reg.cfg.pillarLinkSections.includes(art.section) ? `<a class="link-arrow" href="${L.PILLAR_LINK}">Start with: how to build a restaurant kitchen</a>` : ''}<a class="link-arrow" href="/guides/#${sec.id}">More in ${esc(sec.title)}</a></p>`;
  sect = sect.replace(/\n    <p class="kg-up">[\s\S]*?<\/p>/, '');
  if (photos.every(Boolean)) {
    let i = 0;
    sect = sect.replace(/<article class="pg-card">\s*(?:<div class="pg-card-media">[\s\S]*?<\/div>\s*)?<div class="pg-card-body">/g, () => {
      const p = photos[i++];
      L.checkPhotoFiles(p);
      const img = L.imgTag({ src: p.s600, srcset: [[p.s320, 320], [p.s600, 600]], sizes: SIZES_RELATED, alt: p.alt });
      return `<article class="pg-card">\n        <div class="pg-card-media">${img}</div>\n        <div class="pg-card-body">`;
    });
    sect = sect.replace(/<div class="pg-cards pg-cards-3[^"]*">/, '<div class="pg-cards pg-cards-3 kg-related">');
    sect = sect.replace(/(\n    <\/div>)(\n  <\/div>\n<\/section>)$/, `$1\n    ${links}$2`);
    if (!sect.includes('class="kg-up"')) throw new TemplateError('the related section does not end the way the template expects');
  } else {
    // text cards stay as they are; the links under them still go in
    sect = sect.replace(/(\n    <\/div>)(\n  <\/div>\n<\/section>)$/, `$1\n    ${links}$2`);
  }
  return html.replace(m[0], () => sect);
}

function copyNotice(html) {
  return mustReplace(html, /<p class="art-copy">[\s\S]*?<\/p>/, `<p class="art-copy">${RELEASE_COPY}</p>`, 'the copyright notice (p.art-copy)');
}

// ── one article ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function apply(html, reg, art, answers) {
  const sec = reg.secById[art.section];
  const photo = L.photoOf(art.slug, reg.manifest);
  let out = html;
  out = kicker(out, sec);
  out = hero(out, photo);
  out = byline(out, art);
  out = answer(out, art.slug, answers[art.slug]);
  out = related(out, reg, art, sec);
  out = copyNotice(out);
  return out;
}

function main() {
  const check = process.argv.includes('--check');
  let reg, answers;
  try { reg = L.loadRegistry(); answers = L.loadAnswers(); } catch (err) {
    if (!(err instanceof L.GuidesError)) throw err;
    console.error('FAIL: ' + err.message); process.exit(1);
  }
  const changed = [], problems = [], noAnswer = [];
  const writes = [];
  for (const art of reg.arts) {
    const file = path.join(ROOT, art.file);
    const html = fs.readFileSync(file, 'utf8');
    let next;
    try { next = apply(html, reg, art, answers); } catch (err) {
      if (!(err instanceof L.GuidesError)) throw err;
      problems.push(`${art.file}: ${err.message}`); continue;
    }
    if (!answers[art.slug] && !/class="art-answer"/.test(next)) noAnswer.push(art.slug);
    if (next !== html) { changed.push(art.file); writes.push([file, next]); }
  }
  for (const slug of Object.keys(answers)) if (!reg.bySlug[slug]) problems.push(`scripts/guide-answers.json: "${slug}" is not a published guide`);
  if (problems.length) { console.error(problems.map((p) => 'FAIL: ' + p).join('\n')); process.exit(1); }
  if (noAnswer.length) console.log(`note: ${noAnswer.length} guide(s) have no Quick answer yet (no entry in scripts/guide-answers.json): ${noAnswer.slice(0, 6).join(', ')}${noAnswer.length > 6 ? ', ...' : ''}`);
  if (check) {
    if (changed.length) {
      console.error(changed.map((f) => 'FAIL: ' + f + ': the template parts are stale').join('\n'));
      console.error('  FIX: node scripts/apply-guide-template.js   (it rewrites the kicker, hero credit, byline note, Quick answer, related cards and copyright sentence from scripts/guides-hub.json, the photo manifests and scripts/guide-answers.json)');
      process.exit(1);
    }
    console.log(`PASS: the template parts of the ${reg.arts.length} guides are current${noAnswer.length ? ` (${noAnswer.length} without a Quick answer)` : ''}`);
    return;
  }
  for (const [file, text] of writes) fs.writeFileSync(file, text);
  console.log(changed.length ? `touched ${changed.length} of ${reg.arts.length} guides` : `all ${reg.arts.length} guides are already up to date`);
  for (const f of changed.slice(0, 200)) console.log('  ' + f);
}

if (require.main === module) main();
module.exports = { apply, kicker, hero, byline, answer, related, copyNotice, checkAnswer, RELEASE_COPY };
