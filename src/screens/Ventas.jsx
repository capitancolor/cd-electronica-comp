import { useState, useEffect, useRef } from 'react'
import Database from '@tauri-apps/plugin-sql' // <-- IMPORTANTE: Agregar esto
import { supabase } from '../supabase' // Lo dejamos por si getResumenHoy lo necesita internamente
import { registrarVenta, getVentaDetalle, getResumenHoy } from '../services/negocio' // Quitamos getProductos y getStockCantidad
import { exportarVentaPDF } from '../services/exportPdf'
import { Icon, toast } from '../components/UI'

const fmt = v => '$' + Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 })

const METODOS = [
  { value: 'efectivo', label: '💵 Efectivo' },
  { value: 'tarjeta', label: '💳 Tarjeta (+10%)' },
  { value: 'transferencia', label: '🏦 Transferencia' },
  { value: 'mixto', label: '🔀 Pago Mixto' },
]

const UI = {
  pageBg: '#bbbbbb', pageText: '#111827', pageMuted: '#252525', pageBorder: '#d9e0e7',
  title: '#000000', subtitle: '#4b5563', divider: '#000000',
  statBg: '#ffffff', statBorder: '#000000', statLabel: '#6b7280', statValue: '#111827', statShadow: '0 1px 2px rgba(0,0,0,0.05)',
  searchBg: '#ffffff', searchText: '#111827', searchBorder: '#787878', searchIcon: '#6b7280',
  resultsWrapBg: '#ffffff', resultsWrapBorder: '#d9e0e7',
  resultCardBg: '#ffffff', resultCardBorder: '#707070', resultCardText: '#111827', resultPrice: '#111827', resultPriceNoStock: '#9ca3af',
  resultStock: '#16a34a', resultPlus: '#16a34a', resultDisabled: '#d1d5db', resultTagBg: '#fff3cd', resultTagText: '#856404',
  cartBg: '#ffffff', cartBorder: '#262627', cartTitle: '#111827', cartEmpty: '#6b7280', cartRowBorder: '#777777',
  trashBtnText: '#dc2626', trashBtnBg: '#ffffff', trashBtnBorder: 'transparent', trashBtnHoverBg: '#fef2f2', trashBtnHoverBorder: '#fecaca',
  qtyBoxBg: '#f8fafc', qtyBoxBorder: '#777777', qtyBoxText: '#111827', qtyBtnText: '#374151', qtyBtnHoverBg: '#eef2f7', qtyBtnHoverBorder: '#e0e4d7',
  summaryBg: '#f8fafc', summaryBorder: '#000000', subtotalText: '#6b7280', totalText: '#111827', totalValue: '#16a34a',
  selectBg: '#ffffff', selectText: '#111827', selectBorder: '#000000',
  primaryBtnBg: '#16a34a', primaryBtnText: '#ffffff', primaryBtnBorder: '#16a34a', primaryBtnHoverBg: '#15803d',
  modalOverlayBg: 'rgba(0, 0, 0, 0.18)', modalBg: '#ffffff', modalBorder: '#d9e0e7', modalText: '#111827', modalTitle: '#111827',
  modalDivider: '#e5e7eb', modalCloseBg: '#ffffff', modalCloseText: '#6b7280', modalCloseBorder: '#d1d5db', modalCloseHoverBg: '#f3f4f6',
  ticketAmount: '#16a34a', ticketMuted: '#6b7280',
  placeholder: '#9c9f9d',
}

function VentaStatCard({ label, value, color = UI.statValue, ui }) {
  return (
    <div style={{ background: ui.statBg, border: `1px solid ${ui.statBorder}`, borderRadius: 14, padding: '14px 16px', minWidth: 150, boxShadow: ui.statShadow }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: ui.statLabel, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
    </div>
  )
}

function SoftIconButton({ onClick, title, children, color, hoverBg, hoverBorder, bg = 'transparent', border = 'transparent', disabled = false }) {
  const [hover, setHover] = useState(false)
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ background: hover && !disabled ? hoverBg : bg, color, border: `1px solid ${hover && !disabled ? hoverBorder : border}`, borderRadius: 8, padding: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1 }}>
      {children}
    </button>
  )
}

