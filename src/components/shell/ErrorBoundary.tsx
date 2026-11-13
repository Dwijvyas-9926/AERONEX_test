import { TriangleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

/*
  A fault on one page must not take the whole app with it. Without this, an
  error while drawing leaves an empty window and no way back; with it, the
  page says what happened and the rest of the app, the link to the aircraft
  included, carries on.
*/
interface Props {
  /** Changes when the reader goes to another page, which clears the fault. */
  page: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  page: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, page: this.props.page };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.page !== state.page ? { error: null, page: props.page } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("A page failed to draw:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="page-pad">
        <div className="fault" role="alert">
          <TriangleAlert aria-hidden />
          <div>
            <h1>This page hit a fault</h1>
            <p>The rest of AERONEX is still running, and a linked aircraft stays linked. Your plan and settings are saved.</p>
            <p className="fault-detail">{error.message || String(error)}</p>
            <div className="fault-actions">
              <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
                Try this page again
              </button>
              <a className="btn" href="#/">
                Go to Overview
              </a>
              <button className="btn btn-ghost" onClick={() => window.location.reload()}>
                Reload the app
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
