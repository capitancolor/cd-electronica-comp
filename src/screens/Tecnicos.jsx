import { useState, useEffect } from 'react'
import { Icon, toast } from '../components/UI'
import { getTecnicos, guardarTecnico, eliminarTecnico, getReparacionesPorTecnico } from '../services/negocio'

const fmt = v => '$' + Number(v || 0).toLocaleString('es-AR')

export default function Tecnicos({ onClose }) {
  const [tecnicos, setTecnicos] = useState([])
  const [modal, setModal] = useState(null)
  const [loading, setLoading] = useState(false)

  const cargar = async () => {
    try {
      const data = await getTecnicos()
      setTecnicos(data)
    } catch (err) { toast("Error al cargar técnicos", "error") }
  }

  useEffect(() => { cargar() }, [])

  const handleGuardar = async () => {
    if (!modal.nombre?.trim()) return toast("El nombre es obligatorio", "error")
    setLoading(true)
    try {
      await guardarTecnico({ id: modal.id, nombre: modal.nombre, telefono: modal.telefono, especialidad: modal.especialidad })
      toast(modal.id ? "Técnico actualizado" : "Técnico agregado")
      setModal(null)
      await cargar()
    } catch (err) { toast("Error al guardar", "error") }
    finally { setLoading(false) }
  }

  const handleEliminar = async (t) => {
    alert(`ATENCIÓN: Vas a eliminar a "${t.nombre}". Esta acción no se puede deshacer.`)
    if (!window.confirm(`¿Confirmas eliminar a "${t.nombre}"?`)) return
    try {
      await eliminarTecnico(t.id)
      toast("Eliminado")
      await cargar()
    } catch (err) { toast("Error", "error") }
  }

  const [trabajos, setTrabajos] = useState(null)

  const verTrabajos = async (t) => {
    const reps = await getReparacionesPorTecnico(t.id)
    setTrabajos({ tecnico: t.nombre, items: reps })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 15, padding: 20, background: '#f3f4f6' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 900, margin: 0, color: '#111827' }}>TÉCNICOS</h2>
          <p style={{ fontSize: 12, color: '#666', margin: 0 }}>Gestión del equipo técnico</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setModal({ id: null, nombre: '', telefono: '', especialidad: '' })} style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 800, cursor: 'pointer' }}>
            + NUEVO TÉCNICO
          </button>
          {onClose && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#666', padding: '0 8px' }}>✕</button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#1f2937', zIndex: 10 }}>
            <tr>
              <th style={{ padding: '15px 20px', textAlign: 'left', fontSize: 11, fontWeight: 800, color: '#fff', textTransform: 'uppercase' }}>NOMBRE</th>
              <th style={{ padding: '15px 20px', textAlign: 'left', fontSize: 11, fontWeight: 800, color: '#fff', textTransform: 'uppercase' }}>TELÉFONO</th>
              <th style={{ padding: '15px 20px', textAlign: 'left', fontSize: 11, fontWeight: 800, color: '#fff', textTransform: 'uppercase' }}>ESPECIALIDAD</th>
              <th style={{ padding: '15px 20px', textAlign: 'center', fontSize: 11, fontWeight: 800, color: '#fff', textTransform: 'uppercase' }}>ACCIONES</th>
            </tr>
          </thead>
          <tbody>
            {tecnicos.map(t => (
              <tr key={t.id} style={{ borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
                <td style={{ padding: '12px 20px', fontWeight: 700, color: '#374151' }}>{t.nombre}</td>
                <td style={{ padding: '12px 20px', color: '#374151' }}>{t.telefono || '-'}</td>
                <td style={{ padding: '12px 20px', color: '#374151' }}>{t.especialidad || '-'}</td>
                <td style={{ padding: '12px 20px', textAlign: 'center' }}>
                  <button onClick={() => verTrabajos(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 5, color: '#2563eb' }} title="Ver trabajos"><Icon name="reports" size={18} /></button>
                  <button onClick={() => setModal({ id: t.id, nombre: t.nombre, telefono: t.telefono || '', especialidad: t.especialidad || '' })} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 5, color: '#2563eb' }}><Icon name="tune" size={18} /></button>
                  <button onClick={() => handleEliminar(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 5, color: '#ef4444' }}><Icon name="trash" size={18} /></button>
                </td>
              </tr>
            ))}
            {tecnicos.length === 0 && (
              <tr><td colSpan={4} style={{ padding: 30, textAlign: 'center', color: '#999' }}>No hay técnicos cargados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL TÉCNICO */}
      {modal && !trabajos && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 25, width: 400, border: '1px solid #ddd' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontWeight: 900, color: '#2563eb' }}>{modal.id ? 'EDITAR TÉCNICO' : 'NUEVO TÉCNICO'}</h3>
              <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#666' }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#666', marginBottom: 5, display: 'block' }}>Nombre *</label>
                <input value={modal.nombre} onChange={e => setModal({...modal, nombre: e.target.value})} style={{ width: '100%', padding: 10, border: '1px solid #ccc', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#666', marginBottom: 5, display: 'block' }}>Teléfono</label>
                <input value={modal.telefono} onChange={e => setModal({...modal, telefono: e.target.value})} style={{ width: '100%', padding: 10, border: '1px solid #ccc', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#666', marginBottom: 5, display: 'block' }}>Especialidad</label>
                <input value={modal.especialidad} onChange={e => setModal({...modal, especialidad: e.target.value})} placeholder="Ej: PC, Notebook, Celulares" style={{ width: '100%', padding: 10, border: '1px solid #ccc', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
              </div>
              <button onClick={handleGuardar} disabled={loading} style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: 14, fontWeight: 800, cursor: 'pointer', marginTop: 10 }}>
                {loading ? 'PROCESANDO...' : modal.id ? 'GUARDAR CAMBIOS' : 'AGREGAR TÉCNICO'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL TRABAJOS ASIGNADOS */}
      {trabajos && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 25, width: 650, maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontWeight: 900, color: '#2563eb' }}>TRABAJOS DE: {trabajos.tecnico}</h3>
              <button onClick={() => setTrabajos(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#666' }}>✕</button>
            </div>
            {trabajos.items.length === 0 ? (
              <p style={{ color: '#999', textAlign: 'center', padding: 20 }}>Sin trabajos asignados</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left', fontSize: 11 }}>
                    <th style={{ padding: 10 }}>FECHA</th>
                    <th style={{ padding: 10 }}>CLIENTE</th>
                    <th style={{ padding: 10 }}>EQUIPO</th>
                    <th style={{ padding: 10 }}>ESTADO</th>
                    <th style={{ padding: 10, textAlign: 'right' }}>TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {trabajos.items.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: 10 }}>{new Date(r.fecha).toLocaleDateString('es-AR')}</td>
                      <td style={{ padding: 10, fontWeight: 600 }}>{r.cliente}</td>
                      <td style={{ padding: 10 }}>{r.equipo}</td>
                      <td style={{ padding: 10 }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                          color: r.estado === 'Entregado' ? '#16a34a' : r.estado === 'En Progreso' ? '#2563eb' : r.estado === 'Completado' ? '#d97706' : '#6b7280',
                          background: r.estado === 'Entregado' ? '#f0fdf4' : r.estado === 'En Progreso' ? '#eff6ff' : r.estado === 'Completado' ? '#fffbeb' : '#f9fafb',
                        }}>{r.estado || 'Pendiente'}</span>
                      </td>
                      <td style={{ padding: 10, fontWeight: 800, textAlign: 'right' }}>{fmt(r.costo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}