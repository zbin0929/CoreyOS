import type { Meta, StoryObj } from '@storybook/react';

import type { LlmProfile } from '@/lib/ipc';

import { LlmProfileCard } from './LlmProfileCard';

/**
 * Visual cover for the per-profile grid card. Probe state is the
 * variant axis that's most likely to drift under token edits — we
 * snapshot all four (`undefined` / `probing` / `ok` / `err`).
 */
const meta: Meta<typeof LlmProfileCard> = {
  title: 'Features/Models/LlmProfileCard',
  component: LlmProfileCard,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof LlmProfileCard>;

const sampleProfile: LlmProfile = {
  id: 'gpt-4o',
  label: 'GPT-4o',
  provider: 'openai',
  base_url: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  api_key_env: 'OPENAI_API_KEY',
  vision: true,
};

const longLabelProfile: LlmProfile = {
  ...sampleProfile,
  id: 'deepseek-r1-distill',
  label: 'DeepSeek R1 Distill — long-thinking 32B (international tier)',
  provider: 'deepseek',
  model: 'deepseek-reasoner-r1-distill-llama-32b',
  base_url: 'https://api.deepseek.com/v1',
};

const noop = () => {};

export const Untested: Story = {
  args: { profile: sampleProfile, onOpen: noop, onTest: noop },
};

export const Probing: Story = {
  args: { profile: sampleProfile, probe: 'probing', onOpen: noop, onTest: noop },
};

export const Ok: Story = {
  args: { profile: sampleProfile, probe: 'ok', onOpen: noop, onTest: noop },
};

export const Err: Story = {
  args: { profile: sampleProfile, probe: 'err', onOpen: noop, onTest: noop },
};

/** Stresses long-label truncation + provider-chip overlap. */
export const LongLabel: Story = {
  args: { profile: longLabelProfile, probe: 'ok', onOpen: noop, onTest: noop },
};
