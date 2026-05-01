import { create } from 'zustand';

import { packList, packSetEnabled, packViewsList, type PackListEntry, type PackView } from '@/lib/ipc/pack';

export type { PackListEntry, PackView } from '@/lib/ipc/pack';

interface PackState {
  packs: PackListEntry[];
  views: PackView[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setEnabled: (packId: string, enabled: boolean) => Promise<void>;
}

export const usePackStore = create<PackState>((set, get) => ({
  packs: [],
  views: [],
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const [packs, views] = await Promise.all([packList(), packViewsList()]);
      set({ packs, views, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  setEnabled: async (packId, enabled) => {
    await packSetEnabled(packId, enabled);
    await get().refresh();
  },
}));
