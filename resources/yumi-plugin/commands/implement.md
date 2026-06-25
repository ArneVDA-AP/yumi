---
allowed-tools: Read, Glob, Grep, Edit, Write, Bash(git diff:*), Bash(git status:*), Bash(git log:*), Bash(ls:*), Bash(npm test:*), Bash(npm run:*), Bash(cargo test:*), Bash(go test:*), Bash(pytest:*), mcp__yumi__RunBash, mcp__yumi__AskUserQuestion, Agent
argument-hint: <feature or plan to implement>
description: implement a planned feature end-to-end
---

**YOU MUST ACTUALLY WRITE CODE AND MAKE CHANGES. planning alone is FAILURE. if you finish without editing/creating files, you have failed.**

## task

$ARGUMENTS

## step 1: quick scope (spend <2 minutes, then start coding)

rapidly gather context — just enough to start implementing:
- Glob/Grep for relevant files, read key ones
- identify what to create, what to modify
- if anything is truly ambiguous, ask the user. otherwise, start coding.

do NOT produce a detailed plan document. do NOT stop after analysis. move to step 2 immediately.

## step 2: implement NOW

start writing code immediately after gathering context. execute in dependency order:

1. **types/interfaces first** - define data shapes
2. **core logic** - the main functionality
3. **integration** - wire into existing code (imports, exports, registration)
4. **edge cases** - error handling where needed
5. **tests** - if the project has tests, write them

### rules while coding

- **read before edit** - always read current file state before modifying
- **preserve style** - match existing patterns, naming, formatting
- **minimal changes** - only change what's needed, don't refactor surroundings
- **reuse existing** - use project utilities, types, patterns; don't reinvent
- **no placeholders** - every piece of code must be functional, not stubbed
- **no gold-plating** - implement exactly what's requested, nothing extra

## step 3: verify

after all changes:

1. **run tests** - detect project type, run appropriate test command
2. **check regressions** - did existing tests break?
3. **review changes** - `git diff` to sanity check

## output

```
## implemented: [concise summary]

### changes
- `path/to/file` - [what was done]

### tests
- [pass/fail]

### notes
- [follow-up tasks or caveats, if any]
```

## rules

- **CODE FIRST, NOT PLAN FIRST** - your job is to deliver working code, not a plan document
- **ask when uncertain** - use AskUserQuestion for truly ambiguous requirements
- **fail fast** - if a prerequisite is missing, stop and report
- **no gold-plating** - implement exactly what's requested
- keep output concise. no filler.
