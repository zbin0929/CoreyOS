import type { Preview } from '@storybook/react';
// Mount the exact same Tailwind + design-token sheet the app does so
// stories render pixel-identically. Any runtime-only side effects in
// this import (theme detection, i18n init) are cheap enough to pay
// once per Storybook boot.
import '../src/styles/tokens.css';
import '../src/styles/globals.css';
// Side-effect: i18next.init() runs on first import. Loaded here so
// every story (UI primitives + feature components alike) has the
// same translation context as the running app — no `t('foo.bar')`
// echoing the key path in stories.
import '../src/lib/i18n';
import { withTauriIpc } from './withTauriIpc';

const preview: Preview = {
  parameters: {
    // Default Storybook backgrounds fight the app's own background
    // tokens — use `data-theme` on the docs container instead.
    backgrounds: { disable: true },
    layout: 'centered',
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
  },
  globalTypes: {
    theme: {
      description: 'Design-system theme (drives `html[data-theme]`)',
      defaultValue: 'dark',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'dark', title: 'Dark' },
          { value: 'light', title: 'Light' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    // Runs FIRST so feature stories that read stores hydrated by
    // IPC see a populated mock window before their first effect.
    withTauriIpc,
    (Story, ctx) => {
      // Flip <html data-theme="…"> so Tailwind dark: / token variables
      // resolve the way the app does. Using the document attribute
      // (not a class) matches ThemeProvider's behaviour in `src/app`.
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute(
          'data-theme',
          (ctx.globals.theme as string) ?? 'dark',
        );
      }
      return Story();
    },
  ],
};

export default preview;
