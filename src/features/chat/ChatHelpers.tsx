import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { useChatStore, type UiMessage } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useRoutingStore } from '@/stores/routing';
import { resolveRoutedRule } from './routing';
import { ExportSessionMenu } from './ExportSessionMenu';
import { SaveAsSkillDrawer } from './SaveAsSkillDrawer';

export function ChatHeaderActions({
  sessionId,
  messages,
}: {
  sessionId: string;
  messages: UiMessage[];
}) {
  const title = useChatStore(
    (s) => s.sessions[sessionId]?.title ?? 'chat',
  );
  return (
    <div className="flex items-center gap-2">
      <ExportSessionMenu title={title} messages={messages} />
      <SaveAsSkillHeaderAction messages={messages} />
    </div>
  );
}

function SaveAsSkillHeaderAction({ messages }: { messages: UiMessage[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const canSave = messages.some(
    (m) => m.role === 'assistant' && !m.pending && !m.error && m.content.length > 0,
  );
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        disabled={!canSave}
        title={canSave ? undefined : t('chat.save_as_skill.disabled_hint')}
        data-testid="chat-save-as-skill"
      >
        <Icon icon={Wand2} size="sm" />
        {t('chat.save_as_skill.button')}
      </Button>
      <SaveAsSkillDrawer
        open={open}
        onClose={() => setOpen(false)}
        messages={messages}
      />
    </>
  );
}

export function EmptyHero({ onPick }: { onPick: (prompt: string) => void }) {
  const { t } = useTranslation();
  const suggestions = [
    t('chat_page.hero_suggestion_1'),
    t('chat_page.hero_suggestion_2'),
    t('chat_page.hero_suggestion_3'),
  ];
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gold-500/10 text-gold-500">
        <Icon icon={Sparkles} size={24} />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">{t('chat_page.hero_title')}</h2>
        <p className="text-sm text-fg-muted">
          {t('chat_page.hero_subtitle_prefix')}
          <code className="font-mono text-xs">:8642</code>
          {t('chat_page.hero_subtitle_suffix')}
        </p>
      </div>
      <div className="grid w-full max-w-xl gap-2 sm:grid-cols-1">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-xl border border-border bg-bg-elev-1 px-4 py-3 text-left text-sm text-fg transition hover:border-gold-500/40 hover:bg-gold-500/5"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export function RoutingHint({ draft }: { draft: string }) {
  const { t } = useTranslation();
  const rules = useRoutingStore((s) => s.rules);
  const adapters = useAgentsStore((s) => s.adapters);

  if (!rules || rules.length === 0) return null;
  const matched = resolveRoutedRule(rules, draft);
  if (!matched) return null;

  const registered = new Set(adapters?.map((a) => a.id) ?? []);
  const isRegistered = registered.has(matched.target_adapter_id);
  const adapterLabel =
    adapters?.find((a) => a.id === matched.target_adapter_id)?.name ??
    matched.target_adapter_id;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]',
        isRegistered
          ? 'border border-gold-500/30 bg-gold-500/10 text-gold-600'
          : 'border border-danger/30 bg-danger/5 text-danger',
      )}
      data-testid="chat-routing-hint"
      title={matched.name}
    >
      {isRegistered
        ? t('chat_page.routing_hint', { adapter: adapterLabel, rule: matched.name })
        : t('chat_page.routing_hint_missing', {
            adapter: matched.target_adapter_id,
            rule: matched.name,
          })}
    </span>
  );
}
