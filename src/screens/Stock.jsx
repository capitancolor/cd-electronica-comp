import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Database from '@tauri-apps/plugin-sql'
import { eliminarProducto, getProveedores, importarProductosDesdeExcel, getStock } from '../services/negocio'
import { supabase } from '../supabase'
import { Icon, toast } from '../components/UI'
import StockModales from './StockModales'
import ErrorBoundary from '../components/ErrorBoundary'
import { exportarStockExcel, importarStockExcel } from '../services/exportExcel'

const fmt = v => '$' + Number(v || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const UI = {
  pageBg: '#f0f0f0',
  cardBg: '#ffffff',
  title: '#000000',
  theadBg: '#1a1a1a',
  theadText: '#ffffff',
  rowBorder: '#eeeeee',
  textMain: '#000000',
  textMuted: '#666666'
}

function SortableTh({ label, field, sortConfig, onSort, align = 'left', color = 'inherit' }) {
  const isSorted = sortConfig.key === field;
  return (
    <th onClick={() => onSort(field)} style={{
      padding: '15px 12px',
      textAlign: align,
      cursor: 'pointer',
      userSelect: 'none',
      color: isSorted ? '#2196f3' : color
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

function ActionIconButton({ color, title, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        color,
        background: 'none',
        border: 'none',
        padding: '6px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: '0.2s',
        borderRadius: 4
      }}
      onMouseOver={e => e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.05)'}
      onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
    >
      {children}
    </button>
  )
}

export default function Stock({ usuario, config }) {
  const [stock, setStock] = useState([])
  const [locales, setLocales] = useState([])
  const [categorias, setCategorias] = useState([])
  const [proveedores, setProveedores] = useState([])
  const esAdmin = usuario.rol === 'admin';
  const [filtroLocal, setFiltroLocal] = useState(usuario.rol !== 'admin' ? String(config.local_id) : '')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [filtroProveedor, setFiltroProveedor] = useState('')
  const [filtroMarca, setFiltroMarca] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [filtroBusqueda, setFiltroBusqueda] = useState('')
  const debounceRef = useRef(null)

  const [pagina, setPagina] = useState(1)
  const POR_PAGINA = 50

  const [sortConfig, setSortConfig] = useState({ key: 'nombre', direction: 'asc' })
  const [modal, setModal] = useState(null)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [cotizacion, setCotizacion] = useState(1100)
  const dbRef = useRef(null)

  const estadoInicialNuevo = {
    nombre: '',
    precio_costo: '',
    precio_costo_usd: '',
    precio_venta: '',
    precio_promo: '',
    categoria_id: '',
    stock_l1: '0',
    stock_l2: '0',
    proveedor_id: '',
    marca: '',
    modelo: '',
    en_promo: false
  }

  const [formNuevo, setFormNuevo] = useState(estadoInicialNuevo)
  const [formMov, setFormMov] = useState({ cantidad: '', local_id: '', destino_id: '' }) // Mantenido por si se requiere en el futuro

const getDb = async () => {
    if (!dbRef.current) dbRef.current = await Database.load("sqlite:cd_electronica.db");
    return dbRef.current;
  }

  const cargarStock = useCallback(async () => {
    try {
      setLoading(true);
      const db = await getDb();
      const data = await db.select("SELECT * FROM productos WHERE activo = 1");

      const provMap = {};
      proveedores.forEach(p => provMap[p.id] = p.nombre);
      const catMap = {};
      categorias.forEach(c => catMap[c.id] = c.nombre);

      const dataNormalizada = data.map(p => ({
        ...p,
        en_promo: p.en_promo === 1,
        stock_l1: p.stock_l1 || 0,
        stock_l2: p.stock_l2 || 0,
        proveedor_nombre: provMap[p.proveedor_id] || '-',
        categoria_nombre: catMap[p.categoria_id] || '-'
      }));

      setStock(dataNormalizada);
    } catch (e) {
      console.error("Error cargando stock local:", e);
    } finally {
      setLoading(false);
    }
  }, [proveedores, categorias]);

  const inicializar = async () => {
    try {
      const db = await getDb();
      const cats = await db.select("SELECT * FROM categorias");
      setCategorias(cats);
      setLocales([{ id: 1, nombre: 'LOCAL 1' }, { id: 2, nombre: 'LOCAL 2' }]);
      try {
        const provs = await getProveedores();
        if (provs) setProveedores(provs);
      } catch (err) {
        console.warn("Modo Offline: No se pudieron cargar los proveedores.");
      }
    } catch (err) {
      console.error("Error inicializando:", err);
    }
  };

  useEffect(() => {
    const arrancar = async () => {
      await inicializar();
      setReady(true);
    };
    arrancar();
  }, []);

  useEffect(() => {
    if (ready) cargarStock();
  }, [ready, cargarStock]);

  // Realtime: escuchar cambios en stock/productos (otras terminales)
  useEffect(() => {
    if (!ready) return;
    const channel = supabase
      .channel('stock-cambios')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'stock' },
        async () => {
          console.log('🔄 Cambio en stock, sincronizando...');
          await getStock({});
          cargarStock();
        }
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'productos' },
        async () => {
          console.log('🔄 Cambio en productos, sincronizando...');
          await getStock({});
          cargarStock();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ready, cargarStock]);

  useEffect(() => {
    setPagina(1)
  }, [filtroBusqueda, filtroCategoria, filtroProveedor, filtroMarca, filtroLocal])

  useEffect(() => {
    const cargarDolar = async () => {
      const valor = await fetchDolar();
      setCotizacion(valor);
    };
    cargarDolar();
  }, []);

const fetchDolar = async () => {
  try {
    // Intentamos buscar el precio actualizado
    const response = await fetch("https://dolarapi.com/v1/dolares/oficial");
    if (!response.ok) throw new Error("Error de red");
    
    const data = await response.json();
    
    // Guardamos en caché para la próxima vez que estemos offline
    localStorage.setItem('cd_ultimo_dolar', JSON.stringify({
      valor: data.venta,
      fecha: new Date().toISOString()
    }));
    
    return data.venta;
  } catch (error) {
    // Si falla (como ahora), buscamos el último guardado
    const cache = localStorage.getItem('cd_ultimo_dolar');
    if (cache) {
      const { valor, fecha } = JSON.parse(cache);
      console.warn(`Modo Offline: Usando dólar del ${new Date(fecha).toLocaleDateString()}`);
      return valor;
    }
    
    // Si nunca se guardó nada, un valor default para no romper cálculos
    console.error("Sin internet y sin caché de dólar.");
    return 1000; 
  }
};

  const handleBusqueda = (e) => {
    const v = e.target.value
    setBusqueda(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setFiltroBusqueda(v), 300)
  }

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  }

  const handleEliminar = async (p) => {
    alert(`ATENCIÓN: Vas a eliminar el producto "${p.nombre}". Esta acción no se puede deshacer.`);
    if (!window.confirm(`¿Confirmas eliminar "${p.nombre}"?`)) return;
    try {
      setLoading(true);
      setStock(prev => prev.filter(item => item.id !== p.id));
      const { error } = await eliminarProducto(p.id);
      if (error) throw error;
      toast('Producto eliminado', 'success');
      cargarStock();
    } catch (err) {
      toast('Error al eliminar', 'error');
      cargarStock();
    } finally {
      setLoading(false);
    }
  }

  const marcasUnicas = useMemo(
    () => [...new Set(stock.map(p => p.marca).filter(Boolean))].sort(),
    [stock]
  )

  const stockFiltrado = useMemo(() => stock.map(p => {
    const costoRegulable = (p.precio_costo_usd || 0) * cotizacion
    return {
      ...p,
      costo_reg: costoRegulable,
      costo_mas_100: (p.precio_costo || 0) * 2,
      precio_promo: p.precio_promo || 0,
    }
  }).filter(p => {
    if (filtroBusqueda) {
      const palabras = filtroBusqueda.toLowerCase().split(/\s+/).filter(Boolean)
      const cumple = palabras.every(pal =>
        p.nombre?.toLowerCase().includes(pal) ||
        p.marca?.toLowerCase().includes(pal) ||
        p.modelo?.toLowerCase().includes(pal)
      )
      if (!cumple) return false
    }
    if (filtroCategoria && String(p.categoria_id) !== String(filtroCategoria)) return false
    if (filtroProveedor && String(p.proveedor_id) !== String(filtroProveedor)) return false
    if (filtroMarca && p.marca !== filtroMarca) return false
    if (filtroLocal === '1' && p.stock_l1 <= 0) return false
    if (filtroLocal === '2' && p.stock_l2 <= 0) return false
    return true
  }).sort((a, b) => {
    const valA = a[sortConfig.key] || ''
    const valB = b[sortConfig.key] || ''
    if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
    if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  }), [stock, filtroBusqueda, filtroCategoria, filtroProveedor, filtroMarca, filtroLocal, sortConfig, cotizacion])

  const totalPaginas = Math.max(1, Math.ceil(stockFiltrado.length / POR_PAGINA))
  const listaAMostrar = useMemo(() => {
    const inicio = (pagina - 1) * POR_PAGINA
    return stockFiltrado.slice(inicio, inicio + POR_PAGINA)
  }, [stockFiltrado, pagina])

  const cerrarModal = () => {
    setModal(null)
    setFormMov({ cantidad: '', local_id: filtroLocal || '1', destino_id: '' })
    setFormNuevo(estadoInicialNuevo)
    setLoading(false)
  }

  const handleImportarExcel = async () => {
    const data = await importarStockExcel()
    if (!data || data.length === 0) return

    setLoading(true)
    try {
      const importados = await importarProductosDesdeExcel(data, usuario.id)
      if (importados > 0) {
        toast(`${importados} productos importados correctamente`)
        await cargarStock()
      }
    } catch (err) {
      toast("Error al importar: " + err.message, "error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 15, background: UI.pageBg, padding: 15, color: UI.textMain }}>

      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontWeight: 900, fontSize: 22 }}>STOCK & PRECIOS</h2>

        <div style={{ display: 'flex', gap: 10 }}>
          {esAdmin && (
            <button onClick={() => setModal({ tipo: 'categorias' })} style={{ background: '#fff', border: '1px solid #ccc', padding: '8px 15px', borderRadius: 8, fontWeight: 700, fontSize: 11 }}>
              CATEGORÍAS
            </button>
          )}
          {esAdmin && (
            <button onClick={() => setModal({ tipo: 'proveedores' })} style={{ background: '#fff', border: '1px solid #ccc', padding: '8px 15px', borderRadius: 8, fontWeight: 700, fontSize: 11 }}>
              PROVEEDORES
            </button>
          )}

          <button onClick={() => { console.log('Stock a exportar:', stockFiltrado?.length || 0); exportarStockExcel(stockFiltrado, filtroLocal); }} title="Exportar Stock a Excel" style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '8px 15px', borderRadius: 8, fontWeight: 800, fontSize: 11, cursor: 'pointer' }}>
            📊 EXCEL
          </button>
          {esAdmin && (
            <button onClick={handleImportarExcel} disabled={loading} title="Importar productos desde Excel" style={{ background: '#f59e0b', color: '#fff', border: 'none', padding: '8px 15px', borderRadius: 8, fontWeight: 800, fontSize: 11, cursor: 'pointer' }}>
              📥 IMPORTAR EXCEL
            </button>
          )}
          {esAdmin && (
            <button onClick={() => setModal({ tipo: 'nuevo' })} className="btn-primary" style={{ padding: '8px 20px', fontWeight: 800, borderRadius: 8 }}>
              + NUEVO PRODUCTO
            </button>
          )}
        </div>

        <div style={{ 
          display: 'flex', alignItems: 'center', gap: 15, background: '#fff', 
          padding: '10px 20px', borderRadius: 12, border: '1px solid #2196f3',
          width: 'fit-content', boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Dólar Oficial (Venta)
            </div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#3b6332', display: 'flex', alignItems: 'baseline', gap: 5 }}>
              {fmt(cotizacion)}
            </div>
          </div>
          <button onClick={fetchDolar} title="Actualizar cotización" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', padding: '5px', display: 'flex' }}>
            <Icon name="refresh" size={16} />
          </button>
        </div>
      </div>

      {/* FILTROS */}
      <div style={{ display: 'flex', gap: 10, background: UI.cardBg, padding: 15, borderRadius: 12, border: '1px solid #ddd' }}>
        <input placeholder="Buscar..." value={busqueda} onChange={handleBusqueda} style={{ flex: 2, padding: 10, borderRadius: 8, border: '1px solid #ccc' }} />
        <select value={filtroLocal} onChange={e => setFiltroLocal(e.target.value)} style={{ flex: 1, padding: 10 }}>
          <option value="">Locales</option>
          {locales.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
        </select>
        <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)} style={{ flex: 1, padding: 10 }}>
          <option value="">Categorías</option>
          {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select value={filtroProveedor} onChange={e => setFiltroProveedor(e.target.value)} style={{ flex: 1, padding: 10 }}>
          <option value="">Proveedores</option>
          {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>

      </div>

      {/* TABLA */}
      <div style={{ flex: 1, overflow: 'auto', background: UI.cardBg, border: '1px solid #ddd', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: UI.theadBg, color: UI.theadText }}>
            <tr>
              <SortableTh label="PRODUCTO" field="nombre" sortConfig={sortConfig} onSort={handleSort} />
              <SortableTh label="MARCA" field="marca" sortConfig={sortConfig} onSort={handleSort} />
              <SortableTh label="MODELO" field="modelo" sortConfig={sortConfig} onSort={handleSort} />
              <SortableTh label="CATEGORÍA" field="categoria_nombre" sortConfig={sortConfig} onSort={handleSort} />
              {esAdmin && (
                <>
                  <SortableTh label="COSTO FIJO." field="precio_costo" sortConfig={sortConfig} onSort={handleSort} align="right" />
                  <SortableTh label="CON EL 100%" field="costo_mas_100" sortConfig={sortConfig} onSort={handleSort} align="right" />
                  <SortableTh label="PROVEEDOR" field="proveedor_nombre" sortConfig={sortConfig} onSort={handleSort} />
                </>
              )}
              {(filtroLocal === '' || filtroLocal === '1') && (
                <SortableTh label="L1" field="stock_l1" sortConfig={sortConfig} onSort={handleSort} align="center" />
              )}
              {(filtroLocal === '' || filtroLocal === '2') && (
                <SortableTh label="L2" field="stock_l2" sortConfig={sortConfig} onSort={handleSort} align="center" />
              )}
              <SortableTh label="P. PROMO" field="precio_promo" sortConfig={sortConfig} onSort={handleSort} align="right" color="#facc15" />
              <SortableTh label="P. VENTA" field="precio_venta" sortConfig={sortConfig} onSort={handleSort} align="right" />
              <th style={{ padding: '0 10px' }}>ACCIONES</th>
            </tr>
          </thead>
          <tbody>
            {listaAMostrar.map(p => {
              const sinStockTotal = (Number(p.stock_l1 || 0) + Number(p.stock_l2 || 0)) === 0;
              return (
                <tr key={p.id} style={{ 
                  borderBottom: `1px solid #ddd`,
                  background: p.en_promo ? '#fff9c4' : (sinStockTotal ? '#f9fafb' : UI.cardBg),
                  transition: 'background 0.2s'
                }}>
                  <td style={{ padding: '8px', fontWeight: 700, color: sinStockTotal ? '#9ca3af' : 'inherit' }}>
                    {p.nombre}
                    {p.en_promo && (
                      <span style={{ marginLeft: '6px', fontSize: '10px', background: '#facc15', color: '#854d0e', padding: '2px 6px', borderRadius: '4px', fontWeight: 800 }}>PROMO</span>
                    )}
                  </td>
                  <td style={{ color: sinStockTotal ? '#9ca3af' : 'inherit' }}>{p.marca}</td>
                  <td style={{ color: sinStockTotal ? '#9ca3af' : 'inherit' }}>{p.modelo}</td>
                  <td style={{ color: sinStockTotal ? '#9ca3af' : 'inherit' }}>{p.categoria_nombre}</td>
                  {esAdmin && (
                    <>
                      <td align="right" style={{ color: sinStockTotal ? '#9ca3af' : 'inherit' }}>{fmt(p.precio_costo)}</td>
                      <td align="right" style={{ color: sinStockTotal ? '#9ca3af' : 'inherit' }}>{fmt(p.costo_mas_100)}</td>
                      <td style={{ color: sinStockTotal ? '#9ca3af' : 'inherit' }}>{p.proveedor_nombre}</td>
                    </>
                  )}
                  {(filtroLocal === '' || filtroLocal === '1') && (
                    <td align="center" style={{ fontWeight: 700, color: Number(p.stock_l1) === 0 ? '#ef4444' : '#16a34a' }}>{p.stock_l1}</td>
                  )}
                  {(filtroLocal === '' || filtroLocal === '2') && (
                    <td align="center" style={{ fontWeight: 700, color: Number(p.stock_l2) === 0 ? '#ef4444' : '#16a34a' }}>{p.stock_l2}</td>
                  )}
                  <td align="right" style={{ fontWeight: 800, color: '#d97706' }}>{p.en_promo ? fmt(p.precio_promo) : '-'}</td>
                  <td align="right" style={{ fontWeight: 800, textDecoration: p.en_promo ? 'line-through' : 'none', color: p.en_promo ? '#9ca3af' : 'inherit' }}>{fmt(p.precio_venta)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, padding: '4px' }}>
                      {esAdmin && (<ActionIconButton color="#555" title="Editar" onClick={() => setModal({ tipo: 'editar', item: p })}><Icon name="tune" /></ActionIconButton>)}
                      <ActionIconButton color="#e65100" title="Transferir" onClick={() => setModal({ tipo: 'transferir', item: p })}><Icon name="transfer" /></ActionIconButton>
                      {esAdmin && (<ActionIconButton color="#d32f2f" title="Eliminar" onClick={() => handleEliminar(p)}><Icon name="trash" /></ActionIconButton>)}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* PAGINACIÓN */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
        <span style={{ fontSize: 13, color: '#666' }}>
          {stockFiltrado.length} artículos · Pág. {pagina} de {totalPaginas}
        </span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button disabled={pagina <= 1} onClick={() => setPagina(p => Math.max(1, p - 1))} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ccc', background: pagina <= 1 ? '#f0f0f0' : '#fff', cursor: pagina <= 1 ? 'default' : 'pointer', fontWeight: 700, fontSize: 12 }}>
            ◀
          </button>
          {(() => {
            const maxVisible = 7
            let inicio = Math.max(1, pagina - Math.floor(maxVisible / 2))
            let fin = Math.min(totalPaginas, inicio + maxVisible - 1)
            if (fin - inicio + 1 < maxVisible) inicio = Math.max(1, fin - maxVisible + 1)
            const pages = []
            if (inicio > 1) pages.push({ n: 1, label: '1' }, { n: -1, label: '...' })
            for (let i = inicio; i <= fin; i++) pages.push({ n: i, label: String(i) })
            if (fin < totalPaginas) pages.push({ n: -2, label: '...' }, { n: totalPaginas, label: String(totalPaginas) })
            return pages.map(p => 
              p.n < 0 ? (
                <span key={p.label} style={{ padding: '6px 4px', fontSize: 12, color: '#999' }}>{p.label}</span>
              ) : (
                <button key={p.n} onClick={() => setPagina(p.n)} disabled={p.n === pagina} style={{
                  padding: '6px 10px', borderRadius: 6, border: p.n === pagina ? '2px solid #2196f3' : '1px solid #ddd',
                  background: p.n === pagina ? '#e3f2fd' : '#fff',
                  color: p.n === pagina ? '#1565c0' : '#333',
                  cursor: 'pointer', fontWeight: p.n === pagina ? 800 : 400, fontSize: 12
                }}>
                  {p.label}
                </button>
              )
            )
          })()}
          <button disabled={pagina >= totalPaginas} onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ccc', background: pagina >= totalPaginas ? '#f0f0f0' : '#fff', cursor: pagina >= totalPaginas ? 'default' : 'pointer', fontWeight: 700, fontSize: 12 }}>
            ▶
          </button>
        </div>
      </div>

      <ErrorBoundary>
        <StockModales
          modal={modal} cerrarModal={cerrarModal}
          formMov={formMov} setFormMov={setFormMov}
          formNuevo={formNuevo} setFormNuevo={setFormNuevo}
          loading={loading} setLoading={setLoading}
          locales={locales} proveedores={proveedores} categorias={categorias}
          cotizacion={cotizacion} setModal={setModal} usuario={usuario}
          cargarStock={cargarStock}
          setCategorias={setCategorias} 
          setProveedores={setProveedores}
          setStock={setStock}
          stock={stock}
        />
      </ErrorBoundary>
    </div>
  )
}