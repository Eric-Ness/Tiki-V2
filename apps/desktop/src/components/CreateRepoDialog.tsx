import { useCallback } from 'react';
import { useCreateRepoDialogStore } from '../stores';
import './CreateRepoDialog.css';

/**
 * Imperative Public/Private chooser shown before creating a GitHub repo (#299).
 * Driven by {@link useCreateRepoDialogStore} / `requestRepoVisibility`. Mounted
 * once at the app root; renders nothing until a request opens it.
 *
 * Choosing Public/Private resolves the pending promise with that value; Cancel,
 * the Escape key, and a backdrop click all resolve it with `null`.
 */
export function CreateRepoDialog() {
  const open = useCreateRepoDialogStore((s) => s.open);
  const projectName = useCreateRepoDialogStore((s) => s.projectName);
  const choose = useCreateRepoDialogStore((s) => s.choose);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        choose(null);
      }
    },
    [choose],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        choose(null);
      }
    },
    [choose],
  );

  if (!open) return null;

  return (
    <div
      className="create-repo-dialog-overlay"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="create-repo-dialog" role="dialog" aria-modal="true">
        <div className="create-repo-dialog-header">
          <h2 className="create-repo-dialog-title">
            Create GitHub repo{projectName ? ` for ${projectName}` : ''}
          </h2>
          <button
            className="create-repo-dialog-close"
            onClick={() => choose(null)}
            type="button"
            aria-label="Close"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 4L4 12M4 4L12 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="create-repo-dialog-content">
          <p className="create-repo-dialog-prompt">
            Should this repository be public or private?
          </p>
          <div className="create-repo-dialog-choices">
            <button
              className="create-repo-dialog-choice create-repo-dialog-choice-public"
              onClick={() => choose('public')}
              type="button"
              autoFocus
            >
              <span className="create-repo-dialog-choice-label">Public</span>
              <span className="create-repo-dialog-choice-desc">
                Anyone on the internet can see this repository.
              </span>
            </button>
            <button
              className="create-repo-dialog-choice create-repo-dialog-choice-private"
              onClick={() => choose('private')}
              type="button"
            >
              <span className="create-repo-dialog-choice-label">Private</span>
              <span className="create-repo-dialog-choice-desc">
                Only you choose who can see this repository.
              </span>
            </button>
          </div>
        </div>

        <div className="create-repo-dialog-footer">
          <button
            className="create-repo-dialog-btn create-repo-dialog-btn-cancel"
            onClick={() => choose(null)}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
