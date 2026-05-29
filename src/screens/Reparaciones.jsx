import { useState, useEffect, useMemo } from 'react'
import { getReparaciones, guardarReparacion, eliminarReparacion } from '../services/negocio'
import { Icon, toast } from '../components/UI'
import { supabase } from '../supabase'
import Database from '@tauri-apps/plugin-sql'
import Tecnicos from './Tecnicos'

const UI = {
  headerBg: '#1f2937', 
  headerText: '#ffffff',
  border: '#e5e7eb',
  accent: '#2563eb',
  title: '#111827'
}

const fmt = v => '$' + Number(v || 0).toLocaleString('es-AR')

export default function Reparaciones() {
  const [items, setItems] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState({ show: false, data: null })
  const [sortConfig, setSortConfig] = useState({ field: 'fecha', direction: 'desc' })
  const [showTecnicos, setShowTecnicos] = useState(false)

  const estadoInicial = { 
    fecha: new Date().toISOString().split('T')[0],
    cliente: '', telefono: '', equipo: '', marca: '', modelo: '', 
    problema: '', arreglo: '', accesorios: '', service: false, total: 0, estado: 'Pendiente'
  }

  const cargar = async () => {
    try {
      const data = await getReparaciones(busqueda)
      setItems(data)
    } catch (err) { toast("Error al cargar", "error") }
  }

  useEffect(() => { cargar() }, [busqueda])

  // Realtime: escuchar cambios en reparaciones (otras terminales)
  useEffect(() => {
    const channel = supabase
      .channel('reparaciones-cambios')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'reparaciones' },
        () => {
          console.log('🔄 Cambio en reparaciones, recargando...');
          cargar();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleSort = (field) => {
    let direction = 'asc'
    if (sortConfig.field === field && sortConfig.direction === 'asc') direction = 'desc'
    setSortConfig({ field, direction })
  }

  const itemsOrdenados = useMemo(() => {
    const temp = [...items]
    if (sortConfig.field) {
      temp.sort((a, b) => {
        const valA = (a[sortConfig.field] || '').toString().toLowerCase()
        const valB = (b[sortConfig.field] || '').toString().toLowerCase()
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1
        return 0
      })
    }
    return temp
  }, [items, sortConfig])

  const abrirModal = (reparacion = null) => {
    const data = reparacion ? { ...reparacion } : { ...estadoInicial }
    if (reparacion && reparacion.problema) {
      const p = reparacion.problema
      const mm = p.match(/^MARCA\/MODELO:\s*(.*?)\s*$/m)
      const fa = p.match(/^FALLA:\s*(.*?)\s*$/m)
      const ac = p.match(/^ACCESORIOS:\s*(.*?)\s*$/m)
      const tr = p.match(/^TRABAJO:\s*(.*?)\s*$/m)
      if (mm || fa || ac || tr) {
        data.marca = mm ? mm[1].trim().split(/\s+/)[0] || '' : reparacion.marca || ''
        data.modelo = mm ? mm[1].trim().split(/\s+/).slice(1).join(' ') || '' : reparacion.modelo || ''
        data.problema = fa ? fa[1].trim() : ''
        data.accesorios = ac ? ac[1].trim() : ''
        data.arreglo = tr ? tr[1].trim() : ''
      }
    }
    setModal({ show: true, data })
  }

  const cerrarModal = () => setModal({ show: false, data: null })

  const handleGuardar = async () => {
    
    const { data } = modal;
    if (!data.cliente || !data.equipo) return toast("Cliente y Equipo son obligatorios", "error");
    
    setLoading(true);
    try {
      await guardarReparacion(data);
      toast(data.id ? "Orden Actualizada" : "Orden Registrada");
      cerrarModal();
      await cargar(); // <--- IMPORTANTE: Recargar la lista del SQLite
    } catch (err) { 
      toast("Error al guardar", "error"); 
    } finally { 
      setLoading(false); 
    }
  };

  const handleEliminar = async (id, cliente) => {
    alert(`ATENCIÓN: Vas a eliminar la orden de "${cliente}". Esta acción no se puede deshacer.`);
    if (!window.confirm(`¿Confirmas eliminar la orden de "${cliente}"?`)) return
    try { await eliminarReparacion(id); cargar(); toast("Eliminado") } 
    catch (err) { toast("Error", "error") }
  }

  const handleCambiarEstado = async (id, nuevoEstado) => {
    if (!nuevoEstado) return
    try {
      const db = await Database.load("sqlite:cd_electronica.db")
      await db.execute("UPDATE reparaciones SET estado = ? WHERE id = ?", [nuevoEstado, id])
      setItems(prev => prev.map(r => r.id === id ? { ...r, estado: nuevoEstado } : r))
      try {
        await supabase.from('reparaciones').update({ estado: nuevoEstado }).eq('id', id)
      } catch (e) {
        console.warn("Supabase no disponible al cambiar estado:", e.message)
      }
    } catch (err) {
      toast("Error al actualizar estado", "error")
    }
  }

  const SortableTh = ({ label, field, width }) => (
    <th style={{ ...styles.th, width, cursor: 'pointer' }} onClick={() => handleSort(field)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        {label}
        {sortConfig.field === field && <Icon name={sortConfig.direction === 'asc' ? 'expand_less' : 'expand_more'} size={14} />}
      </div>
    </th>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 15, padding: 20, background: '#f3f4f6' }}>
      
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 900, margin: 0, color: UI.title }}>REPARACIONES Y SERVICE</h2>
          <p style={{ fontSize: 12, color: '#666', margin: 0 }}>Seguimiento técnico de equipos</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input 
            type="text" placeholder="Buscar cliente, equipo o falla..." 
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            style={styles.busqueda}
          />
          <button onClick={() => abrirModal()} style={styles.btnNuevo}>+ NUEVA REPARACIÓN</button>
          <button onClick={() => setShowTecnicos(true)} style={{ ...styles.btnNuevo, background: '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="group" size={16} /> TÉCNICOS</button>
        </div>
      </div>

      {/* TABLA */}
      <div style={styles.tableWrap}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ position: 'sticky', top: 0, background: UI.headerBg, zIndex: 10 }}>
            <tr>
              <SortableTh label="FECHA" field="fecha" width="10%" />
              <SortableTh label="CLIENTE" field="cliente" width="16%" />
              <SortableTh label="EQUIPO" field="equipo" width="14%" />
              <SortableTh label="MARCA" field="marca" width="12%" />
              <SortableTh label="MODELO" field="modelo" width="12%" />
              <SortableTh label="ESTADO" field="estado" width="12%" />
              <SortableTh label="TOTAL" field="total" width="10%" />
              <th style={{ ...styles.th, textAlign: 'center', width: '14%' }}>ACCIONES</th>
            </tr>
          </thead>
          <tbody>
            {itemsOrdenados.map((r) => (
              <tr key={r.id} style={styles.tr}>
                <td style={styles.td}>{new Date(r.fecha).toLocaleDateString('es-AR')}</td>
                <td style={styles.td}>
                  <div style={{ fontWeight: 700 }}>{r.cliente}</div>
                  <div style={{ fontSize: 11, color: '#666' }}>{r.telefono}</div>
                </td>
                <td style={{ ...styles.td, fontWeight: 600 }}>{r.equipo}</td>
                <td style={styles.td}>{r.marca || '-'}</td>
                <td style={styles.td}>{r.modelo || '-'}</td>
                <td style={styles.td}>
                  <select value={r.estado || 'Pendiente'} onChange={e => handleCambiarEstado(r.id, e.target.value)}
                    style={{
                      padding: '4px 6px', borderRadius: 6, border: '1px solid #ccc',
                      fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      color: r.estado === 'Entregado' ? '#16a34a' : r.estado === 'En Progreso' ? '#2563eb' : r.estado === 'Completado' ? '#d97706' : '#6b7280',
                      background: r.estado === 'Entregado' ? '#f0fdf4' : r.estado === 'En Progreso' ? '#eff6ff' : r.estado === 'Completado' ? '#fffbeb' : '#f9fafb',
                    }}>
                    <option value="Pendiente">Pendiente</option>
                    <option value="En Progreso">En Progreso</option>
                    <option value="Completado">Completado</option>
                    <option value="Entregado">Entregado</option>
                  </select>
                </td>
                <td style={{ ...styles.td, fontWeight: 800 }}>{fmt(r.total)}</td>
                <td style={{ ...styles.td, textAlign: 'center' }}>
                  <button onClick={() => abrirModal(r)} style={styles.btnAction}><Icon name="tune" color={UI.accent} size={18} /></button>
                  <button onClick={() => handleEliminar(r.id, r.cliente)} style={styles.btnAction}><Icon name="trash" color="#ef4444" size={18} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* MODAL */}
      {modal.show && (
        <div style={styles.overlay}>
          <div style={styles.modalContent}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontWeight: 900, color: UI.accent }}>
                {modal.data.id ? `EDITAR ORDEN #${modal.data.id}` : 'NUEVA ORDEN DE REPARACIÓN'}
              </h3>
              <button onClick={cerrarModal} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
              
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 15 }}>
                <div>
                  <label style={styles.label}>Cliente *</label>
                  <input style={styles.modalInput} value={modal.data.cliente} onChange={e => setModal({...modal, data: {...modal.data, cliente: e.target.value}})} />
                </div>
                <div>
                  <label style={styles.label}>Teléfono</label>
                  <input style={styles.modalInput} value={modal.data.telefono} onChange={e => setModal({...modal, data: {...modal.data, telefono: e.target.value}})} />
                </div>
                <div>
                  <label style={styles.label}>Fecha</label>
                  <input type="date" style={styles.modalInput} value={modal.data.fecha} onChange={e => setModal({...modal, data: {...modal.data, fecha: e.target.value}})} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 15 }}>
                <div>
                  <label style={styles.label}>Equipo *</label>
                  <input style={styles.modalInput} placeholder="Ej: Notebook" value={modal.data.equipo} onChange={e => setModal({...modal, data: {...modal.data, equipo: e.target.value}})} />
                </div>
                <div>
                  <label style={styles.label}>Marca</label>
                  <input style={styles.modalInput} value={modal.data.marca} onChange={e => setModal({...modal, data: {...modal.data, marca: e.target.value}})} />
                </div>
                <div>
                  <label style={styles.label}>Modelo</label>
                  <input style={styles.modalInput} value={modal.data.modelo} onChange={e => setModal({...modal, data: {...modal.data, modelo: e.target.value}})} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                <div>
                  <label style={styles.label}>Problema Reportado</label>
                  <textarea style={{...styles.modalInput, height: 60}} value={modal.data.problema} onChange={e => setModal({...modal, data: {...modal.data, problema: e.target.value}})} />
                </div>
                <div>
                  <label style={styles.label}>Accesorios</label>
                  <textarea style={{...styles.modalInput, height: 60}} value={modal.data.accesorios} onChange={e => setModal({...modal, data: {...modal.data, accesorios: e.target.value}})} />
                </div>
              </div>

              <div>
                <label style={styles.label}>Trabajo Realizado / Notas Técnicas</label>
                <textarea style={{...styles.modalInput, height: 50}} value={modal.data.arreglo} onChange={e => setModal({...modal, data: {...modal.data, arreglo: e.target.value}})} />
              </div>

              <div style={{ display: 'flex', gap: 15, alignItems: 'end' }}>
                <div style={{ flex: 1 }}>
                  <label style={styles.label}>Estado</label>
                  <select value={modal.data.estado || 'Pendiente'} onChange={e => setModal({...modal, data: {...modal.data, estado: e.target.value}})} style={styles.modalInput}>
                    <option value="Pendiente">Pendiente</option>
                    <option value="En Progreso">En Progreso</option>
                    <option value="Completado">Completado</option>
                    <option value="Entregado">Entregado</option>
                  </select>
                </div>
              </div>

              {/* AREA DE CIERRE DE ORDEN */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', background: '#f9fafb', padding: 15, borderRadius: 10, gap: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontWeight: 800, color: '#374151' }}>PRECIO FINAL:</span>
                  <input 
                    type="number" 
                    style={{...styles.modalInput, width: 150, fontSize: 20, fontWeight: 900, textAlign: 'right', color: UI.accent}} 
                    value={modal.data.total} 
                    onChange={e => setModal({...modal, data: {...modal.data, total: e.target.value}})} 
                  />
                </div>
              </div>

              <button onClick={handleGuardar} disabled={loading} style={styles.btnSave}>
                {loading ? 'PROCESANDO...' : modal.data.id ? 'ACTUALIZAR ORDEN' : 'REGISTRAR INGRESO'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL TÉCNICOS */}
      {showTecnicos && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#f3f4f6', borderRadius: 12, width: '90%', height: '90%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <Tecnicos onClose={() => setShowTecnicos(false)} />
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  th: { padding: '15px 20px', textAlign: 'left', fontSize: 11, fontWeight: 800, color: UI.headerText, textTransform: 'uppercase' },
  tr: { borderBottom: `1px solid ${UI.border}`, background: '#fff' },
  td: { padding: '12px 20px', color: '#374151' },
  btnAction: { background: 'none', border: 'none', cursor: 'pointer', padding: '5px' },
  tableWrap: { flex: 1, overflow: 'auto', border: `1px solid ${UI.border}`, borderRadius: 10, background: '#fff' },
  busqueda: { padding: '10px 15px', borderRadius: 8, border: `1px solid ${UI.border}`, width: 350, fontSize: 14 },
  btnNuevo: { background: UI.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 800, cursor: 'pointer' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modalContent: { background: '#fff', borderRadius: 12, padding: 30, width: 650, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' },
  label: { fontSize: 11, fontWeight: 700, color: '#666', marginBottom: 5, display: 'block' },
  modalInput: { width: '100%', padding: '10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 14, boxSizing: 'border-box' },
  btnSave: { background: UI.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '14px', fontWeight: 800, cursor: 'pointer' }
}