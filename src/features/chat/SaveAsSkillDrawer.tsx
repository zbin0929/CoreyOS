import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { AlertCircle, Check, Loader2, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Icon } from '@/components/ui/icon';
import { chatSend, ipcErrorMessage, skillSave } from '@/lib/ipc';
import { useAgentsStore } from '@/stores/agents';
import type { UiMessage } from '@/stores/chat';

/**
 * Phase 7 · T7.2 — "Save as Skill" distillation drawer.
 *
 * User flow:
 *   1. Click "Save as Skill" in the chat header (available once the
 *      session has at least one completed assistant reply).
 *   2. This drawer opens with:
 *      - a name input (→ becomes the file stem under ~/.hermes/skills/).
 *      - a pre-filled SKILL.md textarea with frontmatter stubs + the
 *        full conversation transcript as the body.
 *   3. Edit inline (trim, add frontmatter values, rewrite prose).
 *   4. Save → `skill_save` IPC writes `~/.hermes/skills/<slug>.md`.
 *      Hermes picks it up natively on next session; Corey's Skills
 *      page lists it on next reload.
 *
 * Why no LLM distillation step yet:
 *   The phase doc's "ship it to chat_once with a distillation prompt"
 *   pipeline is a nice-to-have — it adds a round-trip, an extra
 *   failure mode ("what if the model returns non-Markdown?"), and
 *   isn't load-bearing for the exit criterion ("Save conversation as
 *   Skill button lands a new file in ~/.hermes/skills/"). The
 *   graceful-degradation path described in the doc (open editor with
 *   conversation as free-text) IS implemented here as the default —
 *   the user becomes their own distillation layer, which for a
 *   personal-skill workflow is often what you actually want.
 *
 *   Upgrading this to a real LLM distillation is a drop-in: feed
 *   `buildTemplate(messages)` through `chatStream`, replace the
 *   textarea initial value with the response, keep everything else.
 */
