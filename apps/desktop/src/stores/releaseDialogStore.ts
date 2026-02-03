import { create } from 'zustand';
import type { TikiRelease } from './tikiReleasesStore';

interface ReleaseDialogState {
  isOpen: boolean;
  editingRelease: TikiRelease | undefined;
}

interface ReleaseDialogActions {
  openDialog: (release?: TikiRelease) => void;
  closeDialog: () => void;
}

type ReleaseDialogStore = ReleaseDialogState & ReleaseDialogActions;

export const useReleaseDialogStore = create<ReleaseDialogStore>()((set) => ({
  isOpen: false,
  editingRelease: undefined,

  openDialog: (release) =>
    set({
      isOpen: true,
      editingRelease: release,
    }),

  closeDialog: () =>
    set({
      isOpen: false,
      editingRelease: undefined,
    }),
}));
