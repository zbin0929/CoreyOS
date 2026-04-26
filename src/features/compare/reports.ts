import type { Lane } from './types';

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function renderMarkdownReport(prompt: string, lanes: Lane[]): string {
  const header = `# Compare run\n\n**Prompt**\n\n> ${prompt.replace(/\n/g, '\n> ')}\n`;
  const body = lanes
    .map((l) => {
      const title = `## ${l.model.display_name ?? l.model.id} (${l.model.provider})`;
      if (l.state.kind === 'done') {
        const elapsed = l.state.finishedAt - l.state.startedAt;
        const tokens =
          (l.state.summary.prompt_tokens ?? 0) + (l.state.summary.completion_tokens ?? 0);
        return `${title}\n\n- latency: ${formatMs(elapsed)}\n- tokens: ${tokens}\n- finish_reason: ${
          l.state.summary.finish_reason ?? 'n/a'
        }\n\n${l.state.content}\n`;
      }
      if (l.state.kind === 'error') {
        return `${title}\n\n> **error**: ${l.state.message}\n\n${l.state.content}\n`;
      }
      if (l.state.kind === 'cancelled') return `${title}\n\n> cancelled\n\n${l.state.content}\n`;
      return `${title}\n\n> (no output)\n`;
    })
    .join('\n');
  return `${header}\n${body}`;
}

export function toJsonReport(prompt: string, lanes: Lane[]) {
  return {
    prompt,
    ran_at: new Date().toISOString(),
    lanes: lanes.map((l) => ({
      model: l.model.id,
      provider: l.model.provider,
      display_name: l.model.display_name,
      state: l.state.kind,
      content:
        l.state.kind === 'done' ||
        l.state.kind === 'streaming' ||
        l.state.kind === 'cancelled' ||
        l.state.kind === 'error'
          ? l.state.content
          : '',
      summary: l.state.kind === 'done' ? l.state.summary : null,
      elapsed_ms:
        l.state.kind === 'done'
          ? l.state.finishedAt - l.state.startedAt
          : null,
      error: l.state.kind === 'error' ? l.state.message : null,
    })),
  };
}

export function downloadBlob(data: string, filename: string, mime: string) {
  const blob = new Blob([data], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke; some browsers need a tick to actually fire the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
