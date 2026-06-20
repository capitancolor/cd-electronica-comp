import { useState, useEffect, useMemo } from 'react'
import { getClientes, guardarCliente, eliminarCliente } from '../services/negocio'
import { Icon, toast, ConfirmDialog } from '../components/UI'

const UI = {
  headerBg: '#1f2937', 
  headerText: '#ffffff',
  border: '#e5e7eb',
  accent: '#2563eb'
}

const formatCUIT = (val) => {
  const num = val.replace(/\D/g, '');
  const cut = num.slice(0, 11);
  if (cut.length <= 2) return cut;
  if (cut.length <= 10) return `${cut.slice(0, 2)}-${cut.slice(2)}`;
  return `${cut.slice(0, 2)}-${cut.slice(2, 10)}-${cut.slice(10, 11)}`;
}

export default function Clientes() {
  const [clientes, setClientes] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState({ show: false, data: null })
  const [eliminarId, setEliminarId] = useState(null)

  // --- ESTADO DE ORDENAMIENTO ---
  const [sortConfig, setSortConfig] = useState({ field: 'nombre', direction: 'asc' })

  const estadoInicial = { 
    nombre: '', razon_social: '', cuit: '', direccion: '', condicion_iva: 'Consumidor Final' 
  }

  const cargar = async () => {
    try {
      const data = await getClientes(busqueda)
      setClientes(data)
    } catch (err) {
      toast("Error al cargar clientes", "error")
    }
  }

  useEffect(() => { cargar() }, [busqueda])

  // --- LÓGICA DE AUTOSORT ---
  const handleSort = (field) => {
    let direction = 'asc'
    if (sortConfig.field === field && sortConfig.direction === 'asc') {
      direction = 'desc'
    }
    setSortConfig({ field, direction })
  }

  const clientesOrdenados = useMemo(() => {
    const temp = [...clientes]
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
  }, [clientes, sortConfig])

  const abrirModal = (cliente = null) => {
    setModal({
      show: true,
      data: cliente ? { ...cliente } : { ...estadoInicial }
    })
  }

  const cerrarModal = () => setModal({ show: false, data: null })

  const handleGuardar = async () => {
    const { data } = modal
    if (!data.nombre) return toast("El nombre es obligatorio", "error")
    
    setLoading(true)
    try {
      await guardarCliente(data)
      toast(data.id ? "Cliente actualizado" : "Cliente creado")
      cerrarModal()
      cargar()
    } catch (err) {
      toast("Error al guardar", "error")
    } finally {
      setLoading(false)
    }
  }

  const handleEliminar = async () => {
    if (!eliminarId) return
    try {
      await eliminarCliente(eliminarId)
      setEliminarId(null)
      cargar()
      toast("Cliente eliminado")
    } catch (err) { toast("Error al eliminar", "error") }
  }

  // Componente de cabecera con Sort
  const SortableTh = ({ label, field, width }) => (
    <th 
      style={{ ...styles.th, width, cursor: 'pointer', userSelect: 'none' }} 
      onClick={() => handleSort(field)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        {label}
        <Icon 
          name={sortConfig.field === field ? (sortConfig.direction === 'asc' ? 'expand_less' : 'expand_more') : 'unfold_more'} 
          size={14} 
          color={sortConfig.field === field ? '#fff' : 'rgba(255,255,255,0.4)'}
        />
      </div>
    </th>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 15, padding: 20, background: '#f3f4f6' }}>
      
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 900, margin: 0, color: '#111' }}>GESTIÓN DE CLIENTES</h2>
          <p style={{ fontSize: 12, color: '#666', margin: 0 }}>Panel de administración de cartera</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input 
            type="text" 
            placeholder="Buscar por nombre o CUIT..." 
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            style={{ padding: '10px 15px', borderRadius: 8, border: `1px solid ${UI.border}`, width: 300, fontSize: 14 }}
          />
          <button onClick={() => abrirModal()} style={{ background: UI.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 800, cursor: 'pointer' }}>
            + NUEVO CLIENTE
          </button>
        </div>
      </div>

      {/* TABLA */}
      <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${UI.border}`, borderRadius: 10, background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ position: 'sticky', top: 0, background: UI.headerBg, zIndex: 10 }}>
            <tr>
              <SortableTh label="NOMBRE / CONTACTO" field="nombre" width="25%" />
              <SortableTh label="RAZÓN SOCIAL" field="razon_social" width="20%" />
              <SortableTh label="CUIT" field="cuit" width="15%" />
              <SortableTh label="DIRECCIÓN" field="direccion" width="20%" />
              <SortableTh label="IVA" field="condicion_iva" width="15%" />
              <th style={{ ...styles.th, textAlign: 'center', width: '5%' }}>ACCIONES</th>
            </tr>
          </thead>
          <tbody>
            {clientesOrdenados.length === 0 ? (
              <tr><td colSpan="6" style={{ textAlign: 'center', padding: 40, color: '#999' }}>No se encontraron clientes.</td></tr>
            ) : (
              clientesOrdenados.map((c) => (
                <tr key={c.id} style={styles.tr}>
                  <td style={{ ...styles.td, fontWeight: 700 }}>{c.nombre}</td>
                  <td style={styles.td}>{c.razon_social || '-'}</td>
                  <td style={{ ...styles.td, fontFamily: 'monospace' }}>{c.cuit || '-'}</td>
                  <td style={styles.td}>{c.direccion || '-'}</td>
                  <td style={styles.td}>{c.condicion_iva}</td>
                  <td style={{ ...styles.td, textAlign: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 5 }}>
                      <button onClick={() => abrirModal(c)} style={styles.btnAction} title="Editar"><Icon name="tune" color={UI.accent} size={18} /></button>
                      <button onClick={() => setEliminarId(c.id)} style={styles.btnAction} title="Eliminar"><Icon name="trash" color="#ef4444" size={18} /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL DE CLIENTE */}
      {modal.show && (
        <div style={styles.overlay}>
          <div style={styles.modalContent}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontWeight: 900 }}>{modal.data.id ? 'EDITAR CLIENTE' : 'NUEVO CLIENTE'}</h3>
              <button onClick={cerrarModal} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
              <div>
                <label style={styles.label}>Nombre Comercial / Contacto *</label>
                <input 
                  style={styles.modalInput} 
                  value={modal.data.nombre} 
                  onChange={e => setModal({...modal, data: {...modal.data, nombre: e.target.value}})}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                <div>
                  <label style={styles.label}>Razón Social</label>
                  <input 
                    style={styles.modalInput} 
                    value={modal.data.razon_social} 
                    onChange={e => setModal({...modal, data: {...modal.data, razon_social: e.target.value}})}
                  />
                </div>
                <div>
                  <label style={styles.label}>CUIT / CUIL</label>
                  <input 
                    style={styles.modalInput} 
                    placeholder="00-00000000-0"
                    value={modal.data.cuit} 
                    onChange={e => setModal({...modal, data: {...modal.data, cuit: formatCUIT(e.target.value)}})}
                  />
                </div>
              </div>

              <div>
                <label style={styles.label}>Dirección</label>
                <input 
                  style={styles.modalInput} 
                  value={modal.data.direccion} 
                  onChange={e => setModal({...modal, data: {...modal.data, direccion: e.target.value}})}
                />
              </div>

              <div>
                <label style={styles.label}>Condición IVA</label>
                <select 
                  style={styles.modalInput} 
                  value={modal.data.condicion_iva}
                  onChange={e => setModal({...modal, data: {...modal.data, condicion_iva: e.target.value}})}
                >
                  <option value="Responsable Inscripto">Responsable Inscripto</option>
                  <option value="Monotributo">Monotributo</option>
                  <option value="Consumidor Final">Consumidor Final</option>
                  <option value="Exento">Exento</option>
                </select>
              </div>

              <button 
                onClick={handleGuardar} 
                disabled={loading}
                style={{ ...styles.btnSave, opacity: loading ? 0.7 : 1 }}
              >
                {loading ? 'GUARDANDO...' : 'GUARDAR CLIENTE'}
              </button>
            </div>
          </div>
        </div>
      )}

      {eliminarId && (
        <ConfirmDialog
          title="Eliminar Cliente"
          message="¿Estás seguro de eliminar este cliente? Esta acción no se puede deshacer."
          confirmLabel="Eliminar"
          danger
          onConfirm={handleEliminar}
          onClose={() => setEliminarId(null)}
        />
      )}
    </div>
  )
}

const styles = {
  th: { padding: '15px 20px', textAlign: 'left', fontSize: 11, fontWeight: 800, color: UI.headerText, textTransform: 'uppercase', letterSpacing: '0.5px' },
  tr: { borderBottom: `1px solid ${UI.border}`, transition: '0.2s' },
  td: { padding: '12px 20px', color: '#374151' },
  btnAction: { background: 'none', border: 'none', cursor: 'pointer', padding: '5px' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modalContent: { background: '#fff', borderRadius: 12, padding: 30, width: 500, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' },
  label: { fontSize: 11, fontWeight: 700, color: '#666', marginBottom: 5, display: 'block' },
  modalInput: { width: '100%', padding: '10px', borderRadius: 6, border: '1px solid #ccc', outline: 'none', fontSize: 14, boxSizing: 'border-box', background: '#fff' },
  btnSave: { background: UI.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '14px', fontWeight: 800, cursor: 'pointer', marginTop: 10 }
}