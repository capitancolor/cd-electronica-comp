import { useState, useEffect, useCallback, useMemo } from 'react'
import { getVentas, getLocales, getCategorias, eliminarVenta, actualizarVenta, getProductos } from '../services/negocio'
import { supabase } from '../supabase'
import { Icon, Badge, ConfirmDialog, toast } from '../components/UI'
import { exportarProductosExcel } from "../services/exportExcel"

const fmt = v => '$' + Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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

export default function Reportes({ usuario, config }) {
  const [locales, setLocales] = useState([])
  const [filtroLocal, setFiltroLocal] = useState(usuario.rol !== 'admin' ? config.local_id : '')
  const [periodo, setPeriodo] = useState('hoy')
  const [ventas, setVentas] = useState([])
  const [loading, setLoading] = useState(false)
  const [mesSeleccionado, setMesSeleccionado] = useState(new Date().getMonth() + 1)
  const [añoSeleccionado, setAñoSeleccionado] = useState(new Date().getFullYear())
  const [diaSeleccionado, setDiaSeleccionado] = useState(0)
  const [filtroMetodo, setFiltroMetodo] = useState('')
  const [categorias, setCategorias] = useState([])
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [busquedaTexto, setBusquedaTexto] = useState('')

  const [confirmDelete, setConfirmDelete] = useState(null);
  const [editandoVenta, setEditandoVenta] = useState(null);
  const [editItems, setEditItems] = useState([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editFecha, setEditFecha] = useState('');
  const [busquedaProd, setBusquedaProd] = useState('');
  const [resultadosProd, setResultadosProd] = useState([]);
  const [buscandoProd, setBuscandoProd] = useState(false);
  const esVendedor = usuario.rol === 'vendedor';
  
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
      else if (añoSeleccionado && mesSeleccionado) {
        if (diaSeleccionado) {
          const dd = String(diaSeleccionado).padStart(2, '0');
          const mm = String(mesSeleccionado).padStart(2, '0');
          desde = `${añoSeleccionado}-${mm}-${dd}`;
          hasta = desde;
        } else {
          desde = `${añoSeleccionado}-${String(mesSeleccionado).padStart(2, '0')}-01`;
          const ultimoDia = new Date(añoSeleccionado, mesSeleccionado, 0).getDate();
          hasta = `${añoSeleccionado}-${String(mesSeleccionado).padStart(2, '0')}-${ultimoDia}`;
        }
      } else if (añoSeleccionado) {
        desde = `${añoSeleccionado}-01-01`;
        hasta = `${añoSeleccionado}-12-31`;
      } else {
        desde = null;
        hasta = null;
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
  }, [filtroLocal, periodo, mesSeleccionado, añoSeleccionado, diaSeleccionado]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const res = await eliminarVenta(confirmDelete.id);
    setConfirmDelete(null);
    if (res.ok) {
      alert('Stock restaurado correctamente.');
      generar();
    } else {
      alert('Error: ' + (res.msg || 'No se pudo anular la venta'));
    }
  };

  useEffect(() => {
    getLocales().then(setLocales)
    getCategorias().then(setCategorias)
    generar()
  }, [generar])

  // Realtime: escuchar cambios en ventas (nuevas ventas de otros terminales)
  useEffect(() => {
    const channel = supabase
      .channel('reportes-ventas')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'ventas' },
        () => {
          console.log('🔄 Cambio detectado en ventas, recargando...');
          generar();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [generar]);

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

    if (busquedaTexto.trim()) {
      const q = busquedaTexto.trim().toLowerCase()
      result = result.filter(v =>
        (v.productos_nombres || '').toLowerCase().includes(q) ||
        (v.productos_marcas || '').toLowerCase().includes(q) ||
        (v.productos_modelos || '').toLowerCase().includes(q) ||
        (v.vendedor || '').toLowerCase().includes(q) ||
        (v.local_nombre || '').toLowerCase().includes(q) ||
        (v.metodo_pago || '').toLowerCase().includes(q)
      )
    }
    
    return result
  }, [ventas, filtroMetodo, filtroCategoria, sortConfig, busquedaTexto])

  const articulosData = useMemo(() => {
    const rows = [];
    for (const v of listaAMostrar) {
      for (const item of (v.venta_items || [])) {
        const cantidad = Number(item.cantidad || 0);
        const precioUnitario = Number(item.precio_unitario || 0);
        const precioCosto = Number(item.productos?.precio_costo || 0);
        rows.push({
          fecha: v.fecha,
          articulo: item.productos?.nombre || item.descripcion || '—',
          marca: item.productos?.marca || '—',
          modelo: item.productos?.modelo || '—',
          local: v.local_nombre,
          vendedor: v.vendedor,
          metodo_pago: v.metodo_pago,
          cantidad: cantidad,
          costo: cantidad * precioCosto,
          precio: cantidad * precioUnitario,
          ganancia: (cantidad * precioUnitario) - (cantidad * precioCosto),
          venta: v,
        });
      }
    }
    return rows.sort((a, b) => {
      let valA, valB;
      const key = sortConfig.key;
      if (['costo', 'precio', 'ganancia', 'cantidad'].includes(key)) {
        valA = a[key];
        valB = b[key];
      } else {
        valA = (a[key] || '').toString().toLowerCase();
        valB = (b[key] || '').toString().toLowerCase();
      }
      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [listaAMostrar, sortConfig])

  const ventasSinNC = useMemo(() => listaAMostrar.filter(v => v.metodo_pago !== 'nota_credito'), [listaAMostrar])
  const totalPeriodo = ventasSinNC.reduce((s, v) => s + Number(v.total || 0), 0)
  const gananciaTotal = ventasSinNC.reduce((acc, v) => {
    return acc + Number(v.total || 0) - Number(v.costo_total || 0);
  }, 0)
  const costoTotalPeriodo = ventasSinNC.reduce((s, v) => s + Number(v.costo_total || 0), 0)
  const efectivoTotal = ventasSinNC.reduce((s, v) => {
    if (v.metodo_pago === 'efectivo') return s + Number(v.total || 0)
    if (v.metodo_pago === 'mixto') return s + Number(v.detalle_mixto?.efectivo || 0)
    return s
  }, 0)
  const tarjetaTransferenciaTotal = ventasSinNC.reduce((s, v) => {
    if (v.metodo_pago === 'tarjeta') return s + Number(v.total || 0)
    if (v.metodo_pago === 'transferencia') return s + Number(v.total || 0)
    if (v.metodo_pago === 'mixto') {
      return s + Number(v.detalle_mixto?.tarjeta || 0) + Number(v.detalle_mixto?.transferencia || 0)
    }
    return s
  }, 0)
  
  // NUEVO CÁLCULO: Cantidad de artículos vendidos (suma de cantidades en venta_items)
  const articulosVendidos = ventasSinNC.reduce((acc, v) => {
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
              <select value={añoSeleccionado} onChange={e => setAñoSeleccionado(Number(e.target.value) || 0)} style={{ height: 40, padding: '0 10px', background: UI.selectBg, border: `1px solid ${UI.selectBorder}`, borderRadius: 10, fontWeight: 600, width: 90 }}>
                <option value={0}>Todos</option>
                {[2024, 2025, 2026].map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <select value={mesSeleccionado} onChange={e => setMesSeleccionado(Number(e.target.value))} style={{ height: 40, padding: '0 10px', background: UI.selectBg, border: `1px solid ${UI.selectBorder}`, borderRadius: 10, fontWeight: 600, width: 120 }}>
                <option value={0}>Todos</option>
                {['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <select value={diaSeleccionado} onChange={e => setDiaSeleccionado(Number(e.target.value) || 0)} style={{ height: 40, padding: '0 10px', background: UI.selectBg, border: `1px solid ${UI.selectBorder}`, borderRadius: 10, fontWeight: 600, width: 90 }}>
                <option value={0}>Todos</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input value={busquedaTexto} onChange={e => setBusquedaTexto(e.target.value)} placeholder="🔍 Buscar..." style={{ width: 170, height: 40, padding: '0 10px', background: UI.selectBg, border: `1px solid ${UI.selectBorder}`, borderRadius: 10, fontWeight: 600, fontSize: 13 }} />
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
          <div className="table-container" style={{ flex: 1, overflowY: 'auto', background: UI.tableWrapBg, border: `1px solid ${UI.tableWrapBorder}`, borderRadius: 12 }}>  
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
  <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
    <tr style={{ background: UI.theadBg }}>
      <SortableTh label="FECHA" field="fecha" sortConfig={sortConfig} onSort={handleSort} />
      <SortableTh label="ARTÍCULO" field="articulo" sortConfig={sortConfig} onSort={handleSort} />
      <SortableTh label="MARCA" field="marca" sortConfig={sortConfig} onSort={handleSort} />
      <SortableTh label="MODELO" field="modelo" sortConfig={sortConfig} onSort={handleSort} />
      <SortableTh label="CANT." field="cantidad" sortConfig={sortConfig} onSort={handleSort} align="right" />
      <SortableTh label="LOCAL" field="local_nombre" sortConfig={sortConfig} onSort={handleSort} />
      <SortableTh label="VENDEDOR" field="vendedor" sortConfig={sortConfig} onSort={handleSort} />
      <SortableTh label="PAGO" field="metodo_pago" sortConfig={sortConfig} onSort={handleSort} />
      {!esVendedor && <SortableTh label="COSTO" field="costo" sortConfig={sortConfig} onSort={handleSort} align="right" />}
      <SortableTh label="PRECIO" field="precio" sortConfig={sortConfig} onSort={handleSort} align="right" />
      {!esVendedor && <SortableTh label="GANANCIA" field="ganancia" sortConfig={sortConfig} onSort={handleSort} align="right" />}
      
      <th style={{ width: 50 }}></th>
    </tr>
  </thead>
  <tbody>
    {articulosData.length === 0 ? (
      <tr>
        <td colSpan={esVendedor ? 10 : 12} style={{ textAlign: 'center', padding: 60, color: UI.pageMuted, fontWeight: 600 }}>
          No hay registros.
        </td>
      </tr>
    ) : (
      articulosData.map((row, idx) => {
        const costo = Number(row.costo || 0);
        const precio = Number(row.precio || 0);
        const ganancia = Number(row.ganancia || 0);
        return (
          <tr key={`${row.venta.id}-${idx}`} style={{ background: UI.rowBg, borderBottom: `1px solid ${UI.rowBorder}` }}>
            <td style={{ padding: 14, color: UI.dateText, fontSize: 11, fontWeight: 600 }}>
              {new Date(row.fecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </td>
            <td style={{ padding: 14, fontSize: 11, fontWeight: 700, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: UI.priceText }} title={row.articulo}>
              {row.articulo}
            </td>
            <td style={{ padding: 14, color: UI.pageText, fontSize: 12 }}>{row.marca}</td>
            <td style={{ padding: 14, color: UI.pageText, fontSize: 12 }}>{row.modelo}</td>
            <td style={{ padding: 14, textAlign: 'right', fontWeight: 700, color: UI.priceText }}>{row.cantidad}</td>
            <td style={{ padding: 14, color: UI.pageText, fontSize: 12 }}>{row.local}</td>
            <td style={{ padding: 14, color: UI.pageText, fontSize: 12 }}>{row.vendedor}</td>
            <td style={{ padding: 14 }}><Badge color={METODO_COLOR[row.metodo_pago] || UI.pageMuted}>{row.metodo_pago.toUpperCase()}</Badge></td>
            {!esVendedor && <td style={{ padding: 14, textAlign: 'right', color: UI.pageMuted, fontSize: 11 }}>{fmt(costo)}</td>}
            <td style={{ padding: 14, textAlign: 'right', fontWeight: 800, color: UI.priceText }}>{fmt(precio)}</td>
            {!esVendedor && <td style={{ padding: 14, textAlign: 'right', color: ganancia >= 0 ? UI.profitPositive : UI.profitNegative, fontWeight: 800 }}>{fmt(ganancia)}</td>}
            <td style={{ padding: '0 10px', textAlign: 'center' }}>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                <button 
                    onClick={(e) => {
                    e.stopPropagation();
                    setEditandoVenta(row.venta);
                    setEditFecha(row.venta.fecha ? new Date(row.venta.fecha).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
                    setEditItems((row.venta.venta_items || []).map(it => ({ ...it, producto_id: it.producto_id || it.productos?.id, nombre: it.productos?.nombre || it.descripcion, marca: it.productos?.marca || '', modelo: it.productos?.modelo || '' })));
                  }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name="edit" size={16} />
                </button>
                <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(row.venta);
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="trash" size={16} />
              </button>
              </div>
            </td>
          </tr>
        );
      })
    )}
        </tbody>
      </table>
          </div>

          <div style={{ display: 'flex', gap: 10, width: '100%', overflowX: 'auto', paddingBottom: 4 }}>
            <ReportStatCard label="Total Ingresos" value={fmt(totalPeriodo)} icon="cart" color={UI.statIngresos} ui={UI} />
            <ReportStatCard label="Efectivo" value={fmt(efectivoTotal)} icon="receipt" color="#059669" ui={UI} />
            <ReportStatCard label="Tarjeta/Transf." value={fmt(tarjetaTransferenciaTotal)} icon="transfer" color="#2563eb" ui={UI} />
            <ReportStatCard label="Costo Total" value={fmt(costoTotalPeriodo)} icon="stock" color={UI.statOperaciones} ui={UI} />
            <ReportStatCard label="Total Ganancia" value={fmt(gananciaTotal)} icon="reports" color={UI.statGanancia} ui={UI} />
          </div>
        </div>
      )}

{editandoVenta && (
  <div
    onClick={() => { if (!editSaving) setEditandoVenta(null) }}
    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}
  >
    <div
      onClick={e => e.stopPropagation()}
      style={{ background: '#fff', padding: 24, borderRadius: 16, width: '100%', maxWidth: 500, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)', border: '1px solid #000', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
    >
      <div className="row-between" style={{ marginBottom: 16, borderBottom: `1px solid ${UI.divider}`, paddingBottom: 12 }}>
        <div className="col">
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>EDITAR VENTA</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <input
              type="date"
              value={editFecha}
              onChange={e => setEditFecha(e.target.value)}
              style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: 12, width: 'auto' }}
            />
            <span style={{ fontSize: 11, color: UI.pageMuted }}>— {editandoVenta.local_nombre}</span>
          </div>
        </div>
        <button onClick={() => { if (!editSaving) setEditandoVenta(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.pageMuted }}>
          <Icon name="x" size={20} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 5, marginBottom: 16 }}>
        {/* BUSCADOR DE PRODUCTOS */}
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <input
            type="text"
            placeholder="Buscar producto para agregar..."
            value={busquedaProd}
            onChange={async e => {
              setBusquedaProd(e.target.value);
              const q = e.target.value.trim();
              if (q.length < 1) { setResultadosProd([]); return; }
              setBuscandoProd(true);
              const res = await getProductos({ busqueda: q });
              setResultadosProd(res.filter(p => !editItems.some(it => it.producto_id === p.id)));
              setBuscandoProd(false);
            }}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #9ca3af', fontSize: 13, boxSizing: 'border-box' }}
          />
          {buscandoProd && <div style={{ position: 'absolute', right: 12, top: 12, fontSize: 11, color: '#999' }}>Buscando...</div>}
          {resultadosProd.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, zIndex: 100, maxHeight: 200, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
              {resultadosProd.map(p => (
                <div
                  key={p.id}
                  onClick={() => {
                    setEditItems(prev => [...prev, {
                      producto_id: p.id,
                      nombre: p.nombre,
                      marca: p.marca || '',
                      modelo: p.modelo || '',
                      cantidad: 1,
                      precio_unitario: Number(p.precio_venta || 0),
                      precio_costo: Number(p.precio_costo || 0),
                      descripcion: p.nombre,
                      es_manual: false
                    }]);
                    setBusquedaProd('');
                    setResultadosProd([]);
                  }}
                  style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onMouseOver={e => e.currentTarget.style.background = '#f3f4f6'}
                  onMouseOut={e => e.currentTarget.style.background = '#fff'}
                >
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{p.nombre}</span>
                    {(p.marca || p.modelo) && (
                      <span style={{ fontSize: 11, color: '#666', marginLeft: 8 }}>{[p.marca, p.modelo].filter(Boolean).join(' - ')}</span>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: '#2563eb', fontWeight: 700 }}>{fmt(p.precio_venta)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ fontSize: 10, fontWeight: 800, color: UI.pageMuted, marginBottom: 10, letterSpacing: 0.5 }}>PRODUCTOS:</div>
        {editItems.map((item, i) => (
          <div key={i} style={{
            padding: '12px',
            background: '#f8fafc',
            borderRadius: 10,
            marginBottom: 8,
            border: '1px solid #e2e8f0',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#111827', display: 'block' }}>{item.nombre}</span>
                {(item.marca || item.modelo) && (
                  <span style={{ fontSize: 11, color: '#666' }}>{[item.marca, item.modelo].filter(Boolean).join(' - ')}</span>
                )}
              </div>
              <button
                onClick={() => setEditItems(prev => prev.filter((_, idx) => idx !== i))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 4, flexShrink: 0 }}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: '#666', display: 'block', marginBottom: 2 }}>CANT</label>
                <input
                  type="number"
                  min="1"
                  value={item.cantidad}
                  onChange={e => {
                    const val = Math.max(0, parseInt(e.target.value) || 0);
                    setEditItems(prev => prev.map((it, idx) => idx === i ? { ...it, cantidad: val } : it));
                  }}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: '#666', display: 'block', marginBottom: 2 }}>PRECIO UNIT.</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.precio_unitario}
                  onChange={e => {
                    const val = parseFloat(e.target.value) || 0;
                    setEditItems(prev => prev.map((it, idx) => idx === i ? { ...it, precio_unitario: val } : it));
                  }}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>
              {!esVendedor && <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: '#666', display: 'block', marginBottom: 2 }}>COSTO UNIT.</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.precio_costo ?? 0}
                  onChange={e => {
                    const val = parseFloat(e.target.value) || 0;
                    setEditItems(prev => prev.map((it, idx) => idx === i ? { ...it, precio_costo: val } : it));
                  }}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>}
              <div style={{ flex: '0 0 70px', textAlign: 'right' }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: '#666', display: 'block', marginBottom: 2 }}>SUB</label>
                <span style={{ fontSize: 13, fontWeight: 900, color: '#2563eb' }}>{fmt((item.cantidad || 0) * (item.precio_unitario || 0))}</span>
              </div>
            </div>
          </div>
        ))}
        {editItems.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: UI.pageMuted, background: '#f8fafc', borderRadius: 10 }}>
            No hay productos en esta venta.
          </div>
        )}
      </div>

      <div style={{ paddingTop: 16, borderTop: `2px solid #000` }}>
        <div className="row-between" style={{ fontSize: 15, fontWeight: 900, marginBottom: 16 }}>
          <span>TOTAL:</span>
          <span style={{ color: UI.statGanancia, fontSize: 22 }}>{fmt(editItems.reduce((s, it) => s + (it.cantidad || 0) * (it.precio_unitario || 0), 0))}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={async () => {
              if (editSaving) return;
              const itemsValidos = editItems.filter(it => it.cantidad > 0);
              if (itemsValidos.length === 0) return toast('Debe haber al menos un producto con cantidad > 0', 'error');
              setEditSaving(true);
              const res = await actualizarVenta({
                ventaId: editandoVenta.id,
                items: itemsValidos,
                localId: editandoVenta.local_id,
                usuarioId: usuario.id,
                metodoPago: editandoVenta.metodo_pago,
                fecha: editFecha
              });
              setEditSaving(false);
              if (res.ok) {
                toast('Venta actualizada', 'success');
                setEditandoVenta(null);
                generar();
              } else {
                toast('Error: ' + (res.msg || 'No se pudo actualizar'), 'error');
              }
            }}
            disabled={editSaving}
            style={{ flex: 1, height: 48, borderRadius: 12, background: '#2563eb', color: '#fff', fontWeight: 800, border: 'none', cursor: editSaving ? 'not-allowed' : 'pointer', fontSize: 14, opacity: editSaving ? 0.7 : 1 }}
          >
            {editSaving ? 'GUARDANDO...' : 'GUARDAR CAMBIOS'}
          </button>
          <button
            onClick={() => { if (!editSaving) setEditandoVenta(null) }}
            disabled={editSaving}
            style={{ height: 48, borderRadius: 12, background: '#374151', color: '#fff', fontWeight: 700, border: 'none', cursor: editSaving ? 'not-allowed' : 'pointer', fontSize: 14, padding: '0 24px', opacity: editSaving ? 0.7 : 1 }}
          >
            CANCELAR
          </button>
        </div>
      </div>
    </div>
  </div>
)}

{confirmDelete && (
  <ConfirmDialog
    title="Eliminar venta"
    message={`¿Seguro que querés borrar esta venta?\n\nSe va a restaurar el stock de los productos.`}
    onConfirm={handleDelete}
    onClose={() => setConfirmDelete(null)}
    confirmLabel="Eliminar"
    danger
  />
)}
    </div>
  )
}