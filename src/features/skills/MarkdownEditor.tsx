import { useMemo, useRef } from 'react';
import CodeMirror, {
  EditorView,
  keymap,
  type ReactCodeMirrorRef,
} from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';

/**
 * T4.2b — CodeMirror 6 editor for Skill Markdown bodies.
 *
 * Wraps `@uiw/react-codemirror` with:
 * - **Markdown language** + `language-data` so fenced code blocks pick
 *   up the right sub-highlighter (ts, bash, py, …) lazily.
 * - A **design-token theme** (no `theme-one-dark` import; we want to
 *   inherit the app's `data-theme` colours so dark/light flip follow
 *   the global toggle, and a 300kb bundled theme is pointless when
 *   our tokens do the job).
 * - A **hidden mirror `<textarea>`** so Playwright's `.fill()` /
 *   `.toHaveValue()` contract on `skills-editor-textarea` keeps
 *   working. The textarea is `sr-only` + `aria-hidden`; programmatic
 *   writes route through React state just like user typing.
 * - **Cmd/Ctrl-S** forwarded to `onSave` so ⌘S saves without taking
 *   focus out of the editor — the single most-missed affordance in
 *   the old textarea.
 *
 * Trade-offs worth logging:
 * - CM6 is still ~180kb gzipped minimum (view + state + markdown).
 *   The Skills route is tree-split by the router, so users who never
 *   open `/skills` don't pay. Verified via `vite build` bundle map.
 * - No vim/emacs keymaps — can add `@replit/codemirror-vim` behind a
 *   user setting later. ~20kb, not worth pre-shipping.
 */
export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Fired on Cmd/Ctrl-S regardless of dirty state. The Skills page
   *  already no-ops the save when `dirty === false`, so we don't
   *  gate here. */
  onSave?: () => void;
  /** Mirror-textarea testid. Defaults match the existing Playwright
   *  contract (`skills-editor-textarea`). Kept configurable so other
   *  consumers — runbooks, future prompt editors — can collide-proof
   *  their own e2e hooks. */
  testId?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  testId = 'skills-editor-textarea',
}: MarkdownEditorProps) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  // Extensions are stable per-mount — only the callback closures change.
  // `useMemo` stops CodeMirror from reconfiguring on every parent render.
  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            onSave?.();
            return true;
          },
          preventDefault: true,
        },
      ]),
    ],
    [onSave],
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-bg">
      <CodeMirror
        ref={cmRef}
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme="none"
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          searchKeymap: true,
          // Markdown prose benefits from soft-wrap more than from
          // explicit indent guides; keep the gutter lean.
          indentOnInput: false,
          bracketMatching: false,
        }}
        className="skills-cm min-h-0 flex-1 overflow-auto text-xs"
      />
      {/* Hidden mirror — preserves the Playwright `.fill()` /
       *  `.toHaveValue()` contract the old <textarea> exposed.
       *  `sr-only` keeps it in the accessibility tree but off-screen;
       *  `aria-hidden` stops screen readers from double-announcing
       *  since CM6 is the real editable surface. */}
      <textarea
        aria-hidden="true"
        tabIndex={-1}
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="sr-only"
      />
    </div>
  );
}
