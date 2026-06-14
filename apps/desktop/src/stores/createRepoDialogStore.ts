import { create } from 'zustand';

/** The visibility a user can choose for a new GitHub repo, or null on cancel. */
export type RepoVisibility = 'public' | 'private';

type RepoVisibilityResult = RepoVisibility | null;

interface CreateRepoDialogState {
  open: boolean;
  projectName: string | null;
  resolver: ((v: RepoVisibilityResult) => void) | null;
}

interface CreateRepoDialogActions {
  /**
   * Resolve the pending request with the chosen visibility (or null on
   * cancel / Escape / backdrop), close the dialog, and clear the resolver.
   * No-op (still closes) if there's no pending resolver.
   */
  choose: (v: RepoVisibilityResult) => void;
}

type CreateRepoDialogStore = CreateRepoDialogState & CreateRepoDialogActions;

export const useCreateRepoDialogStore = create<CreateRepoDialogStore>()((set, get) => ({
  open: false,
  projectName: null,
  resolver: null,

  choose: (v) => {
    const { resolver } = get();
    if (resolver) resolver(v);
    set({ open: false, projectName: null, resolver: null });
  },
}));

/**
 * Imperatively ask the user "Public or Private?" before creating a GitHub repo.
 * Opens the {@link CreateRepoDialog} and returns a Promise that resolves to
 * `'public'` / `'private'` when the user chooses, or `null` on cancel.
 *
 * Defensive: if a request is already open, the prior one is resolved with
 * `null` first so its caller doesn't hang.
 */
export function requestRepoVisibility(
  projectName: string,
): Promise<RepoVisibilityResult> {
  const { resolver: prior } = useCreateRepoDialogStore.getState();
  if (prior) prior(null);

  return new Promise<RepoVisibilityResult>((resolve) => {
    useCreateRepoDialogStore.setState({
      open: true,
      projectName,
      resolver: resolve,
    });
  });
}
