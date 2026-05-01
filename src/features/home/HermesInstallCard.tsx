import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Play,
  RefreshCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  hermesDetect,
  hermesGatewayStart,
  hermesInstall,
  hermesInstallPreflight,
  ipcErrorMessage,
  type HermesDetection,
  type HermesInstallPreflight,
} from '@/lib/ipc';
import { useAppStatusStore } from '@/stores/appStatus';

/**
 * First-run "is Hermes set up?" card on Home.
 *
 * Three states mapped cleanly onto three CTAs:
 *
 *   1. **Binary not found**       → install instructions + copy-to-clipboard
 *                                   command + "I've installed it" re-check.
 *   2. **Installed, gateway off** → one-click "Start gateway" that shells
 *                                   `hermes gateway start`.
 *   3. **All good**               → compact confirmation with version +
 *                                   path; this is the "you're set" state.
 *
 * The old Home Step 1 showed nothing actionable for state (1) beyond a
 * docs link. With a packaged distribution, users who've never touched a
 * CLI before are going to land on state (1) the most — this card turns
 * it into two clicks: install, re-check.
 */
export function HermesInstallCard() {
  const { t } = useTranslation();
  const gateway = useAppStatusStore((s) => s.gateway);
  const refreshGateway = useAppStatusStore((s) => s.refreshGateway);
  const [detection, setDetection] = useState<HermesDetection | null>(null);
  const [checking, setChecking] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const probe = async () => {
    setChecking(true);
    try {
      const result = await hermesDetect();
      setDetection(result);
    } catch (e) {
      // Detection failure shouldn't block the rest of the UI — if the
      // IPC itself errors, treat it as "not installed" + surface the
      // detail in the console.
      console.warn('hermes_detect failed:', ipcErrorMessage(e));
      setDetection({
        installed: false,
        broken: false,
        path: null,
        version: null,
        version_parsed: null,
        compatibility: 'unknown',
        compatibility_detail: 'detection failed',
      });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void probe();
  }, []);

  // Once the gateway flips online, also re-probe version — useful after
  // the user runs "Start gateway" and Hermes reports its version fully.
  useEffect(() => {
    if (gateway === 'online' && detection?.installed && !detection.version) {
      void probe();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway]);

  // Full-happy-path collapse. Two triggers render nothing:
  //   1. Gateway reports online — by definition Hermes is installed
  //      and healthy; no second confirmation card needed. We short-
  //      circuit even if the local `hermes_detect` probe is still in
  //      flight (macOS Spotlight / slow disks occasionally take a few
  //      seconds). Without this branch the user sees a persistent
  //      spinner on Home right above a green "Hermes 网关在线" chip,
  //      which is the exact UX bug reported on 2026-04-27.
  //   2. Probe is done and says installed (but gateway is offline) —
  //      covered by the GatewayOfflineCard render below.
  //
  // Exception: a `untested` / `too_old` Hermes still warrants a
  // visible banner even when the gateway is online — the banner
  // protects FUTURE writes (config-yaml schema drift), not current
  // connectivity, so suppressing it on green = silent breakage.
  if (
    gateway === 'online' &&
    (!detection ||
      detection.compatibility === 'supported' ||
      detection.compatibility === 'unknown')
  ) {
    return <NextStepsCard />;
  }
  if (
    gateway === 'online' &&
    detection &&
    (detection.compatibility === 'untested' || detection.compatibility === 'too_old')
  ) {
    return <CompatibilityBanner detection={detection} />;
  }
  if (detection?.installed) {
    // fall through — render the offline-gateway card below
  } else if (checking && !detection) {
    // Only show the inline loading state when gateway is NOT yet
    // online. Prevents the "stuck at 加载中" look on fresh launches
    // where gateway is 'unknown' for a beat before the first health
    // probe completes.
    return (
      <section className="flex items-center gap-3 rounded-lg border border-border bg-bg-elev-1/60 p-4">
        <Icon icon={Loader2} size="sm" className="animate-spin text-fg-subtle" />
        <span className="text-xs text-fg-subtle">{t('common.loading')}</span>
      </section>
    );
  }

  if (!detection?.installed) {
    return <NotInstalledCard onRecheck={probe} copied={copied} setCopied={setCopied} />;
  }

  if (detection.broken) {
    return <BrokenInstallCard detection={detection} onRecheck={probe} />;
  }

  // Installed but gateway offline → offer the one-click start.
  return (
    <GatewayOfflineCard
      detection={detection}
      starting={starting}
      startError={startError}
      onStart={async () => {
        setStarting(true);
        setStartError(null);
        try {
          await hermesGatewayStart();
          // Give Hermes a beat to bind its port before we re-probe.
          await new Promise((r) => setTimeout(r, 500));
          await refreshGateway();
        } catch (e) {
          setStartError(ipcErrorMessage(e));
        } finally {
          setStarting(false);
        }
      }}
      onRecheck={async () => {
        await refreshGateway();
        await probe();
      }}
    />
  );
}

// ───────────────────────── State 1: not installed ─────────────────────────

function NotInstalledCard({
  onRecheck,
  copied,
  setCopied,
}: {
  onRecheck: () => Promise<void>;
  copied: boolean;
  setCopied: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const cmd = installCommandForPlatform();
  const [preflight, setPreflight] = useState<HermesInstallPreflight | null>(null);
  const [preflightChecking, setPreflightChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installMessage, setInstallMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreflightChecking(true);
    hermesInstallPreflight()
      .then((r) => {
        if (!cancelled) setPreflight(r);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPreflightChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can fail under some Tauri configurations; fall
      // through quietly — the command is also shown in the code block.
    }
  }

  async function handleInstall() {
    setInstalling(true);
    setInstallError(null);
    try {
      const msg = await hermesInstall();
      setInstallError(null);
      setInstallMessage(msg || 'Bootstrap started');
      await onRecheck();
    } catch (e) {
      setInstallError(ipcErrorMessage(e));
    } finally {
      setInstalling(false);
    }
  }

  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-danger/40 bg-danger/5 p-4',
      )}
      data-testid="home-hermes-install-card"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-danger/40 bg-danger/10 text-danger">
          <Icon icon={AlertTriangle} size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg">
            {t('home.install_title')}
          </h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            {t('home.install_desc')}
          </p>
        </div>
      </div>

      {/* Pre-flight status: tells the user whether their machine
          even has the prerequisites for the install command below.
          Three states:
            - loading: light-grey "checking…"
            - ready (Python 3.11+ + pip): green "ready to install"
            - missing something: amber + actionable hint
          Surfacing this before the copy block prevents the most
          common "I copy-pasted and it broke" support thread. */}
      {(preflightChecking || preflight) && (
        <div
          className={cn(
            'rounded-md border px-3 py-2 text-xs',
            preflightChecking
              ? 'border-border bg-bg-elev-2/50 text-fg-subtle'
              : preflight && preflight.python_ok && preflight.pip_ok
                ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'
                : 'border-amber-500/40 bg-amber-500/5 text-fg-muted',
          )}
          data-testid="home-hermes-preflight"
        >
          {preflightChecking
            ? t('home.preflight_checking', { defaultValue: '正在检查 Python / pip…' })
            : preflight?.summary}
        </div>
      )}

      {/* Copy-paste command block — the primary affordance. */}
      <div className="flex items-stretch gap-2 rounded-md border border-border bg-bg font-mono text-xs">
        <code className="flex-1 overflow-x-auto px-3 py-2 text-fg">
          {cmd}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1 border-l border-border px-2 text-fg-muted hover:bg-bg-elev-2 hover:text-fg"
          title={t('home.install_copy')}
          data-testid="home-hermes-install-copy"
        >
          <Icon icon={copied ? Check : Copy} size="xs" />
          <span className="text-[10px]">
            {copied ? t('home.install_copied') : t('home.install_copy')}
          </span>
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        {/* Used to point at hermes-agent.nousresearch.com/docs/quickstart
            — that domain returns 404, so we now route to the in-app
            user manual instead. The "Hermes 安装" section there mirrors
            what the upstream quickstart used to cover (Linux/macOS curl
            + Windows installer + verification commands), and works
            offline. Keeps the affordance discoverable without depending
            on an upstream URL we don't control. */}
        <Link
          to="/help"
          hash="安装-hermes-必需"
          className="inline-flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg"
        >
          <Icon icon={ExternalLink} size="xs" />
          {t('home.install_docs')}
        </Link>
        <div className="flex items-center gap-2">
          {installError && (
            <span className="text-[10px] text-danger">{installError}</span>
          )}
          {installMessage && !installError && (
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400">{installMessage}</span>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void onRecheck()}
            data-testid="home-hermes-recheck"
          >
            <Icon icon={RefreshCcw} size="xs" />
            {t('home.install_recheck')}
          </Button>
          <Button
            size="sm"
            onClick={() => void handleInstall()}
            disabled={installing}
            data-testid="home-hermes-install-now"
          >
            {installing ? (
              <Icon icon={Loader2} size="xs" className="animate-spin" />
            ) : (
              <Icon icon={Play} size="xs" />
            )}
            {t('home.install_now', { defaultValue: '一键安装' })}
          </Button>
        </div>
      </div>
    </section>
  );
}

// ───────────────────────── State 1.5: broken install ────────────────────────

function BrokenInstallCard({
  detection,
  onRecheck,
}: {
  detection: HermesDetection;
  onRecheck: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const fixCommand =
    typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('win')
      ? 'pip install --upgrade hermes-agent'
      : 'pip install --upgrade hermes-agent';

  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-danger/40 bg-danger/5 p-4',
      )}
      data-testid="home-hermes-broken"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-danger/40 bg-danger/10 text-danger">
          <Icon icon={AlertTriangle} size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg">
            {t('home.broken_title', { defaultValue: 'Hermes 安装损坏' })}
          </h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            {t('home.broken_desc', {
              defaultValue:
                '找到了 Hermes 二进制，但无法运行（模块缺失或 Python 环境不匹配）。请重新安装：',
            })}
          </p>
          {detection.path && (
            <code className="mt-1 block truncate text-[10px] text-fg-subtle">
              {detection.path}
            </code>
          )}
        </div>
      </div>

      <div className="rounded border border-border bg-bg-elev-1 p-2">
        <code className="block text-xs text-fg">{fixCommand}</code>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            navigator.clipboard.writeText(fixCommand).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          <Icon icon={copied ? Check : Copy} size="xs" />
          {copied
            ? t('home.install_copied')
            : t('home.install_copy')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void onRecheck()}
        >
          <Icon icon={RefreshCcw} size="xs" />
          {t('home.install_recheck')}
        </Button>
      </div>
    </section>
  );
}

