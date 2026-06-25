---
allowed-tools: Read, Glob, Grep, Edit, Write, Bash(git status:*), Bash(git log:*), Bash(git branch:*), Bash(ls:*), mcp__yumi__RunBash, mcp__yumi__AskUserQuestion, Task, Agent
argument-hint: <task to parallelize>
description: coordinate a team of agents on a complex task
---

**YOU MUST ACTUALLY EXECUTE THE WORK. planning alone is FAILURE. your job is to spawn agents that write real code, make real changes, and deliver working results. if you finish without spawning agents and making changes, you have failed.**

## task

$ARGUMENTS

## step 1: quick analysis (spend <2 minutes here)

rapidly scan the codebase to understand what needs to happen:
- Glob/Grep for relevant files
- identify 2-4 independent workstreams (different files/modules = parallel)
- assign disjoint file ownership per teammate

do NOT over-analyze. move to execution fast.

## step 2: spawn the team NOW

immediately launch 2-4 Agent subagents **in parallel**. do NOT present a plan and wait. do NOT ask for confirmation. just spawn.

use `subagent_type: "yumi--implementer"` for each teammate.

each teammate prompt MUST include:

1. **full context** - the agent has NO prior context; include everything it needs (project structure, frameworks, patterns, types)
2. **owned files** - exactly which files to read, create, or modify
3. **forbidden files** - files owned by other teammates (do NOT touch)
4. **concrete task** - step-by-step what to implement, not vague goals
5. **done when** - specific acceptance criteria

teammate prompt template:
```
you are implementing: [specific deliverable]

## your scope
files you own (read/write): [list]
files you must NOT modify: [list — owned by other agents]

## context
[project: framework, language, patterns, key types/interfaces]
[relevant existing code snippets or file contents they need]

## task
1. [concrete step]
2. [concrete step]
3. [concrete step]

## done when
- [specific file exists or is modified with X]
- [specific behavior works]
```

**launch ALL independent teammates in a single message with multiple Agent tool calls.**

for sequential dependencies: launch first group, wait, then launch next group with first group's outputs.

## step 3: integrate and verify

after ALL teammates complete:

1. **review results** - did every teammate deliver?
2. **resolve conflicts** - fix any overlapping changes
3. **wire together** - imports, exports, type connections
4. **fix gaps** - handle anything teammates missed
5. **run tests** - `npm run test` or appropriate command

## output

```
## swarm complete: [summary]

### results:
- [agent-1]: [what was delivered]
- [agent-2]: [what was delivered]

### integration fixes: [any wiring/fixes applied]
### tests: [pass/fail]
### status: [complete | needs follow-up]
```

## rules

- **EXECUTE, DON'T JUST PLAN** - the #1 rule. spawn agents. make changes. deliver code.
- **spawn agents immediately** - do not present a plan and stop. analysis → spawn → integrate.
- **disjoint file ownership** - each file belongs to exactly one teammate
- **complete context in prompts** - teammates have zero prior knowledge
- **2-4 teammates** - match parallelism to the work, don't over-split
- **you are the lead** - you coordinate, review, integrate; teammates execute
- **fail gracefully** - if one fails, fix what you can, continue
- keep output concise. no filler.
