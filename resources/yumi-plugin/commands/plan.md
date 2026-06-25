---
allowed-tools: Read, Glob, Grep, Bash(git log:*), Bash(git status:*), Bash(ls:*)
argument-hint: <what to plan>
description: create an implementation plan (read-only)
---

## task

$ARGUMENTS

## process

1. **understand the goal** - what exactly needs to be built or changed?
2. **explore the codebase** - find relevant files, patterns, dependencies
3. **identify constraints** - existing architecture, conventions, limitations
4. **decompose into steps** - ordered, concrete implementation steps
5. **flag risks** - breaking changes, edge cases, unknowns

## exploration

before planning, understand the current state:

- **project structure** - key directories, frameworks, patterns in use
- **related code** - existing implementations similar to what's requested
- **dependencies** - what this feature touches, upstream/downstream effects
- **conventions** - naming, file organization, testing patterns already established

use Glob, Grep, and Read to gather context. be thorough.

## output

```
## plan: [concise goal summary]

### context
- [relevant existing code/patterns found]
- [constraints and dependencies identified]

### steps
1. [concrete step with specific files/locations]
2. [next step]
3. ...

### files to create/modify
- `path/to/file` - [what changes]

### risks
- [potential issues, breaking changes, edge cases]

### open questions
- [anything that needs clarification before implementing]
```

## rules

- **read-only** - do not create, edit, or modify any files
- **be specific** - reference actual file paths, function names, line numbers
- **be practical** - steps should be directly actionable
- **be honest** - flag unknowns and risks, don't hand-wave complexity
- **scope it** - if the task is large, suggest phases or milestones
- keep it concise. no filler.
