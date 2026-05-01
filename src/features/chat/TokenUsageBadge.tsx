import { useChatStore } from '@/stores/chat';

export function TokenUsageBadge() {
  const usage = useChatStore((s) => s.lastTokenUsage);
  if (!usage) return null;
  const total = usage.prompt + usage.completion;
  return (
    <span className="font-mono text-[10px] text-fg-subtle" data-testid="token-usage">
      输入 {usage.prompt.toLocaleString()} · 输出 {usage.completion.toLocaleString()} · 共 {total.toLocaleString()} tokens
    </span>
  );
}
