import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Storybook 8 config for Caduceus.
 *
 * We deliberately scope stories to `src/components/ui/**` for now — those
 * are the pure design-system primitives (Button, Icon, Select, Empty-
 * state) that don't touch Tauri IPC, Zustand, or i18n. Feature modules
 * (`src/features/**`) stay out of Storybook until we wire a Tauri-IPC
 * decorator that can serve the same mocks the Playwright suite uses.
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
