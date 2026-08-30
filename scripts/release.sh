#!/usr/bin/env bash
# release.sh — one door for shipping the Barro Ops System.
#
# The app deploys on `git push` (GitHub Pages), but Firebase surfaces
# (Firestore rules+indexes, Storage rules, Cloud Functions) deploy separately
# and MUST land BEFORE the code that depends on them, or writes fail silently.
# This script makes that ordering visible and refuses a push it knows is unsafe.
#
# Usage:
#   bash scripts/release.sh                 # status: drift report + pending ops + push state
#   bash scripts/release.sh rules           # deploy firestore rules+indexes, then record
#   bash scripts/release.sh storage         # deploy storage rules, then record
#   bash scripts/release.sh functions       # deploy cloud functions, then record
#   bash scripts/release.sh record <surface|all>   # record current files as "deployed"
#                                           # (after a deploy done outside this script)
#   bash scripts/release.sh push [--force]  # guarded git push origin master
#   bash scripts/release.sh verify          # compare live APP_VERSION vs local
#
# State: .deploy-state (repo root, gitignored) — "<surface> <sha256> <date>" per line.
# It records what was last deployed FROM THIS MACHINE; deploys done elsewhere
# need a manual `record` after verifying in the Firebase console.

set -u
cd "$(dirname "$0")/.." || exit 1

STATE_FILE=".deploy-state"
STATUS_MD="STATUS.md"
LIVE_URL="https://barroindustries-operatingsystem.ravenmails.com"
FIREBASE="$(command -v firebase || true)"
[ -z "$FIREBASE" ] && [ -x "$HOME/.npm-global/bin/firebase" ] && FIREBASE="$HOME/.npm-global/bin/firebase"

# ---------- helpers ----------------------------------------------------------
hash_surface() { # surface -> sha256 of its source files
  case "$1" in
    firestore) cat firestore.rules firestore.indexes.json 2>/dev/null ;;
    storage)   cat storage.rules 2>/dev/null ;;
    functions) cat functions/index.js functions/package.json 2>/dev/null ;;
  esac | shasum -a 256 | cut -d' ' -f1
}

recorded_hash() { grep "^$1 " "$STATE_FILE" 2>/dev/null | tail -1 | cut -d' ' -f2; }

record_surface() {
  local s="$1" h; h="$(hash_surface "$1")"
  grep -v "^$s " "$STATE_FILE" 2>/dev/null > "$STATE_FILE.tmp" || true
  echo "$s $h $(date +%Y-%m-%dT%H:%M:%S)" >> "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"
  echo "  recorded: $s = ${h:0:12}…"
}

drift_of() { # surface -> "current" | "DRIFTED" | "unknown"
  local cur rec; cur="$(hash_surface "$1")"; rec="$(recorded_hash "$1")"
  if [ -z "$rec" ]; then echo "unknown"
  elif [ "$cur" = "$rec" ]; then echo "current"
  else echo "DRIFTED"
  fi
}

print_pending_ops() {
  echo "── Pending one-time actions (STATUS.md) ──────────────────────────"
  local ops
  ops="$(sed -n '/<!-- PENDING-OPS:BEGIN -->/,/<!-- PENDING-OPS:END -->/p' "$STATUS_MD" 2>/dev/null | grep '^- \[ \]' || true)"
  if [ -n "$ops" ]; then
    echo "$ops" | sed 's/^- \[ \] /  ☐ /' | cut -c1-100
  else
    echo "  (none — or STATUS.md markers missing)"
  fi
}

