import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { getProductos } from '../services/negocio'
import { Icon, toast } from '../components/UI'

const UI = {
  pageBg: '#e0e0e0',
  cardBg: '#ffffff',
  cardBorder: '#000000',
  inputBg: '#ffffff',
  inputText: '#000000',
  theadBg: '#000000',
  theadText: '#ffffff',
  rowBorder: '#a1a1a1',
  rowText: '#000000',
  accentBlue: '#2563eb',
  accentGreen: '#16a34a',
  accentRed: '#dc2626',
  scrollThumb: '#828181',
  scrollTrack: '#efefef'
}

const fmt = v => '$' + Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 })

function SoftButton({ children, onClick, bg, text, border, disabled }) {
  const [hover, setHover] = useState(false)
  return (
    <button 
      onClick={onClick} 
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover && !disabled ? text : bg,
        color: hover && !disabled ? bg : text,
        border: `2px solid ${border}`,
        borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 800,
        cursor: disabled ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, 
        opacity: disabled ? 0.5 : 1, transition: 'all 0.1s ease'
      }}>
      {children}
    </button>
  )
}

export default function MonitorPrecios() {
  const [productos, setProductos] = useState([])
  const [dolar, setDolar] = useState(null)
  const [aplicando, setAplicando] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [categorias, setCategorias] = useState([])
  const [filtroCategoria, setFiltroCategoria] = useState('')

  useEffect(() => { 
    fetchDolar()
    cargarDatos()
    supabase.from('categorias').select('*').then(({ data }) => setCategorias(data || [])) 
  }, [])

  useEffect(() => {
    const t = setTimeout(cargarDatos, 300)
    return () => clearTimeout(t)
  }, [busqueda, filtroCategoria])

  async function fetchDolar() {
    try {
      const res = await fetch('https://dolarapi.com/v1/dolares/oficial')
      const data = await res.json()
      if (data.venta) setDolar(data.venta)
    } catch (err) {
      console.error("Error cotización:", err)
    }
  }

  async function cargarDatos() {
    const p = await getProductos({ 
      busqueda: busqueda, 
      categoriaId: filtroCategoria 
    })
    setProductos(p.filter(x => x.precio_costo_usd > 0))
  }

  async function aplicarSincronizacion() {
    const total = productos.length
    if (!confirm(`¿Actualizar los precios de ${total} productos? Se ajustará la venta proporcionalmente al cambio de costo.`)) return
    
    setAplicando(true)
    try {
      for (const p of productos) {
        const nuevoCosto = p.precio_costo_usd * dolar
        const factor = p.precio_costo > 0 ? (nuevoCosto / p.precio_costo) : 1
        const nuevoPrecioVenta = Math.ceil((p.precio_venta * factor) / 100) * 100
        
        await supabase.from('productos').update({ 
          precio_venta: nuevoPrecioVenta,
          precio_costo: nuevoCosto 
        }).eq('id', p.id)
      }
      toast('Precios sincronizados con éxito', 'success')
      cargarDatos()
    } catch (err) {
      toast('Error al actualizar', 'error')
    } finally {
      setAplicando(false)
    }
  }

  return (
    <div className="col monitor-wrap" style={{ gap: 20, padding: 20, background: UI.pageBg, height: '100%', borderRadius: 12, overflow: 'hidden' }}>
      <style>{`
        .monitor-wrap::-webkit-scrollbar, .monitor-scroll::-webkit-scrollbar { width: 10px; }
        .monitor-wrap::-webkit-scrollbar-track, .monitor-scroll::-webkit-scrollbar-track { background: ${UI.scrollTrack}; }
        .monitor-wrap::-webkit-scrollbar-thumb, .monitor-scroll::-webkit-scrollbar-thumb { 
          background: ${UI.scrollThumb}; border-radius: 10px; border: 2px solid ${UI.scrollTrack}; 
        }
      `}</style>

      {/* HEADER COTIZACION */}
      <div className="row-between" style={{ background: UI.cardBg, padding: '20px 25px', borderRadius: 16, border: `2px solid ${UI.cardBorder}`, boxShadow: '4px 4px 0px rgba(0,0,0,0.1)' }}>
        <div className="col">
          <h2 style={{ fontSize: 24, fontWeight: 900, color: UI.rowText, margin: 0 }}>Sincronizador USD</h2>
          <p style={{ color: '#555', fontSize: 13, fontWeight: 600, margin: '4px 0 0 0' }}>Actualización proporcional por diferencia de costos (${dolar})</p>
        </div>
        
        <div className="row" style={{ gap: 20 }}>
          <div className="col" style={{ alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 900, color: '#000' }}>COTIZACIÓN $</span>
            <input type="number" value={dolar} onChange={e => setDolar(e.target.value)} style={{ width: 120, padding: '10px', borderRadius: 8, border: `2px solid ${UI.cardBorder}`, fontSize: 20, fontWeight: 900, textAlign: 'center', background: UI.inputBg, color: UI.inputText }} />
          </div>
          <SoftButton bg={UI.accentGreen} text="#ffffff" border={UI.cardBorder} onClick={aplicarSincronizacion} disabled={aplicando}>
            <Icon name="sync" size={18} /> {aplicando ? 'PROCESANDO...' : 'SINCRONIZAR'}
          </SoftButton>
        </div>
      </div>

      {/* FILTROS */}
      <div className="row" style={{ gap: 12 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#666' }}>
            <Icon name="search" size={16} />
          </span>
          <input 
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar producto..."
            style={{ 
              width: '100%', padding: '10px 10px 10px 35px', borderRadius: 10, 
              border: `2px solid ${UI.cardBorder}`, background: UI.inputBg,
              fontWeight: 600, height: 44, boxSizing: 'border-box'
            }}
          />
        </div>

        <select 
          value={filtroCategoria} 
          onChange={e => setFiltroCategoria(e.target.value)}
          style={{ 
            width: 200, height: 44, padding: '0 10px', borderRadius: 10, 
            border: `2px solid ${UI.cardBorder}`, background: UI.inputBg,
            fontWeight: 700, cursor: 'pointer'
          }}
        >
          <option value="">Todas las Categorías</option>
          {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>

   
      </div>
{/* TABLA */}
      <div className="monitor-scroll" style={{ flex: 1, overflow: 'auto', background: UI.cardBg, border: `2px solid ${UI.cardBorder}`, borderRadius: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            <tr style={{ background: UI.theadBg }}>
              <th style={{ padding: 18, textAlign: 'left', color: UI.theadText, fontSize: 11 }}>PRODUCTO</th>
              <th style={{ padding: 18, textAlign: 'right', color: UI.theadText, fontSize: 11 }}>COSTO USD</th>
              <th style={{ padding: 18, textAlign: 'right', color: UI.theadText, fontSize: 11 }}>COSTO EN PESOS (ACTUALIZADO)</th>
              <th style={{ padding: 18, textAlign: 'right', color: UI.theadText, fontSize: 11 }}>PRECIO DE VENTA ACTUAL</th>
            </tr>
          </thead>
          <tbody>
            {productos.map(p => {
              // Costo en pesos según el dólar de la cabecera (API o manual)
              const costoPesosActualizado = p.precio_costo_usd * (dolar || 0)
              
              // Verificamos si el costo nuevo supera al precio de venta actual (Alerta de pérdida)
              const enRiesgo = costoPesosActualizado >= p.precio_venta

              return (
                <tr key={p.id} style={{ 
                  borderBottom: `1px solid ${UI.rowBorder}`, 
                  background: enRiesgo ? '#fff1f1' : 'transparent' // Rojo muy suave si el costo supera la venta
                }}>
                  <td style={{ padding: 15, fontWeight: 700, fontSize: 13, color: UI.rowText }}>{p.nombre}</td>
                  
                  {/* COSTO USD (Fijo en DB) */}
                  <td style={{ padding: 15, textAlign: 'right', color: UI.accentBlue, fontWeight: 800 }}>
                    U$D {p.precio_costo_usd.toFixed(2)}
                  </td>
                  
                  {/* COSTO EN PESOS (USD * Dolar API/Input) */}
                  <td style={{ padding: 15, textAlign: 'right', color: '#615d5d', fontWeight: 800 }}>
                    {fmt(costoPesosActualizado)}
                  </td>
                  
                  {/* PRECIO DE VENTA ACTUAL (Tal cual está en la DB) */}
                  <td style={{ padding: 15, textAlign: 'right', color: '#000', fontWeight: 900 }}>
                    {fmt(p.precio_venta)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      
      
      </div>
    </div>
  )
}