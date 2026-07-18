'use client';

import { create } from 'zustand';

/**
 * The analyse box's current text.
 *
 * It lives in a store rather than inside RepoPicker so the suggested-repo chips
 * can fill it without prop-drilling or reaching into the DOM. Deliberately fill
 * only — clicking a suggestion never submits, because submitting starts a real
 * (paid) analysis and that should always be an explicit second action.
 */
interface PasteBoxState {
  value: string;
  setValue: (value: string) => void;
}

export const usePasteBox = create<PasteBoxState>((set) => ({
  value: '',
  setValue: (value) => set({ value }),
}));

/** id on the analyse input, so a suggestion can move focus to it. */
export const PASTE_BOX_INPUT_ID = 'ditto-analyse-input';
