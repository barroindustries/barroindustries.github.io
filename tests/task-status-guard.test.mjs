// tests/task-status-guard.test.mjs — a non-admin must never have a task's status silently rewritten.
//
//   · Bug: allowedStatuses for non-admins was TASK_STATUSES filtered to EMP_STATUSES, so a task in review / returned /
//     on-hold / done ... was not an <option>; the <select> fell back to Backlog and the Edit modal saved status 'backlog'
//     (and deleted completedAt).
//   · Fix: the current status is always an option, the Edit save only writes status/completedAt when the selection differs
//     from t.status, and non-admins get no Edit / Change-Status controls on done / approved / archived tasks.
//
// Source-level pins (tasks.js is a browser script). Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'js/screens/tasks.js'), 'utf8');

describe('task status guard (non-admin)', () => {
  it('both status dropdowns keep the current status as an option', () => {
    const lines = src.split('\n').filter(l => l.includes('const allowedStatuses'));
    assert.equal(lines.length, 2);
    for (const l of lines) assert.match(l, /EMP_STATUSES\.includes\(s\.value\)\|\|s\.value===t\.status/);
  });

  it('Edit save writes status/completedAt only when the selection changed', () => {
    const i = src.indexOf("save-edit-btn').addEventListener");
    assert.ok(i > 0);
    const body = src.slice(i, i + 3500);
    assert.doesNotMatch(body, /^\s*status:\$p\('et-status'\)\.value,/m, 'status must not be in the base update object');
    assert.match(body, /if \(selStatus!==t\.status\)\s*\{\s*update\.status=selStatus;/);
    assert.match(body, /selStatus!==t\.status[\s\S]*completedAt/);
  });

  it('non-admins lose Edit / Change Status on done, approved, archived', () => {
    assert.match(src, /const canEditFull = canEdit && \(isAdmin \|\| !\['done','approved','archived'\]\.includes\(t\.status\)\)/);
    assert.match(src, /\$\{canEditFull\?`<button class="btn-secondary btn-sm" id="edit-task-btn"/);
    assert.match(src, /\$\{canEditFull\?`<div[^>]*>\s*<div[^>]*>Change Status/);
  });
});
