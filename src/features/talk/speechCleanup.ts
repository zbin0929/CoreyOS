/**
 * Best-effort Markdown → speech-friendly plain text.
 *
 * Piper (and most CLI TTS engines) treat punctuation literally:
 * `**bold**` becomes "asterisk asterisk bold asterisk asterisk",
 * fenced code blocks are read line-by-line including the ``` , and
 * link syntax `[label](url)` either spells out the URL or goes
 * silent on the brackets. Stripping these before synthesis is the
 * difference between "Hermes 在线播报" and a confused mumble.
 *
 * We intentionally keep this **conservative** — full Markdown→
 * SSML is a rabbit hole; for v1 we only need to handle what
 * Hermes actually emits in chat replies (bold, italics, inline
 * code, fences, list bullets, headings, links).
 *
 * Extracted from `useTalkMode.ts` 2026-05-17 as a pure utility.
 */
export function stripMarkdownForSpeech(input: string): string {
  return (
    input
      // Fenced code blocks → drop the fences but keep the text
      // (often contains commands the user wants read aloud).
      .replace(/```[a-zA-Z0-9_-]*\n?/g, '')
      .replace(/```/g, '')
      // Inline code: keep contents, drop backticks.
      .replace(/`([^`]+)`/g, '$1')
      // Bold + italic markers (** *** _ __) — drop the marker chars,
      // keep the inner text.
      .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      // Links: `[label](url)` → just the label.
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      // Heading hashes at line start.
      .replace(/^#{1,6}\s+/gm, '')
      // Bullet markers (- * +) at line start → drop, the pause comes
      // from the surrounding newline anyway.
      .replace(/^\s*[-*+]\s+/gm, '')
      // Numbered list markers (1. 2. ...) → keep number, drop dot
      // so Piper doesn't pause oddly.
      .replace(/^\s*(\d+)\.\s+/gm, '$1 ')
      // Emojis + pictographs (`\u{1F300}-\u{1F9FF}` + dingbats etc).
      // The Unicode property `Extended_Pictographic` covers every
      // emoji-like glyph; ZWJ + variation selectors get swept up
      // alongside so a sequence like 👨‍👩‍👧 doesn't leave fragment
      // chars behind. Without this, macOS `say` reads "huo3" for
      // 🔥 and Piper's phonemizer produces dead-air. Either way:
      // hearing "fire-emoji" mid-sentence is jarring UX.
      .replace(/\p{Extended_Pictographic}/gu, '')
      // ZWJ / variation selector / keycap glue — strip individually,
      // not via a character class (eslint flags combining marks
      // inside `[…]`).
      .replace(/\u{200D}/gu, '')
      .replace(/\u{FE0F}/gu, '')
      .replace(/\u{20E3}/gu, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[：；、，,]/g, ' ')
      .replace(/。/g, '.')
      .replace(/？/g, '?')
      .replace(/！/g, '!')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
