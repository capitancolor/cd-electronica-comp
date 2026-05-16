import { useState, useEffect, useMemo } from 'react'
import { getVentas, getGastos, registrarGasto, eliminarGasto, actualizarGasto } from '../services/negocio'
import { Icon, Badge, toast } from '../components/UI'
import { exportarGastosExcel } from '../services/exportExcel'

const fmt = v => '$' + Number(v || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })

const UI = {
  headerBg: '#1f2937', headerText: '#191616', border: '#e5e7eb', accent: '#2563eb',
  cardBg: '#ffffff', cardBorder: '#d1d5db', pageBg: '#f3f4f6',
  statGastos: '#dc2626', statGanancia: '#16a34a',
  inputBg: '#ffffff', inputBorder: '#d1d5db'
}

function StatCard({ label, value, icon, color }) {
  return (
    <div style={{ background: UI.cardBg, border: `1px solid ${UI.cardBorder}`, borderRadius: 12, padding: 15, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
        <Icon name={icon} size={14} color={color} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 900, color }}>{value}</div>
    </div>
  )
}

export default function Gastos({ usuario }) {
  const [gastos, setGastos] = useState([])
  const [ventas, setVentas] = useState([])
  const [loading, setLoading] = useState(false)
  const hoy = new Date()
  const [mesActual, setMesActual] = useState(hoy.getMonth())
  const [anioActual, setAnioActual] = useState(hoy.getFullYear())
  const [modal, setModal] = useState({ show: false, data: null })

  const estadoInicial = { descripcion: '', monto: '', dias_aplicados: [] }

  useEffect(() => { cargarDatos() }, [mesActual, anioActual])



async function cargarDatos() {
  setLoading(true);
  const desde = `${anioActual}-${String(mesActual + 1).padStart(2, '0')}-01`;
  const ultimoDia = new Date(anioActual, mesActual + 1, 0).getDate();
  const hasta = `${anioActual}-${String(mesActual + 1).padStart(2, '0')}-${ultimoDia}`;

  try {
    // 1. Probamos ventas primero
    console.log("Intentando cargar ventas...");
    const v = await getVentas({ fechaDesde: desde, fechaHasta: hasta, limit: 1000 });
    setVentas(v || []);

    // 2. Probamos gastos después (separado para aislar el error)
    console.log("Intentando cargar gastos...");
    if (typeof getGastos !== 'function') {
      throw new Error("getGastos no es una función. Revisar importación.");
    }
    
    const g = await getGastos(desde, hasta);
    setGastos(g || []);

  } catch (err) {
    console.error("ERROR DETECTADO EN CD ELECTRONICA:");
    console.error("Mensaje:", err.message);
    console.error("Stack:", err.stack);
    toast("Error: " + err.message, "error");
  } finally {
    setLoading(false);
  }
}

  // --- LÓGICA DE SELECCIÓN RÁPIDA ---
  const diasEnMes = new Date(anioActual, mesActual + 1, 0).getDate()
  
  const selHabiles = () => {
    const habiles = []
    for (let d = 1; d <= diasEnMes; d++) {
      const day = new Date(anioActual, mesActual, d).getDay()
      if (day !== 0 && day !== 6) habiles.push(d) // 0=Dom, 6=Sab
    }
    setModal({ ...modal, data: { ...modal.data, dias_aplicados: habiles } })
  }

  const abrirModal = (gasto = null) => {
    setModal({
      show: true,
      data: gasto ? { ...gasto, dias_aplicados: gasto.dias_aplicados || [] } : { ...estadoInicial }
    })
  }

  const cerrarModal = () => setModal({ show: false, data: null })

  const handleGuardar = async () => {
    const { data } = modal
    if (!data.descripcion || !data.monto) return toast("Completar descripción y monto", "error")
    setLoading(true)
    try {
      const payload = {
        ...data,
        monto: parseFloat(data.monto),
        usuario_id: usuario.id,
        fecha: new Date(anioActual, mesActual, 1).toISOString(),
        dias_aplicados: data.dias_aplicados?.length > 0 ? data.dias_aplicados : null
      }
      if (data.id) await actualizarGasto(data.id, payload)
      else await registrarGasto(payload)
      toast(data.id ? "Gasto actualizado" : "Gasto registrado")
      cerrarModal()
      cargarDatos()
    } catch (err) { toast("Error al procesar", "error") } finally { setLoading(false) }
  }

  const handleEliminar = async (id) => {
    if (window.confirm('¿Eliminar este gasto?')) {
      try {
        await eliminarGasto(id)
        cargarDatos()
        toast("Eliminado")
      } catch (err) { toast("Error", "error") }
    }
  }

  const getGastoParaDia = (dia) => {
    return gastos.reduce((acc, g) => {
      const aplicados = g.dias_aplicados || Array.from({ length: diasEnMes }, (_, i) => i + 1)
      if (!aplicados.includes(dia)) return acc
      const porDia = Math.floor(Number(g.monto) / aplicados.length)
      const resto = Number(g.monto) - porDia * aplicados.length
      const ultimoDia = Math.max(...aplicados)
      return acc + porDia + (dia === ultimoDia ? resto : 0)
    }, 0)
  }

  const totalGastosMes = gastos.reduce((s, g) => s + Number(g.monto), 0)
  const totalGananciaMes = ventas.reduce((s, v) => s + (Number(v.total) - Number(v.costo_total || 0)), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 15, padding: 20, background: UI.pageBg }}>
      
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 15, alignItems: 'center' }}>
          <h2 style={{ fontSize: 20, fontWeight: 900, margin: 0, color: '#111827'}}>CONTROL DE GASTOS</h2>
          <div style={{ display: 'flex', gap: 5 }}>
            <select value={mesActual} onChange={e => setMesActual(Number(e.target.value))} style={styles.selectHeader}>
              {['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'].map((m, i) => (
                <option key={i} value={i}>{m}</option>
              ))}
            </select>
            <select value={anioActual} onChange={e => setAnioActual(Number(e.target.value))} style={styles.selectHeader}>
              {[2025, 2026].map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* STATS */}
      <div style={{ display: 'flex', gap: 15 }}>
        <StatCard label="Total Gastos del Mes" value={fmt(totalGastosMes)} icon="reports" color={UI.statGastos} />
        <StatCard label="Obj. Diario" value={fmt(totalGastosMes / diasEnMes)} icon="check" color="#d97706" />
        <StatCard label="Ganancia en el Mes" value={fmt(totalGananciaMes)} icon="pos" color={UI.statGanancia} />
        <StatCard label="Balance Neto" value={fmt(totalGananciaMes - totalGastosMes)} icon="stock" color={(totalGananciaMes - totalGastosMes) >= 0 ? UI.statGanancia : UI.statGastos} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20, flex: 1, minHeight: 0 }}>
        
        {/* TABLA DE GASTOS CON EL BOTÓN AQUÍ */}
        <div style={styles.containerCol}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: `1px solid ${UI.border}` }}>
            <h3 style={{ ...styles.colTitle, padding: 0, border: 'none' }}>DETALLE DE GASTOS</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { console.log('Gastos a exportar:', gastos?.length || 0); exportarGastosExcel(gastos); }} title="Exportar a Excel" style={{ ...styles.btnNuevoTabla, background: '#16a34a' }}>
                📊 EXCEL
              </button>
              <button onClick={() => abrirModal()} style={styles.btnNuevoTabla}>+ NUEVO GASTO</button>
            </div>
          </div>
          <div style={{ overflow: 'auto' }}>
            <table style={styles.table}>
              <thead style={styles.thead}>
                <tr>
                  <th style={styles.th}>DESCRIPCIÓN</th>
                  <th style={styles.th}>APLICACIÓN</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>MONTO</th>
                  <th style={{ ...styles.th, textAlign: 'center' }}>ACCIONES</th>
                </tr>
              </thead>
              <tbody>
                {gastos.map(g => (
                  <tr key={g.id} style={styles.tr}>
                    <td style={{ ...styles.td, fontWeight: 700 }}>{g.descripcion}</td>
                    <td style={styles.td}>
                      <Badge color="#6b7280">{g.dias_aplicados ? `${g.dias_aplicados.length} días` : 'Mes Completo'}</Badge>
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: 900, color: UI.statGastos }}>{fmt(g.monto)}</td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>
                      <button onClick={() => abrirModal(g)} style={styles.actionBtn} title="Editar"><Icon name="tune" color={UI.accent} size={16} /></button>
                      <button onClick={() => handleEliminar(g.id)} style={styles.actionBtn} title="Eliminar"><Icon name="trash" color="#ef4444" size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* RENDIMIENTO DIARIO */}
        <div style={styles.containerCol}>
          <h3 style={styles.colTitle}>RENDIMIENTO POR DÍA</h3>
          <div style={{ overflow: 'auto' }}>
            <table style={styles.table}>
              <thead style={styles.thead}>
                <tr>
                  <th style={styles.th}>DÍA</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>GANANCIA</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>GASTO</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>BALANCE</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: diasEnMes }, (_, i) => {
                  const d = i + 1;
                  const gDia = getGastoParaDia(d);
                  const vDia = ventas.filter(v => new Date(v.fecha).getDate() === d);
                  const ganDia = vDia.reduce((acc, v) => acc + (Number(v.total) - Number(v.costo_total || 0)), 0);
                  const bal = ganDia - gDia;
                  const esFuturo = (anioActual === hoy.getFullYear() && mesActual === hoy.getMonth() && d > hoy.getDate());
                  return (
                    <tr key={d} style={{ ...styles.tr, opacity: esFuturo ? 0.4 : 1 }}>
                      <td style={{ ...styles.td, fontWeight: 700 }}>Día {d}</td>
                      <td style={{ ...styles.td, textAlign: 'right', color: UI.statGanancia }}>{ganDia > 0 ? fmt(ganDia) : '-'}</td>
                      <td style={{ ...styles.td, textAlign: 'right', color: UI.statGastos }}>{fmt(gDia)}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontWeight: 800, color: bal >= 0 ? UI.statGanancia : UI.statGastos }}>
                        {fmt(bal)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* MODAL GASTO */}
        {/* MODAL GASTO */}
      {modal.show && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontWeight: 900 }}>{modal.data.id ? 'EDITAR GASTO' : 'NUEVO GASTO'}</h3>
              <button onClick={cerrarModal} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input placeholder="Descripción..." style={styles.input} value={modal.data.descripcion} onChange={e => setModal({...modal, data: {...modal.data, descripcion: e.target.value}})} />
              <input type="number" placeholder="Monto Total" style={{ ...styles.input, fontSize: 18, fontWeight: 900 }} value={modal.data.monto} onChange={e => setModal({...modal, data: {...modal.data, monto: e.target.value}})} />
              
              <div style={styles.calendarContainer}>
                <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
                  <button style={styles.btnQuick} onClick={() => setModal({...modal, data: {...modal.data, dias_aplicados: Array.from({length: diasEnMes}, (_,i)=>i+1)}})}>Todos</button>
                  <button style={styles.btnQuick} onClick={selHabiles}>Hábiles</button>
                  <button style={{...styles.btnQuick, color: '#ef4444'}} onClick={() => setModal({...modal, data: {...modal.data, dias_aplicados: []}})}>Limpiar</button>
                </div>

                <div style={styles.gridDias}>
                  {/* CABECERA DE DÍAS */}
                  {['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'].map(d => (
                    <div key={d} style={{ textAlign: 'center', fontSize: 9, fontWeight: 900, color: '#9ca3af', paddingBottom: 5 }}>{d}</div>
                  ))}

                  {/* OFFSET (Espacios vacíos para que el día 1 caiga donde debe) */}
                  {(() => {
                    const primerDiaMes = new Date(anioActual, mesActual, 1).getDay();
                    const offset = primerDiaMes === 0 ? 6 : primerDiaMes - 1; // Ajuste para que empiece en Lunes
                    return Array.from({ length: offset }).map((_, i) => <div key={`off-${i}`} />);
                  })()}

                  {/* DÍAS DEL MES */}
                  {Array.from({ length: diasEnMes }, (_, i) => {
                    const d = i + 1;
                    const isSel = modal.data.dias_aplicados.includes(d);
                    const fechaDia = new Date(anioActual, mesActual, d);
                    const esFinde = (fechaDia.getDay() === 0 || fechaDia.getDay() === 6);
                    
                    return (
                      <div 
                        key={d} 
                        onClick={() => {
                          const list = modal.data.dias_aplicados.includes(d) 
                            ? modal.data.dias_aplicados.filter(x => x !== d) 
                            : [...modal.data.dias_aplicados, d];
                          setModal({...modal, data: {...modal.data, dias_aplicados: list}});
                        }} 
                        style={{ 
                          ...styles.dia, 
                          background: isSel ? UI.accent : (esFinde ? '#fff0f0' : '#ffffff'), 
                          color: isSel ? '#fff' : (esFinde ? '#dc2626' : '#333'), 
                          border: `1px solid ${isSel ? UI.accent : '#e5e7eb'}` 
                        }}
                      >
                        {d}
                      </div>
                    )
                  })}
                </div>
                <div style={{ fontSize: 9, color: '#6b7280', marginTop: 10, textAlign: 'center' }}>
                  {modal.data.dias_aplicados.length === 0 ? 
                    'IMPORTANTE: Si no marcás días, se amortiza en el MES COMPLETO.' : 
                    `Amortizando en ${modal.data.dias_aplicados.length} días seleccionados.`}
                </div>
              </div>

              <button onClick={handleGuardar} disabled={loading} style={styles.btnGuardar}>
                {loading ? 'GUARDANDO...' : 'GUARDAR GASTO'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  containerCol: { background: '#fff', borderRadius: 12, border: `1px solid ${UI.border}`, display: 'flex', flexDirection: 'column', minHeight: 0, boxShadow: '0 2px 4px rgba(0,0,0,0.05)' },
  colTitle: { margin: 0, padding: '15px 20px', fontSize: 13, fontWeight: 800, borderBottom: `1px solid ${UI.border}`, color: '#374151' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  thead: { position: 'sticky', top: 0, background: '#f9fafb', zIndex: 5 },
  th: { padding: '12px 20px', textAlign: 'left', fontSize: 11, color: '#dbdee3', textTransform: 'uppercase' },
  tr: { borderBottom: `1px solid ${UI.border}` },
  td: { padding: '12px 20px', color: '#2f2c2c' },
  selectHeader: { padding: '6px 10px', borderRadius: 8, border: `1px solid ${UI.border}`, fontSize: 13, fontWeight: 600 },
  btnNuevoTabla: { background: UI.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 11, fontWeight: 800, cursor: 'pointer' },
  actionBtn: { background: 'none', border: 'none', cursor: 'pointer', padding: 5 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal: { background: '#fff', borderRadius: 15, padding: 25, width: 400, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' },
  input: { padding: 12, borderRadius: 8, border: `1px solid ${UI.inputBorder}`, width: '100%', boxSizing: 'border-box' },
  calendarContainer: { background: '#f9fafb', padding: 10, borderRadius: 10, border: '1px solid #eee' },
  gridDias: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 },
  dia: { aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5, fontSize: 10, cursor: 'pointer', fontWeight: 700 },
  btnQuick: { flex: 1, padding: '5px', fontSize: 9, borderRadius: 4, border: '1px solid #ddd', cursor: 'pointer', background: '#fff', fontWeight: 700 },
  btnGuardar: { background: UI.accent, color: '#fff', border: 'none', borderRadius: 8, padding: 15, fontWeight: 800, cursor: 'pointer', marginTop: 10 }
}