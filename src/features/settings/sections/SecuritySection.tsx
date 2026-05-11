import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  ipcErrorMessage,
  securityReconcile,
  securityStatusGet,
  type SecurityStatus,
} from '@/lib/ipc';

import { Section } from '../shared';

/**
 * Security Status card — visibility into the L3 hard-defence layer
 * (Corey guard script + Hermes pre_tool_call hook registration).
 *
 * Key insight baked in: **installed ≠ registered**. The guard can
 * sit on disk forever and do nothing if the Hermes config isn't
 * pointing at it. The 2026-05-11 incident was exactly that state.
 * The top-level badge reflects the worst-case situation of all
 * three independent conditions:
 *
 *   - script exists → else CRIT (we have no guard at all)
 *   - hook registered in config.yaml → else CRIT (guard is dormant)
 *   - hooks_auto_accept: true → else WARN (works in TTY, breaks
 *     on cron / WhatsApp / Slack because Hermes waits for TTY
 *     prompt on first fire)
 *   - guard log has fires in recent tail → else WARN (either guard
 *     has never run or we're in a fresh install; user should
 *     test with a benign destructive op)
 */

const ISSUE_COPY: Record<string, string> = {
  hermes_dir_unresolved:
    'Hermes 数据目录无法定位。Corey 无法安装或验证 guard。',
  guard_script_missing:
    'Guard 脚本不存在。点"立即修复"会从 Corey 包里重新拷贝。',
  guard_hook_unregistered:
    'Guard 已安装但没注册到 Hermes。这意味着 guard **不会运行**——任何破坏性操作都没有硬拦截。',
  hooks_auto_accept_false:
    'hooks_auto_accept=false 会让 Hermes 等 TTY 确认。在 cron / WhatsApp / Slack 等非交互渠道上会死锁。',
  guard_never_fired:
    'Guard 已注册但日志里没有运行记录。可能是刚装好没用过，也可能是 Hermes 没重启。',
};

function BadgeRow({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean | null;
}) {
  const colour =
    ok === null
      ? 'text-fg-muted'
      : ok
        ? 'text-emerald-500'
        : 'text-rose-500';
  return (
    <div className="flex items-center justify-between py-1 text-xs">
      <span className="text-fg-subtle">{label}</span>
      <span className={`font-mono ${colour}`}>
        {ok === null ? '—' : ok ? '✓' : '✗'} {value}
      </span>
    </div>
  );
}

function OverallBadge({ level }: { level: SecurityStatus['overall'] }) {
  if (level === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <ShieldCheck className="h-3 w-3" />
        OK · 双层防御就绪
      </span>
    );
  }
  if (level === 'warn') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-3 w-3" />
        WARN · 部分渠道可能失效
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
      <ShieldAlert className="h-3 w-3" />
      CRIT · 破坏性操作无硬拦截
    </span>
  );
}

export function SecuritySection() {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const s = await securityStatusGet();
      setStatus(s);
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onFixNow = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await securityReconcile();
      setStatus(s);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return (
    <Section
      id="security"
      title={
        <span className="flex items-center gap-2">
          <ShieldAlert className="h-3.5 w-3.5" />
          安全防护 · Corey Guard
        </span>
      }
      description="Hermes Agent 执行工具前的硬拦截层。guard 物理拦截针对桌面 / 文档 / 下载夹 / 系统路径的破坏性操作，即使 LLM 决定绕过铁律也动不了手。"
    >
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {!status && !error && (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          正在读取防护状态…
        </div>
      )}

      {status && (
        <>
          <div className="flex items-center justify-between">
            <OverallBadge level={status.overall} />
            <Button
              variant="secondary"
              size="sm"
              onClick={onFixNow}
              disabled={busy}
              className="h-7 gap-1 text-xs"
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {status.overall === 'ok' ? '重新检查' : '立即修复'}
            </Button>
          </div>

          <div className="rounded-lg border border-border bg-bg-elev-0 p-3">
            <BadgeRow
              label="Guard 脚本已安装"
              value={status.guardScriptInstalled ? '在' : '缺失'}
              ok={status.guardScriptInstalled}
            />
            <BadgeRow
              label="hook 已注册到 config.yaml"
              value={status.guardHookRegistered ? '已注册' : '未注册 — guard 不会运行'}
              ok={status.guardHookRegistered}
            />
            <BadgeRow
              label="hooks_auto_accept"
              value={status.hooksAutoAccept ? 'true' : 'false — 非交互渠道会死锁'}
              ok={status.hooksAutoAccept}
            />
            <BadgeRow
              label="最近 guard 运行次数 (tail 2000 行)"
              value={`FIRED ${status.recentFires} / BLOCK ${status.recentBlocks}`}
              ok={status.recentFires > 0 ? true : null}
            />
            {status.guardScriptPath && (
              <div className="mt-2 flex items-center justify-between pt-2 text-[10px] text-fg-subtle">
                <span>脚本路径</span>
                <code className="truncate font-mono text-[10px]">{status.guardScriptPath}</code>
              </div>
            )}
          </div>

          {status.issues.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-xs font-medium text-fg">待修复</div>
              <ul className="flex flex-col gap-1 text-xs text-fg-muted">
                {status.issues.map((issue) => (
                  <li key={issue} className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-2">
                    <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                    <span>{ISSUE_COPY[issue] ?? issue}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {status.issues.length === 0 && status.overall === 'ok' && (
            <div className="flex items-start gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <span>
                双层防御就绪。破坏性操作（删 / 改 / 移 / 部署等）会通过 guard
                硬拦截 + 铁律软约束双重审查，所有渠道（UI / WhatsApp /
                cron / Slack）都生效。
              </span>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