// ───────────────────────── State 2: gateway offline ─────────────────────────

function GatewayOfflineCard({
  detection,
  starting,
  startError,
  onStart,
  onRecheck,
}: {
  detection: HermesDetection;
  starting: boolean;
  startError: string | null;
  onStart: () => Promise<void>;
  onRecheck: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4',
      )}
      data-testid="home-hermes-start-card"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-500">
          <Icon icon={Play} size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg">
            {t('home.start_title')}
          </h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            {t('home.start_desc')}
          </p>
          {detection.version && (
            <code className="mt-1 block truncate text-[10px] text-fg-subtle">
              {detection.version}
            </code>
          )}
        </div>
      </div>

      {startError && (
        <div
          className="rounded border border-danger/40 bg-danger/10 p-2 text-xs text-danger"
          data-testid="home-hermes-start-error"
        >
          {startError}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void onRecheck()}
          disabled={starting}
        >
          <Icon icon={RefreshCcw} size="xs" />
          {t('home.install_recheck')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => void onStart()}
          disabled={starting}
          data-testid="home-hermes-start"
        >
          {starting ? (
            <>
              <Icon icon={Loader2} size="xs" className="animate-spin" />
              {t('home.start_starting')}
            </>
          ) : (
            <>
              <Icon icon={Play} size="xs" />
              {t('home.start_now')}
            </>
          )}
        </Button>
      </div>
    </section>
  );
}

