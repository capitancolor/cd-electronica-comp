import { useState, useEffect, useCallback, useMemo } from 'react'
import { getVentas, getLocales, getCategorias, eliminarVenta } from '../services/negocio'
import { Icon, Badge } from '../components/UI'
import { exportarProductosExcel } from "../services/exportExcel"

const fmt = v => '$' + Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 })

/* =========================
   PALETA VISUAL UNIFICADA
   ========================= */
const UI = {
  pageBg: '#e6e6e6',
  pageText: '#111827',
  pageMuted: '#6b7280',
  pageBorder: '#d9d9d9',
  title: '#111827',
  subtitle: '#4b5563',
  divider: '#d6d6d6',
  periodWrapBg: '#ffffff',
  periodWrapBorder: '#787878',
  periodBtnText: '#4b5563',
  periodBtnActiveBg: '#000000',
  periodBtnActiveText: '#ffffff',
  selectBg: '#ffffff',
  selectText: '#111827',
  selectBorder: '#050505',
  primaryBtnBg: '#2563eb',
  primaryBtnText: '#ffffff',
  statBg: '#ffffff',
  statBorder: '#000000',
  statShadow: '0 4px 12px rgba(0,0,0,0.05)',
  statLabel: '#6b7280',
  statIngresos: '#2563eb',
  statOperaciones: '#111111',
  statGanancia: '#16a34a',
  tableWrapBg: '#ffffff',
  tableWrapBorder: '#0d0d0d',
  theadBg: '#1a1a1a', // Ajustado a Stock
  theadText: '#ffffff',
  rowBg: '#ffffff',
  rowBorder: '#eeeeee', // Ajustado a Stock
  dateText: '#666666',
  priceText: '#111827',
  profitPositive: '#16a34a',
  profitNegative: '#dc2626',
  badgeEfectivo: '#16a34a',
  badgeTarjeta: '#2563eb',
  badgeTransferencia: '#d97706',
  badgeMixto: '#6b7280',
}

// --- SORTABLE TH CLONADO DE STOCK ---
function SortableTh({ label, field, sortConfig, onSort, align = 'left', color = '#ffffff' }) {
  const isSorted = sortConfig.key === field;
  return (
    <th onClick={() => onSort(field)} style={{
      padding: '15px 12px',
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

const getLimitesHoyAr = () => {
  const ahora = new Date()
  const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 0, 0, 0, 0).getTime()
  const fin = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 23, 59, 59, 999).getTime()
  return { inicio, fin }
}

const getFechaLocalStr = (fecha = new Date()) => {
  const offset = fecha.getTimezoneOffset() * 60000;
  return (new Date(fecha - offset)).toISOString().slice(0, 10);
}

const hoyStr = () => getFechaLocalStr(new Date());
const inicioMesStr = () => {
  const d = new Date();
  d.setDate(1);
  return getFechaLocalStr(d);
}

const METODO_COLOR = {
  efectivo: UI.badgeEfectivo,
  tarjeta: UI.badgeTarjeta,
  transferencia: UI.badgeTransferencia,
  mixto: UI.badgeMixto
}

function ReportStatCard({ label, value, icon, color, ui }) {
  return (
    <div style={{ 
      background: ui.statBg, border: `2px solid ${ui.statBorder}`, borderRadius: 12, padding: '10px 14px',
      boxShadow: ui.statShadow, display: 'flex', flexDirection: 'column', gap: 2, flex: 1 
    }}>
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        {icon && <span style={{ color, display: 'inline-flex' }}><Icon name={icon} size={13} /></span>}
        <span style={{ fontSize: 9, fontWeight: 800, color: ui.statLabel, letterSpacing: 0.5 }}>{label.toUpperCase()}</span>
      </div>
      <div style={{ fontSize: 18, fontWeight: 900, color }}>{value}</div> 
    </div>
  )
}

function SoftButton({ children, onClick, disabled = false, bg, text, border, style = {}, title }) {
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled}
      style={{
        background: bg, color: text, border: `1px solid ${border || 'transparent'}`,
        borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, 
        transition: 'all 0.2s', ...style
      }}>
      {children}
    </button>
  )
}

