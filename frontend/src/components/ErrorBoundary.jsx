import { Component } from 'react';

// React 18 unmounts the ENTIRE tree to a blank white page on any uncaught
// render error, with no way back except a hard refresh — exactly what
// happened when a bug in Floor Plan Presentation Mode took down the whole
// app. Wrapping a risky, self-contained feature in this boundary means a
// bug there shows a recoverable message instead, with the rest of the app
// (and the user's unsaved work elsewhere) left alone.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2000, background: '#fff',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24,
        }}>
          <h3 style={{ margin: 0 }}>Something went wrong</h3>
          <p style={{ color: '#5c6070', maxWidth: 480, textAlign: 'center' }}>
            {this.props.label || 'This screen'} hit an unexpected error. Nothing else in LowForce was affected —
            click below to close it and continue.
          </p>
          <button type="button" onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}>
            Close and Return
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
