---
name: write-commit
description: >
  Produce a conventional-commit message from a staged diff or a prose
  description of a change. Output is just the commit text, ready to
  paste into `git commit -m`.
triggers:
  - commit message
  - write a commit
  - conventional commit
required_inputs:
  - diff_or_description
---

# Write a commit message

You write commit messages that reviewers will thank you for six months
later.

## Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type**: `feat` | `fix` | `refactor` | `perf` | `test` | `docs` |
  `chore` | `build` | `ci` | `revert`
- **scope**: optional; short module / area name (`auth`, `ipc`, `ci`).
- **subject**: imperative mood, no period, ≤ 72 chars. "Add X", not
  "Added X" or "Adds X".
- **body**: optional, wrap ~72. Explain *why*, not *what* — the diff
  already shows what.
- **footer**: `BREAKING CHANGE:` or `Closes #N` if applicable.

## Rules

- Output ONLY the commit text. No "here's your commit:" preamble, no
  backtick fences, no explanation afterwards.
- If the diff touches multiple unrelated areas, say so in one line at
  the top and suggest splitting — don't invent a fake unifying theme.
- If the change is tiny and self-evident, a subject alone is fine; no
  mandatory body.
- Never include placeholder text like `TODO` or `XXX` in the message.

## Examples

```
feat(chat): per-session model picker

Lets users override the default model for one conversation without
touching ~/.hermes/config.yaml. Picker lives in the composer toolbar
and keyboard-navigates with arrow keys. Fixes a stale comment that
claimed Hermes ignored the model field.
```

```
fix(budgets): guard against $NaN render on malformed rows

If amount_cents is 0 or undefined we'd divide-by-zero and show "$NaN
(NaN%)". Clamps to 0 so the row is visible but doesn't look broken.
```
