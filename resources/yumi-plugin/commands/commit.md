---
allowed-tools: mcp__yumi__RunBash
argument-hint: [--amend] [files...]
description: create a concise, lowercase commit
---

## context

first, gather context using RunBash (run all 4 in sequence):
1. `git status`
2. `git diff --staged`
3. `git diff`
4. `git log --oneline -5`

## parse arguments

$ARGUMENTS

check for flags:
- `--amend` → amend previous commit instead of creating new one
- file paths → stage only specified files

## CRITICAL: read the FULL diff

**BEFORE writing any commit message, you MUST:**

1. if diff output shows "Output too large" or "Preview (first X)" → READ THE PERSISTED FILE to see ALL changes
2. NEVER write a commit message based on truncated/preview output
3. the persisted file path is in the tool result - use the Read tool to get the full diff

## analyze changes

before writing the commit message:

1. **read EVERY line of the diff** - not just file names or a preview
2. **identify the PRIMARY change** - what's the main thing this commit does?
3. **list secondary changes** - version bumps, config updates, related fixes
4. **rank by importance** - lead with the most significant change, not just "update docs"
5. **check for multiple concerns** - if changes span unrelated areas, consider separate commits

**common mistakes to avoid:**
- `update docs` when you also changed code behavior
- `bump version` when the version bump accompanies feature changes
- generic descriptions like `update configs` when the configs change specific behavior

## commit message format

**subject line** (required):
- all lowercase, no period, max 50 chars
- present tense verb: add, fix, update, remove, refactor, simplify, improve
- specific: describe WHAT changed and WHERE
- bad: `fix bug`, `update code`, `changes`
- good: `fix null check in auth middleware`, `add retry logic to api client`

**body** (when needed):
- blank line after subject
- wrap at 72 chars
- explain WHY if not obvious from subject
- list additional changes if commit touches multiple areas

## examples

simple change:
```
fix off-by-one in pagination offset
```

change with context:
```
add request timeout to external api calls

prevents hanging when third-party services are slow.
default 30s, configurable via API_TIMEOUT env var.
```

multiple related changes:
```
refactor auth flow to use refresh tokens

- add token refresh before expiry
- store refresh token in secure storage
- remove session-based auth fallback
```

version bump + feature (lead with feature):
```
add dynamic compaction thresholds, bump to 0.6.1
```

config + behavior change (describe the behavior):
```
change auto-compact from 77.5% to 75% default
```

**BAD examples** (don't do these):
- `update docs` ← too vague, what changed in the docs?
- `bump version` ← why? what's new in this version?
- `update configs` ← which configs? what do they configure?
- `fix bug` ← which bug? where?
- `code cleanup` ← what was cleaned? why?

amend example (when --amend flag):
```
git commit --amend -m "updated message"
```

## rules

- no co-authored-by
- no emojis
- stage specific files, avoid `git add -A` for large changes
- if unsure about grouping, ask before committing
- if --amend: use `git commit --amend` (reuses message if no changes to message)

## workflow

1. if specific files provided, stage those files
2. if --amend flag, use `git commit --amend`
3. else create new commit

stage and commit. only use tool calls, no text output.
