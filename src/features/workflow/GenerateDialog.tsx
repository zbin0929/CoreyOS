import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Icon } from '@/components/ui/icon';
import { ipcErrorMessage, workflowGenerate, type WorkflowDef } from '@/lib/ipc';

/**
 * "Generate from prompt" drawer for the Workflow page.
 *
 * The user pastes a free-form description, hits Generate, and the
 * default LLM authors a `WorkflowDef` we hand straight to the
 * editor. Errors (parse / validation) come back as the LLM-side
 * message, which is more actionable than a generic "AI failed"
 * toast — the message usually says exactly which schema field
 * tripped the parser, so the user knows what to clarify.
 *
 * Why a drawer (not an inline panel): the prompt is multi-line and
 * the result drops the user into the editor anyway, so we have
 * nowhere to show "before / after" alongside the list view. A
 * drawer keeps the surface focused and dismissible.
 */
export function WorkflowGenerateDialog({
  open,
  onClose,
  onGenerated,
}: {
  open: boolean;
  onClose: () => void;
  /** Called once the LLM returns a valid `WorkflowDef`. The page
   *  routes the user into the editor with this value pre-filled. */
  onGenerated: (def: WorkflowDef) => void;
}) {
  const { t, i18n } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    const trimmed = prompt.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // Pass the active UI locale so the LLM picks the right
      // language for the generated `name` / `description`. Steps
      // stay in the schema's English keys regardless.
      const locale = i18n.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
      const result = await workflowGenerate(trimmed, locale);
      onGenerated(result.workflow);
      // Reset for the next invocation. We don't auto-close here —
      // the parent drives the close after it switches modes, so
      // the user sees a clean state if they reopen.
      setPrompt('');
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      title={t('workflow_page.generate')}
      testId="workflow-generate-drawer"
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          <Icon icon={Sparkles} size="sm" className="text-gold-500" />
          {t('workflow_page.generate_dialog_title')}
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('workflow_page.generate_placeholder')}
          rows={8}
          className="resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
          data-testid="workflow-generate-prompt"
          autoFocus
          disabled={busy}
        />

        <p className="text-[11px] text-fg-subtle">
          {t('workflow_page.generate_hint')}
        </p>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2 text-xs text-danger"
            data-testid="workflow-generate-error"
          >
            <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
            <span className="break-all">{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClose}
            disabled={busy}
          >
            <Icon icon={X} size="sm" />
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="primary"
            onClick={() => void submit()}
            disabled={busy || prompt.trim().length === 0}
            data-testid="workflow-generate-submit"
          >
            {busy ? (
              <Icon icon={Loader2} size="sm" className="animate-spin" />
            ) : (
              <Icon icon={Sparkles} size="sm" />
            )}
            {busy
              ? t('workflow_page.generate_running')
              : t('workflow_page.generate_submit')}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