export default function Reportes({ usuario }) {
  const [locales, setLocales] = useState([])
  const [filtroLocal, setFiltroLocal] = useState(usuario.rol !== 'admin' ? usuario.local_id : '')
  const [periodo, setPeriodo] = useState('hoy')
  const [ventas, setVentas] = useState([])
  const [loading, setLoading] = useState(false)
  const [mesSeleccionado, setMesSeleccionado] = useState(new Date().getMonth() + 1)
  const [añoSeleccionado, setAñoSeleccionado] = useState(new Date().getFullYear())
  const [filtroMetodo, setFiltroMetodo] = useState('')
  const [categorias, setCategorias] = useState([])
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [ventaDetalleVisible, setVentaDetalleVisible] = useState(null);
  
  // CONFIGURACIÓN DE SORT IDÉNTICA A STOCK
  const [sortConfig, setSortConfig] = useState({ key: 'fecha', direction: 'desc' })

  const OPCIONES_PAGO = [
    { value: '', label: 'Todos los medios' },
    { value: 'efectivo', label: 'Efectivo' },
    { value: 'tarjeta', label: 'Tarjeta' },
    { value: 'transferencia', label: 'Transferencia' },
  ]

  const generar = useCallback(async () => {
    setLoading(true)
    try {
      let desde, hasta;
      if (periodo === 'hoy') { desde = hoyStr(); hasta = hoyStr(); } 
      else if (periodo === 'mes') { desde = inicioMesStr(); hasta = hoyStr(); } 
      else {
        desde = `${añoSeleccionado}-${String(mesSeleccionado).padStart(2, '0')}-01`;
        const ultimoDia = new Date(añoSeleccionado, mesSeleccionado, 0).getDate();
        hasta = `${añoSeleccionado}-${String(mesSeleccionado).padStart(2, '0')}-${ultimoDia}`;
      }

      const v = await getVentas({
        localId: filtroLocal || null,
        fechaDesde: desde,
        fechaHasta: hasta,
        limit: 2000 
      })

      let resultado = v || [];
      if (periodo === 'hoy') {
        const limites = getLimitesHoyAr();
        resultado = resultado.filter(item => {
          const tVenta = new Date(item.fecha).getTime();
          return tVenta >= limites.inicio && tVenta <= limites.fin;
        });
      }
      setVentas(resultado)
    } catch (error) { console.error("Error:", error) } 
    finally { setLoading(false) }
  }, [filtroLocal, periodo, mesSeleccionado, añoSeleccionado]);

  useEffect(() => {
    getLocales().then(setLocales)
    getCategorias().then(setCategorias)
    generar()
  }, [generar])

  // MANEJADOR DE SORT CLONADO DE STOCK
  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  }

  const listaAMostrar = useMemo(() => {
    let result = [...ventas]
    
    // Filtrar por método de pago
    if (filtroMetodo) {
      result = result.filter(v => v.metodo_pago === filtroMetodo)
    }
    
    // Filtrar por categoría
    if (filtroCategoria) {
      result = result.filter(v => 
        v.venta_items?.some(item => item.categoria_nombre === filtroCategoria)
      )
    }
    
    return result.sort((a, b) => {
      let valA = a[sortConfig.key] || ''
      let valB = b[sortConfig.key] || ''

      if (['total', 'costo_total', 'ganancia'].includes(sortConfig.key)) {
        valA = Number(valA || 0)
        valB = Number(valB || 0)
      }

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    })
  }, [ventas, filtroMetodo, filtroCategoria, sortConfig])

  const totalPeriodo = ventas.reduce((s, v) => s + Number(v.total || 0), 0)
  const gananciaTotal = ventas.reduce((acc, v) => acc + (Number(v.total || 0) - Number(v.costo_total || 0)), 0)
  const costoTotalPeriodo = ventas.reduce((s, v) => s + Number(v.costo_total || 0), 0)
  
  // NUEVO CÁLCULO: Cantidad de artículos vendidos (suma de cantidades en venta_items)
  const articulosVendidos = ventas.reduce((acc, v) => {
    const cantVenta = v.venta_items?.reduce((sum, item) => sum + (Number(item.cantidad) || 0), 0) || 0;
    return acc + cantVenta;
  }, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16, background: UI.pageBg, color: UI.pageText, padding: 8, borderRadius: 12, overflow: 'hidden' }}>
      
      <div className="row-between">
        <div className="col">
          <h2 style={{ fontSize: 20, fontWeight: 700, color: UI.title, margin: 0 }}>BALANCE DE VENTAS</h2>
          <span style={{ color: UI.subtitle, fontSize: 12 }}>
            Mostrando: <strong>{periodo === 'hoy' ? 'Ventas de Hoy' : 'Ventas del Mes'}</strong>
          </span>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <span style={{ color: UI.pageMuted, fontSize: 12, fontWeight: 600 }}>👤 {usuario.nombre}</span>
        </div>
      </div>

      <hr style={{ margin: 0, border: 'none', borderTop: `1px solid ${UI.divider}` }} />

      <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="row" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 6, background: '#fff', padding: 4, borderRadius: 12, border: `1px solid ${UI.periodWrapBorder}` }}>
            <SoftButton onClick={() => setPeriodo('hoy')} bg={periodo === 'hoy' ? UI.periodBtnActiveBg : 'transparent'} text={periodo === 'hoy' ? UI.periodBtnActiveText : UI.periodBtnText}>Hoy</SoftButton>
            <SoftButton onClick={() => setPeriodo('mes')} bg={periodo === 'mes' ? UI.periodBtnActiveBg : 'transparent'} text={periodo === 'mes' ? UI.periodBtnActiveText : UI.periodBtnText}>Este Mes</SoftButton>
            <SoftButton onClick={() => setPeriodo('historial')} bg={periodo === 'historial' ? UI.periodBtnActiveBg : 'transparent'} text={periodo === 'historial' ? UI.periodBtnActiveText : UI.periodBtnText}>Historial</SoftButton>
          </div>

          {periodo === 'historial' && (
            <div style={{ display: 'inline-flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <select value={añoSeleccionado} onChange={e => setAñoSeleccionado(Number(e.target.value))} style={{ height: 40, padding: '0 10px', background: UI.selectBg, border: `1px solid ${UI.selectBorder}`, borderRadius: 10, fontWeight: 600, width: 90 }}>
                {[2024, 2025, 2026].map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <select value={mesSeleccionado} onChange={e => setMesSeleccionado(Number(e.target.value))} style={{ height: 40, padding: '0 10px', background: UI.selectBg, border: `1px solid ${UI.selectBorder}`, borderRadius: 10, fontWeight: 600, width: 120 }}>
                {['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <select value={filtroMetodo} onChange={e => setFiltroMetodo(e.target.value)} style={{ width: 150, height: 40, padding: '0 10px', background: UI.selectBg, border: `1px solid ${UI.selectBorder}`, borderRadius: 10, fontWeight: 600 }}>
            {OPCIONES_PAGO.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)} style={{ width: 160, height: 40, padding: '0 10px', background: UI.selectBg, border: `1px solid ${UI.selectBorder}`, borderRadius: 10, fontWeight: 600 }}>
            <option value="">Todas las categorías</option>
            {categorias.map(cat => <option key={cat.id} value={cat.nombre}>{cat.nombre}</option>)}
          </select>
          {usuario.rol === 'admin' && (
            <select value={filtroLocal} onChange={e => setFiltroLocal(e.target.value)} style={{ width: 160, height: 40, padding: '0 10px', background: UI.selectBg, border: `1px solid ${UI.selectBorder}`, borderRadius: 10, fontWeight: 600 }}>
              <option value="">Todos los locales</option>
              {locales.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </select>
          )}
          <SoftButton onClick={generar} disabled={loading} bg={UI.primaryBtnBg} text={UI.primaryBtnText} style={{ padding: '8px 12px' }}><Icon name="refresh" size={16} /></SoftButton>
          <button onClick={() => exportarProductosExcel(ventas)} disabled={ventas.length === 0} title="Exportar Ventas a Excel" style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '8px 15px', borderRadius: 8, fontWeight: 800, fontSize: 11, cursor: ventas.length === 0 ? 'not-allowed' : 'pointer', opacity: ventas.length === 0 ? 0.4 : 1 }}>
            📊 EXCEL
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" /></div>
      ) : (
        <div className="scroll-area col" style={{ gap: 16, flex: 1, overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 10, width: '100%', overflowX: 'auto', paddingBottom: 4 }}>
            <ReportStatCard label="Total Ingresos" value={fmt(totalPeriodo)} icon="cart" color={UI.statIngresos} ui={UI} />
            <ReportStatCard label="Total Ganancia" value={fmt(gananciaTotal)} icon="reports" color={UI.statGanancia} ui={UI} />
            <ReportStatCard label="Articulos vendidos" value={articulosVendidos} icon="stock" color={UI.statOperaciones} ui={UI} />
          </div>

          <div className="table-container" style={{ flex: 1, overflowY: 'auto', background: UI.tableWrapBg, border: `1px solid ${UI.tableWrapBorder}`, borderRadius: 12 }}>  
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
  <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
    <tr style={{ background: UI.theadBg }}>
      <SortableTh label="FECHA" field="fecha" sortConfig={sortConfig} onSort={handleSort} />
      <SortableTh label="PRODUCTO" field="productos_nombres" sortConfig={sortConfig} onSort={handleSort} />
      <SortableTh label="LOCAL" field="local_nombre" sortConfig={sortConfig} onSort={handleSort} />
      <SortableTh label="PAGO" field="metodo_pago" sortConfig={sortConfig} onSort={handleSort} />
      <SortableTh label="COSTO" field="costo_total" sortConfig={sortConfig} onSort={handleSort} align="right" />
      <SortableTh label="PRECIO" field="total" sortConfig={sortConfig} onSort={handleSort} align="right" />
      <SortableTh label="GANANCIA" field="total" sortConfig={sortConfig} onSort={handleSort} align="right" />
      
      <th style={{ width: 50 }}></th>
    </tr>
  </thead>
  <tbody>
    {listaAMostrar.length === 0 ? (
      <tr>
        <td colSpan="8" style={{ textAlign: 'center', padding: 60, color: UI.pageMuted, fontWeight: 600 }}>
          No hay registros.
        </td>
      </tr>
    ) : (
      listaAMostrar.map(v => {
        const costo = Number(v.costo_total || 0);
        const precio = Number(v.total || 0);
        const ganancia = precio - costo;
        return (
          <tr key={v.id} style={{ background: UI.rowBg, borderBottom: `1px solid ${UI.rowBorder}` }}>
            <td style={{ padding: 14, color: UI.dateText, fontSize: 11, fontWeight: 600 }}>
              {new Date(v.fecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </td>
            <td style={{ padding: 14, fontSize: 11, fontWeight: 700, maxWidth: 200 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: UI.priceText }} title={v.productos_nombres}>
                  {v.productos_nombres || "Venta Directa"}
                </div>
                <button onClick={() => setVentaDetalleVisible(v)} style={{ background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6, padding: '3px 5px', cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <Icon name="stock" size={10} color="#4b5563" />
                </button>
              </div>
            </td>
            <td style={{ padding: 14, color: UI.pageText, fontSize: 12 }}>{v.local_nombre}</td>
            <td style={{ padding: 14 }}><Badge color={METODO_COLOR[v.metodo_pago] || UI.pageMuted}>{v.metodo_pago.toUpperCase()}</Badge></td>
            <td style={{ padding: 14, textAlign: 'right', color: UI.pageMuted, fontSize: 11 }}>{fmt(costo)}</td>
            <td style={{ padding: 14, textAlign: 'right', fontWeight: 800, color: UI.priceText }}>{fmt(precio)}</td>
            <td style={{ padding: 14, textAlign: 'right', color: ganancia >= 0 ? UI.profitPositive : UI.profitNegative, fontWeight: 800 }}>{fmt(ganancia)}</td>
            <td style={{ padding: '0 10px', textAlign: 'center' }}>
              <button 
                onClick={async (e) => {
                  e.stopPropagation();
                  if (window.confirm('¿ELIMINAR MOVIMIENTO?')) {
                    const res = await eliminarVenta(v.id);
                    if (res.ok) {
                      generar(); // Al recargar los datos, la fila desaparece visualmente
                    } else {
                      alert('Error: ' + res.msg); // Usamos el alert nativo del navegador
                    }
                  }
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="trash" size={16} />
              </button>
            </td>
          </tr>
        );
      })
    )}
  </tbody>
</table>
          </div>
        </div>
      )}

{/* MODAL DE DETALLE DE PRODUCTOS */}
{ventaDetalleVisible && (
  <div 
    onClick={() => setVentaDetalleVisible(null)} 
    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}
  >
    <div 
      onClick={e => e.stopPropagation()} 
      style={{ background: '#fff', padding: 24, borderRadius: 16, width: '100%', maxWidth: 420, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)', border: '1px solid #000' }}
    >
      <div className="row-between" style={{ marginBottom: 16, borderBottom: `1px solid ${UI.divider}`, paddingBottom: 12 }}>
        <div className="col">
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>DETALLE DE VENTA</h3>
          <span style={{ fontSize: 11, color: UI.pageMuted }}>
            {new Date(ventaDetalleVisible.fecha).toLocaleString('es-AR')}
          </span>
        </div>
        <button onClick={() => setVentaDetalleVisible(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.pageMuted }}>
          <Icon name="x" size={20} />
        </button>
      </div>

      <div style={{ maxHeight: '350px', overflowY: 'auto', paddingRight: 5 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: UI.pageMuted, marginBottom: 10, letterSpacing: 0.5 }}>ARTÍCULOS:</div>
        
        {/* Usamos venta_items que ya trae los datos desglosados */}
        {ventaDetalleVisible.venta_items?.map((item, i) => (
          <div key={i} style={{ 
            padding: '12px', 
            background: '#f8fafc', 
            borderRadius: 10, 
            marginBottom: 8, 
            border: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            gap: 4
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#111827', flex: 1 }}>
                {item.productos?.nombre || item.descripcion || "Ingreso Manual"}
              </span>
              <span style={{ fontSize: 13, fontWeight: 900, color: UI.primaryBtnBg }}>
                {fmt(item.precio_unitario * item.cantidad)}
              </span>
            </div>
            
            <div style={{ fontSize: 11, color: UI.pageMuted, fontWeight: 600 }}>
              {item.cantidad} x {fmt(item.precio_unitario)}
            </div>
          </div>
        ))}

        {(!ventaDetalleVisible.venta_items || ventaDetalleVisible.venta_items.length === 0) && (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: UI.pageMuted }}>
            No hay información de ítems disponible.
          </div>
        )}
      </div>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: `2px solid #000`, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="row-between" style={{ fontSize: 13, fontWeight: 700, color: UI.pageMuted }}>
          <span>MÉTODO DE PAGO:</span>
          <span style={{ textTransform: 'uppercase' }}>{ventaDetalleVisible.metodo_pago}</span>
        </div>
        <div className="row-between" style={{ fontSize: 15, fontWeight: 900, marginTop: 4 }}>
          <span>TOTAL:</span>
          <span style={{ color: UI.statGanancia, fontSize: 22 }}>{fmt(ventaDetalleVisible.total)}</span>
        </div>
      </div>

      <button 
        onClick={() => setVentaDetalleVisible(null)} 
        style={{ width: '100%', marginTop: 20, height: 48, borderRadius: 12, background: '#111', color: '#fff', fontWeight: 800, border: 'none', cursor: 'pointer', fontSize: 14 }}
      >
        ENTENDIDO
      </button>
    </div>
  </div>
)}
    </div>
  )
}