export function SaveAsSkillDrawer({
  open,
  onClose,
  messages,
}: {
  open: boolean;
  onClose: () => void;
  messages: UiMessage[];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Regenerate only when messages change. On reopen we also reset
  // state via the sync-on-open guard below, so the user always sees
  // a fresh template pulled from the CURRENT transcript.
  const initialBody = useMemo(() => buildTemplate(messages), [messages]);
  const initialName = useMemo(
    () => deriveSlug(messages) || 'saved-conversation',
    [messages],
  );

  const [name, setName] = useState(initialName);
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [distilling, setDistilling] = useState(false);
  const activeAdapter = useAgentsStore((s) => s.activeId);

  // When the drawer re-opens with new inputs the `useMemo` recomputes
  // but useState's initial values don't re-apply. React's ref-style
  // answer (key the Drawer contents) is overkill; instead we reset
  // state via a cheap effect-free guard: if `open` just flipped from
  // false to true AND we haven't been mutated, adopt the new inputs.
  // In practice: we just reset on open via a light-weight flag.
  const [syncKey, setSyncKey] = useState<boolean>(false);
  if (open && !syncKey) {
    setSyncKey(true);
    setName(initialName);
    setBody(initialBody);
    setSavedPath(null);
    setError(null);
  } else if (!open && syncKey) {
    setSyncKey(false);
  }

  const slug = useMemo(() => sanitizeSlug(name), [name]);
  const nameError = useMemo(() => {
    if (!slug) return t('chat.save_as_skill.name_required');
    return null;
  }, [slug, t]);

  /**
   * Optional LLM-distillation pass. Ships the transcript to the
   * currently-active adapter with a prompt that asks for a proper
   * SKILL.md: frontmatter, a description, concrete steps. Replaces
   * the textarea body with the response; the user can edit further
   * before saving. On any failure we surface the error inline but
   * LEAVE the existing body intact so the user doesn't lose their
   * raw-transcript fallback.
   */
  const onDistill = async () => {
    if (distilling) return;
    setDistilling(true);
    setError(null);
    try {
      const transcript = messages
        .filter((m) => (m.content ?? '').trim().length > 0)
        .map((m) => {
          const who = m.role === 'user' ? 'User' : 'Assistant';
          return `${who}: ${m.content.trim()}`;
        })
        .join('\n\n');
      const systemPrompt =
        'You turn conversations into reusable Hermes SKILL.md files. ' +
        'Analyse the conversation below and extract the single most useful ' +
        'reusable skill. Output ONLY a valid SKILL.md file — nothing else, ' +
        'no prose before or after, no ``` fences. Start with YAML ' +
        'frontmatter enclosed in --- that has these keys (strings unless ' +
        'noted): name, description, triggers (YAML list of strings), ' +
        'required_inputs (YAML list of strings). After the closing --- ' +
        'write a concise body in Markdown describing what the skill does ' +
        'and the steps to perform it, in the imperative voice. Keep the ' +
        'total under ~400 words.';
      const { content } = await chatSend({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: transcript },
        ],
        adapter_id: activeAdapter ?? undefined,
      });
      // Strip accidental code-fence wrappers some models add even
      // when asked not to. Everything between a leading ```markdown /
      // ``` and the matching trailing ``` is the real body.
      const cleaned = stripCodeFences(content).trim();
      if (cleaned.length > 0) {
        setBody(cleaned);
      } else {
        setError(t('chat.save_as_skill.distill_empty'));
      }
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setDistilling(false);
    }
  };

  const onSave = async () => {
    if (nameError || saving) return;
    setSaving(true);
    setError(null);
    try {
      const path = `${slug}.md`;
      const saved = await skillSave(path, body, true);
      setSavedPath(saved.path);
    } catch (e) {
      // If the file already exists (`createNew: true` rejected),
      // retry as an update. The user's intent on "Save" is "commit
      // these bytes" regardless of whether the skill existed before;
      // the editor in /skills handles the disambiguation if they
      // care.
      const msg = ipcErrorMessage(e);
      if (msg.includes('already exists')) {
        try {
          const path = `${slug}.md`;
          const saved = await skillSave(path, body, false);
          setSavedPath(saved.path);
        } catch (err2) {
          setError(ipcErrorMessage(err2));
        }
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t('chat.save_as_skill.title')}
      testId="save-as-skill-drawer"
    >
      <div className="flex flex-col gap-3 py-2">
        <p className="text-xs text-fg-muted">
          {t('chat.save_as_skill.subtitle')}
        </p>

        {savedPath ? (
          <div
            className="flex flex-col gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs text-emerald-500"
            data-testid="save-as-skill-success"
          >
            <div className="inline-flex items-center gap-2">
              <Icon icon={Check} size="sm" />
              <span>{t('chat.save_as_skill.saved', { path: savedPath })}</span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  onClose();
                  void navigate({ to: '/skills' });
                }}
                data-testid="save-as-skill-open"
              >
                {t('chat.save_as_skill.open_in_skills')}
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose}>
                {t('common.close')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-fg-muted">{t('chat.save_as_skill.name')}</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="saved-conversation"
                className="rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none"
                spellCheck={false}
                data-testid="save-as-skill-name"
              />
              <span className="font-mono text-[11px] text-fg-subtle">
                {t('chat.save_as_skill.name_hint', { slug: slug || '…' })}
              </span>
              {nameError && (
                <span className="text-[11px] text-danger">{nameError}</span>
              )}
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-fg-muted">{t('chat.save_as_skill.body')}</span>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => void onDistill()}
                  disabled={distilling}
                  title={t('chat.save_as_skill.distill_hint')}
                  data-testid="save-as-skill-distill"
                >
                  {distilling ? (
                    <Icon icon={Loader2} size="xs" className="animate-spin" />
                  ) : (
                    <Icon icon={Sparkles} size="xs" />
                  )}
                  {t('chat.save_as_skill.distill')}
                </Button>
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={14}
                spellCheck={false}
                className="resize-y rounded-md border border-border bg-bg p-2 font-mono text-[11px] text-fg focus:border-accent focus:outline-none"
                data-testid="save-as-skill-body"
              />
              <span className="text-[11px] text-fg-subtle">
                {t('chat.save_as_skill.body_hint')}
              </span>
            </label>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
                <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => void onSave()}
                disabled={!!nameError || saving}
                data-testid="save-as-skill-submit"
              >
                {saving ? (
                  <Icon icon={Loader2} size="sm" className="animate-spin" />
                ) : (
                  <Icon icon={Wand2} size="sm" />
                )}
                {t('chat.save_as_skill.save')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

/**
 * Build a seed SKILL.md body from the session transcript.
 *
 * Format mirrors the frontmatter convention the Skills editor
 * already expects (name / description / triggers / required_inputs
 * fields with stub values the user replaces), followed by a
 * transcript of the conversation. Keeping the raw transcript means
 * the user can always go back to the source material — a
 * distillation that drops the original is worse than no distillation.
 */
function buildTemplate(messages: UiMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')?.content ?? '';
  const snippet = (firstUser.split('\n')[0] ?? '').slice(0, 80) || 'Saved conversation';

  const transcript = messages
    .filter((m) => (m.content ?? '').trim().length > 0)
    .map((m) => {
      const who = m.role === 'user' ? '## User' : '## Assistant';
      return `${who}\n\n${m.content.trim()}`;
    })
    .join('\n\n');

  return `---
name: ${escapeYaml(snippet)}
description: ${escapeYaml(snippet)}
triggers: []
required_inputs: []
---

${transcript || '_Empty conversation — add a description above._'}
`;
}

/** Cheap YAML-string escape for a single-line value. We quote if the
 *  string contains a YAML meta character; otherwise leave it alone
 *  for readability. */
function escapeYaml(s: string): string {
  if (/[:#\-&*!|>'"%@`]/.test(s) || s.includes('\n')) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

/** Derive a starter slug from the first user message. Used as the
 *  default name field value. Empty when the session has no user
 *  messages yet — the Save button is gated separately. */
function deriveSlug(messages: UiMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')?.content ?? '';
  return sanitizeSlug((firstUser.split('\n')[0] ?? '').slice(0, 40));
}

/** Some models wrap SKILL.md output in ``` fences despite the system
 *  prompt asking otherwise. Strip a single leading / trailing fence
 *  (with or without a language tag) so the textarea gets the raw
 *  Markdown. If the fencing is malformed, just return the original —
 *  the user can clean it up manually. */
function stripCodeFences(s: string): string {
  const lines = s.split('\n');
  if (lines.length < 2) return s;
  const firstFence = /^```(\w+)?\s*$/;
  const lastFence = /^```\s*$/;
  if (firstFence.test(lines[0]!.trim()) && lastFence.test(lines[lines.length - 1]!.trim())) {
    return lines.slice(1, -1).join('\n');
  }
  return s;
}

/** Normalise a free-form name to a filesystem-safe slug:
 *  lowercase ASCII alphanumerics + dashes. Collapses runs of
 *  separators and trims leading/trailing dashes. Matches the
 *  convention used by `~/.hermes/skills/` upstream. */
function sanitizeSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
