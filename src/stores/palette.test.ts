import { describe, it, expect, beforeEach } from 'vitest';
import { usePaletteStore } from './palette';

describe('usePaletteStore', () => {
  beforeEach(() => {
    usePaletteStore.setState({ open: false });
  });

  it('starts closed', () => {
    expect(usePaletteStore.getState().open).toBe(false);
  });

  it('setOpen(true) opens it', () => {
    usePaletteStore.getState().setOpen(true);
    expect(usePaletteStore.getState().open).toBe(true);
  });

  it('toggle() flips state', () => {
    const { toggle } = usePaletteStore.getState();
    toggle();
    expect(usePaletteStore.getState().open).toBe(true);
    toggle();
    expect(usePaletteStore.getState().open).toBe(false);
  });
});
