import { useState } from 'react'
import { login } from '../services/negocio'
import { saveLocalConfig } from '../services/config' 
import { Icon } from '../components/UI'

export default function SetupLocal({ onConfigured }) {
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [localId, setLocalId] = useState('1')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    
    if (!user.trim() || !pass.trim()) { 
      setError('Completá los datos de administrador')
      return 
    }

    setLoading(true)
    try {
      const u = await login(user.trim(), pass.trim())
      
      if (u && u.rol === 'admin') {
        const nuevaConfig = { 
          local_id: parseInt(localId),
          nombre_local: localId === '1' ? 'LOCAL 1' : 'LOCAL 2'
        }

        const ok = await saveLocalConfig(nuevaConfig)

        if (ok) {
          onConfigured(nuevaConfig)
        } else {
          setError('Error al escribir el archivo de configuración')
        }
      } else {
        setError('Acceso denegado: Se requiere un usuario Administrador')
      }
    } catch (err) {
      console.error("Error en Setup:", err)
      setError('Error de conexión o de base de datos')
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
        boxShadow: '0 20px 60px rgba(251, 253, 128, 0.2)',
      }}>
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
        <div style={{ fontSize: 16, fontWeight: 600, margin: '16px 0 16px' }}>Vincular Terminal</div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }} autoComplete="off">

          <div className="col" style={{ gap: 4 }}>
            <label>ASIGNAR A:</label>
            <select
              value={localId}
              onChange={e => setLocalId(e.target.value)}
              disabled={loading}
            >
              <option value="1">LOCAL 1 (Calle Principal)</option>
              <option value="2">LOCAL 2 (Sucursal)</option>
            </select>
          </div>

          <hr className="divider" />

          <div className="col" style={{ gap: 4 }}>
            <label>Usuario Admin</label>
            <input
              value={user}
              onChange={e => setUser(e.target.value)}
              placeholder="Admin"
              autoFocus
              disabled={loading}
              autoComplete="off"
            />
          </div>

          <div className="col" style={{ gap: 4 }}>
            <label>Contraseña</label>
            <input
              type="password"
              value={pass}
              onChange={e => setPass(e.target.value)}
              placeholder="Contraseña"
              disabled={loading}
              autoComplete="new-password"
            />
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
            {loading ? 'Guardando...' : <><Icon name="check" size={16} /> Vincular Terminal</>}
          </button>
        </form>
      </div>
    </div>
  )
}