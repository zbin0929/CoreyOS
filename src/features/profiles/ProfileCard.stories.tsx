import type { Meta, StoryObj } from '@storybook/react';

import type { HermesProfileInfo } from '@/lib/ipc';

import { ProfileCard } from './ProfileCard';

/**
 * Per-Hermes-profile card. The two axes that matter visually are
 * `mode` (view / rename / clone / confirm-delete — drives the
 * inline strip below the header) and `status` (idle / busy / err —
 * controls disabled flags + spinner placement). We snapshot one
 * representative variant per axis-value combination that's actually
 * reachable in the UI.
 */
const meta: Meta<typeof ProfileCard> = {
  title: 'Features/Profiles/ProfileCard',
  component: ProfileCard,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-[520px]">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof ProfileCard>;

const profile: HermesProfileInfo = {
  name: 'staging',
  path: '/Users/example/.hermes/profiles/staging',
  is_active: false,
  updated_at: Date.now() - 1000 * 60 * 60 * 6,
};

const activeProfile: HermesProfileInfo = { ...profile, name: 'production', is_active: true };

const noop = () => {};

const baseHandlers = {
  onModeChange: noop,
  onRename: noop,
  onClone: noop,
  onDelete: noop,
  onExport: noop,
  onActivate: noop,
};

export const Idle: Story = {
  args: {
    profile,
    mode: { kind: 'view' },
    status: { kind: 'idle' },
    ...baseHandlers,
  },
};

export const Active: Story = {
  args: {
    profile: activeProfile,
    mode: { kind: 'view' },
    status: { kind: 'idle' },
    ...baseHandlers,
  },
};

export const Renaming: Story = {
  args: {
    profile,
    mode: { kind: 'rename', value: 'staging-v2' },
    status: { kind: 'idle' },
    ...baseHandlers,
  },
};

export const Cloning: Story = {
  args: {
    profile,
    mode: { kind: 'clone', value: 'staging-fork' },
    status: { kind: 'idle' },
    ...baseHandlers,
  },
};

export const ConfirmDelete: Story = {
  args: {
    profile,
    mode: { kind: 'confirm-delete' },
    status: { kind: 'idle' },
    ...baseHandlers,
  },
};

export const Busy: Story = {
  args: {
    profile,
    mode: { kind: 'view' },
    status: { kind: 'busy' },
    ...baseHandlers,
  },
};

export const Errored: Story = {
  args: {
    profile,
    mode: { kind: 'view' },
    status: { kind: 'err', message: 'Failed to clone — destination already exists.' },
    ...baseHandlers,
  },
};
