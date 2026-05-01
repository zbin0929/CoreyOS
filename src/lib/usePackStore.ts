import { create } from 'zustand';

import { packList, packSetEnabled, type PackListEntry } from '@/lib/ipc/pack';

export type { PackListEntry } from '@/lib/ipc/pack';

interface PackState {
  packs: PackListEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setEnabled: (packId: string, enabled: boolean) => Promise<void>;
}

export const usePackStore = create<PackState>((set, get) => ({
  packs: [],
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const packs = await packList();
      set({ packs, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  setEnabled: async (packId, enabled) => {
    await packSetEnabled(packId, enabled);
    await get().refresh();
  },
}));
