import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Drawer } from '@/components/ui/drawer';
import { llmProfileList, type HermesInstance, type LlmProfile } from '@/lib/ipc';

import { DetailsStep } from './AgentWizardDetailsStep';
import { SourcePickerStep } from './AgentWizardSourceStep';
import { PROVIDER_TEMPLATES, type ProviderTemplate } from './providerTemplates';

/**
 * Guided "Add Agent" wizard.
 *
 * A Hermes *agent* (= one `HermesInstance` row) is a named endpoint
 * Corey routes chats through. The raw form in `HermesInstancesSection`
 * expects users to know what to type for `base_url`, which env var the
 * provider's API key lives under, and which models the provider
 * exposes — none of which a non-engineer will know off the top of
 * their head.
 *
 * This wizard trades that power-user form for a two-step flow:
 *
 *   Step 1 — pick a provider template (or reuse an existing LlmProfile).
 *            Seeds `base_url`, `env_key`, and a shortlist of models
 *            from the template; or attaches to a profile and skips
 *            credentials/model entry entirely.
 *
 *   Step 2 — fill in the blanks. Just the API key (when needed) + a
 *            model pick. Model list is refreshed live via
 *            `modelProviderProbe` once the key is entered.
 *
 * Output: a freshly-created `HermesInstance` persisted via
 * `hermesInstanceUpsert`. On save the caller refreshes its list.
 *
 * Non-goals for this v1:
 *   - Sandbox scope picker (stays on the default).
 *   - Local-binary auto-install for Ollama / LM Studio — the wizard
 *     surfaces a link instead and trusts the user.
 *   - Editing existing rows — use the regular HermesInstanceRow for
 *     that; the wizard is strictly "add new".
 *
 * 2026-04-26 — extracted `SourcePickerStep` / `DetailsStep` /
 * `FieldCard` / `generateUniqueId` out of the original 727-line file.
 * The route below is the orchestrator: drawer wiring + step state +
 * profile pre-fetch.
 */
export function AgentWizard({
  open,
  onClose,
  onCreated,
  existingIds,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (next: HermesInstance) => void | Promise<void>;
  /** Ids already in use. The wizard's auto-generated id dodges them. */
  existingIds: string[];
}) {
  const { t } = useTranslation();
  const [template, setTemplate] = useState<ProviderTemplate | null>(null);
  const [preselectedProfile, setPreselectedProfile] = useState<LlmProfile | null>(
    null,
  );
  const [profiles, setProfiles] = useState<LlmProfile[]>([]);

  // Fetch profiles once per open so Step 1 can offer "reuse existing"
  // cards before falling back to the provider template grid.
  useEffect(() => {
    if (!open) return;
    setTemplate(null);
    setPreselectedProfile(null);
    llmProfileList()
      .then((r) => setProfiles(r.profiles))
      .catch(() => setProfiles([]));
  }, [open]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t('agent_wizard.title')}
      testId="agent-wizard"
    >
      {template ? (
        <DetailsStep
          template={template}
          initialSelectedProfile={preselectedProfile}
          existingIds={existingIds}
          onBack={() => {
            setTemplate(null);
            setPreselectedProfile(null);
          }}
          onCreated={async (inst) => {
            await onCreated(inst);
            onClose();
          }}
        />
      ) : (
        <SourcePickerStep
          profiles={profiles}
          onPickProfile={(profile) => {
            // Jump straight to DetailsStep with the matching provider
            // template pre-selected and this profile pre-attached.
            // The user lands on "just name it" mode — no API key /
            // model picker, because the profile owns those fields.
            const tpl =
              PROVIDER_TEMPLATES.find((p) => p.id === profile.provider) ??
              PROVIDER_TEMPLATES[0]!;
            setPreselectedProfile(profile);
            setTemplate(tpl);
          }}
          onPickTemplate={setTemplate}
        />
      )}
    </Drawer>
  );
}
