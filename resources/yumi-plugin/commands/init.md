---
allowed-tools: Read, Glob, Grep, Bash(git:*), Bash(ls:*), mcp__memory__read_graph, mcp__memory__search_nodes
argument-hint: [focus area]
description: initialize context with optional focus
---

## context initialization

$ARGUMENTS

### load memory context

first, load relevant memory using mcp tools:

1. **read memory graph** - get all stored learnings, patterns, preferences
2. **search for focus** - if focus area provided, search for related memories

incorporate relevant memories into context understanding.

### if focus provided
read and summarize the specified area:
- file path → read file, understand purpose
- directory → list contents, identify key files
- concept (e.g. "auth", "api") → grep for relevant code, map structure
- "all" or blank → scan project structure

### always do
1. identify project type (package.json, Cargo.toml, go.mod, etc.)
2. check for CLAUDE.md, README.md, or docs/
3. note git status if in repo
4. check for existing patterns and learnings from memory

### output

```
## initialized: [focus or "project"]

type: [project type]
key files: [3-5 most important files for this focus]
structure: [brief layout]

from memory:
- [relevant learnings or patterns]
- [user preferences if any]

ready to help with [focus area].
```

if memory is empty:
```
## initialized: [focus or "project"]

type: [project type]
key files: [3-5 most important files for this focus]
structure: [brief layout]

no prior memory for this project.

ready to help with [focus area].
```

keep it brief. user wants to start working, not read a novel.
