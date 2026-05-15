import { create } from 'zustand';
import type { TikiRelease, TikiReleaseIssue } from './tikiReleasesStore';

interface ReleaseDialogState {
  isOpen: boolean;
  editingRelease: TikiRelease | undefined;
  /**
   * Optional pre-populated issue list for "create new release with these
   * issues" — used by the bulk-action toolbar's Add-to-release button
   * (#203). Ignored when `editingRelease` is set.
   */
  initialIssues: TikiReleaseIssue[] | undefined;
}

interface OpenDialogOptions {
  /** When provided (and `release` is undefined), pre-fills the new-release form's selected issues. */
  initialIssues?: TikiReleaseIssue[];
}

interface ReleaseDialogActions {
  openDialog: (release?: TikiRelease, opts?: OpenDialogOptions) => void;
  closeDialog: () => void;
}

type ReleaseDialogStore = ReleaseDialogState & ReleaseDialogActions;

export const useReleaseDialogStore = create<ReleaseDialogStore>()((set) => ({
  isOpen: false,
  editingRelease: undefined,
  initialIssues: undefined,

  openDialog: (release, opts) =>
    set({
      isOpen: true,
      editingRelease: release,
      initialIssues: opts?.initialIssues,
    }),

  closeDialog: () =>
    set({
      isOpen: false,
      editingRelease: undefined,
      initialIssues: undefined,
    }),
}));
