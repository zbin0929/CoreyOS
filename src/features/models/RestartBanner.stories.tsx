import type { Meta, StoryObj } from '@storybook/react';

import { RestartBanner } from './RestartBanner';

/**
 * RestartBanner self-manages its restart status (idle / running /
 * done / err) so we can only snapshot the initial paint via props.
 * The other three states transition off real `hermes_gateway_restart`
 * IPC calls; the e2e suite (`e2e/settings.spec.ts`) exercises those
 * — Storybook would just be re-running the same mock.
 *
 * That said, having the idle banner in Storybook is still valuable
 * for catching token drift on the orange info-row + the inline
 * action buttons.
 */
const meta: Meta<typeof RestartBanner> = {
  title: 'Features/Models/RestartBanner',
  component: RestartBanner,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof RestartBanner>;

const noop = () => {};

export const Idle: Story = {
  args: { onDismiss: noop, onRestarted: noop },
};
