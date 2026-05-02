import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/app/shell/PageHeader';
import { InfoHint } from '@/components/ui/info-hint';
import { HermesInstancesSection } from '@/features/settings';

/**
 * T8 — the Agents page. Previously this lived inside Settings as the
 * "Extra Hermes instances" section, where new users almost never found
 * it. Promoting it to a top-level route parallels the LLMs page
 * (models list) and makes the agent/model split visible at the sidebar
 * level:
 *
 *   LLMs page   → manage model profiles (base_url + key + model id)
 *   Agents page → manage running instances, each referencing a profile
 *
 * Logic is intentionally a thin wrapper around the extracted
 * `HermesInstancesSection` — the real CRUD + wizard lives there so
 * the Settings ↔ Agents move is zero behaviour change.
 */
export function AgentsRoute() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('agents_page.title')}
        subtitle={t('agents_page.subtitle')}
        actions={
          <InfoHint
            title={t('agents_page.title')}
            content={t('agents_page.help_page')}
            testId="agents-help"
          />
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-6">
          <HermesInstancesSection />
        </div>
      </div>
    </div>
  );
}
