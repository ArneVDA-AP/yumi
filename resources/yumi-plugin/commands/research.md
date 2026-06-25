---
allowed-tools: Read, Glob, Grep, WebFetch, WebSearch, Bash(git log:*), Bash(git status:*), Bash(ls:*), Bash(wc:*), Bash(file:*), Bash(head:*), Bash(cat:*)
argument-hint: <topic or question>
description: research a topic, problem, or resource (read-only)
---

## subject

$ARGUMENTS

## process

1. **parse intent** - what exactly needs to be understood?
   - codebase question → search files, trace code paths
   - external topic → web search, fetch docs
   - bug/error → find root cause, gather context
   - architecture question → map dependencies, data flow
   - library/API → fetch docs, find usage examples
   - mixed → combine approaches

2. **scope the search** - identify all relevant dimensions:
   - what files, modules, or systems are involved?
   - what external resources (docs, APIs, specs) apply?
   - what related concepts or dependencies matter?
   - what prior art or patterns exist?

3. **gather evidence** - cast a wide net, then focus:
   - use Grep/Glob for codebase searches (multiple query variations)
   - use WebSearch for external knowledge
   - use WebFetch for specific documentation pages
   - use Read to examine relevant files in depth
   - trace call chains, data flow, configuration paths

4. **synthesize** - connect findings into coherent understanding

## research strategies

**codebase research:**
- search with multiple terms (function names, error strings, types, comments)
- trace imports/exports to map dependency graphs
- read test files to understand expected behavior
- check git history for context on why things are the way they are

**external research:**
- search with specific, technical queries (not vague)
- fetch official documentation over blog posts
- cross-reference multiple sources for accuracy
- note version-specific information

**bug/error research:**
- search for the exact error message in codebase
- search web for the error + framework/library context
- trace the code path that produces the error
- check for known issues, changelogs, migration guides

**architecture research:**
- map entry points, data flow, state management
- identify boundaries between modules/services
- find configuration and environment dependencies
- note patterns, conventions, and deviations

## output

```
## research: [concise topic summary]

### query
- [restated question / research goal]

### findings

#### [finding area 1]
- [specific fact with source reference (file:line or URL)]
- [specific fact]

#### [finding area 2]
- [specific fact]

### key insights
- [most important takeaway]
- [non-obvious connection or implication]

### sources
- `path/to/file:line` - [what it shows]
- [url] - [what it covers]

### open questions
- [what remains unclear or needs further investigation]
```

## rules

- **read-only** - do not create, edit, or modify any files
- **evidence-based** - every claim must reference a source (file path, URL, or command output)
- **exhaustive search** - try multiple query variations before concluding something doesn't exist
- **specific** - reference actual file paths, function names, line numbers, URLs
- **honest** - clearly distinguish facts from inference, flag uncertainty
- **structured** - group findings logically, not chronologically by search order
- keep it concise. no filler. lead with the answer.
