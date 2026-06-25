# yumi plugin

core plugin for yumi.

## commands

### /commit
concise, lowercase git commits:
- all lowercase, no period, max 50 chars
- present tense: add, fix, update, remove, refactor
- supports `--amend` for amending previous commit

### /review
code review of current changes:
- bugs, security, performance, style, tests
- verdict: ready / needs work / critical issues
- use `--fix` to auto-fix minor issues

### /compact
context compaction with preservation:
- preserves task, files, decisions
- saves learnings to memory v2
- structured hints: `task:`, `files:`, `decisions:`

### /init
initialize context with focus:
- scans project structure
- loads memory context (learnings, patterns)
- optional focus area for deep dive

## agents

### yumi-architect
plans architecture, decomposes tasks into steps, identifies dependencies and risks. use before complex features.

### yumi-explorer
codebase exploration and context gathering. searches files, reads code, maps structure. read-only, uses sonnet.

### yumi-implementer
makes small, focused code edits after planning. reads before editing, minimal diffs.

### yumi-guardian
reviews for bugs, security issues, performance problems. also handles tests, docs, devops, data processing.

## hooks

### yumi guard
blocks dangerous operations:
- destructive commands (rm -rf, dd, format)
- privilege escalation (sudo, chmod +s)
- system modifications (shutdown, systemctl)
- remote code execution (curl|sh, eval)
- dangerous git (force push, reset --hard)
- protected paths (.ssh, .aws, /etc)
- credential exposure (.env, secrets)

## version
2.2.0
