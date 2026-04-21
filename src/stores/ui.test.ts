import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './ui';

describe('useUIStore', () => {
  beforeEach(() => {
    useUIStore.setState({ theme: 'dark', sidebarCollapsed: false });
    document.documentElement.removeAttribute('data-theme');
  });

  it('has a dark-first default theme', () => {
    expect(useUIStore.getState().theme).toBe('dark');
  });

  it('setTheme writes data-theme on the root element', () => {
    useUIStore.getState().setTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(useUIStore.getState().theme).toBe('light');
  });

  it('toggleTheme flips dark <-> light', () => {
    const { toggleTheme } = useUIStore.getState();
    toggleTheme();
    expect(useUIStore.getState().theme).toBe('light');
    toggleTheme();
    expect(useUIStore.getState().theme).toBe('dark');
  });

  it('toggleSidebar flips the collapsed flag', () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });
});
