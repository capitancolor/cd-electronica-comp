import { useState, useEffect, useMemo, useRef } from 'react'
import { getReparaciones, guardarReparacion, eliminarReparacion, getTecnicos, registrarPagoReparacion } from '../services/negocio'
import { Icon, toast, ConfirmDialog } from '../components/UI'
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

const fmt = v => '$' + Number(v || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Reparaciones({ usuario, config }) {
  const [items, setItems] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState({ show: false, data: null })
  const [sortConfig, setSortConfig] = useState({ field: 'fecha', direction: 'desc' })
  const [showTecnicos, setShowTecnicos] = useState(false)
  const [tecnicosList, setTecnicosList] = useState([])
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [repuestoBusqueda, setRepuestoBusqueda] = useState('')
  const [repuestoResultados, setRepuestoResultados] = useState([])
  const [showCobrarModal, setShowCobrarModal] = useState(false)
  const [cobrarReparacion, setCobrarReparacion] = useState(null)
  const [metodoPagoCobro, setMetodoPagoCobro] = useState('efectivo')
  const [cobrando, setCobrando] = useState(false)
  const [mixtoDataRep, setMixtoDataRep] = useState({ efectivo: '', tarjeta: '', transferencia: '' })
  const priceRef = useRef(null)

  useEffect(() => {
    getTecnicos().then(setTecnicosList).catch(() => {})
  }, [])

  const estadoInicial = { 
    fecha: new Date().toISOString().split('T')[0],
    cliente: '', telefono: '', equipo: '', marca: '', modelo: '', 
    problema: '', arreglo: '', accesorios: '', service: false, precio: '', costo: '', estado: 'En Progreso', tecnico_id: null,
    repuestos: []
  }

  const cargar = async () => {
    try {
      const data = await getReparaciones(busqueda)
      setItems(data)
    } catch (err) { toast("Error al cargar", "error") }
  }

  useEffect(() => { cargar() }, [busqueda])

  // Búsqueda de productos para repuestos
  useEffect(() => {
    if (!modal.show) return;
    const q = repuestoBusqueda.trim();
    if (!q) { setRepuestoResultados([]); return; }
    const t = setTimeout(async () => {
      try {
        const db = await Database.load("sqlite:cd_electronica.db");
        const palabras = q.split(/\s+/).filter(Boolean);
        const condiciones = palabras.map(() => "(nombre LIKE ? OR marca LIKE ? OR modelo LIKE ?)");
        const params = [];
        for (const pal of palabras) {
          const term = `%${pal}%`;
          params.push(term, term, term);
        }
        const data = await db.select(
          `SELECT * FROM productos WHERE activo = 1 AND (${condiciones.join(" AND ")}) LIMIT 20`,
          params
        );
        setRepuestoResultados(data || []);
      } catch (e) { console.error("Error buscando repuestos:", e); }
    }, 250);
    return () => clearTimeout(t);
  }, [repuestoBusqueda, modal.show]);

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
    setRepuestoBusqueda('');
    setRepuestoResultados([]);
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
    if (typeof data.precio === 'number' && !isNaN(data.precio)) {
      data.precio = data.precio > 0 ? data.precio.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    }
    if (typeof data.costo === 'number' && !isNaN(data.costo)) {
      data.costo = data.costo > 0 ? data.costo.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
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

  const handleEliminar = async () => {
    if (!confirmDelete) return
    try { await eliminarReparacion(confirmDelete.id); cargar(); toast("Eliminado"); setConfirmDelete(null) } 
    catch (err) { toast("Error", "error"); setConfirmDelete(null) }
  }

  const confirmarEliminar = (id, cliente) => setConfirmDelete({ id, cliente })

  const agregarRepuesto = (prod) => {
    const lista = modal.data.repuestos || [];
    const idx = lista.findIndex(r => r.producto_id === prod.id);
    if (idx >= 0) {
      lista[idx].cantidad += 1;
    } else {
      lista.push({ producto_id: prod.id, nombre: prod.nombre, cantidad: 1 });
    }
    setModal({...modal, data: {...modal.data, repuestos: [...lista]}});
    setRepuestoBusqueda('');
    setRepuestoResultados([]);
  };

  const quitarRepuesto = (productoId) => {
    const lista = (modal.data.repuestos || []).filter(r => r.producto_id !== productoId);
    setModal({...modal, data: {...modal.data, repuestos: lista}});
  };

  const cambiarCantidadRepuesto = (productoId, delta) => {
    const lista = (modal.data.repuestos || []).map(r =>
      r.producto_id === productoId ? { ...r, cantidad: Math.max(1, r.cantidad + delta) } : r
    );
    setModal({...modal, data: {...modal.data, repuestos: lista}});
  };

  const handlePriceChange = (field) => (e) => {
    const input = e.target;
    const cursorPos = input.selectionStart;
    const raw = e.target.value;

    const rawBefore = raw.slice(0, cursorPos).replace(/[^\d,\-]/g, '');
    const relevantLen = rawBefore.length;

    let cleaned = raw.replace(/[^\d,\-]/g, '');
    const isNegative = cleaned.startsWith('-') ? '-' : '';
    if (isNegative) cleaned = cleaned.slice(1);

    const commaIdx = cleaned.indexOf(',');
    let intPart = cleaned;
    let decPart = '';
    if (commaIdx !== -1) {
      intPart = cleaned.slice(0, commaIdx);
      decPart = cleaned.slice(commaIdx + 1).replace(/\D/g, '').slice(0, 2);
    }

    const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    let result = isNegative + formattedInt;
    if (commaIdx !== -1 || raw.endsWith(',')) {
      result += ',' + decPart;
    }

    let newCursor = result.length;
    if (relevantLen === 0) {
      newCursor = 0;
    } else {
      let count = 0;
      for (let i = 0; i < result.length; i++) {
        if (/[\d,\-]/.test(result[i])) count++;
        if (count >= relevantLen) { newCursor = i + 1; break; }
      }
    }

    if (result !== modal.data[field]) {
      setModal({...modal, data: {...modal.data, [field]: result}});
    }
    requestAnimationFrame(() => {
      if (input === document.activeElement) {
        input.selectionStart = input.selectionEnd = newCursor;
      }
    });
  };

  const totalBaseCobro = Number(cobrarReparacion?.total || 0)
  const nEfectivoRep = Number(mixtoDataRep.efectivo) || 0
  const nTarjetaRep = Number(mixtoDataRep.tarjeta) || 0
  const nTransferenciaRep = Number(mixtoDataRep.transferencia) || 0
  const recargoTarjetaCobro = metodoPagoCobro === 'tarjeta' ? totalBaseCobro * 0.10 : (metodoPagoCobro === 'mixto' ? nTarjetaRep * 0.10 : 0)
  const totalFinalCobro = totalBaseCobro + recargoTarjetaCobro
  const totalIngresadoRep = nEfectivoRep + nTarjetaRep + nTransferenciaRep
  const faltaCubrirRep = totalBaseCobro - totalIngresadoRep

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
              <SortableTh label="FECHA" field="fecha" width="9%" />
              <SortableTh label="CLIENTE" field="cliente" width="14%" />
              <SortableTh label="EQUIPO" field="equipo" width="13%" />
              <SortableTh label="MARCA" field="marca" width="10%" />
              <SortableTh label="MODELO" field="modelo" width="10%" />
              <SortableTh label="TÉCNICO" field="tecnico_id" width="10%" />
              <SortableTh label="ESTADO" field="estado" width="10%" />
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
                <td style={styles.td}>{tecnicosList.find(t => t.id === r.tecnico_id)?.nombre || '-'}</td>
                <td style={styles.td}>
                  <select value={r.estado || 'En Progreso'} onChange={e => handleCambiarEstado(r.id, e.target.value)}
                    style={{
                      padding: '4px 6px', borderRadius: 6, border: '1px solid #ccc',
                      fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      color: r.estado === 'Entregado' ? '#16a34a' : r.estado === 'En Progreso' ? '#2563eb' : r.estado === 'Completado' ? '#d97706' : r.estado === 'Sin Arreglo' ? '#dc2626' : '#6b7280',
                      background: r.estado === 'Entregado' ? '#f0fdf4' : r.estado === 'En Progreso' ? '#eff6ff' : r.estado === 'Completado' ? '#fffbeb' : r.estado === 'Sin Arreglo' ? '#fef2f2' : '#f9fafb',
                    }}>
                    <option value="En Progreso">En Progreso</option>
                    <option value="Completado">Completado</option>
                    <option value="Entregado">Entregado</option>
                    <option value="Sin Arreglo">Sin Arreglo</option>
                  </select>
                </td>
                <td style={{ ...styles.td, fontWeight: 800 }}>{fmt(r.total)}</td>
                <td style={{ ...styles.td, textAlign: 'center' }}>
                  {(!r.cobrado && (r.estado === 'Completado' || r.estado === 'Entregado')) && (
                    <button onClick={() => { setCobrarReparacion(r); setShowCobrarModal(true); }} style={{ ...styles.btnAction, color: '#16a34a', fontWeight: 800, fontSize: 11 }}>COBRAR</button>
                  )}
                  <button onClick={() => abrirModal(r)} style={styles.btnAction}><Icon name="tune" color={UI.accent} size={18} /></button>
                  <button onClick={() => confirmarEliminar(r.id, r.cliente)} style={styles.btnAction}><Icon name="trash" color="#ef4444" size={18} /></button>
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

              <div style={{ display: 'flex', gap: 15, alignItems: 'end' }}>
                <div style={{ flex: 1 }}>
                  <label style={styles.label}>Estado</label>
                  <select value={modal.data.estado || 'En Progreso'} onChange={e => setModal({...modal, data: {...modal.data, estado: e.target.value}})} style={styles.modalInput}>
                    <option value="En Progreso">En Progreso</option>
                    <option value="Completado">Completado</option>
                    <option value="Entregado">Entregado</option>
                    <option value="Sin Arreglo">Sin Arreglo</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={styles.label}>Técnico Asignado</label>
                  <select value={modal.data.tecnico_id || ''} onChange={e => setModal({...modal, data: {...modal.data, tecnico_id: e.target.value ? Number(e.target.value) : null}})} style={styles.modalInput}>
                    <option value="">Sin asignar</option>
                    {tecnicosList.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                  </select>
                </div>
              </div>

              {/* REPUESTOS UTILIZADOS */}
              <div style={{ background: '#f8fafc', padding: 15, borderRadius: 10, border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontWeight: 800, color: '#374151', fontSize: 13 }}>REPUESTOS DEL LOCAL</span>
                  <span style={{ fontSize: 11, color: '#6b7280' }}>Se descontarán del stock al cobrar</span>
                </div>

                {modal.data.repuestos && modal.data.repuestos.length > 0 && (
                  <div style={{ marginBottom: 10, border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: '#e2e8f0' }}>
                          <th style={{ padding: '6px 10px', textAlign: 'left' }}>Producto</th>
                          <th style={{ padding: '6px 10px', textAlign: 'center', width: 100 }}>Cant.</th>
                          <th style={{ padding: '6px 10px', textAlign: 'center', width: 50 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(modal.data.repuestos || []).map((r, i) => (
                          <tr key={r.producto_id || i} style={{ borderTop: '1px solid #e2e8f0' }}>
                            <td style={{ padding: '6px 10px', fontWeight: 600 }}>{r.nombre}</td>
                            <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                <button onClick={() => cambiarCantidadRepuesto(r.producto_id, -1)} style={{ border: '1px solid #ccc', background: '#fff', borderRadius: 4, cursor: 'pointer', padding: '2px 5px', fontSize: 12 }}>-</button>
                                <span style={{ fontWeight: 800, fontSize: 14 }}>{r.cantidad}</span>
                                <button onClick={() => cambiarCantidadRepuesto(r.producto_id, 1)} style={{ border: '1px solid #ccc', background: '#fff', borderRadius: 4, cursor: 'pointer', padding: '2px 5px', fontSize: 12 }}>+</button>
                              </div>
                            </td>
                            <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                              <button onClick={() => quitarRepuesto(r.producto_id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 14 }}>✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text" placeholder="Buscar producto para agregar como repuesto..."
                    value={repuestoBusqueda}
                    onChange={e => setRepuestoBusqueda(e.target.value)}
                    style={{ flex: 1, padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 13 }}
                  />
                </div>

                {repuestoBusqueda.trim() && repuestoResultados.length > 0 && (
                  <div style={{ marginTop: 6, border: '1px solid #e2e8f0', borderRadius: 6, maxHeight: 150, overflowY: 'auto', background: '#fff' }}>
                    {repuestoResultados.map(p => (
                      <div key={p.id} onClick={() => agregarRepuesto(p)}
                        style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', transition: 'background 0.2s', color: '#111827' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                        onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                      >
                        <div style={{ flex: 2, fontWeight: 700, fontSize: 13, color: '#111827' }}>{p.nombre}</div>
                        <div style={{ flex: 1, fontSize: 12, color: '#6b7280' }}>{p.marca || '-'}</div>
                        <div style={{ flex: 1, fontSize: 12, color: '#6b7280' }}>{p.modelo || '-'}</div>
                        <div style={{ width: 60, textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                          L1: {p.stock_l1 || 0} / L2: {p.stock_l2 || 0}
                        </div>
                        <div style={{ width: 30, textAlign: 'right', color: '#2563eb' }}><Icon name="plus" size={16} /></div>
                      </div>
                    ))}
                  </div>
                )}
                {repuestoBusqueda.trim() && repuestoResultados.length === 0 && (
                  <div style={{ marginTop: 6, padding: 10, textAlign: 'center', color: '#999', fontSize: 12 }}>Sin resultados</div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                <div>
                  <label style={styles.label}>Costo de la Reparación</label>
                  <input
                    type="text" inputMode="decimal"
                    value={modal.data.costo}
                    onChange={handlePriceChange('costo')}
                    placeholder="0,00"
                    style={{ ...styles.modalInput, fontWeight: 800, color: '#dc2626' }}
                  />
                </div>
                <div>
                  <label style={styles.label}>Precio de Reparación</label>
                  <input
                    type="text" inputMode="decimal"
                    value={modal.data.precio}
                    onChange={handlePriceChange('precio')}
                    placeholder="0,00"
                    style={{ ...styles.modalInput, fontWeight: 800, color: '#16a34a' }}
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

      {/* MODAL COBRAR REPARACIÓN */}
      {showCobrarModal && cobrarReparacion && (
        <div style={styles.overlay}>
          <div style={{ ...styles.modalContent, width: 550 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontWeight: 900, color: UI.accent }}>COBRAR REPARACIÓN</h3>
              <button onClick={() => { setShowCobrarModal(false); setCobrarReparacion(null); setMixtoDataRep({ efectivo: '', tarjeta: '', transferencia: '' }); }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
              <div style={{ background: '#f0fdf4', padding: 15, borderRadius: 10, border: '1px solid #bbf7d0' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 14 }}>
                  <div><span style={{ fontWeight: 700, color: '#666' }}>Cliente:</span> <b>{cobrarReparacion.cliente}</b></div>
                  <div><span style={{ fontWeight: 700, color: '#666' }}>Equipo:</span> <b>{cobrarReparacion.equipo}</b></div>
                  <div><span style={{ fontWeight: 700, color: '#666' }}>Marca:</span> <b>{cobrarReparacion.marca || '-'}</b></div>
                  <div><span style={{ fontWeight: 700, color: '#666' }}>Modelo:</span> <b>{cobrarReparacion.modelo || '-'}</b></div>
                </div>
              </div>

              {cobrarReparacion.repuestos && cobrarReparacion.repuestos.length > 0 && (
                <div style={{ background: '#fffbeb', padding: 15, borderRadius: 10, border: '1px solid #fde68a' }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: '#92400e', marginBottom: 8 }}>⚠️ REPUESTOS A DESCONTAR DEL STOCK:</div>
                  {cobrarReparacion.repuestos.map((r, i) => (
                    <div key={r.producto_id || i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                      <span>{r.nombre}</span>
                      <span style={{ fontWeight: 800 }}>x{r.cantidad}</span>
                    </div>
                  ))}
                  <div style={{ fontSize: 11, color: '#92400e', marginTop: 6 }}>
                    * Los repuestos se descuentan del stock a precio $0 (incluidos en el total de la reparación)
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f9fafb', padding: 15, borderRadius: 10 }}>
                <span style={{ fontWeight: 800, fontSize: 16, color: '#374151' }}>SUBTOTAL:</span>
                <span style={{ fontWeight: 900, fontSize: 24, color: '#374151' }}>
                  ${totalBaseCobro.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              {recargoTarjetaCobro > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 15px' }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#dc2626' }}>Recargo tarjeta (10%):</span>
                  <span style={{ fontWeight: 900, fontSize: 18, color: '#dc2626' }}>
                    +${recargoTarjetaCobro.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f0fdf4', padding: 15, borderRadius: 10, border: '1px solid #bbf7d0' }}>
                <span style={{ fontWeight: 800, fontSize: 16, color: '#374151' }}>TOTAL A COBRAR:</span>
                <span style={{ fontWeight: 900, fontSize: 28, color: '#16a34a' }}>
                  ${totalFinalCobro.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#666', marginBottom: 5, display: 'block' }}>MÉTODO DE PAGO</label>
                <select value={metodoPagoCobro} onChange={e => { setMetodoPagoCobro(e.target.value); setMixtoDataRep({ efectivo: '', tarjeta: '', transferencia: '' }); }} style={{ width: '100%', padding: 10, borderRadius: 6, border: '1px solid #ccc', fontSize: 14, fontWeight: 700 }}>
                  <option value="efectivo">💵 Efectivo</option>
                  <option value="tarjeta">💳 Tarjeta (+10%)</option>
                  <option value="transferencia">🏦 Transferencia</option>
                  <option value="mixto">🔀 Pago Mixto</option>
                </select>
              </div>

              {metodoPagoCobro === 'mixto' && (
                <div style={{ display: 'flex', gap: 8, background: '#f8fafc', padding: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 9, fontWeight: 900, display: 'block', color: '#666' }}>EFECTIVO</span>
                    <input type="number" value={mixtoDataRep.efectivo} onChange={e => setMixtoDataRep({ ...mixtoDataRep, efectivo: e.target.value })}
                      style={{ width: '100%', height: 35, borderRadius: 6, border: '1px solid #ccc', padding: '0 8px', fontWeight: 700 }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 9, fontWeight: 900, display: 'block', color: '#666' }}>TARJETA</span>
                    <input type="number" value={mixtoDataRep.tarjeta} onChange={e => setMixtoDataRep({ ...mixtoDataRep, tarjeta: e.target.value })}
                      style={{ width: '100%', height: 35, borderRadius: 6, border: '1px solid #ccc', padding: '0 8px', fontWeight: 700 }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 9, fontWeight: 900, display: 'block', color: '#666' }}>TRANSF.</span>
                    <input type="number" value={mixtoDataRep.transferencia} onChange={e => setMixtoDataRep({ ...mixtoDataRep, transferencia: e.target.value })}
                      style={{ width: '100%', height: 35, borderRadius: 6, border: '1px solid #ccc', padding: '0 8px', fontWeight: 700 }} />
                  </div>
                </div>
              )}
              {metodoPagoCobro === 'mixto' && faltaCubrirRep > 0 && (
                <div style={{ textAlign: 'center', color: '#dc2626', fontWeight: 700, fontSize: 13 }}>
                  FALTAN: ${faltaCubrirRep.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              )}

              <button onClick={async () => {
                if (metodoPagoCobro === 'mixto' && faltaCubrirRep > 0) return toast('Completá los montos del pago mixto', 'error');
                setCobrando(true);
                try {
                  const res = await registrarPagoReparacion({
                    reparacionId: cobrarReparacion.id,
                    localId: config?.local_id || 1,
                    usuarioId: usuario?.id,
                    metodoPago: metodoPagoCobro,
                    totalFinal: totalFinalCobro,
                    detalleMixto: metodoPagoCobro === 'mixto' ? mixtoDataRep : undefined
                  });
                  toast('Reparación cobrada correctamente');
                  setShowCobrarModal(false);
                  setCobrarReparacion(null);
                  setMixtoDataRep({ efectivo: '', tarjeta: '', transferencia: '' });
                  await cargar();
                } catch (err) {
                  toast(err.message, 'error');
                } finally {
                  setCobrando(false);
                }
              }} disabled={cobrando || (metodoPagoCobro === 'mixto' && faltaCubrirRep > 0)} style={{
                background: UI.accent, color: '#fff', border: 'none', borderRadius: 8,
                padding: 14, fontWeight: 800, cursor: cobrando ? 'not-allowed' : 'pointer', fontSize: 16
              }}>
                {cobrando ? 'PROCESANDO...' : `COBRAR ${totalFinalCobro.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Eliminar Reparación"
          message={`¿Estás seguro de eliminar la orden de "${confirmDelete.cliente}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          danger
          onConfirm={handleEliminar}
          onClose={() => setConfirmDelete(null)}
        />
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
  modalContent: { background: '#fff', borderRadius: 12, padding: 30, width: 650, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', color: '#111827' },
  label: { fontSize: 11, fontWeight: 700, color: '#666', marginBottom: 5, display: 'block' },
  modalInput: { width: '100%', padding: '10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 14, boxSizing: 'border-box' },
  btnSave: { background: UI.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '14px', fontWeight: 800, cursor: 'pointer' }
}