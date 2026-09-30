import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Global error boundary — keeps a themed, honest failure surface. */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[XR] Unhandled UI error:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="bg-bg-void flex h-screen items-center justify-center p-6">
        <div className="border-border-subtle bg-bg-ink max-w-md rounded-lg border p-8 text-center">
          <h1 className="text-text-primary text-2xl font-semibold">
            Something broke
          </h1>
          <p className="text-text-secondary mt-3">
            The interface hit an unexpected error and stopped rendering. The
            details are in the console — nothing was lost.
          </p>
          <pre className="bg-bg-raised text-danger mt-4 overflow-x-auto rounded-md p-3 text-left font-mono text-xs">
            {error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="bg-accent text-accent-contrast mt-6 rounded-md px-4 py-2 text-sm font-medium"
          >
            Reload XR
          </button>
        </div>
      </div>
    );
  }
}