// ───────────────────────── Platform detection ─────────────────────────

/**
 * Best-guess install command for the current platform. Users can
 * always ignore it and follow the docs — the block is purely a
 * convenience.
 */
function installCommandForPlatform(): string {
  if (typeof navigator === 'undefined') {
    return 'pip install hermes-agent';
  }
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'brew install nousresearch/hermes/hermes-agent';
  if (ua.includes('win')) return 'pip install hermes-agent';
  return 'pip install hermes-agent';
}

/**
 * Banner shown on Home when the running Hermes is outside the
 * version range Corey was tested against.
 *
 * Two distinct shapes:
 *   - `untested` (Hermes too NEW): yellow. Most things still work
 *     but config-yaml writes might hit unknown schema. Recommend
 *     updating Corey or pinning Hermes back.
 *   - `too_old` (Hermes too OLD): red. Memory store / auto-compress
 *     features need ≥ MIN_SUPPORTED. Recommend `hermes self-update`.
 *
 * Both copy the verbatim `compatibility_detail` from the backend
 * (English; the wrapping headline is localized). Click-through link
 * jumps to the Hermes upgrade docs.
 */
function CompatibilityBanner({ detection }: { detection: HermesDetection }) {
  const { t } = useTranslation();
  const isTooOld = detection.compatibility === 'too_old';
  return (
    <section
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-4',
        isTooOld
          ? 'border-danger/40 bg-danger/5'
          : 'border-amber-500/40 bg-amber-500/5',
      )}
      data-testid={isTooOld ? 'home-hermes-too-old' : 'home-hermes-untested'}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex h-9 w-9 flex-none items-center justify-center rounded-full border',
            isTooOld
              ? 'border-danger/40 bg-danger/10 text-danger'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-500',
          )}
        >
          <Icon icon={AlertTriangle} size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg">
            {isTooOld
              ? t('home.hermes_too_old_title', { defaultValue: 'Hermes 版本过旧' })
              : t('home.hermes_untested_title', { defaultValue: 'Hermes 版本未经测试' })}
          </h3>
          <p className="mt-0.5 text-xs text-fg-muted break-words">
            {detection.compatibility_detail}
          </p>
          {detection.version && (
            <code className="mt-1 block truncate text-[10px] text-fg-subtle">
              {detection.version}
            </code>
          )}
        </div>
      </div>
    </section>
  );
}

function NextStepsCard() {
  const { t } = useTranslation();
  const steps = [
    { label: t('home.next_skills', { defaultValue: '配置 Skills' }), to: '/skills' as const },
    { label: t('home.next_mcp', { defaultValue: '配置 MCP' }), to: '/mcp' as const },
    { label: t('home.next_channel', { defaultValue: '连接通道' }), to: '/channels' as const },
  ];
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4"
      data-testid="home-next-steps"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-500">
          <Icon icon={Check} size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg">
            {t('home.next_title', { defaultValue: 'Hermes 网关已启动' })}
          </h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            {t('home.next_desc', { defaultValue: '接下来配置你的 AI 助手能力：' })}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-bg-elev-2 px-3 py-1.5 text-xs text-fg transition hover:border-gold-500/40 hover:text-gold-500"
          >
            {s.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
