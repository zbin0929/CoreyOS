import type { Meta, StoryObj } from '@storybook/react';

import type { LlmProfile } from '@/lib/ipc';

import { SourcePickerStep } from './AgentWizardSourceStep';

/**
 * Step 1 of the Agent Wizard. The component is props-only —
 * `profiles` drives whether the "use an existing LLM" cluster
 * appears above the provider template grid. Stories below cover
 * the three branches actually reachable in the UI: no saved
 * profiles, one profile, and many profiles (where the
 * `sm:grid-cols-2` wrap kicks in).
 */
const meta: Meta<typeof SourcePickerStep> = {
  title: 'Features/Settings/AgentWizard/SourcePickerStep',
  component: SourcePickerStep,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-[720px] rounded-lg border border-border bg-bg-elev-1">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof SourcePickerStep>;

const noop = () => {};

const profileGpt: LlmProfile = {
  id: 'gpt-4o',
  label: 'GPT-4o',
  provider: 'openai',
  base_url: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  api_key_env: 'OPENAI_API_KEY',
  vision: true,
};

const profileClaude: LlmProfile = {
  id: 'claude',
  label: 'Claude 3.5 Sonnet',
  provider: 'anthropic',
  base_url: 'https://api.anthropic.com/v1',
  model: 'claude-3-5-sonnet-latest',
  api_key_env: 'ANTHROPIC_API_KEY',
  vision: true,
};

const profileDeepSeek: LlmProfile = {
  id: 'deepseek-r1',
  label: 'DeepSeek R1',
  provider: 'deepseek',
  base_url: 'https://api.deepseek.com/v1',
  model: 'deepseek-reasoner',
  api_key_env: 'DEEPSEEK_API_KEY',
  vision: false,
};

export const NoProfiles: Story = {
  args: { profiles: [], onPickProfile: noop, onPickTemplate: noop },
};

export const OneProfile: Story = {
  args: { profiles: [profileGpt], onPickProfile: noop, onPickTemplate: noop },
};

export const ManyProfiles: Story = {
  args: {
    profiles: [profileGpt, profileClaude, profileDeepSeek],
    onPickProfile: noop,
    onPickTemplate: noop,
  },
};
