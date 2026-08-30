#!/usr/bin/env bash
# PreToolUse guard — blocks git commands that destroy uncommitted work in this
# SHARED LIVE worktree (multiple agents edit it concurrently; a `git stash` here
# wiped ~300 uncommitted lines of another agent's work on 2026-08-03).
# Wired via .claude/settings.json (PreToolUse / Bash). Input: hook JSON on stdin.
# Exit 2 = block the tool call (stderr is shown to the model). Exit 0 = allow.

payload="$(cat)"
cmd="$(printf '%s' "$payload" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{const j=JSON.parse(s);process.stdout.write(String((j.tool_input&&j.tool_input.command)||""))}
  catch(e){}
});' 2>/dev/null)"
[ -z "$cmd" ] && exit 0

block() {
  echo "BLOCKED (scripts/hooks/block-destructive-git.sh): $1. This shared live worktree carries other agents' uncommitted work — see CLAUDE.md 'Critical workflow rules'. To verify in isolation, copy files to a scratch dir; to read a clean baseline use 'git show HEAD:<path>'. (If this is a false positive from e.g. a commit message, rephrase the message.)" >&2
  exit 2
}

echo_cmd() { printf '%s' "$cmd"; }

echo_cmd | grep -qE '\bgit\b[^|&;]*\bstash\b' \
  && block "'git stash' does a hard reset under the hood and wipes every other agent's uncommitted work"

echo_cmd | grep -qE '\bgit\b[^|&;]*\breset\b[^|&;]*--(hard|merge|keep)' \
  && block "'git reset --hard/--merge/--keep' discards uncommitted work tree-wide"

echo_cmd | grep -qE '\bgit\b[^|&;]*\bclean\b[^|&;]*-[a-zA-Z]*[fdxXn]' \
  && block "'git clean' deletes other sessions' untracked scratch files"

echo_cmd | grep -qE '\bgit\b[^|&;]*\bcheckout\b[^|&;]*(\s--(\s|$)|\s\.[[:space:]]*$)' \
  && block "'git checkout -- <path>' / 'git checkout .' overwrites uncommitted edits"

if echo_cmd | grep -qE '\bgit\b[^|&;]*\brestore\b'; then
  if ! echo_cmd | grep -q -- '--staged' || echo_cmd | grep -q -- '--worktree'; then
    block "'git restore' (working-tree form) overwrites uncommitted edits ('git restore --staged' alone is fine)"
  fi
fi

exit 0
