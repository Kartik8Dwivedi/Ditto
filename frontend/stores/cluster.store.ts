'use client';

import { create } from 'zustand';

interface ClusterDrawerState {
  /** id of the cluster whose detail drawer is open, or null. */
  openClusterId: string | null;
  openCluster: (clusterId: string) => void;
  closeCluster: () => void;
}

export const useClusterDrawer = create<ClusterDrawerState>((set) => ({
  openClusterId: null,
  openCluster: (openClusterId) => set({ openClusterId }),
  closeCluster: () => set({ openClusterId: null }),
}));