function VentaButton({ children, onClick, disabled = false, ui, style = {} }) {
  const [hover, setHover] = useState(false)
  return (
    <button type="button" onClick={onClick} disabled={disabled} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ height: 54, fontSize: 18, fontWeight: 800, width: '100%', background: hover && !disabled ? ui.primaryBtnHoverBg : ui.primaryBtnBg, color: ui.primaryBtnText, border: `1px solid ${ui.primaryBtnBorder}`, borderRadius: 12, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, ...style }}>
      {children}
    </button>
  )
}

function VentaModal({ title, onClose, children, width = 350, ui }) {
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{ position: 'fixed', inset: 0, background: ui.modalOverlayBg, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
      <div style={{ background: ui.modalBg, border: `1px solid ${ui.modalBorder}`, borderRadius: 14, padding: 24, width: '100%', maxWidth: width, color: ui.modalText, boxShadow: '0 10px 30px rgba(0,0,0,0.08)' }}>
        <div className="row-between" style={{ marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${ui.modalDivider}` }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: ui.modalTitle }}>{title}</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: ui.modalCloseText }}><Icon name="x" size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function Ventas({ usuario }) {
  const [busqueda, setBusqueda] = useState('')
  const isSubmitting = useRef(false);
  const [resultados, setResultados] = useState([])
  const [metodo, setMetodo] = useState('efectivo')
  const [resumen, setResumen] = useState({ cant: 0, total: 0 })
  const [categorias, setCategorias] = useState([])
  const [filtroCategoria, setFiltroCategoria] = useState('')

  const [esSugerencia, setEsSugerencia] = useState(true)

  const [marcas, setMarcas] = useState([])
const [filtroMarca, setFiltroMarca] = useState('')
const [filtroModelo, setFiltroModelo] = useState('')
  
  const [showManualModal, setShowManualModal] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [ticketModal, setTicketModal] = useState(null)
  const [localConfig, setLocalConfig] = useState({ id: null, nombre: 'Cargando local...' });
  const [manualData, setManualData] = useState({ concepto: '', precio: '' })
  const [mixtoData, setMixtoData] = useState({ efectivo: '', tarjeta: '', transferencia: '' })

  const [carrito, setCarrito] = useState(() => {
    const userId = usuario?.id || 'anon'
    const guardado = localStorage.getItem(`carrito_${userId}`)
    return guardado ? JSON.parse(guardado) : []
  })

const cargarListasBase = async () => {
  try {
    const db = await Database.load("sqlite:cd_electronica.db");
    
    // 1. LEER CONFIGURACIÓN DEL LOCAL (Hardcodeo en base local)
    let terminalLocalId = 1; // Valor por defecto por si algo falla
    try {
      const conf = await db.select("SELECT valor FROM configuracion WHERE clave = 'local_id'");
      if (conf && conf.length > 0) {
        terminalLocalId = Number(conf[0].valor);
      }
    } catch (errConfig) {
      console.warn("No se pudo leer la tabla configuracion, usando Local 1 por defecto.", errConfig);
    }

    // Actualizamos el estado para que toda la pantalla de Ventas sepa en qué PC estamos
    setLocalConfig({
      id: terminalLocalId,
      nombre: terminalLocalId === 1 ? '📍 LOCAL 1 (Principal)' : '📍 LOCAL 2 (Sucursal)' 
    });

    // 2. Categorías locales
    const cats = await db.select("SELECT * FROM categorias");
    setCategorias(cats || []);

    // 3. Marcas locales únicas (buscamos en productos para no tener repetidas ni vacías)
    const prodsMarcas = await db.select("SELECT DISTINCT marca FROM productos WHERE marca IS NOT NULL AND marca != '' AND activo = 1 ORDER BY marca ASC");
    setMarcas(prodsMarcas.map(p => p.marca));

  } catch (error) {
    console.error("Error cargando listas base:", error);
  }
};


  useEffect(() => {
    cargarListasBase();
    actualizarResumen(); 
  }, []);


  useEffect(() => {
    const userId = usuario?.id || 'anon'
    localStorage.setItem(`carrito_${userId}`, JSON.stringify(carrito))
  }, [carrito, usuario?.id])



  useEffect(() => {
    const cargar = async () => {
      const queryBusqueda = busqueda.trim();
      try {
        const db = await Database.load("sqlite:cd_electronica.db");
        
        let query = "SELECT * FROM productos WHERE activo = 1";
        let params = [];

        // Filtro por texto
        if (queryBusqueda) {
          query += " AND (nombre LIKE ? OR marca LIKE ? OR modelo LIKE ?)";
          const termino = `%${queryBusqueda}%`;
          params.push(termino, termino, termino);
        }

        // Filtro por categoría
        if (filtroCategoria) {
          query += " AND categoria_id = ?";
          params.push(Number(filtroCategoria));
        }

        // Filtro por marca
        if (filtroMarca) {
          query += " AND marca = ?";
          params.push(filtroMarca);
        }

        // Si no hay búsqueda, limitamos para hacer de "sugeridos" y no colgar la UI
        if (!queryBusqueda && !filtroCategoria && !filtroMarca) {
          query += " LIMIT 30";
        }

        const data = await db.select(query, params);

        // PROCESAMIENTO DE STOCK LOCAL
        const localId = usuario.local_id || 1;
        const otroLocalId = localId === 1 ? 2 : 1;

        const conStock = data.map(p => {
          const stockLocalActual = Number(p[`stock_l${localId}`]) || 0;
          const stockOtroLocal = Number(p[`stock_l${otroLocalId}`]) || 0;
          
          let infoExtra = null;
          if (stockLocalActual <= 0) {
            if (stockOtroLocal > 0) {
              infoExtra = { tipo: 'otro', local: `LOCAL ${otroLocalId}` };
            } else {
              infoExtra = { tipo: 'ninguno' };
            }
          }
          
          return { 
            ...p, 
            en_promo: p.en_promo === 1,
            stockActual: stockLocalActual, 
            infoExtra 
          };
        });

        setResultados(conStock);
      } catch (error) {
        console.error("Error cargando productos locales:", error);
      }
    };

    const t = setTimeout(cargar, 250);
    return () => clearTimeout(t);
  }, [busqueda, filtroCategoria, filtroMarca, usuario.local_id]);

  async function actualizarResumen() {
    try {
      const res = await getResumenHoy(usuario.local_id);
      setResumen(res);
    } catch (error) {
      console.error("Error al actualizar resumen:", error);
    }
  }

  // --- LOGICA DE CALCULOS ---
  const subtotalCarrito = carrito.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0)
  const nEfectivo = Number(mixtoData.efectivo) || 0
  const nTarjeta = Number(mixtoData.tarjeta) || 0
  const nTransferencia = Number(mixtoData.transferencia) || 0

  const totalIngresadoNeto = nEfectivo + nTarjeta + nTransferencia
  const faltaCubrirNeto = subtotalCarrito - totalIngresadoNeto
  const pagoNetoCompleto = metodo === 'mixto' ? (faltaCubrirNeto <= 0) : true

  const recargoTarjeta = (metodo === 'tarjeta') ? (subtotalCarrito * 0.10) : (nTarjeta * 0.10)
  const totalFinal = subtotalCarrito + recargoTarjeta;

  function agregarAlCarrito(prod) {
  // Validación inicial
  if (!prod.esManual && prod.stockActual <= 0) {
    return toast('Sin stock en este local', 'error');
  }

  setCarrito(prev => {
    const idx = prev.findIndex(i => i.producto_id === prod.id);
    
    if (idx >= 0) {
      // Validamos contra el stock que YA TENEMOS en el item del carrito
      if (!prev[idx].esManual && prev[idx].cantidad >= prev[idx].stockDisponible) {
        toast(`Límite alcanzado: ${prev[idx].stockDisponible} u.`, 'warning');
        return prev;
      }
      return prev.map((i, j) => j === idx ? { ...i, cantidad: i.cantidad + 1 } : i);
    }
    
    // Si es nuevo en el carrito, le "pegamos" el stock que traía el producto
    return [...prev, { 
      producto_id: prod.id, 
      nombre: prod.nombre, 
      precio_unitario: parseFloat(prod.precio_venta), 
      cantidad: 1,
      esManual: prod.esManual || false,
      stockDisponible: prod.stockActual // <--- ESTO ES LA CLAVE
    }];
  });
  setBusqueda('');
}

async function confirmarVentaFinal() {
    // Bloqueo de seguridad: si ya se está enviando, no hace nada
    if (isSubmitting.current) return;

    try {
      if (carrito.length === 0) return toast('Carrito vacío', 'error')
      
      // Activamos el bloqueo
      isSubmitting.current = true;

      const { id, error } = await registrarVenta({
        localId: usuario.local_id, 
        usuarioId: usuario.id, 
        items: carrito.map(item => ({
          producto_id: item.esManual ? null : item.producto_id,
          nombre: item.nombre, 
          precio_unitario: item.precio_unitario, 
          cantidad: item.cantidad,
          es_manual: item.esManual || false
        })),
        metodoPago: metodo, 
        totalFinal,
        detalleMixto: metodo === 'mixto' ? mixtoData : null
      })

      if (error) throw new Error(error)

      // Limpieza y éxito
      setTicketModal({ total: totalFinal }) 
      setCarrito([])
      setShowConfirmModal(false)
      setMixtoData({ efectivo: '', tarjeta: '', transferencia: '' })
      
      actualizarResumen() 
      toast(`✅ Venta/Ajuste registrado correctamente`)

    } catch (err) { 
      toast(err.message, 'error') 
    } finally {
      // IMPORTANTE: Liberamos el bloqueo siempre, pase lo que pase
      isSubmitting.current = false;
    }
  }
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16, background: UI.pageBg, color: UI.pageText, padding: 12, borderRadius: 12, position: 'relative' }}>
      <style>{`
        input::placeholder { color: ${UI.placeholder} !important; opacity: 1 !important; }
        .remito-table th { padding: 12px; text-align: left; border-bottom: 2px solid ${UI.divider}; font-size: 14px; }
        .remito-table td { padding: 12px; border-bottom: 1px solid ${UI.cartRowBorder}; }
        .busqueda-flotante {
          position: absolute;
          top: 180px; /* Ajustado debajo del buscador */
          left: 12px;
          right: 12px;
          z-index: 50;
          background: ${UI.resultsWrapBg};
          border: 1px solid ${UI.resultsWrapBorder};
          border-radius: 12px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.2);
          max-height: 400px;
          overflow-y: auto;
        }
      `}</style>
      
      {/* HEADER: Título y Stats */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 80 }}>
        <div>
          <h2 style={{ fontSize: 30, fontWeight: 900, margin: 0, color: UI.title }}>Nueva Venta</h2>
          <span style={{ fontSize: 16, fontWeight: 600, color: UI.subtitle }}>📍 {usuario.local_nombre}</span>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <VentaStatCard label="Ventas Hoy" value={resumen.cant} ui={UI} />
          <VentaStatCard label="Caja Hoy" value={fmt(resumen.total)} color={UI.totalValue} ui={UI} />
        </div>
      </div>

      <hr style={{ margin: 0, borderColor: UI.divider }} />

      {/* SECCIÓN DE BÚSQUEDA Y ACCIONES */}
      <div style={{ display: 'flex', gap: 10, position: 'relative' }}>
        <input 
          value={busqueda} 
          onChange={e => setBusqueda(e.target.value)} 
          placeholder="🔍 Buscar producto..." 
          style={{ flex: 1, height: 56, borderRadius: 12, border: `2px solid ${UI.searchBorder}`, padding: '0 15px', fontSize: 18, fontWeight: 600 }} 
        />
        <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)}
          style={{ width: 160, borderRadius: 12, border: `1px solid ${UI.searchBorder}`, padding: '0 10px', fontWeight: 600 }}>
          <option value="">Categorías</option>
          {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <button onClick={() => setShowManualModal(true)} style={{ height: 56, padding: '0 20px', borderRadius: 12, border: '2px solid #000', background: '#fff', fontWeight: 800, cursor: 'pointer' }}>
          + INGRESO MANUAL
        </button>

        {/* LISTA DE RESULTADOS FLOTANTE (Solo aparece al buscar) */}
        {busqueda.trim().length > 0 && (
  <div className="busqueda-flotante">
    {/* Encabezado opcional para la lista flotante para guiar la vista */}
    <div style={{ 
      display: 'flex', background: '#f8fafc', padding: '10px 16px', 
      borderBottom: `2px solid ${UI.resultsWrapBorder}`, fontSize: 11, 
      fontWeight: 800, color: '#64748b', textTransform: 'uppercase' 
    }}>
      <div style={{ flex: 2 }}>Producto</div>
      <div style={{ width: 120 }}>Marca</div>
      <div style={{ width: 120 }}>Modelo</div>
      <div style={{ width: 100, textAlign: 'right' }}>Precio</div>
      <div style={{ width: 60 }}></div>
    </div>

    {resultados.length === 0 ? (
      <div style={{ padding: 20, textAlign: 'center', color: UI.pageMuted }}>No se encontraron productos</div>
    ) : (
      resultados.map(p => {
        const tieneStockLocal = p.stockActual > 0;
        return (
          <div 
            key={p.id} 
            onClick={() => tieneStockLocal && agregarAlCarrito(p)}
            style={{ 
              display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${UI.pageBorder}`,
              cursor: tieneStockLocal ? 'pointer' : 'not-allowed', 
              background: p.en_promo ? UI.resultTagBg : '#fff',
              transition: 'background 0.2s'
            }}
            onMouseEnter={e => tieneStockLocal && (e.currentTarget.style.backgroundColor = '#f1f5f9')}
            onMouseLeave={e => tieneStockLocal && (e.currentTarget.style.backgroundColor = p.en_promo ? UI.resultTagBg : '#fff')}
          >
            {/* PRODUCTO */}
            <div style={{ flex: 2, fontWeight: 700, fontSize: 15 }}>
              {p.nombre} {p.en_promo && '⭐'}
            </div>

            {/* MARCA */}
            <div style={{ width: 120, fontSize: 13, color: UI.subtitle, fontWeight: 600 }}>
              {p.marca || '-'}
            </div>

            {/* MODELO */}
            <div style={{ width: 120, fontSize: 13, color: UI.subtitle, fontWeight: 600 }}>
              {p.modelo || '-'}
            </div>

            {/* PRECIO Y STOCK */}
            <div style={{ width: 100, textAlign: 'right' }}>
              <div style={{ fontWeight: 800, color: tieneStockLocal ? UI.resultPrice : UI.resultPriceNoStock }}>
                {fmt(p.precio_venta)}
              </div>
              <div style={{ fontSize: 10, color: tieneStockLocal ? UI.resultStock : '#dc2626', fontWeight: 700 }}>
                {tieneStockLocal ? `${p.stockActual} u.` : 'SIN STOCK'}
              </div>
            </div>

            {/* ACCIÓN */}
            <div style={{ width: 60, textAlign: 'right' }}>
              <Icon 
                name={tieneStockLocal ? "plus" : "close"} 
                size={20} 
                color={tieneStockLocal ? UI.resultPlus : UI.resultDisabled} 
              />
            </div>
          </div>
        )
      })
    )}
  </div>
)}
      </div>

      {/* CARRITO TIPO REMITO (ANCHO COMPLETO) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: UI.cartBg, border: `2px solid ${UI.cartBorder}`, borderRadius: 16, overflow: 'hidden' }}>
  <div className="scroll-area" style={{ flex: 1 }}>
    <table className="remito-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: '#f1f5f9' }}>
          <th style={{ width: '120px', textAlign: 'center' }}>Cant.</th>
          <th style={{ textAlign: 'left' }}>PRODUCTO</th>
          <th style={{ textAlign: 'left', width: '140px' }}>MARCA</th>
          <th style={{ textAlign: 'left', width: '140px' }}>MODELO</th>
          <th style={{ textAlign: 'right', width: '110px' }}>PRECIO U.</th>
          <th style={{ textAlign: 'right', width: '110px' }}>IMPORTE</th>
          <th style={{ textAlign: 'center', width: '50px' }}></th>
        </tr>
      </thead>
      <tbody>
        {carrito.length === 0 ? (
          <tr>
            <td colSpan="7" style={{ textAlign: 'center', padding: 60, color: UI.cartEmpty, fontSize: 16, fontWeight: 600 }}>
              Use el buscador para agregar ítems.
            </td>
          </tr>
        ) : (
          carrito.map((item, i) => {
            const pOriginal = resultados.find(p => p.id === item.producto_id) || {};
            
            return (
              <tr key={`${item.producto_id}-${i}`} style={{ borderBottom: `1px solid ${UI.cartRowBorder}` }}>
                {/* CANTIDAD CON BOTONES A LOS COSTADOS */}
                <td align="center">
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    gap: 12,
                    background: '#f1f5f9',
                    padding: '6px',
                    borderRadius: '8px',
                    width: 'fit-content',
                    margin: '0 auto'
                  }}>
                    <button 
                      onClick={() => setCarrito(c => c.map((x, j) => j === i ? { ...x, cantidad: Math.max(1, x.cantidad - 1) } : x))} 
                      style={{ border: '1px solid #ccc', background: '#fff', borderRadius: '4px', cursor: 'pointer', display: 'flex', padding: '4px' }}
                    >
                      <Icon name="minus" size={12} color="#dc2626" />
                    </button>
                    
                    <span style={{ fontWeight: 900, fontSize: 18, minWidth: '25px', textAlign: 'center' }}>{item.cantidad}</span>
                    
                  <button 
  onClick={() => {
    // 1. Si es manual, no hay límite, sumamos directo
    if (item.esManual) {
      return setCarrito(c => c.map((x, j) => j === i ? { ...x, cantidad: x.cantidad + 1 } : x));
    }

    // 2. Usamos 'item.stockDisponible' que guardamos al agregarlo
    if (item.cantidad >= item.stockDisponible) {
      return toast(`No hay más stock (${item.stockDisponible} u. máx)`, 'warning');
    }

    // 3. Si hay margen, sumamos
    setCarrito(c => c.map((x, j) => j === i ? { ...x, cantidad: x.cantidad + 1 } : x));
  }} 
  style={{ border: '1px solid #ccc', background: '#fff', borderRadius: '4px', cursor: 'pointer', display: 'flex', padding: '4px' }}
