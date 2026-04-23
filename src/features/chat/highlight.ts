/**
 * Minimal highlight.js wrapper for chat fenced code blocks.
 *
 * ### Why not `rehype-highlight`?
 *
 * `rehype-highlight` v7 `import { common } from 'lowlight'` at module
 * top — every one of the 35 "common" grammars gets bundled even when
 * you pass your own `languages: {…}` option (the prop replaces the
 * registry but doesn't tree-shake the import). Verified against the
 * post-route-split bundle: `ruby`, `scala`, `swift`, `csharp`, `lua`
 * grammars all still shipped despite a `languages` map that named
 * none of them. The library simply doesn't support a "no common"
 * mode.
 *
 * So we drop `rehype-highlight` and drive `highlight.js/lib/core`
 * directly: register only the grammars from `highlightLanguages.ts`
 * and run `hljs.highlight(code, {language})` in React's `code`
 * component renderer. Saves ~150kb gzipped on the initial bundle.
 *
 * Bonus: we get to handle unknown languages exactly the way we want
 * (plain text, no scary warning in the console) instead of depending
 * on `ignoreMissing`'s behaviour.
 */
import hljs from 'highlight.js/lib/core';
import { chatHighlightLanguages } from './highlightLanguages';

// Register once on first import. Every alias in the map points to the
// same underlying grammar function, so hljs sees both canonical ids
// (`typescript`) and aliases (`ts`) as first-class names.
let _registered = false;
function ensureRegistered() {
  if (_registered) return;
  for (const [name, fn] of Object.entries(chatHighlightLanguages)) {
    if (!hljs.getLanguage(name)) {
      hljs.registerLanguage(name, fn);
    }
  }
  _registered = true;
}

/**
 * Highlight a single fenced block. `lang` may be undefined (no info
 * string), an alias we know (`ts`), or something we don't ship
 * (`haskell`) — the last two degrade to the raw source wrapped in
 * `hljs.escapeHTML` so React's `dangerouslySetInnerHTML` can't inject
 * markup from the model's output.
 *
 * Returns `{ html, language }`. `language` is the id hljs actually
 * used (useful for the `language-*` class on the `<code>` element),
 * or `null` when we fell back to escaped plaintext.
 */
export function highlightCode(
  source: string,
  lang: string | undefined,
): { html: string; language: string | null } {
  ensureRegistered();
  const trimmed = (lang ?? '').trim().toLowerCase();
  if (trimmed && hljs.getLanguage(trimmed)) {
    try {
      const out = hljs.highlight(source, { language: trimmed, ignoreIllegals: true });
      return { html: out.value, language: out.language ?? trimmed };
    } catch {
      // Defensive: a malformed grammar should never crash the whole
      // message render. Fall through to the escape path.
    }
  }
  // Unknown language or highlight failure: escape + return raw so the
  // block still renders legibly (just without colours).
  const escaped = source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return { html: escaped, language: null };
}
