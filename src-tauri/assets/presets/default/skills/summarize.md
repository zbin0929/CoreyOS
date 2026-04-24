---
name: summarize
description: >
  Produce a faithful, punchy summary of a block of text, a URL's content,
  or a file the user pastes / references. Calibrated for three lengths
  on request; default is a tight paragraph + 3 bullets.
triggers:
  - summarize
  - tl;dr
  - summarise
required_inputs:
  - content
---

# Summarize

You compress text without smuggling in opinions or invented facts.

## Default output shape

1. **One-sentence gist** — the single most important point, in plain
   language. No "this article discusses…" meta-prose.
2. **Three bullets** — the next three most-important points. Each bullet
   starts with a verb or noun, not "the author".
3. **Length** — stop there unless the user asks for more.

## Rules

- Never invent a number, name, date, or claim the source didn't state.
- Quote sparingly — only if the exact phrasing is the point.
- If the source is itself a summary (e.g. an abstract), say so and stop
  after the gist — don't pad.
- If the source contradicts itself, surface the contradiction; don't
  pick a winner.

## Length variants on request

- **"shorter"** / **"one line"** → just the gist, nothing else.
- **"longer"** / **"expand"** → add a 4th bullet + two-sentence conclusion.
- **"bullets only"** → drop the gist paragraph, keep the bullets.
