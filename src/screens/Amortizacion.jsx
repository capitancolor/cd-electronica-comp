import { useState, useEffect, useMemo } from 'react'
import { getVentasResumen, getGastos, getLocales, registrarGasto, eliminarGasto, actualizarGasto } from '../services/negocio'
import { Icon, Badge, toast, ConfirmDialog } from '../components/UI'
import { exportarGastosExcel } from '../services/exportExcel'
import Database from '@tauri-apps/plugin-sql'

const fmt = v => '$' + Number(v || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const formatearFecha = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const formatearMonto = (raw) => {
  if (!raw) return ''
  const parts = raw.split(',')
  let intPart = parts[0].replace(/\D/g, '')
  if (intPart.length > 1) intPart = intPart.replace(/^0+/, '')
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return parts.length > 1 ? formattedInt + ',' + parts.slice(1).join('').slice(0, 2) : formattedInt
}

const UI = {
  headerBg: '#1f2937', headerText: '#191616', border: '#e5e7eb', accent: '#2563eb',
  cardBg: '#ffffff', cardBorder: '#d1d5db', pageBg: '#f3f4f6',
  statGastos: '#dc2626', statGanancia: '#16a34a',
  inputBg: '#ffffff', inputBorder: '#d1d5db'
}

function SortableTh({ label, field, sortConfig, onSort, align = 'left', color = '#dbdee3' }) {
  const isSorted = sortConfig.key === field;
  return (
    <th onClick={() => onSort(field)} style={{
      padding: '12px 20px',
      textAlign: align,
      cursor: 'pointer',
      userSelect: 'none',
      color: isSorted ? '#2196f3' : color,
      fontSize: 11,
      fontWeight: 800
    }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        <span style={{ fontSize: 10, opacity: isSorted ? 1 : 0.3 }}>
          {isSorted ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </div>
    </th>
  )
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

export default function Gastos({ usuario, config }) {
  const [gastos, setGastos] = useState([])
  const [ventas, setVentas] = useState([])
  const [loading, setLoading] = useState(false)
  const hoy = new Date()
  const [mesActual, setMesActual] = useState(hoy.getMonth())
  const [anioActual, setAnioActual] = useState(hoy.getFullYear())
  const [modal, setModal] = useState({ show: false, data: null })
  const [eliminarId, setEliminarId] = useState(null)
  const [detalleDia, setDetalleDia] = useState(null)
  const [detalleVentasDia, setDetalleVentasDia] = useState(null)
  const [locales, setLocales] = useState([])
  const [filtroLocal, setFiltroLocal] = useState(usuario.rol !== 'admin' && config?.local_id ? String(config.local_id) : '')

  const [sortGastos, setSortGastos] = useState({ key: 'descripcion', direction: 'asc' })
  const [sortRendimiento, setSortRendimiento] = useState({ key: 'dia', direction: 'asc' })

  const estadoInicial = { descripcion: '', monto: '', metodo_pago: 'efectivo', dias_aplicados: [], fecha_ingreso: '' }

  useEffect(() => { cargarDatos() }, [mesActual, anioActual, filtroLocal])

  useEffect(() => {
    getLocales().then(setLocales)
  }, [])

  const handleSortGastos = (key) => {
    let direction = 'asc';
    if (sortGastos.key === key && sortGastos.direction === 'asc') direction = 'desc';
    setSortGastos({ key, direction });
  }

  const handleSortRendimiento = (key) => {
    let direction = 'asc';
    if (sortRendimiento.key === key && sortRendimiento.direction === 'asc') direction = 'desc';
    setSortRendimiento({ key, direction });
  }

async function cargarDatos() {
  setLoading(true);
  const desde = `${anioActual}-${String(mesActual + 1).padStart(2, '0')}-01`;
  const ultimoDia = new Date(anioActual, mesActual + 1, 0).getDate();
  const hasta = `${anioActual}-${String(mesActual + 1).padStart(2, '0')}-${ultimoDia}`;

  // Ventas desde Supabase (consulta liviana: sin join a productos, limit 100)
  try {
    const v = await getVentasResumen({ localId: filtroLocal || null, fechaDesde: desde, fechaHasta: hasta, limit: 100 });
    if (v) setVentas(v);
  } catch (err) {
    console.error("Error en ventas:", err?.message || err);
  }

  // Gastos desde SQLite local (getGastos sincroniza a SQLite)
  let gastosCargados = false;
  try {
    const db = await Database.load("sqlite:cd_electronica.db");
    const gastosLocal = await db.select("SELECT * FROM gastos WHERE fecha >= ? AND fecha <= ? ORDER BY fecha DESC", [desde, hasta]);
    for (const g of gastosLocal) {
      if (g.dias_aplicados && typeof g.dias_aplicados === 'string') g.dias_aplicados = JSON.parse(g.dias_aplicados);
    }
    if (gastosLocal.length > 0) { setGastos(gastosLocal); gastosCargados = true; }
  } catch (e) { console.error("Error leyendo gastos de SQLite:", e); }

  // Fallback a Supabase si no hay gastos locales
  if (!gastosCargados) {
    try {
      const g = await getGastos(desde, hasta);
      if (g) setGastos(g);
    } catch (err) {
      const msg = (err && err.message) || String(err) || 'Error desconocido';
      console.error("Error en gastos:", msg);
      toast("Error al cargar gastos: " + msg, "error");
    }
  }

  setLoading(false);
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
      data: gasto ? { ...gasto, monto: gasto.monto != null ? String(gasto.monto).replace('.', ',') : '', metodo_pago: gasto.metodo_pago || 'efectivo', dias_aplicados: gasto.dias_aplicados || [] } : { ...estadoInicial }
    })
  }

  const cerrarModal = () => setModal({ show: false, data: null })

  const handleGuardar = async () => {
    const { data } = modal
    if (!data.descripcion || !data.monto) return toast("Completar descripción y monto", "error")
    setLoading(true)
    try {
      const normalizarNumero = (v) => {
        const s = String(v).trim()
        if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.'))
        return parseFloat(s)
      }
      const payload = {
        ...data,
        monto: normalizarNumero(data.monto),
        metodo_pago: data.metodo_pago || 'efectivo',
        usuario_id: usuario.id,
        fecha: new Date(anioActual, mesActual, 1).toISOString(),
        fecha_ingreso: data.fecha_ingreso || new Date().toISOString(),
        dias_aplicados: data.dias_aplicados?.length > 0 ? data.dias_aplicados : null
      }
      if (data.id) await actualizarGasto(data.id, payload)
      else await registrarGasto(payload)
      toast(data.id ? "Gasto actualizado" : "Gasto registrado")
      cerrarModal()
      cargarDatos(true)
    } catch (err) { console.error("Error guardando gasto:", err); toast("Error: " + (err.message || err), "error") } finally { setLoading(false) }
  }

  const handleEliminar = async () => {
    if (!eliminarId) return
    try {
      await eliminarGasto(eliminarId)
      setEliminarId(null)
      cargarDatos(true)
      toast("Gasto eliminado")
    } catch (err) { toast("Error", "error") }
  }

  const calcularGastoParaDia = (gasto, dia) => {
    const aplicados = gasto.dias_aplicados || Array.from({ length: diasEnMes }, (_, i) => i + 1)
    if (!aplicados.includes(dia)) return 0
    const totalCentavos = Math.round(Number(gasto.monto) * 100)
    const porDiaCentavos = Math.floor(totalCentavos / aplicados.length)
    const restoCentavos = totalCentavos - porDiaCentavos * aplicados.length
    const ultimoDia = Math.max(...aplicados)
    return (porDiaCentavos + (dia === ultimoDia ? restoCentavos : 0)) / 100
  }

  const getGastoParaDia = (dia) => {
    return gastos.reduce((acc, g) => acc + calcularGastoParaDia(g, dia), 0)
  }

  const getGastosDetalleParaDia = (dia) => {
    return gastos.reduce((acc, g) => {
      const monto = calcularGastoParaDia(g, dia)
      if (monto === 0) return acc
      acc.push({ ...g, montoDia: monto })
      return acc
    }, [])
  }

  const totalGastosMes = gastos.reduce((s, g) => s + Number(g.monto), 0)
  const totalGananciaMes = ventas.filter(v => v.metodo_pago !== 'nota_credito').reduce((s, v) => s + (Number(v.total || 0) - Number(v.costo_total || 0)), 0)

  const gastosOrdenados = useMemo(() => {
    return [...gastos].sort((a, b) => {
      let valA, valB;
      if (sortGastos.key === 'monto') {
        valA = Number(a.monto || 0);
        valB = Number(b.monto || 0);
      } else if (sortGastos.key === 'aplicacion') {
        valA = a.dias_aplicados?.length || diasEnMes;
        valB = b.dias_aplicados?.length || diasEnMes;
      } else {
        valA = (a[sortGastos.key] || '').toString().toLowerCase();
        valB = (b[sortGastos.key] || '').toString().toLowerCase();
      }
      if (valA < valB) return sortGastos.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortGastos.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [gastos, sortGastos])

  const rendimientoData = useMemo(() => {
    const rows = Array.from({ length: diasEnMes }, (_, i) => {
      const d = i + 1;
      const gDia = getGastoParaDia(d);
      const vDia = ventas.filter(v => {
        const dia = parseInt(v.fecha?.split('T')[0]?.split('-')[2], 10);
        return dia === d;
      });
      const ventasRealesDia = vDia.filter(v => v.metodo_pago !== 'nota_credito');
      const ganDia = ventasRealesDia.reduce((acc, v) => acc + (Number(v.total || 0) - Number(v.costo_total || 0)), 0);
      const totalVentasDia = ventasRealesDia.reduce((acc, v) => acc + Number(v.total || 0), 0);
      const bal = ganDia - gDia;
      const esFuturo = (anioActual === hoy.getFullYear() && mesActual === hoy.getMonth() && d > hoy.getDate());
      return { d, gDia, ganDia, totalVentasDia, bal, esFuturo, ventasDia: vDia };
    });
    return rows.sort((a, b) => {
      let valA, valB;
      if (['ganancia', 'gasto', 'balance', 'totalVentasDia'].includes(sortRendimiento.key)) {
        const map = { ganancia: 'ganDia', gasto: 'gDia', balance: 'bal', totalVentasDia: 'totalVentasDia' };
        valA = a[map[sortRendimiento.key]];
        valB = b[map[sortRendimiento.key]];
      } else {
        valA = a[sortRendimiento.key];
        valB = b[sortRendimiento.key];
      }
      if (valA < valB) return sortRendimiento.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortRendimiento.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [gastos, ventas, diasEnMes, sortRendimiento])

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
            <select value={filtroLocal} onChange={e => setFiltroLocal(e.target.value)} style={styles.selectHeader}>
              <option value="">Todos los locales</option>
              {locales.map(l => (
                <option key={l.id} value={l.id}>{l.nombre}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* STATS */}
      <div style={{ display: 'flex', gap: 15 }}>
        <StatCard label="Total Gastos del Mes" value={fmt(totalGastosMes)} icon="reports" color={UI.statGastos} />
        <StatCard label="Gastos Efectivo" value={fmt(gastos.filter(g => g.metodo_pago !== 'transferencia').reduce((s, g) => s + Number(g.monto), 0))} icon="pos" color="#16a34a" />
        <StatCard label="Gastos Transferencia" value={fmt(gastos.filter(g => g.metodo_pago === 'transferencia').reduce((s, g) => s + Number(g.monto), 0))} icon="stock" color="#2563eb" />
        <StatCard label="Ganancia en el Mes" value={fmt(totalGananciaMes)} icon="pos" color={UI.statGanancia} />
        <StatCard label="Ganancia Neta" value={fmt(totalGananciaMes - totalGastosMes)} icon="stock" color={(totalGananciaMes - totalGastosMes) >= 0 ? UI.statGanancia : UI.statGastos} />
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
                  <SortableTh label="DESCRIPCIÓN" field="descripcion" sortConfig={sortGastos} onSort={handleSortGastos} />
                  <SortableTh label="F. INGRESO" field="fecha_ingreso" sortConfig={sortGastos} onSort={handleSortGastos} />
                  <SortableTh label="APLICACIÓN" field="aplicacion" sortConfig={sortGastos} onSort={handleSortGastos} />
                  <SortableTh label="PAGO" field="metodo_pago" sortConfig={sortGastos} onSort={handleSortGastos} />
                  <SortableTh label="MONTO" field="monto" sortConfig={sortGastos} onSort={handleSortGastos} align="right" />
                  <th style={{ ...styles.th, textAlign: 'center' }}>ACCIONES</th>
                </tr>
              </thead>
              <tbody>
                {gastosOrdenados.map(g => (
                  <tr key={g.id} style={styles.tr}>
                    <td style={{ ...styles.td, fontWeight: 700 }}>{g.descripcion}</td>
                    <td style={{ ...styles.td, fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>{formatearFecha(g.fecha_ingreso)}</td>
                    <td style={styles.td}>
                      <Badge color="#6b7280">{g.dias_aplicados ? `${g.dias_aplicados.length} días` : 'Mes Completo'}</Badge>
                    </td>
                    <td style={styles.td}>
                      <Badge color={g.metodo_pago === 'transferencia' ? '#2563eb' : '#16a34a'}>{g.metodo_pago === 'transferencia' ? 'TRANSFERENCIA' : 'EFECTIVO'}</Badge>
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: 900, color: UI.statGastos }}>{fmt(g.monto)}</td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>
                      <button onClick={() => abrirModal(g)} style={styles.actionBtn} title="Editar"><Icon name="tune" color={UI.accent} size={16} /></button>
                      <button onClick={() => setEliminarId(g.id)} style={styles.actionBtn} title="Eliminar"><Icon name="trash" color="#ef4444" size={16} /></button>
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
                  <SortableTh label="DÍA" field="dia" sortConfig={sortRendimiento} onSort={handleSortRendimiento} />
                  <SortableTh label="VENTAS" field="totalVentasDia" sortConfig={sortRendimiento} onSort={handleSortRendimiento} align="right" />
                  <SortableTh label="GANANCIA" field="ganancia" sortConfig={sortRendimiento} onSort={handleSortRendimiento} align="right" />
                  <SortableTh label="GASTO" field="gasto" sortConfig={sortRendimiento} onSort={handleSortRendimiento} align="right" />
                  <SortableTh label="BALANCE" field="balance" sortConfig={sortRendimiento} onSort={handleSortRendimiento} align="right" />
                </tr>
              </thead>
              <tbody>
                {rendimientoData.map(({ d, gDia, ganDia, totalVentasDia, bal, esFuturo, ventasDia }) => (
                  <tr key={d} style={{ ...styles.tr, opacity: esFuturo ? 0.4 : 1 }}>
                    <td style={{ ...styles.td, fontWeight: 700 }}>Día {d}</td>
                    <td style={{ ...styles.td, textAlign: 'right', color: '#2563eb' }}>
                      <span onClick={() => totalVentasDia > 0 && setDetalleVentasDia({ dia: d, ventas: ventasDia })} style={{ cursor: totalVentasDia > 0 ? 'pointer' : 'default', textDecorationLine: totalVentasDia > 0 ? 'underline' : 'none', textDecorationStyle: totalVentasDia > 0 ? 'dotted' : 'none' }}>{fmt(totalVentasDia)}</span>
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', color: ganDia >= 0 ? UI.statGanancia : UI.statGastos }}>{fmt(ganDia)}</td>
                    <td style={{ ...styles.td, textAlign: 'right', color: UI.statGastos }}>
                      <span onClick={() => gDia > 0 && setDetalleDia({ dia: d, gastos: getGastosDetalleParaDia(d) })} style={{ cursor: gDia > 0 ? 'pointer' : 'default', textDecorationLine: gDia > 0 ? 'underline' : 'none', textDecorationStyle: gDia > 0 ? 'dotted' : 'none' }}>{fmt(gDia)}</span>
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: 800, color: bal >= 0 ? UI.statGanancia : UI.statGastos }}>
                      {fmt(bal)}
                    </td>
                  </tr>
                ))}
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
              <input type="text" inputMode="decimal" placeholder="Monto Total" style={{ ...styles.input, fontSize: 18, fontWeight: 900 }} value={formatearMonto(modal.data.monto ?? '')} onChange={e => {
                let raw = e.target.value.replace(/[^\d,]/g, '')
                raw = raw.split(',').slice(0, 2).join(',')
                const parts = raw.split(',')
                if (parts.length === 2 && parts[1].length > 2) raw = parts[0] + ',' + parts[1].slice(0, 2)
                setModal({...modal, data: {...modal.data, monto: raw}})
              }} />

              <select value={modal.data.metodo_pago || 'efectivo'} onChange={e => setModal({...modal, data: {...modal.data, metodo_pago: e.target.value}})} style={{ ...styles.input, fontWeight: 700 }}>
                <option value="efectivo">💵 Efectivo</option>
                <option value="transferencia">🏦 Transferencia</option>
              </select>
              
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

      {eliminarId && (
        <ConfirmDialog
          title="Eliminar Gasto"
          message="¿Estás seguro de eliminar este gasto? Esta acción no se puede deshacer."
          confirmLabel="Eliminar"
          danger
          onConfirm={handleEliminar}
          onClose={() => setEliminarId(null)}
        />
      )}

      {detalleDia && (
        <div style={styles.overlay} onClick={() => setDetalleDia(null)}>
          <div style={{ ...styles.modal, width: 450, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <h3 style={{ margin: 0, fontWeight: 900, fontSize: 15, color: '#000' }}>GASTOS DEL DÍA {detalleDia.dia}</h3>
              <button onClick={() => setDetalleDia(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ overflow: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${UI.border}` }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, color: '#dbdee3', textTransform: 'uppercase' }}>Descripción</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: 10, color: '#dbdee3', textTransform: 'uppercase' }}>Pago</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: 10, color: '#dbdee3', textTransform: 'uppercase' }}>Días</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, color: '#dbdee3', textTransform: 'uppercase' }}>Hoy</th>
                  </tr>
                </thead>
                <tbody>
                  {detalleDia.gastos.map(g => (
                    <tr key={g.id} style={{ borderBottom: `1px solid ${UI.border}` }}>
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: '#000' }}>{g.descripcion}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        <Badge color={g.metodo_pago === 'transferencia' ? '#2563eb' : '#16a34a'}>{g.metodo_pago === 'transferencia' ? 'TRANSFERENCIA' : 'EFECTIVO'}</Badge>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'center', color: '#000' }}>{g.dias_aplicados?.length || diasEnMes}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 900, color: UI.statGastos }}>{fmt(g.montoDia)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ borderTop: `2px solid ${UI.border}`, padding: '12px 10px 0', textAlign: 'right', fontWeight: 900, fontSize: 15 }}>
              Total día: {fmt(detalleDia.gastos.reduce((s, g) => s + g.montoDia, 0))}
            </div>
          </div>
        </div>
      )}

      {detalleVentasDia && (
        <div style={styles.overlay} onClick={() => setDetalleVentasDia(null)}>
          <div style={{ ...styles.modal, width: 550, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <h3 style={{ margin: 0, fontWeight: 900, fontSize: 15, color: '#000' }}>VENTAS DEL DÍA {detalleVentasDia.dia}</h3>
              <button onClick={() => setDetalleVentasDia(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ overflow: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${UI.border}` }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, color: '#dbdee3', textTransform: 'uppercase' }}>Producto</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, color: '#dbdee3', textTransform: 'uppercase' }}>Local</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: 10, color: '#dbdee3', textTransform: 'uppercase' }}>Pago</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, color: '#dbdee3', textTransform: 'uppercase' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {detalleVentasDia.ventas.map(v => (
                    <tr key={v.id} style={{ borderBottom: `1px solid ${UI.border}` }}>
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: '#000' }}>{v.productos_nombres || 'Venta Directa'}</td>
                      <td style={{ padding: '8px 10px', color: '#000' }}>{v.local_nombre}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        <Badge color={v.metodo_pago === 'efectivo' ? '#16a34a' : v.metodo_pago === 'tarjeta' ? '#2563eb' : v.metodo_pago === 'transferencia' ? '#d97706' : '#6b7280'}>{v.metodo_pago?.toUpperCase()}</Badge>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 900, color: '#2563eb' }}>{fmt(v.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ borderTop: `2px solid ${UI.border}`, padding: '12px 10px 0', textAlign: 'right', fontWeight: 900, fontSize: 15 }}>
              Total ventas día: {fmt(detalleVentasDia.ventas.reduce((s, v) => s + Number(v.total || 0), 0))}
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
  btnGuardar: { background: UI.accent, color: '#fff', border: 'none', borderRadius: 8, padding: 15, fontWeight: 800, cursor: 'pointer', marginTop: 10 },
}