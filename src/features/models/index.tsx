import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Star } from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  configGet,
  configSet,
  ipcErrorMessage,
  modelList,
  type GatewayConfigDto,
  type ModelInfo,
} from '@/lib/ipc';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; models: ModelInfo[]; config: GatewayConfigDto }
  | { kind: 'error'; message: string };

export function ModelsRoute() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [settingDefault, setSettingDefault] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const [models, config] = await Promise.all([modelList(), configGet()]);
      setState({ kind: 'loaded', models, config });
    } catch (e) {
      setState({ kind: 'error', message: ipcErrorMessage(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setDefault(modelId: string) {
    if (state.kind !== 'loaded' || settingDefault) return;
    setSettingDefault(modelId);
    try {
      const next: GatewayConfigDto = { ...state.config, default_model: modelId };
      await configSet(next);
      // Reload both — the adapter has been rebuilt with the new default_model,
      // which changes which row the `is_default` flag applies to.
      await load();
    } catch (e) {
      setState({ kind: 'error', message: ipcErrorMessage(e) });
    } finally {
      setSettingDefault(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Language models"
        subtitle="LLMs the Hermes agent can use as its brain · from the gateway's /v1/models"
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={load}
            disabled={state.kind === 'loading'}
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', state.kind === 'loading' && 'animate-spin')}
            />
            Refresh
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-6 py-6">
          {state.kind === 'loading' && (
            <div className="flex items-center gap-2 text-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Fetching models…
            </div>
          )}

          {state.kind === 'error' && (
            <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
              <div className="flex-1">
                <div className="font-medium">Unable to load models</div>
                <div className="mt-1 break-all text-xs opacity-80">{state.message}</div>
                <Button
                  className="mt-3"
                  size="sm"
                  variant="secondary"
                  onClick={load}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Try again
                </Button>
              </div>
            </div>
          )}

          {state.kind === 'loaded' && (
            <ModelTable
              models={state.models}
              settingDefault={settingDefault}
              onSetDefault={setDefault}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ModelTable({
  models,
  settingDefault,
  onSetDefault,
}: {
  models: ModelInfo[];
  settingDefault: string | null;
  onSetDefault: (id: string) => void;
}) {
  if (models.length === 0) {
    return (
      <div className="rounded-md border border-border bg-bg-elev-1 p-6 text-center text-sm text-fg-muted">
        The gateway returned no models. Check that your provider credentials are
        configured in <code className="font-mono text-xs">~/.hermes/.env</code>.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-bg-elev-1">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-bg-elev-2 text-xs uppercase tracking-wider text-fg-muted">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Model</th>
            <th className="px-4 py-2 text-left font-medium">Provider</th>
            <th className="px-4 py-2 text-left font-medium">Context</th>
            <th className="px-4 py-2 text-right font-medium">&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr
              key={m.id}
              className={cn(
                'border-b border-border/50 transition last:border-0',
                m.is_default ? 'bg-gold-500/5' : 'hover:bg-bg-elev-2',
              )}
            >
              <td className="px-4 py-3 align-top">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-xs font-medium text-fg">
                      {m.id}
                    </code>
                    {m.is_default && (
                      <span
                        className="inline-flex items-center gap-1 rounded-sm bg-gold-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-gold-600"
                        title="Used when a chat doesn't specify a model"
                      >
                        <Star className="h-2.5 w-2.5" fill="currentColor" />
                        DEFAULT LLM
                      </span>
                    )}
                  </div>
                  {m.display_name && (
                    <span className="text-xs text-fg-muted">{m.display_name}</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 align-top text-xs text-fg-muted">
                {m.provider}
              </td>
              <td className="px-4 py-3 align-top text-xs text-fg-muted">
                {m.context_window ? formatTokens(m.context_window) : '—'}
              </td>
              <td className="px-4 py-3 align-top text-right">
                {m.is_default ? (
                  <span className="inline-flex items-center gap-1 text-xs text-fg-subtle">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Active
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onSetDefault(m.id)}
                    disabled={settingDefault !== null}
                    title="Use this LLM for new chats that don't override the model"
                  >
                    {settingDefault === m.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Star className="h-3 w-3" />
                    )}
                    Use as default
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}
