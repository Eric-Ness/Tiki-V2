import { Component, type ErrorInfo, type ReactNode } from 'react';
import './ErrorBoundary.css';

/**
 * Class-based React error boundary. Functional components cannot implement
 * `componentDidCatch` / `getDerivedStateFromError`, so this MUST be a class.
 *
 * Added in #212 (v0.6.6 hotfix) to prevent the same blank-screen failure
 * mode as #210: when a center-pane component crashed (KanbanBoard infinite
 * re-render loop), the lack of any boundary above it caused React to
 * unmount the entire tree, leaving users staring at a blank WebView.
 * Wrapping the center pane with this boundary localizes future crashes so
 * the sidebar / header / detail panel remain usable.
 */
export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback renderer. Receives the captured error and a
   *  reset() callback that clears the boundary so children re-mount. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Optional label written to console.error and shown in the default
   *  fallback UI. Useful for tagging which region failed (e.g. "center-pane"). */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(
      '[ErrorBoundary]',
      this.props.label ?? '<unlabeled>',
      error,
      info,
    );
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) {
        return this.props.fallback(error, this.reset);
      }
      return (
        <div className="error-boundary-fallback" role="alert">
          {this.props.label && (
            <div className="eb-label">{this.props.label}</div>
          )}
          <div className="eb-title">{error.name || 'Error'}</div>
          <div className="eb-message">{error.message || 'An unexpected error occurred.'}</div>
          <button
            type="button"
            className="eb-reload-btn"
            onClick={this.reset}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
