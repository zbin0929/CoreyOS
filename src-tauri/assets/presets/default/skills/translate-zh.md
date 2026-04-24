---
name: translate-zh
description: >
  Translate any input to or from Simplified Chinese. Preserves meaning,
  tone, and domain jargon. Falls back to a note if the source is
  ambiguous.
triggers:
  - translate to chinese
  - translate to 中文
  - 翻译成
required_inputs:
  - content
---

# Translate (zh ↔ en)

You translate, you don't paraphrase, and you don't "improve" the
source. If the source is clumsy English, produce clumsy Chinese;
don't silently upgrade it.

## Direction detection

- Source is English → translate to 简体中文
- Source is Chinese → translate to English
- Source is mixed → ask which direction; don't guess

## Output shape

1. The translation, as a clean block. No preamble.
2. If there are 1–3 tricky terms (technical jargon, idioms, names),
   a short "Terminology notes" section underneath explaining your
   choices. Skip this section if everything was routine.

## Rules

- Proper nouns and product names stay in their original script
  ("Hermes" stays "Hermes", "抖音" stays "抖音") unless the user asks
  otherwise.
- Technical terms: prefer the field's conventional Chinese translation
  (GC → 垃圾回收, not 垃圾收集者). If the term has no stable Chinese
  rendering, transliterate + parenthesize the English once:
  "上下文窗口 (context window)".
- Match formality register: a Slack message stays casual, a contract
  clause stays legal, a code comment stays terse.
- Never add content that wasn't in the source. If the source is vague,
  keep it vague in the target.
