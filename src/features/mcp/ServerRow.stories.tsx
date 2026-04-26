import type { Meta, StoryObj } from '@storybook/react';

import type { McpServer } from '@/lib/ipc';

import { ServerRow } from './ServerRow';

/**
 * Cover stdio vs. http transport icons + long-summary truncation.
 * Probe state is row-local and starts un-tested in every story —
 * triggering it would dispatch a real IPC call which the e2e suite
 * (`e2e/mcp.spec.ts`) already exercises end-to-end.
 */
const meta: Meta<typeof ServerRow> = {
  title: 'Features/MCP/ServerRow',
  component: ServerRow,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <ul className="w-[480px] list-none space-y-2 p-0">
        <Story />
      </ul>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof ServerRow>;

const stdio: McpServer = {
  id: 'filesystem',
  config: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  },
};

const http: McpServer = {
  id: 'github-remote',
  config: { url: 'https://mcp.github.com/v1' },
};

const longCmd: McpServer = {
  id: 'longest-server-id-that-needs-truncation',
  config: {
    command: '/usr/local/bin/very-long-command-path/mcp-server-binary-with-many-args',
    args: ['--config', '/Users/example/projects/repo/.mcp/server.toml', '--verbose', '--log-level', 'debug'],
  },
};

const noop = () => {};

export const Stdio: Story = {
  args: { server: stdio, onEdit: noop, onDelete: noop },
};

export const Http: Story = {
  args: { server: http, onEdit: noop, onDelete: noop },
};

export const LongCommand: Story = {
  args: { server: longCmd, onEdit: noop, onDelete: noop },
};
