import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/app/shell/PageHeader';
import { InfoHint } from '@/components/ui/info-hint';
import {
  appPaths,
  type AppPaths,
} from '@/lib/ipc';

import { AppearanceSection } from './AppearanceSection';
import { HermesInstancesSection } from './HermesInstancesSection';
import { BrowserLLMSection } from './sections/BrowserLLMSection';
import { ContextSection } from './sections/ContextSection';
import { CustomerSection } from './sections/CustomerSection';
import { PacksSection } from './sections/PacksSection';
import { LicenseSection } from './sections/LicenseSection';
import { MemorySection } from './sections/MemorySection';
import { RoutingRulesSection } from './sections/RoutingRulesSection';
import { HermesToolPermissionsSection } from './sections/HermesToolPermissionsSection';
import { HermesUpdateSection } from './sections/HermesUpdateSection';
import { SandboxScopesSection } from './sections/SandboxScopesSection';
import { StorageSection } from './sections/StorageSection';
import { WorkspaceSection } from './sections/WorkspaceSection';

// Re-exported here so the rest of the app's imports
// (`features/agents` etc.) keep resolving without churn.
export { HermesInstancesSection };

const SETTINGS_ANCHORS = [
  { id: 'settings-appearance', labelKey: 'settings.appearance.title' },
  { id: 'settings-context', labelKey: 'settings.context.title' },
  { id: 'settings-memory', labelKey: 'settings.memory.title' },
  { id: 'settings-routing', labelKey: 'settings.routing_rules.title' },
  { id: 'settings-sandbox', labelKey: 'settings.sandbox.title' },
  { id: 'settings-scopes', labelKey: 'settings.sandbox_scopes.title' },
  { id: 'settings-hermes-tools', labelKey: 'settings.hermes_security.title' },
  { id: 'settings-customer', labelKey: 'settings.customer.title' },
  { id: 'settings-packs', labelKey: 'settings.packs.title' },
  { id: 'settings-storage', labelKey: 'settings.storage.title' },
] as const;

export function SettingsRoute() {
  const { t } = useTranslation();

  const [paths, setPaths] = useState<AppPaths | null>(null);

  useEffect(() => {
    let alive = true;
    appPaths()
      .then((p) => {
        if (alive) setPaths(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
        actions={
          <InfoHint
            title={t('settings.title')}
            content={t('settings.help_page')}
            testId="settings-help"
          />
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto" id="settings-scroll-container">
        <nav className="sticky top-0 z-10 border-b border-border bg-bg/95 backdrop-blur-sm">
          <div className="mx-auto w-full max-w-5xl px-6 py-2.5">
            <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-bg-elev-1/80 p-1 shadow-[var(--shadow-1)]">
            {SETTINGS_ANCHORS.map((a) => (
              <a
                key={a.id}
                href={`#${a.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  const el = document.getElementById(a.id);
                  const container = document.getElementById('settings-scroll-container');
                  if (el && container) {
                    let offset = 0;
                    let node: HTMLElement | null = el;
                    while (node && node !== container) {
                      offset += node.offsetTop;
                      node = node.offsetParent as HTMLElement | null;
                    }
                    container.scrollTo({ top: offset - 48, behavior: 'smooth' });
                  }
                }}
                className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-elev-2 hover:text-fg"
              >
                {t(a.labelKey)}
              </a>
            ))}
            </div>
          </div>
        </nav>
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
          {/* Appearance is independent of gateway config — render first and
              always, even while the gateway config is still loading. */}
          <AppearanceSection />

          {/* v9 — Auto-context-compression knobs. Lives between gateway
              and routing because it's a Hermes-config concern (same
              YAML file as the model section) and the next thing a
              user wants to tune after picking a model is "how does the
              context get managed". */}
          <ContextSection />

          {/* v9 — Memory provider status + USER.md editor. Sits next to
              ContextSection because they're conceptually a pair: one
              shrinks the active context, the other persists the
              long-term memory across sessions. Both are powered by
              Hermes infrastructure that Corey doesn't own. */}
          <MemorySection />

          {/* T6.4 — routing rules. Sits next to Hermes instances since
              routing most commonly picks between them. */}
          <RoutingRulesSection />

          {/* Sandbox workspace roots — lives between gateway and storage so
              the control-plane order roughly matches "what agents can reach". */}
          <WorkspaceSection />

          {/* T6.5 — named sandbox scopes. Sits directly under the
              default-scope workspace section so users see the "global
              roots" and "named scopes" as adjacent affordances. */}
          <SandboxScopesSection />

          {/* The OTHER half of the permission story: Hermes' own
              command-pattern + approval gate. Lives next to the
              path-based sandbox so users see "Corey path policy"
              and "Hermes command policy" as siblings, not as one
              vs the other. Killed the "I locked sandbox but Hermes
              still ran ls ~/Desktop" confusion the v9 audit logged. */}
          <HermesToolPermissionsSection />

          <CustomerSection hermesDataDir={paths?.hermes_data_dir} />

          <PacksSection />

          <HermesUpdateSection />

          <BrowserLLMSection />

          {/* Read-only storage info. Lives below the gateway form — it's the
              least-frequently-needed section but important for backup /
              debugging. Hides itself if the IPC fails. */}
          {paths && <StorageSection paths={paths} onPathsChange={setPaths} />}

          {/* License management — visible only when there's a real
              activated key. Lets users see who the license belongs
              to + remove it (re-shows the gate on next launch). */}
          <LicenseSection />
        </div>
      </div>
    </div>
  );
}