>
  <Icon name="plus" size={12} color="#16a34a" />
</button>
                  </div>
                </td>

                <td style={{ fontWeight: 800, fontSize: 15 }}>
                  {item.nombre}
                  {item.esManual && <span style={{ marginLeft: 8, fontSize: 9, background: '#fee2e2', color: '#dc2626', padding: '2px 4px', borderRadius: 4 }}>MANUAL</span>}
                </td>
                
                <td style={{ color: UI.subtitle, fontWeight: 600, fontSize: 13 }}>{pOriginal.marca || '-'}</td>
                <td style={{ color: UI.subtitle, fontWeight: 600, fontSize: 13 }}>{pOriginal.modelo || '-'}</td>
                
                <td align="right" style={{ fontWeight: 600, fontSize: 14 }}>{fmt(item.precio_unitario)}</td>
                <td align="right" style={{ fontWeight: 900, fontSize: 16 }}>{fmt(item.cantidad * item.precio_unitario)}</td>
                
                <td align="center">
                  <button 
                    onClick={() => setCarrito(c => c.filter(x => x.producto_id !== item.producto_id))} 
                    style={{ background: 'none', border: 'none', color: UI.trashBtnText, cursor: 'pointer', padding: '8px' }}
                  >
                    <Icon name="trash" size={18} />
                  </button>
                </td>
              </tr>
            )
          })
        )}
      </tbody>
    </table>
  </div>
        {/* FOOTER DEL REMITO: Totales y Cobro */}
        <div style={{ padding: 20, background: '#f1f5f9', borderTop: `2px solid ${UI.divider}`, display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 800, marginBottom: 5 }}>MÉTODO DE PAGO</label>
            <select value={metodo} onChange={e => setMetodo(e.target.value)} style={{ height: 48, width: '100%', borderRadius: 10, border: `2px solid ${UI.selectBorder}`, fontWeight: 700, fontSize: 16 }}>
              {METODOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          {metodo === 'mixto' && (
            <div style={{ display: 'flex', gap: 8, background: '#fff', padding: 10, borderRadius: 10, border: '1px solid #ccc' }}>
              <div className="col">
                <span style={{ fontSize: 9, fontWeight: 900 }}>EFECTIVO</span>
                <input type="number" value={mixtoData.efectivo} onChange={e => setMixtoData({...mixtoData, efectivo: e.target.value})} style={{ width: 80, height: 35, borderRadius: 6, border: '1px solid #000' }} />
              </div>
              <div className="col">
                <span style={{ fontSize: 9, fontWeight: 900 }}>TARJETA</span>
                <input type="number" value={mixtoData.tarjeta} onChange={e => setMixtoData({...mixtoData, tarjeta: e.target.value})} style={{ width: 80, height: 35, borderRadius: 6, border: '1px solid #000' }} />
              </div>
              <div className="col">
                <span style={{ fontSize: 9, fontWeight: 900 }}>TRANSF.</span>
                <input type="number" value={mixtoData.transferencia} onChange={e => setMixtoData({...mixtoData, transferencia: e.target.value})} style={{ width: 80, height: 35, borderRadius: 6, border: '1px solid #000' }} />
              </div>
            </div>
          )}

          <div style={{ textAlign: 'right', minWidth: 200 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: UI.subtitle }}>{metodo === 'mixto' && faltaCubrirNeto > 0 ? `FALTAN: ${fmt(faltaCubrirNeto)}` : 'TOTAL A COBRAR'}</div>
            <div style={{ fontSize: 38, fontWeight: 900, color: UI.totalValue, lineHeight: 1 }}>{fmt(totalFinal)}</div>
          </div>

          <VentaButton 
            ui={UI} 
            onClick={() => setShowConfirmModal(true)} 
            disabled={!carrito.length || (metodo === 'mixto' && faltaCubrirNeto > 0)}
            style={{ width: 220 }}
          >
            CONFIRMAR VENTA
          </VentaButton>
        </div>
      </div>
      {showManualModal && (
  <VentaModal title="Ajuste / Ingreso Manual" onClose={() => setShowManualModal(false)} ui={UI}>
    <div className="col" style={{ gap: 15 }}>
      <div style={{ fontSize: 13, color: '#666', marginBottom: -10 }}>Descripción (aparecerá en el reporte)</div>
      <input 
        value={manualData.concepto} 
        onChange={e => setManualData({...manualData, concepto: e.target.value})} 
        placeholder="Ej: Reparación de pin de carga"
        style={{ height: 44, padding: '0 12px', borderRadius: 8, border: '1px solid #ccc', fontWeight: '600' }} 
      />
      <div style={{ fontSize: 13, color: '#666', marginBottom: -10 }}>Monto</div>
      <input 
        type="number" 
        value={manualData.precio} 
        onChange={e => setManualData({...manualData, precio: e.target.value})}  
        placeholder="0.00"
        style={{ 
          height: 44, 
          padding: '0 12px', 
          borderRadius: 8, 
          border: '1px solid #ccc',
          fontWeight: '800',
          color: Number(manualData.precio) < 0 ? '#dc2626' : '#16a34a'
        }} 
      /><VentaButton ui={UI} onClick={() => {
        const conceptoOk = manualData.concepto && manualData.concepto.trim() !== '';
        const precioOk = manualData.precio !== '' && !isNaN(manualData.precio);

        if (!conceptoOk || !precioOk) {
          return toast('Por favor, ingresa descripción y monto', 'error');
        }
        
        // Creamos el objeto con el nombre que el usuario escribió
        const nuevoAjuste = { 
          id: `MANUAL-${Date.now()}`, 
  nombre: manualData.concepto.trim().toUpperCase(), 
  precio_venta: Number(manualData.precio), // registrarVenta usa precio_unitario, ojo ahí
  stockActual: 9999,
  esManual: true
        };
  // 3. Lo mandamos a la función que ya tenías
  agregarAlCarrito(nuevoAjuste);

  // 4. Limpiamos y cerramos
  setShowManualModal(false); 
  setManualData({ concepto: '', precio: '' });
}}>
  AGREGAR AJUSTE
</VentaButton>
    </div>
  </VentaModal>
)}

      {showConfirmModal && (
        <VentaModal title="Confirmar Venta" onClose={() => setShowConfirmModal(false)} ui={UI}>
          <div className="col" style={{ gap: 12 }}>
            <div className="row-between"><span>Subtotal:</span> <b>{fmt(subtotalCarrito)}</b></div>
            {recargoTarjeta > 0 && <div className="row-between" style={{ color: 'red' }}><span>Recargo Tarjeta:</span> <b>+{fmt(recargoTarjeta)}</b></div>}
            <div className="row-between" style={{ fontSize: 24, fontWeight: 900 }}><span>TOTAL:</span> <span style={{ color: UI.totalValue }}>{fmt(totalFinal)}</span></div>
            
            {/* Botón de exportar PDF separado */}
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
              <SoftIconButton 
                onClick={async () => {
                  try {
                    const success = await exportarVentaPDF(carrito, totalFinal, metodo, localConfig.nombre, usuario.nombre, metodo === 'mixto' ? mixtoData : null)
                    if (success) {
                      toast('PDF guardado correctamente', 'success')
                    }
                  } catch (error) {
                    toast('Error al guardar el PDF', 'error')
                  }
                }} 
                title="Exportar PDF de la venta"
                color="#2563eb"
                hoverBg="#dbeafe"
                hoverBorder="#2563eb"
                style={{ padding: 12, borderRadius: 8 }}
              >
                <Icon name="printer" size={24} />
              </SoftIconButton>
            </div>

            <VentaButton ui={UI} onClick={confirmarVentaFinal}>COBRAR</VentaButton>
          </div>
        </VentaModal>
      )}

      {ticketModal && (
        <VentaModal title="Venta Exitosa" onClose={() => setTicketModal(null)} ui={UI}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 32, fontWeight: 900, color: UI.ticketAmount }}>{fmt(ticketModal?.total || 0)}</div>
          </div>
          <VentaButton ui={UI} onClick={() => setTicketModal(null)}>Listo</VentaButton>
        </VentaModal>
      )}
    </div>
  )
}