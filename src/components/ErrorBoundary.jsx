import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999,
          padding: 20
        }}>
          <div style={{
            background: '#fff', borderRadius: 12, padding: 25, maxWidth: 500, width: '100%',
            color: '#000'
          }}>
            <h3 style={{ margin: '0 0 10px', color: '#d32f2f' }}>ERROR INESPERADO</h3>
            <p style={{ margin: '0 0 15px', fontSize: 13, color: '#666' }}>
              {this.state.error?.message || 'Ocurrió un error al abrir esta ventana.'}
            </p>
            <pre style={{
              background: '#f5f5f5', padding: 12, borderRadius: 8, fontSize: 11,
              overflow: 'auto', maxHeight: 200, margin: '0 0 15px', color: '#333'
            }}>
              {this.state.error?.stack || 'Sin detalle'}
            </pre>
            <button onClick={() => this.setState({ error: null })} style={{
              background: '#1976d2', color: '#fff', border: 'none', padding: '10px 20px',
              borderRadius: 8, fontWeight: 700, cursor: 'pointer'
            }}>
              CERRAR
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
