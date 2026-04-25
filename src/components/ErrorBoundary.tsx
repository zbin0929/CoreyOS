import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const title = this.props.fallbackTitle ?? 'Something went wrong';

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-danger/40 bg-danger/10 text-danger">
          <Icon icon={AlertTriangle} size="lg" />
        </div>
        <h2 className="text-lg font-semibold text-fg">{title}</h2>
        <p className="max-w-md text-sm text-fg-muted">
          {this.state.error?.message ?? 'An unexpected error occurred in this section.'}
        </p>
        <Button
          variant="secondary"
          onClick={() => this.setState({ hasError: false, error: null })}
        >
          <Icon icon={RotateCcw} size="sm" />
          Retry
        </Button>
      </div>
    );
  }
}
