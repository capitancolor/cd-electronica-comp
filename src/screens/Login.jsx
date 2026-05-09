import { useState } from 'react'
import { login } from '../services/negocio'
import { Icon } from '../components/UI'

export default function Login({ onLogin }) {
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    
    if (!user.trim() || !pass.trim()) { 
      setError('Completá usuario y contraseña')
      return 
    }

    setLoading(true)
    try {
      // Llamada al servicio de negocio que conecta con Supabase/SQLite
      const u = await login(user.trim(), pass.trim())
      
      if (u) {
        // Verificamos que onLogin sea una función antes de llamarla
        if (typeof onLogin === 'function') {
          onLogin(u)
        } else {
          console.error("Error crítico: La prop 'onLogin' no llegó al componente Login.")
          setError('Error interno del sistema (Prop missing)')
        }
      } else {
        setError('Usuario o contraseña incorrectos')
      }
    } catch (err) {
      console.error("Error en login:", err)
      setError('Error de conexión con el servidor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <div style={{
        width: 400, padding: 40,
        background: 'var(--bg2)', border: '1px solid var(--border)',
        borderRadius: 16,
        boxShadow: '0 20px 60px rgba(251, 253, 128, 0.2)', // Ajusté opacidad para que no sature
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
          <div style={{
            width: 180, height: 90, borderRadius: 14,
            background: 'var(--blue-dim)', border: '1px solid #1A73E840',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--blue)', marginBottom: 12, overflow: 'hidden', padding: 8,
          }}>
            <img
              src="/logo-insumos.png"
              alt="CD - Electrónica"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3 }}>CD Electrónica</div>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>Sistema de Gestión</div>
        </div>

        <hr className="divider" />
        <div style={{ fontSize: 16, fontWeight: 600, margin: '16px 0 16px' }}>Iniciar Sesión</div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }} autoComplete="off">
          <div className="col" style={{ gap: 4 }}>
            <label>Usuario</label>
            <input 
              value={user} 
              onChange={e => setUser(e.target.value)}
              placeholder="Usuario" 
              autoFocus 
              disabled={loading}
              autoComplete="off" 
            />
          </div>
          <div className="col" style={{ gap: 4 }}>
            <label>Contraseña</label>
            <div style={{ position: 'relative' }}>
              <input 
                type={showPass ? 'text' : 'password'}
                value={pass} 
                onChange={e => setPass(e.target.value)}
                placeholder="Contraseña" 
                style={{ paddingRight: 40 }} 
                disabled={loading}
                autoComplete="new-password" 
              />
              <button 
                type="button" 
                className="btn-icon"
                onClick={() => setShowPass(!showPass)}
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', cursor: 'pointer' }}
              >
                <Icon name={showPass ? "eye-off" : "eye"} size={15} />
              </button>
            </div>
          </div>

          {error && (
            <div style={{ 
              color: '#FF4B2B', fontSize: 13, background: '#FF4B2B15', 
              padding: '8px 12px', borderRadius: 6, border: '1px solid #FF4B2B30',
              display: 'flex', alignItems: 'center', gap: 8
            }}>
              <Icon name="alert" size={14} />
              {error}
            </div>
          )}

          <button 
            type="submit" 
            className="btn-primary"
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center', height: 44, marginTop: 4, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}
          >
            {loading ? 'Ingresando...' : <><Icon name="check" size={16} /> Ingresar</>}
          </button>
        </form>
      </div>
    </div>
  )
}