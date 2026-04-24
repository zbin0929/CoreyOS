import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        bg: 'hsl(var(--bg) / <alpha-value>)',
        'bg-elev-1': 'hsl(var(--bg-elev-1) / <alpha-value>)',
        'bg-elev-2': 'hsl(var(--bg-elev-2) / <alpha-value>)',
        'bg-elev-3': 'hsl(var(--bg-elev-3) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        'border-strong': 'hsl(var(--border-strong) / <alpha-value>)',
        fg: 'hsl(var(--fg) / <alpha-value>)',
        'fg-muted': 'hsl(var(--fg-muted) / <alpha-value>)',
        'fg-subtle': 'hsl(var(--fg-subtle) / <alpha-value>)',
        'fg-disabled': 'hsl(var(--fg-disabled) / <alpha-value>)',
        gold: {
          50: 'hsl(var(--gold-50) / <alpha-value>)',
          200: 'hsl(var(--gold-200) / <alpha-value>)',
          500: 'hsl(var(--gold-500) / <alpha-value>)',
          600: 'hsl(var(--gold-600) / <alpha-value>)',
          700: 'hsl(var(--gold-700) / <alpha-value>)',
        },
        success: 'hsl(var(--success) / <alpha-value>)',
        warning: 'hsl(var(--warning) / <alpha-value>)',
        danger: 'hsl(var(--danger) / <alpha-value>)',
        info: 'hsl(var(--info) / <alpha-value>)',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'PingFang SC',
          'Noto Sans SC',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        xs: ['11px', { lineHeight: '1.45' }],
        sm: ['12.5px', { lineHeight: '1.5' }],
        base: ['14px', { lineHeight: '1.55' }],
        md: ['15px', { lineHeight: '1.5' }],
        lg: ['17px', { lineHeight: '1.4' }],
        xl: ['20px', { lineHeight: '1.35' }],
        '2xl': ['24px', { lineHeight: '1.3' }],
        display: ['40px', { lineHeight: '1.15' }],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        1: 'var(--shadow-1)',
        2: 'var(--shadow-2)',
      },
      transitionTimingFunction: {
        enter: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        exit: 'cubic-bezier(0.4, 0, 1, 1)',
      },
      transitionDuration: {
        fast: '120ms',
        DEFAULT: '180ms',
        slow: '320ms',
      },
      keyframes: {
        // T3.5 mobile drawer slide-in (see components/ui/drawer.tsx).
        // Kept at the tailwind level rather than a stylesheet so the
        // `animate-[drawerUp_...]` arbitrary value in JSX resolves.
        drawerUp: {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0%)' },
        },
        // T8 polish — side drawer used by `/models` and `/agents` for
        // focused card edit without losing the grid visually.
        drawerRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0%)' },
        },
      },
    },
  },
  plugins: [animate],
} satisfies Config;
