import { useState } from 'react'
import { login } from '../services/negocio'
import { saveLocalConfig } from '../services/config' 
import { Icon } from '../components/UI'

export default function SetupLocal({ onConfigured }) {
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [localId, setLocalId] = useState('1') // Estado para el select
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
      // 1. Validamos que el que configura sea Admin
      const u = await login(user.trim(), pass.trim())
      
      if (u && u.rol === 'admin') {
        // 2. Creamos la configuración con el local ELEGIDO en el select
        const nuevaConfig = { 
          local_id: parseInt(localId),
          nombre_local: localId === '1' ? 'LOCAL 1' : 'LOCAL 2'
        }

        // 3. Guardamos el archivo app_config.json
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
      background: '#111827', fontFamily: 'sans-serif'
    }}>
      <div style={{
        width: 400, padding: 40, background: '#1f2937', borderRadius: 16,
        boxShadow: '0 10px 25px rgba(0,0,0,0.5)', color: 'white'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <div style={{ 
            background: '#374151', width: 60, height: 60, borderRadius: '50%', 
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 15px'
          }}>
            <Icon name="computer" size={30} color="#fbbf24" />
          </div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Vincular Terminal</h2>
          <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 8 }}>
            Configuración inicial de sucursal
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
          
          {/* SELECT DE LOCAL */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 12, color: '#fbbf24', fontWeight: 800 }}>ASIGNAR A:</label>
            <select 
              value={localId}
              onChange={e => setLocalId(e.target.value)}
              style={{ 
                padding: '12px', borderRadius: 8, border: '1px solid #374151', 
                background: '#111827', color: 'white', outline: 'none',
                fontSize: '14px', fontWeight: 'bold', cursor: 'pointer'
              }}
            >
              <option value="1">LOCAL 1 (Calle Principal)</option>
              <option value="2">LOCAL 2 (Sucursal)</option>
            </select>
          </div>

          <hr style={{ border: '0', borderTop: '1px solid #374151', margin: '10px 0' }} />

          {/* CREDENCIALES DE ADMIN PARA AUTORIZAR */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>USUARIO ADMIN</label>
            <input 
              value={user} 
              onChange={e => setUser(e.target.value)}
              placeholder="Admin"
              style={{ 
                padding: '12px', borderRadius: 8, border: '1px solid #374151', 
                background: '#111827', color: 'white', outline: 'none' 
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>CONTRASEÑA</label>
            <input 
              type="password"
              value={pass} 
              onChange={e => setPass(e.target.value)}
              placeholder="••••••••"
              style={{ 
                padding: '12px', borderRadius: 8, border: '1px solid #374151', 
                background: '#111827', color: 'white', outline: 'none' 
              }}
            />
          </div>

          {error && (
            <div style={{ 
              color: '#f87171', fontSize: 13, textAlign: 'center', 
              background: 'rgba(248,113,113,0.1)', padding: '10px', borderRadius: 8 
            }}>
              {error}
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            style={{ 
              background: '#fbbf24', color: '#000', padding: '14px', 
              borderRadius: 8, border: 'none', fontWeight: 800, 
              cursor: loading ? 'not-allowed' : 'pointer', marginTop: 10,
              textTransform: 'uppercase', letterSpacing: 1
            }}
          >
            {loading ? 'Guardando...' : 'Vincular Terminal'}
          </button>
        </form>
      </div>
    </div>
  )
}