# AGENTS.md

**Canonical instructions live in [CLAUDE.md](CLAUDE.md) — read that file first; every rule in it
applies here verbatim.** This file used to be a hand-synced near-copy and the two drifted
(2026-08-30 review); it is now a stub so there is exactly one source of truth. Do not add
repo guidance here — add it to CLAUDE.md.

**Current project state lives in [STATUS.md](STATUS.md)** — live version, active program, open
owner rulings, pending deploys/one-time actions, ranked backlog. Read it every session; update
it before ending a session that changes state.

## Non-negotiables (duplicated because each has destroyed real work here)

- **NEVER run `git stash`, `git reset --hard`, `git checkout -- <file>`, or `git clean`.**
  Multiple agents edit this working tree LIVE and concurrently; a stash on 2026-08-03 wiped
  ~300 uncommitted lines of another agent's work. To verify in isolation, copy files to a
  scratch dir; read clean baselines with `git show HEAD:<path>`.
- **Gates before every commit:**
  `node --test tests/*.test.mjs && bash scripts/ci-invariants.sh && node scripts/check-ui-wiring.js`
  (There IS a test suite — money/payroll. [js/money-core.js](js/money-core.js) is frozen/additive-only;
  a money fix without a mutation-tested test is not done.)
- **`git push` deploys the app but NOT Firebase.** Rules/storage/functions ship separately via
  `bash scripts/release.sh` — and rules land **BEFORE** the code that needs them, or writes fail
  silently in prod.
- **Never hand-edit versions, never commit `--no-verify`** — the pre-commit hook owns
  `APP_VERSION`, `CACHE_VER`, and `precache-manifest.json`, and re-stages
  index.html / js/config.js / sw.js (so `git diff --cached` before committing; stage explicitly,
  never `git add -A`).
- **Manila time only** via `bizDate()/bizHour()/bizDow()` — raw `toISOString()` has corrupted
  attendance and payroll. **`escHtml()`** every piece of user content before `innerHTML`.
