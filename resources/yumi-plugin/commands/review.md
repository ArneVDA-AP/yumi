---
allowed-tools: Read, Glob, Grep, Edit, Bash(git diff:*), Bash(git status:*), Bash(git log:*), Bash(npm test:*), Bash(cargo test:*), Bash(go test:*), Bash(pytest:*)
argument-hint: [--fix] [scope]
description: review changes or codebase (read-only)
---

## scope

$ARGUMENTS

## parse flags

- `--fix` → auto-fix minor issues after review (formatting, typos, simple bugs)
- everything else → scope for review

## detect scope

1. **if argument provided**: review specified scope
   - file path → review that file
   - directory → review files in directory
   - concept (e.g. "auth", "security") → grep and review related code
   - "diff" → force git diff review
   - "all" → full codebase scan
2. else: files edited this conversation → review those
3. else: `git diff HEAD` + `git diff --cached` → review diff
4. else: review codebase (scan for issues, tech debt, patterns)

## examine

for each change, question critically:

- **correctness** - logic right? off-by-one? null/empty handled?
- **approach** - simpler way? over-engineered? under-engineered?
- **edge cases** - failures? boundaries? malformed input?
- **security** - injection? exposure? auth bypass? path traversal?
- **breaking** - contracts changed? callers affected? backwards compat?
- **consistency** - matches surrounding code style? naming conventions?
- **performance** - n+1 queries? unnecessary work? memory leaks?
- **tech debt** - todos? hacks? outdated patterns?

for non-code (docs, configs, data):
- **accuracy** - factually correct? outdated references?
- **completeness** - missing sections? incomplete examples?
- **clarity** - ambiguous? misleading? typos?

## verify

detect project type and run tests (read results only):

```
package.json     → npm test
Cargo.toml       → cargo test
go.mod           → go test ./...
pyproject.toml   → pytest
```

run only what's relevant. report pass/fail status.

## output

```
## review: [scope summary]

examined:
- [file] [what was checked]

issues:
- [critical] description (file:line)
- [warning] description (file:line)

suggestions:
- optional improvements

verified:
- [tests passed/failed]

verdict: ready | needs work | critical issues
```

if clean:
```
## review: [scope]
looks good. no issues found.
```

## --fix mode

if `--fix` flag is present AND issues were found:

1. **auto-fixable issues** (fix these directly):
   - typos in strings/comments
   - missing semicolons, trailing commas
   - obvious formatting issues
   - unused imports
   - simple null checks
   - obvious off-by-one fixes

2. **not auto-fixable** (report only):
   - logic changes
   - architectural issues
   - security vulnerabilities
   - breaking changes

after fixing:
```
## fixes applied:
- [file:line] what was fixed

remaining issues:
- [issue] why it needs manual review
```

without --fix flag: read-only, do not make changes.
