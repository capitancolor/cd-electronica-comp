import { useState } from 'react'
import { supabase } from '../supabase'
import { toast, Icon } from '../components/UI'
import { crearProducto, getCategorias, getProveedores } from '../services/negocio'
import Database from '@tauri-apps/plugin-sql' // <-- Asegurate de tener este import

export default function StockModales({
  modal, cerrarModal, formMov, setFormMov, formNuevo, setFormNuevo,
  loading, setLoading, locales, proveedores, categorias,
  cotizacion, setModal, usuario, cargarStock, setCategorias, 
  setProveedores, setStock
}) {
  const [nuevoMaestro, setNuevoMaestro] = useState({ nombre: '', contacto: '', telefono: '', mail: '', direccion: '' })
  const [idEditando, setIdEditando] = useState(null)

  if (!modal) return null

  const isEdit = modal.tipo === 'editar'
  const isNuevo = modal.tipo === 'nuevo'
  const isGestion = ['categorias', 'proveedores'].includes(modal.tipo)

  const handlePrecioARSChange = (e) => {
    const value = e.target.value
    const usdCalculado = (cotizacion > 0 && value) ? (parseFloat(value) / cotizacion).toFixed(2) : '0.00'
    if (isEdit) {
      setModal({ ...modal, item: { ...modal.item, precio_costo: value, precio_costo_usd: usdCalculado } })
    } else {
      setFormNuevo({ ...formNuevo, precio_costo: value, precio_costo_usd: usdCalculado })
    }
  }

  const cancelarEdicion = () => {
    setIdEditando(null)
    setNuevoMaestro({ nombre: '', contacto: '', telefono: '', mail: '', direccion: '' })
  }

  // --- GESTIÓN DE MAESTROS (CATEGORÍAS / PROVEEDORES) ---
  const handleGuardarMaestro = async () => {
    if (!nuevoMaestro.nombre) return toast('El nombre es obligatorio', 'error')
    setLoading(true)
    try {
      let payload = { nombre: nuevoMaestro.nombre.trim() };
      if (modal.tipo === 'proveedores') {
        payload = {
          ...payload,
          contacto: nuevoMaestro.contacto || null,
          telefono: nuevoMaestro.telefono || null,
          email: nuevoMaestro.mail || null,
          direccion: nuevoMaestro.direccion || null,
        }
      }

      if (idEditando) {
        const { error } = await supabase.from(modal.tipo).update(payload).eq('id', idEditando)
        if (error) throw error
      } else {
        const { error } = await supabase.from(modal.tipo).insert([payload])
        if (error) throw error
      }

      toast('Operación exitosa');
      cancelarEdicion();

      // REFRESCAR SOLO LO NECESARIO
      if (modal.tipo === 'categorias') {
        const nuevasCats = await getCategorias();
        setCategorias(nuevasCats);
      } else {
        const nuevosProvs = await getProveedores();
        setProveedores(nuevosProvs);
      }
      
      // QUITAMOS cargarStock() de acá para evitar el "salto" al pasado del SQLite
    } catch (e) { 
      toast('Error: ' + e.message, 'error'); 
    } finally { 
      setLoading(false); 
    }
  }

  const handleDeleteMaestro = async (id) => {
    alert(`ATENCIÓN: Vas a eliminar este registro. Esta acción no se puede deshacer.`);
    if (!window.confirm('¿Confirmas eliminar este registro?')) return
    const { error } = await supabase.from(modal.tipo).delete().eq('id', id)
    if (error) {
        toast('No se puede borrar (tiene productos asociados)', 'error')
    } else { 
        toast('Eliminado');
        if (modal.tipo === 'categorias') {
            const nuevas = await getCategorias();
            setCategorias(nuevas); 
        } else {
            const nuevos = await getProveedores();
            setProveedores(nuevos);
        }
        // TAMBIÉN QUITAMOS cargarStock() de acá
    }
  }

  const prepararEdicion = (item) => {
    setIdEditando(item.id)
    setNuevoMaestro({
      nombre: item.nombre || '', 
      contacto: item.contacto || '', 
      telefono: item.telefono || '', 
      mail: item.email || item.mail || '', 
      direccion: item.direccion || ''
    })
  }

  // --- GESTIÓN DE PRODUCTOS ---
  async function handleGuardarProducto() {
    const data = isEdit ? modal.item : formNuevo;
    if (!data.nombre) return toast('Nombre obligatorio', 'error');
    
    setLoading(true);
    try {
      if (isNuevo) {
        await crearProducto({ ...data, usuario_id: usuario.id });
        toast('Guardado con éxito');
        await cargarStock(); 
        cerrarModal();
      } else {
        // 1. UPDATE EN SUPABASE
        const { error: errorProd } = await supabase.from('productos').update({
            nombre: data.nombre.trim(), marca: data.marca || null, modelo: data.modelo || null,
            en_promo: Boolean(data.en_promo), precio_venta: parseFloat(data.precio_venta || 0),
            precio_costo: parseFloat(data.precio_costo || 0), precio_costo_usd: parseFloat(data.precio_costo_usd || 0),
            precio_promo: parseFloat(data.precio_promo || 0),
            categoria_id: data.categoria_id ? parseInt(data.categoria_id) : null,
            proveedor_id: data.proveedor_id ? parseInt(data.proveedor_id) : null,
        }).eq('id', data.id);
        if (errorProd) throw errorProd;

        await supabase.from('stock').upsert({ producto_id: data.id, local_id: 1, cantidad: parseInt(data.stock_l1 || 0) });
        await supabase.from('stock').upsert({ producto_id: data.id, local_id: 2, cantidad: parseInt(data.stock_l2 || 0) });

        // 2. UPDATE EN SQLITE LOCAL (PARA MATAR AL FANTASMA)
        const db = await Database.load("sqlite:cd_electronica.db");
        await db.execute(`
          UPDATE productos 
          SET nombre = ?, marca = ?, modelo = ?, en_promo = ?,
              precio_venta = ?, precio_costo = ?, precio_costo_usd = ?, precio_promo = ?,
              categoria_id = ?, proveedor_id = ?, stock_l1 = ?, stock_l2 = ?
          WHERE id = ?
        `, [
          data.nombre.trim(), data.marca || null, data.modelo || null, data.en_promo ? 1 : 0,
          parseFloat(data.precio_venta || 0), parseFloat(data.precio_costo || 0), 
          parseFloat(data.precio_costo_usd || 0), parseFloat(data.precio_promo || 0),
          data.categoria_id ? parseInt(data.categoria_id) : null, 
          data.proveedor_id ? parseInt(data.proveedor_id) : null, 
          parseInt(data.stock_l1 || 0), parseInt(data.stock_l2 || 0), data.id
        ]);

        toast('Guardado con éxito');
        await cargarStock(); 
        cerrarModal();
      }
    } catch (e) {
      console.error("ERROR:", e);
      toast(e.message || 'Falla al guardar', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 25, width: isGestion ? 700 : 500, border: '1px solid #ddd', boxShadow: '0 5px 15px rgba(0,0,0,0.1)', maxHeight: '95vh', overflowY: 'auto' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontWeight: 900, color: '#000', fontSize: 18, textTransform: 'uppercase' }}>{modal.tipo}</h3>
          <button onClick={cerrarModal} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#666', fontWeight: 900 }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
          {/* ... Lógica de Gestión (Categorías/Proveedores) queda igual ... */}
          {isGestion && (
            <>
              <div style={{ background: idEditando ? '#fff3e0' : '#f9f9f9', padding: 15, borderRadius: 10, border: idEditando ? '1px solid #ffb74d' : '1px solid #eee', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: idEditando ? '#e65100' : '#666', marginBottom: 5 }}>
                    {idEditando ? 'EDITANDO REGISTRO SELECCIONADO' : `CARGAR NUEVA ${modal.tipo.toUpperCase()}`}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: modal.tipo === 'proveedores' ? '1fr 1fr' : '1fr', gap: 10 }}>
                  <input placeholder="Nombre / Razón Social" value={nuevoMaestro.nombre} onChange={e => setNuevoMaestro({...nuevoMaestro, nombre: e.target.value})} style={{ padding: 10, borderRadius: 6, border: '1px solid #ccc', color: '#000', fontWeight: 600 }} />
                  {modal.tipo === 'proveedores' && (
                    <>
                      <input placeholder="Contacto / Vendedor" value={nuevoMaestro.contacto} onChange={e => setNuevoMaestro({...nuevoMaestro, contacto: e.target.value})} style={{ padding: 10, borderRadius: 6, border: '1px solid #ccc', color: '#000' }} />
                      <input placeholder="Teléfono" value={nuevoMaestro.telefono} onChange={e => setNuevoMaestro({...nuevoMaestro, telefono: e.target.value})} style={{ padding: 10, borderRadius: 6, border: '1px solid #ccc', color: '#000' }} />
                      <input placeholder="E-mail" value={nuevoMaestro.mail} onChange={e => setNuevoMaestro({...nuevoMaestro, mail: e.target.value})} style={{ padding: 10, borderRadius: 6, border: '1px solid #ccc', color: '#000' }} />
                      <input placeholder="Dirección" value={nuevoMaestro.direccion} onChange={e => setNuevoMaestro({...nuevoMaestro, direccion: e.target.value})} style={{ padding: 10, borderRadius: 6, border: '1px solid #ccc', color: '#000', gridColumn: 'span 2' }} />
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={handleGuardarMaestro} className="btn-primary" disabled={loading} style={{ flex: 1, padding: 10, fontWeight: 700, background: idEditando ? '#e65100' : '' }}>
                        {idEditando ? '💾 ACTUALIZAR DATOS' : '+ AGREGAR A LA LISTA'}
                    </button>
                    {idEditando && <button onClick={cancelarEdicion} style={{ padding: '0 15px', borderRadius: 6, border: '1px solid #ccc', cursor: 'pointer', fontWeight: 700 }}>CANCELAR</button>}
                </div>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', color: '#000' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left', fontSize: 11 }}>
                    <th style={{ padding: 10 }}>NOMBRE</th>
                    {modal.tipo === 'proveedores' && <th style={{ padding: 10 }}>CONTACTO / INFO</th>}
                    <th style={{ padding: 10, textAlign: 'center' }}>ACCIONES</th>
                  </tr>
                </thead>
                <tbody>
                  {(modal.tipo === 'categorias' ? categorias : proveedores).map(i => (
                    <tr key={i.id} style={{ borderBottom: '1px solid #eee', background: idEditando === i.id ? '#fff9f0' : 'transparent' }}>
                      <td style={{ padding: 10, fontWeight: 700, fontSize: 13 }}>{i.nombre}</td>
                      {modal.tipo === 'proveedores' && (
                        <td style={{ padding: 10, fontSize: 11, color: '#333' }}>
                          <div>{i.contacto && <b>{i.contacto}</b>} {i.telefono && `| ${i.telefono}`}</div>
                          <div style={{ color: '#666' }}>{i.mail}</div>
                        </td>
                      )}
                      <td style={{ textAlign: 'center', width: 80 }}>
                        <button onClick={() => prepararEdicion(i)} style={{ background: 'none', border: 'none', color: '#007bff', cursor: 'pointer', marginRight: 10 }}><Icon name="tune" size={16} /></button>
                        <button onClick={() => handleDeleteMaestro(i.id)} style={{ background: 'none', border: 'none', color: '#d32f2f', cursor: 'pointer' }}><Icon name="trash" size={16} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {(isNuevo || isEdit) && (
            <>
              {/* SECCIÓN PROMO Y PRECIO PROMO */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: '#fff9c4', padding: 15, borderRadius: 10, border: '1px solid #fbc02d' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontWeight: 800, color: '#854d0e', fontSize: 14 }}>
                    <input 
                      type="checkbox" 
                      checked={isEdit ? modal.item.en_promo : formNuevo.en_promo} 
                      onChange={e => isEdit ? setModal({...modal, item: {...modal.item, en_promo: e.target.checked}}) : setFormNuevo({...formNuevo, en_promo: e.target.checked})} 
                      style={{ width: 20, height: 20 }} 
                    /> ¿ESTÁ EN PROMOCIÓN?
                  </label>
                  <div style={{ fontWeight: 800, color: '#2e7d32', fontSize: 12 }}>DÓLAR: ${cotizacion}</div>
                </div>

                {(isEdit ? modal.item.en_promo : formNuevo.en_promo) && (
                  <div>
                    <label style={{ fontWeight: 700, fontSize: 11, color: '#854d0e', marginBottom: 3, display: 'block' }}>Precio de Oferta (ARS)</label>
                    <input 
                      type="number" 
                      placeholder="Ej: 5500"
                      value={isEdit ? (modal.item.precio_promo || '') : (formNuevo.precio_promo || '')} 
                      onChange={e => isEdit ? setModal({...modal, item: {...modal.item, precio_promo: e.target.value}}) : setFormNuevo({...formNuevo, precio_promo: e.target.value})} 
                      style={{ width: '100%', padding: 10, border: '2px solid #fbc02d', borderRadius: 8, fontSize: 16, fontWeight: 800, color: '#000' }} 
                    />
                  </div>
                )}
              </div>

              <div>
                <label style={{ fontWeight: 700, fontSize: 11, color: '#666', marginBottom: 3, display: 'block' }}>Nombre del Producto</label>
                <input value={isEdit ? modal.item.nombre : formNuevo.nombre} onChange={e => isEdit ? setModal({...modal, item: {...modal.item, nombre: e.target.value}}) : setFormNuevo({...formNuevo, nombre: e.target.value})} style={{ width: '100%', padding: 10, border: '1px solid #ccc', borderRadius: 6, color: '#000', fontWeight: 600 }} />
              </div>

              {/* ... Resto de los campos (Marca, Modelo, Costos) se mantienen igual ... */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <input placeholder="Marca" value={isEdit ? (modal.item.marca || '') : formNuevo.marca} onChange={e => isEdit ? setModal({...modal, item: {...modal.item, marca: e.target.value}}) : setFormNuevo({...formNuevo, marca: e.target.value})} style={{ padding: 10, border: '1px solid #ccc', borderRadius: 6, color: '#000' }} />
                <input placeholder="Modelo" value={isEdit ? (modal.item.modelo || '') : formNuevo.modelo} onChange={e => isEdit ? setModal({...modal, item: {...modal.item, modelo: e.target.value}}) : setFormNuevo({...formNuevo, modelo: e.target.value})} style={{ padding: 10, border: '1px solid #ccc', borderRadius: 6, color: '#000' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 10, alignItems: 'end' }}>
                <div>
                  <label style={{ fontWeight: 700, fontSize: 11, color: '#666', marginBottom: 3, display: 'block' }}>Costo ARS</label>
                  <input type="number" value={isEdit ? modal.item.precio_costo : formNuevo.precio_costo} onChange={handlePrecioARSChange} style={{ width: '100%', padding: 12, border: '1px solid #ccc', borderRadius: 8, color: '#000', fontWeight: 700, fontSize: 16 }} />
                </div>
                <div style={{ background: '#f4f4f4', padding: '10px', borderRadius: 8, border: '1px solid #eee', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#888' }}>U$S ESTIMADO</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#2e7d32' }}>{isEdit ? modal.item.precio_costo_usd : (formNuevo.precio_costo_usd || '0.00')}</div>
                </div>
              </div>

              <div>
                <label style={{ fontWeight: 700, fontSize: 11, color: '#666', marginBottom: 3, display: 'block' }}>Venta Final ARS (Normal)</label>
                <input type="number" value={isEdit ? modal.item.precio_venta : formNuevo.precio_venta} onChange={e => isEdit ? setModal({...modal, item: {...modal.item, precio_venta: e.target.value}}) : setFormNuevo({...formNuevo, precio_venta: e.target.value})} style={{ width: '100%', padding: 12, border: '1px solid #2e7d32', borderRadius: 8, fontSize: 18, fontWeight: 800, color: '#000' }} />
              </div>

              
            <div style={{ background: '#e3f2fd', padding: 12, borderRadius: 10, border: '1px solid #2196f3', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
  <div>
    <label style={{fontSize: 9, fontWeight: 800, color: '#1565c0', display: 'block'}}>STOCK LOCAL 1</label>
    <input 
      type="number" 
      value={isEdit ? (modal.item.stock_l1 ?? 0) : (formNuevo.stock_l1 || 0)} 
      onChange={e => isEdit 
        ? setModal({...modal, item: {...modal.item, stock_l1: e.target.value}}) 
        : setFormNuevo({...formNuevo, stock_l1: e.target.value})} 
      style={{ width: '100%', padding: 8, border: '1px solid #999', borderRadius: 6, color: '#000', fontWeight: 700 }} 
    />
  </div>
  <div>
    <label style={{fontSize: 9, fontWeight: 800, color: '#1565c0', display: 'block'}}>STOCK LOCAL 2</label>
    <input 
      type="number" 
      value={isEdit ? (modal.item.stock_l2 ?? 0) : (formNuevo.stock_l2 || 0)} 
      onChange={e => isEdit 
        ? setModal({...modal, item: {...modal.item, stock_l2: e.target.value}}) 
        : setFormNuevo({...formNuevo, stock_l2: e.target.value})} 
      style={{ width: '100%', padding: 8, border: '1px solid #999', borderRadius: 6, color: '#000', fontWeight: 700 }} 
    />
  </div>
</div>
              

<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
  <select 
    value={(isEdit ? modal.item.categoria_id : formNuevo.categoria_id) ?? ''} 
    onChange={e => {
      const val = e.target.value || null;
      isEdit 
        ? setModal({...modal, item: {...modal.item, categoria_id: val}}) 
        : setFormNuevo({...formNuevo, categoria_id: val})
    }} 
    style={{ padding: 10, border: '1px solid #ccc', borderRadius: 6, color: '#000', background: '#fff' }}
  >
    <option value="">Categoría...</option>
    {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
  </select>

  <select 
    value={(isEdit ? modal.item.proveedor_id : formNuevo.proveedor_id) ?? ''} 
    onChange={e => {
      const val = e.target.value || null;
      isEdit 
        ? setModal({...modal, item: {...modal.item, proveedor_id: val}}) 
        : setFormNuevo({...formNuevo, proveedor_id: val})
    }} 
    style={{ padding: 10, border: '1px solid #ccc', borderRadius: 6, color: '#000', background: '#fff' }}
  >
    <option value="">Proveedor...</option>
    {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
  </select>
</div>
              <button onClick={handleGuardarProducto} className="btn-primary" disabled={loading} style={{ padding: 15, fontWeight: 800, fontSize: 14, textTransform: 'uppercase', marginTop: 10 }}>
                {isEdit ? '💾 GUARDAR CAMBIOS' : '🚀 CREAR PRODUCTO'}
              </button>
            </>
          )}

         </div>
      </div>
    </div>
  )
}