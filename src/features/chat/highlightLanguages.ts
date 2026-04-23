/**
 * Subset of highlight.js languages we actually see in chat.
 *
 * `rehype-highlight` v7 defaults to `common: true` which pulls in ~35
 * grammars — fine for a blog but ~200kb of grammar JS we don't need
 * when the overwhelming majority of LLM-emitted fences are in a dozen
 * languages. Passing an explicit `languages: {…}` map drops `common`
 * and ships only what we register here.
 *
 * Rule of thumb when adding:
 * - Keep every grammar under ~10kb gzipped.
 * - Register every alias the model might emit. Highlight.js accepts
 *   lookup by both canonical id (`typescript`) and alias (`ts`); if
 *   the map doesn't hit, the block renders un-highlighted but still
 *   readable — so missing a language degrades gracefully.
 * - When in doubt leave it out: `plaintext` blocks in github-dark
 *   look nearly identical to highlighted ones anyway.
 *
 * Ordered by how often we see them in Hermes responses today (rough
 * eyeball from logs, not rigorous).
 */
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml'; // html/svg
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';

export const chatHighlightLanguages = {
  // JS family — register aliases too so ```ts / ```tsx / ```js fences
  // all resolve. `tsx`/`jsx` reuse the base grammar; hljs doesn't ship
  // a JSX-aware variant and the base grammar is good enough for the
  // short snippets LLMs emit.
  javascript,
  js: javascript,
  jsx: javascript,
  typescript,
  ts: typescript,
  tsx: typescript,
  python,
  py: python,
  bash,
  sh: bash,
  shell: bash,
  zsh: bash,
  json,
  yaml,
  yml: yaml,
  markdown,
  md: markdown,
  rust,
  rs: rust,
  go,
  golang: go,
  sql,
  // HTML / SVG / XML all share the `xml` grammar inside hljs.
  xml,
  html: xml,
  svg: xml,
  css,
  diff,
  patch: diff,
};