print_status() {
  echo "══ release.sh — $(date +%Y-%m-%d\ %H:%M) ══════════════════════════"
  echo "── Firebase surface drift (vs last deploy recorded on this machine) ─"
  local s d warn=0
  for s in firestore storage functions; do
    d="$(drift_of "$s")"
    case "$d" in
      current) printf "  ✓ %-10s current\n" "$s" ;;
      DRIFTED) printf "  ✗ %-10s DRIFTED — deploy before pushing dependent code\n" "$s"; warn=1 ;;
      unknown) printf "  ? %-10s no baseline — verify console state, then: release.sh record %s\n" "$s" "$s"; warn=1 ;;
    esac
  done
  echo "── Git ────────────────────────────────────────────────────────────"
  git status -sb | head -1 | sed 's/^/  /'
  local dirty; dirty="$(git status --porcelain | wc -l | tr -d ' ')"
  echo "  uncommitted paths: $dirty"
  print_pending_ops
  [ "$warn" = 1 ] && echo "⚠ resolve the ✗/? lines above before 'release.sh push'."
  return 0
}

deploy() { # surface -> firebase target
  local s="$1" target
  case "$s" in
    firestore) target="firestore" ;;
    storage)   target="storage" ;;
    functions) target="functions" ;;
    *) echo "unknown surface: $s"; exit 1 ;;
  esac
  if [ -z "$FIREBASE" ]; then
    echo "firebase CLI not found (looked in PATH and ~/.npm-global/bin). Install or deploy by hand, then: release.sh record $s"
    exit 1
  fi
  echo "deploying $s (firebase deploy --only $target)…"
  if "$FIREBASE" deploy --only "$target"; then
    record_surface "$s"
    echo "✓ $s deployed + recorded. Rules propagation takes ~10–60s."
  else
    echo "✗ deploy failed — state NOT recorded."
    exit 1
  fi
}

guarded_push() {
  local force="${1:-}" bad=0 s d
  for s in firestore storage; do
    d="$(drift_of "$s")"
    if [ "$d" = "DRIFTED" ]; then
      echo "✗ $s rules have changed since their last recorded deploy."
      bad=1
    elif [ "$d" = "unknown" ]; then
      echo "? $s has no recorded baseline — can't prove the push is safe (allowed, but verify + 'record')."
    fi
  done
  if [ "$bad" = 1 ] && [ "$force" != "--force" ]; then
    echo ""
    echo "REFUSING PUSH: rules must land BEFORE the code that needs them, or writes fail"
    echo "silently in prod. Run 'release.sh rules' / 'release.sh storage' first,"
    echo "or 'release.sh push --force' if the rules change is genuinely independent."
    exit 1
  fi
  echo "pushing…"
  git push origin master || exit 1
  echo "✓ pushed. Pages builds in ~1–3 min. Then: release.sh verify"
  print_pending_ops
}

verify_live() {
  local local_v live_v
  local_v="$(grep -m1 "APP_VERSION" js/config.js | grep -oE "[0-9]+\.[0-9]+\.[0-9]+")"
  live_v="$(curl -sL --max-time 20 "$LIVE_URL/js/config.js" | grep -m1 "APP_VERSION" | grep -oE "[0-9]+\.[0-9]+\.[0-9]+")"
  echo "  local:  v${local_v:-?}"
  echo "  live:   v${live_v:-unreachable}"
  if [ -n "$live_v" ] && [ "$local_v" = "$live_v" ]; then
    echo "  ✓ live matches local. (Devices may still hold the old SW until reload — banner handles it.)"
  else
    echo "  … not matching yet. Pages takes a few minutes; if it persists, check the pages-deploy-check workflow."
  fi
}

# ---------- dispatch ---------------------------------------------------------
case "${1:-status}" in
  status)            print_status ;;
  rules|firestore)   deploy firestore ;;
  storage)           deploy storage ;;
  functions)         deploy functions ;;
  record)
    case "${2:-}" in
      all) record_surface firestore; record_surface storage; record_surface functions ;;
      firestore|storage|functions) record_surface "$2" ;;
      *) echo "usage: release.sh record <firestore|storage|functions|all>"; exit 1 ;;
    esac ;;
  push)              guarded_push "${2:-}" ;;
  verify)            verify_live ;;
  *) echo "usage: release.sh [status|rules|storage|functions|record <surface|all>|push [--force]|verify]"; exit 1 ;;
esac
