import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Storybook 8 config for Caduceus.
 *
 * Scope: `src/**\/*.stories.{ts,tsx,mdx}`. UI primitives live under
 * `src/components/ui/**` and feature components under `src/features/**`.
 * Since 2026-04-26 the `withTauriIpc` decorator (preview.ts) installs
 * the same in-memory `__TAURI_INTERNALS__` mock the Playwright suite
 * uses, so feature stories can render without bailing out on missing
 * IPC. Add new commands to `e2e/fixtures/tauri-mock.ts` so both
 * harnesses stay in lockstep.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx|mdx)'],
  addons: ['@storybook/addon-essentials'],
  framework: { name: '@storybook/react-vite', options: {} },
  typescript: {
    reactDocgen: 'react-docgen-typescript',
  },
  core: { disableTelemetry: true },
};

export default config;
