import { supabase } from '../supabase'

import { invoke } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';


async function hashPassword(password) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function checkOfflineError(error) {
  return !window.navigator.onLine || error?.message?.includes('fetch') || error?.status === 0;
}

/** * AUTENTICACIÓN*/
export async function login(username, password) {
  const hash = await hashPassword(password)
  const { data, error } = await supabase
    .from('usuarios')
    .select('*, locales(nombre)')
    .eq('username', username)
    .eq('password_hash', hash)
    .eq('activo', true)
    .limit(1)

  if (error || !data || data.length === 0) return null
  const usuario = data[0]
  return { ...usuario, local_nombre: usuario.locales?.nombre }
}

/*** CONFIGURACIÓN Y MAESTROS*/
export async function getLocales() {
  try {
    const { data, error } = await supabase.from('locales').select('*').eq('activo', true).order('nombre')
    if (error) throw error;
    if (data) localStorage.setItem('cd_locales_cache', JSON.stringify(data));
    return data || []
  } catch (error) {
    if (checkOfflineError(error)) return JSON.parse(localStorage.getItem('cd_locales_cache') || '[]');
    throw error;
  }
}

export async function getCategorias() {
  try {
    const { data, error } = await supabase.from('categorias').select('*').order('nombre')
    if (error) throw error;
    if (data) localStorage.setItem('cd_categorias_cache', JSON.stringify(data));
    return data || []
  } catch (error) {
    if (checkOfflineError(error)) return JSON.parse(localStorage.getItem('cd_categorias_cache') || '[]');
    throw error;
  }
}

export async function guardarCategoria(categoria) {
  const payload = { nombre: categoria.nombre.trim() };
  if (categoria.id) payload.id = categoria.id;
  const { data, error } = await supabase.from('categorias').upsert(payload).select().single();
  if (error) throw error;
  const db = await Database.load("sqlite:cd_electronica.db");
  await db.execute("INSERT OR REPLACE INTO categorias (id, nombre) VALUES (?, ?)", [data.id, data.nombre]);
  return data;
}

export async function eliminarCategoria(id) {
  const { error } = await supabase.from('categorias').delete().eq('id', id);
  if (error) throw error;
  const db = await Database.load("sqlite:cd_electronica.db");
  await db.execute("DELETE FROM categorias WHERE id = ?", [id]);
}

/**
 * PROVEEDORES
 */
export async function getProveedores() {
  try {
    const { data, error } = await supabase.from('proveedores').select('*').order('nombre', { ascending: true });
    if (error) throw error;
    if (data) localStorage.setItem('cd_proveedores_cache', JSON.stringify(data));
    return data || [];
  } catch (error) {
    if (checkOfflineError(error)) return JSON.parse(localStorage.getItem('cd_proveedores_cache') || '[]');
    throw error;
  }
}

export async function guardarProveedor(proveedor) {
  const payload = {
    nombre: proveedor.nombre,
    contacto: proveedor.contacto || null,
    telefono: proveedor.telefono || null,
    email: proveedor.email || null,
    direccion: proveedor.direccion || null,
    activo: proveedor.activo ?? true
  };
  if (proveedor.id) payload.id = proveedor.id;
  const { data, error } = await supabase.from('proveedores').upsert(payload).select().single();
  if (error) throw error;
  const db = await Database.load("sqlite:cd_electronica.db");
  await db.execute(
    "INSERT OR REPLACE INTO proveedores (id, nombre, contacto, telefono, email, direccion, activo) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [data.id, data.nombre, data.contacto, data.telefono, data.email, data.direccion, data.activo ? 1 : 0]
  );
  return data;
}

export async function eliminarProveedor(id) {
  await supabase.from('productos').update({ proveedor_id: null }).eq('proveedor_id', id);
  const { error } = await supabase.from('proveedores').delete().eq('id', id);
  if (error) throw error;
  const db = await Database.load("sqlite:cd_electronica.db");
  await db.execute("UPDATE productos SET proveedor_id = NULL WHERE proveedor_id = ?", [id]);
  await db.execute("DELETE FROM proveedores WHERE id = ?", [id]);
}

/**
 * PRODUCTOS
 */
export async function getProductos({ busqueda = '', categoriaId = null } = {}) {
  try {
    const db = await Database.load("sqlite:cd_electronica.db");
    
    // Si hay internet, intentamos refrescar un poco la lista (opcional, para no saturar)
    // Pero para la prueba, prioricemos la lectura local que es lo que querés testear
    
    let sql = "SELECT p.*, c.nombre as categoria_nombre FROM productos p LEFT JOIN categorias c ON p.categoria_id = c.id WHERE p.activo = 1";
    let params = [];

    if (busqueda.trim()) {
      sql += " AND (p.nombre LIKE ? OR p.codigo LIKE ? OR p.marca LIKE ?)";
      const t = `%${busqueda.trim()}%`;
      params.push(t, t, t);
    }

    if (categoriaId) {
      sql += " AND p.categoria_id = ?";
      params.push(categoriaId);
    }

    sql += " ORDER BY p.nombre LIMIT 100";
    
    const res = await db.select(sql, params);
    return res.map(p => ({
      ...p,
      categoria: p.categoria_nombre || 'General'
    }));
  } catch (error) {
    console.error("Error leyendo productos de SQLite:", error);
    return [];
  }
}

export async function crearProducto(data) {
  // 0. GENERAR CÓDIGO NUMÉRICO si no viene uno
  if (!data.codigo) {
    try {
      const { data: ultimo } = await supabase
        .from('productos')
        .select('id')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle()
      data.codigo = String(ultimo ? ultimo.id + 1 : 1)
    } catch {
      data.codigo = String(Date.now())
    }
  }

  // 1. INSERTAR CABECERA DE PRODUCTO EN SUPABASE (con reintento si hay duplicado)
  let p, errorProd;
  for (let intento = 0; intento < 5; intento++) {
    const res = await supabase.from('productos').insert({
      nombre: data.nombre.trim(),
      codigo: data.codigo,
      marca: data.marca || null,
      modelo: data.modelo || null,
      precio_venta: parseFloat(data.precio_venta || 0),
      precio_costo: parseFloat(data.precio_costo || 0),
      precio_costo_usd: parseFloat(data.precio_costo_usd || 0),
      precio_promo: parseFloat(data.precio_promo || 0),
      en_promo: Boolean(data.en_promo),
      categoria_id: data.categoria_id ? parseInt(data.categoria_id) : null,
      proveedor_id: data.proveedor_id ? parseInt(data.proveedor_id) : null,
      activo: true
    }).select().single();
    p = res.data;
    errorProd = res.error;

    if (!errorProd) break;

    const violacion = errorProd?.message?.includes('duplicate key')
      || errorProd?.message?.includes('unique constraint')
      || errorProd?.code === '23505';
    if (!violacion) throw errorProd;

    data.codigo = String(Date.now()) + String(Math.floor(Math.random() * 100));
  }

  if (errorProd) throw errorProd;

  // 2. PREPARAR STOCKS INICIALES
  const s1 = parseInt(data.stock_l1 || 0);
  const s2 = parseInt(data.stock_l2 || 0);

  // Insertar/Actualizar stocks en la nube
  const { error: errorStock } = await supabase.from('stock').upsert([
    { producto_id: p.id, local_id: 1, cantidad: s1 },
    { producto_id: p.id, local_id: 2, cantidad: s2 }
  ], { onConflict: 'producto_id,local_id' });

  if (errorStock) console.error("Error stock inicial en nube:", errorStock);

  // 3. REGISTRAR MOVIMIENTOS DE AUDITORÍA (Opcional pero recomendado)
  const movimientos = [];
  if (s1 > 0) {
    movimientos.push({ 
      producto_id: p.id, local_id: 1, tipo: 'entrada', cantidad: s1, 
      referencia: 'Carga inicial L1', usuario_id: data.usuario_id 
    });
  }
  if (s2 > 0) {
    movimientos.push({ 
      producto_id: p.id, local_id: 2, tipo: 'entrada', cantidad: s2, 
      referencia: 'Carga inicial L2', usuario_id: data.usuario_id 
    });
  }
  if (movimientos.length > 0) {
    await supabase.from('movimientos_stock').insert(movimientos);
  }

  // 4. INSERTAR EN SQLITE LOCAL (EL ESPEJO)
  // Esto es lo que hace que aparezca al instante sin recargar la app
  try {
    const db = await Database.load("sqlite:cd_electronica.db");
    await db.execute(
      `INSERT INTO productos (
        id, nombre, codigo, marca, modelo, 
        precio_venta, precio_costo, precio_costo_usd, 
        precio_promo, en_promo, categoria_id, proveedor_id,
        stock_l1, stock_l2, activo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        p.id, 
        p.nombre, 
        p.codigo, 
        p.marca, 
        p.modelo, 
        parseFloat(p.precio_venta), 
        parseFloat(p.precio_costo), 
        parseFloat(data.precio_costo_usd || 0), // <--- Valor clave para tu tabla
        parseFloat(p.precio_promo || 0),
        p.en_promo ? 1 : 0,
        p.categoria_id,
        p.proveedor_id,
        s1, 
        s2
      ]
    );
  } catch (sqError) {
    console.error("Error al sincronizar producto nuevo en SQLite:", sqError);
    // No lanzamos throw aquí para no asustar al usuario si la nube funcionó
  }

  return p;
}

export async function eliminarProducto(id) {
  // 1. Borrar dependencias en Supabase
  await supabase.from('stock').delete().eq('producto_id', id);
  await supabase.from('movimientos_stock').delete().eq('producto_id', id);

  // 2. En Supabase: soft-delete (activo=false) para mantener FK de venta_items intacta.
  //    Las snapshots en detalle_mixto.items_snapshot ya preservan nombres/precios históricos.
  const { error } = await supabase.from('productos').update({ activo: false }).eq('id', id);
  if (error) throw error;

  // 3. En SQLite local: hard-delete para que desaparezca del stock
  const db = await Database.load("sqlite:cd_electronica.db");
  await db.execute("DELETE FROM productos WHERE id = ?", [id]);

  return { ok: true };
}

export async function importarProductosDesdeExcel(data, usuario_id) {
  if (!data || data.length === 0) return 0

  const db = await Database.load("sqlite:cd_electronica.db")

  const existentes = await db.select("SELECT id, codigo FROM productos WHERE activo = 1 AND codigo IS NOT NULL AND codigo != ''")
  const porCodigo = {}
  for (const p of existentes) porCodigo[p.codigo.toString().trim()] = p.id

  let categorias = []
  try {
    categorias = await db.select("SELECT * FROM categorias")
  } catch (e) { console.warn("No se pudieron cargar categorías:", e.message) }

  let proveedores = []
  try {
    proveedores = await db.select("SELECT * FROM proveedores")
  } catch (e) { console.warn("No se pudieron cargar proveedores:", e.message) }

  const normalizar = (row, keys) => {
    for (const k of keys) {
      const v = row[k]
      if (v !== undefined && v !== null && v !== '') return v
    }
    return null
  }

  let importados = 0

  for (const row of data) {
    const nombre = normalizar(row, ['Producto', 'producto', 'NOMBRE', 'nombre', 'PRODUCTO'])
    if (!nombre) continue

    const codigo = String(normalizar(row, ['Codigo', 'codigo', 'CÓDIGO', 'CODIGO', 'Código']) || '').trim()
    const marca = normalizar(row, ['Marca', 'marca', 'MARCA']) || ''
    const modelo = normalizar(row, ['Modelo', 'modelo', 'MODELO']) || ''
    const categoria_nombre = normalizar(row, ['Categoria', 'categoria', 'CATEGORIA', 'Categoría', 'categoría']) || ''
    const proveedor_nombre = normalizar(row, ['Proveedor', 'proveedor', 'PROVEEDOR']) || ''
    const precio_costo = parseFloat(normalizar(row, ['Precio Costo', 'precio_costo', 'PRECIO COSTO']) || 0)
    const precio_costo_usd = parseFloat(normalizar(row, ['Precio Costo USD', 'precio_costo_usd', 'PRECIO COSTO USD', 'Costo USD', 'costo_usd']) || 0)
    const precio_venta = parseFloat(normalizar(row, ['Precio Venta', 'precio_venta', 'PRECIO VENTA']) || 0)
    const precio_promo = parseFloat(normalizar(row, ['Precio Promo', 'precio_promo', 'PRECIO PROMO', 'Precio Promoción']) || 0)
    const en_promo = normalizar(row, ['En Promo', 'en_promo', 'EN PROMO', 'Promo', 'promo']) === 'SI' || false
    const s1 = parseInt(normalizar(row, ['Stock L1', 'stock_l1', 'STOCK L1', 'Stock Local 1']) || 0)
    const s2 = parseInt(normalizar(row, ['Stock L2', 'stock_l2', 'STOCK L2', 'Stock Local 2']) || 0)

    // Resolver categoría por nombre
    let categoria_id = null
    if (categoria_nombre) {
      const cat = categorias.find(c => c.nombre.toLowerCase() === categoria_nombre.toLowerCase())
      if (cat) {
        categoria_id = cat.id
      } else {
        try {
          const nueva = await guardarCategoria({ nombre: categoria_nombre })
          categoria_id = nueva.id
          categorias.push(nueva)
        } catch (e) {
          console.warn("No se pudo crear categoría:", categoria_nombre, e.message)
        }
      }
    }

    // Resolver proveedor por nombre
    let proveedor_id = null
    if (proveedor_nombre) {
      const prov = proveedores.find(p => p.nombre.toLowerCase() === proveedor_nombre.toLowerCase())
      if (prov) {
        proveedor_id = prov.id
      } else {
        try {
          const nuevo = await guardarProveedor({ nombre: proveedor_nombre })
          proveedor_id = nuevo.id
          proveedores.push(nuevo)
        } catch (e) {
          console.warn("No se pudo crear proveedor:", proveedor_nombre, e.message)
        }
      }
    }

    // Buscar si ya existe por codigo
    const existenteId = codigo ? porCodigo[codigo] : null

    if (existenteId) {
      // UPDATE: preserva el id original
      await db.execute(
        `UPDATE productos SET
          nombre = ?, marca = ?, modelo = ?,
          precio_costo = ?, precio_costo_usd = ?,
          precio_venta = ?, precio_promo = ?, en_promo = ?,
          categoria_id = ?, proveedor_id = ?,
          stock_l1 = ?, stock_l2 = ?
         WHERE id = ?`,
        [nombre, marca, modelo,
         precio_costo, precio_costo_usd,
         precio_venta, precio_promo, en_promo ? 1 : 0,
         categoria_id, proveedor_id,
         s1, s2, existenteId]
      )

      // Supabase: actualizar producto existente
      let supabaseOk = false
      try {
        const { error: errProd } = await supabase.from('productos').update({
          nombre, marca, modelo,
          precio_costo, precio_costo_usd, precio_venta, precio_promo,
          en_promo: !!en_promo, categoria_id, proveedor_id, activo: true
        }).eq('id', existenteId)
        if (!errProd) {
          const stocks = []
          if (s1 > 0) stocks.push({ producto_id: existenteId, local_id: 1, cantidad: s1 })
          if (s2 > 0) stocks.push({ producto_id: existenteId, local_id: 2, cantidad: s2 })
          if (stocks.length > 0) {
            const { error: errSt } = await supabase.from('stock').upsert(stocks, { onConflict: 'producto_id,local_id' })
            if (!errSt) supabaseOk = true
          } else {
            supabaseOk = true
          }
        }
      } catch (e) {
        console.warn("Supabase no disponible:", e.message)
      }

      if (!supabaseOk) {
        await db.execute(
          "INSERT INTO productos_pendientes (payload, fecha, sincronizado) VALUES (?, ?, 0)",
          [JSON.stringify({ id: existenteId, codigo, nombre, marca, modelo, precio_costo, precio_costo_usd, precio_venta, precio_promo, en_promo: !!en_promo, categoria_id, proveedor_id, stock_l1: s1, stock_l2: s2, usuario_id }), new Date().toISOString()]
        )
      }
    } else {
      // INSERT: producto nuevo
      let realId = null
      let supabaseOk = false

      // Primero intentar upsert en Supabase por codigo (obtiene el id real)
      try {
        const { data: prod, error: errProd } = await supabase.from('productos')
          .upsert({
            codigo, nombre, marca, modelo,
            precio_costo, precio_costo_usd, precio_venta, precio_promo,
            en_promo: !!en_promo, categoria_id, proveedor_id, activo: true
          }, { onConflict: 'codigo' })
          .select('id')
          .single()

        if (!errProd && prod) {
          realId = prod.id

          const stocks = []
          if (s1 > 0) stocks.push({ producto_id: realId, local_id: 1, cantidad: s1 })
          if (s2 > 0) stocks.push({ producto_id: realId, local_id: 2, cantidad: s2 })
          if (stocks.length > 0) {
            const { error: errSt } = await supabase.from('stock').upsert(stocks, { onConflict: 'producto_id,local_id' })
            if (!errSt) {
              const movimientos = []
              if (s1 > 0) movimientos.push({ producto_id: realId, local_id: 1, tipo: 'entrada', cantidad: s1, referencia: 'Importación Excel', usuario_id })
              if (s2 > 0) movimientos.push({ producto_id: realId, local_id: 2, tipo: 'entrada', cantidad: s2, referencia: 'Importación Excel', usuario_id })
              if (movimientos.length > 0) await supabase.from('movimientos_stock').insert(movimientos)
            }
          }
          supabaseOk = true
        }
      } catch (e) {
        console.warn("Supabase no disponible:", e.message)
      }

      if (supabaseOk && realId) {
        await db.execute(
          `INSERT INTO productos
            (id, codigo, nombre, marca, modelo, precio_costo, precio_costo_usd,
             precio_venta, precio_promo, en_promo, categoria_id, proveedor_id,
             stock_l1, stock_l2, activo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [realId, codigo, nombre, marca, modelo, precio_costo, precio_costo_usd,
           precio_venta, precio_promo, en_promo ? 1 : 0, categoria_id, proveedor_id,
           s1, s2]
        )
        porCodigo[codigo] = realId
      } else {
        const id = Date.now() + importados

        await db.execute(
          `INSERT INTO productos
            (id, codigo, nombre, marca, modelo, precio_costo, precio_costo_usd,
             precio_venta, precio_promo, en_promo, categoria_id, proveedor_id,
             stock_l1, stock_l2, activo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [id, codigo, nombre, marca, modelo, precio_costo, precio_costo_usd,
           precio_venta, precio_promo, en_promo ? 1 : 0, categoria_id, proveedor_id,
           s1, s2]
        )

        await db.execute(
          "INSERT INTO productos_pendientes (payload, fecha, sincronizado) VALUES (?, ?, 0)",
          [JSON.stringify({ id, codigo, nombre, marca, modelo, precio_costo, precio_costo_usd, precio_venta, precio_promo, en_promo: !!en_promo, categoria_id, proveedor_id, stock_l1: s1, stock_l2: s2, usuario_id }), new Date().toISOString()]
        )
      }
    }

    importados++
  }

  // ── Limpiar productos que NO están en el Excel ──
  const codigosEnExcel = new Set()
  for (const row of data) {
    const nombre = normalizar(row, ['Producto', 'producto', 'NOMBRE', 'nombre', 'PRODUCTO'])
    if (!nombre) continue
    const codigo = String(normalizar(row, ['Codigo', 'codigo', 'CÓDIGO', 'CODIGO', 'Código']) || '').trim()
    if (codigo) codigosEnExcel.add(codigo)
  }

  if (codigosEnExcel.size > 0) {
    const aBorrar = await db.select(
      "SELECT id, codigo FROM productos WHERE activo = 1 AND codigo IS NOT NULL AND codigo != ''"
    )
    for (const prod of aBorrar) {
      if (!codigosEnExcel.has(prod.codigo.toString().trim())) {
        await db.execute("UPDATE productos SET activo = 0 WHERE id = ?", [prod.id])
        try {
          await supabase.from('productos').update({ activo: false }).eq('id', prod.id)
        } catch (e) {
          console.warn("Supabase no disponible al limpiar:", e.message)
        }
      }
    }
  }

  return importados
}

/**
 * STOCK
 */
export async function getStockCantidad(productoId, localId) {
  if (!productoId || !localId) return 0;
  try {
    const { data, error } = await supabase.from('stock').select('cantidad').eq('producto_id', parseInt(productoId)).eq('local_id', parseInt(localId)).maybeSingle();
    if (error) throw error;
    return data ? data.cantidad : 0;
  } catch (error) {
    if (checkOfflineError(error)) {
      const cache = JSON.parse(localStorage.getItem('cd_stock_cache') || '[]');
      const prod = cache.find(p => p.id === parseInt(productoId));
      if (prod) return parseInt(localId) === 1 ? prod.stock_l1 : prod.stock_l2;
    }
    return 0;
  }
}

/**
 * VENTAS
 */
export async function registrarVenta({ localId, usuarioId, items, metodoPago, totalFinal, detalleMixto, reparacion_id }) {
  const db = await Database.load("sqlite:cd_electronica.db");
  const costoTotalItems = items.reduce((sum, it) => sum + (it.cantidad || 0) * (it.precio_costo || 0), 0);
  const itemsSnapshot = items.map(item => ({
    producto_id: item.producto_id,
    nombre: item.nombre || item.descripcion || 'Producto',
    marca: item.marca || '',
    modelo: item.modelo || '',
    precio_costo: item.precio_costo || 0,
    precio_unitario: item.precio_unitario,
    cantidad: item.cantidad
  }));
  const detalleConOrigen = { ...(detalleMixto || {}), local_original: localId, costo_total: costoTotalItems, items_snapshot: itemsSnapshot };

  const descontarStockLocal = async () => {
    for (const item of items) {
      if (item.producto_id && !item.es_manual) {
        const columnaStock = localId === 1 ? 'stock_l1' : 'stock_l2';
        await db.execute(
          `UPDATE productos SET ${columnaStock} = MAX(0, ${columnaStock} - ?) WHERE id = ?`,
          [item.cantidad, item.producto_id]
        );
      }
    }
  };

  // Offline: guardar pendiente + descontar stock local
  if (!window.navigator.onLine) {
    const fecha = new Date().toISOString();
    await db.execute(
      "INSERT INTO ventas_pendientes (payload, fecha) VALUES (?, ?)",
      [JSON.stringify({ localId, usuarioId, items, metodoPago, totalFinal, detalleMixto, fecha, reparacion_id }), fecha]
    );
    await descontarStockLocal();
    return { id: 'OFFLINE_OK', offline: true };
  }

  try {
    let ventasParaRegistrar = [];
    
    if (localId === 2 && (metodoPago === 'mixto' || metodoPago === 'tarjeta')) {
      if (metodoPago === 'mixto') {
        const montoT = parseFloat(detalleMixto?.tarjeta || 0);
        if (montoT > 0) ventasParaRegistrar.push({ local: 1, total: montoT, metodo: 'tarjeta' });
        if (totalFinal - montoT > 0) ventasParaRegistrar.push({ local: 2, total: totalFinal - montoT, metodo: 'mixto' });
      } else {
        ventasParaRegistrar.push({ local: 1, total: totalFinal, metodo: 'tarjeta' });
      }
    } else {
      ventasParaRegistrar.push({ local: localId, total: totalFinal, metodo: metodoPago });
    }

    for (const v of ventasParaRegistrar) {
      const proporcion = totalFinal > 0 ? v.total / totalFinal : 1 / ventasParaRegistrar.length;
      const detalleConCosto = detalleConOrigen ? { ...detalleConOrigen, costo_proporcional: Math.round(costoTotalItems * proporcion) } : null;

      const { data: venta, error: errorVenta } = await supabase.from('ventas').insert([{
        local_id: v.local, 
        usuario_id: usuarioId, 
        total: v.total, 
        metodo_pago: v.metodo,
        detalle_mixto: detalleConCosto, 
        fecha: new Date().toISOString()
      }]).select().single();

      if (errorVenta) throw errorVenta;

      if (ventasParaRegistrar.indexOf(v) === 0) {
        const detalleInsert = items.map(item => ({
          venta_id: venta.id, 
          producto_id: item.producto_id || null, 
          descripcion: item.nombre || item.descripcion || "Producto", 
          cantidad: item.cantidad, 
          precio_unitario: item.precio_unitario, 
          subtotal: item.cantidad * item.precio_unitario
        }));
        await supabase.from('venta_items').insert(detalleInsert);
      } else {
        const nombresProductos = items.map(i => i.nombre || i.descripcion).filter(Boolean).join(', ');
        await supabase.from('venta_items').insert([{
          venta_id: venta.id,
          producto_id: null,
          descripcion: `Pago mixto - resto en efectivo Local 2: ${nombresProductos}`,
          cantidad: 1,
          precio_unitario: v.total,
          subtotal: v.total
        }]);
      }
    }

    for (const item of items) {
      if (item.producto_id && !item.es_manual) {
        const actual = await getStockCantidad(item.producto_id, localId);
        await supabase.from('stock').update({ 
          cantidad: Math.max(0, actual - item.cantidad) 
        }).eq('producto_id', item.producto_id).eq('local_id', localId);
        
        await supabase.from('movimientos_stock').insert({
          producto_id: item.producto_id, 
          local_id: localId, 
          tipo: 'salida', 
          cantidad: -item.cantidad, 
          referencia: `Venta #${metodoPago}`, 
          usuario_id: usuarioId
        });

        const columnaStock = localId === 1 ? 'stock_l1' : 'stock_l2';
        await db.execute(
          `UPDATE productos SET ${columnaStock} = ? WHERE id = ?`,
          [Math.max(0, actual - item.cantidad), item.producto_id]
        );
      }
    }
    
    return { id: 'OK' };
  } catch (error) {
    if (checkOfflineError(error)) {
      await descontarStockLocal();
      return { id: 'OFFLINE_OK', offline: true };
    }
    throw error;
  }
}

export async function registrarNotaCredito({ localId, usuarioId, items, motivo }) {
  const db = await Database.load("sqlite:cd_electronica.db");
  const total = items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);

  const restaurarStockLocal = async () => {
    for (const item of items) {
      if (item.producto_id && !item.es_manual) {
        const columnaStock = localId === 1 ? 'stock_l1' : 'stock_l2';
        await db.execute(
          `UPDATE productos SET ${columnaStock} = ${columnaStock} + ? WHERE id = ?`,
          [item.cantidad, item.producto_id]
        );
      }
    }
  };

  if (!window.navigator.onLine) {
    const fecha = new Date().toISOString();
    await db.execute(
      "INSERT INTO ventas_pendientes (payload, fecha) VALUES (?, ?)",
      [JSON.stringify({ localId, usuarioId, items, metodoPago: 'nota_credito', totalFinal: -total, esNotaCredito: true, motivo, fecha }), fecha]
    );
    await restaurarStockLocal();
    return { id: 'OFFLINE_OK', offline: true };
  }

  const costoTotal = items.reduce((s, it) => s + it.cantidad * (it.precio_costo || 0), 0);

  try {
    const fechasCompra = items.reduce((acc, it) => {
      if (it.fecha_compra) acc[it.producto_id] = it.fecha_compra;
      return acc;
    }, {});
    const { data: venta, error } = await supabase.from('ventas').insert([{
      local_id: localId,
      usuario_id: usuarioId,
      total: -total,
      metodo_pago: 'nota_credito',
      detalle_mixto: {
        motivo, es_nota_credito: true, costo_proporcional: -costoTotal,
        items_snapshot: items.map(item => ({
          producto_id: item.producto_id,
          nombre: item.nombre || 'Producto',
          marca: item.marca || '',
          modelo: item.modelo || '',
          precio_costo: item.precio_costo || 0,
          precio_unitario: item.precio_unitario,
          cantidad: item.cantidad
        })),
        ...(Object.keys(fechasCompra).length && { fechas_compra: fechasCompra })
      },
      fecha: new Date().toISOString()
    }]).select().single();

    if (error) throw error;

    const detalleInsert = items.map(item => ({
      venta_id: venta.id,
      producto_id: item.producto_id || null,
      descripcion: item.fecha_compra ? `${item.nombre} (Compra: ${item.fecha_compra})` : (item.nombre || "Producto"),
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      subtotal: -(item.cantidad * item.precio_unitario)
    }));
    await supabase.from('venta_items').insert(detalleInsert);

    for (const item of items) {
      if (item.producto_id && !item.es_manual) {
        const actual = await getStockCantidad(item.producto_id, localId);
        await supabase.from('stock').update({
          cantidad: (actual || 0) + item.cantidad
        }).eq('producto_id', item.producto_id).eq('local_id', localId);

        await supabase.from('movimientos_stock').insert({
          producto_id: item.producto_id,
          local_id: localId,
          tipo: 'entrada',
          cantidad: item.cantidad,
          referencia: `Nota Crédito: ${motivo || 'Devolución'}`,
          usuario_id: usuarioId
        });

        const columnaStock = localId === 1 ? 'stock_l1' : 'stock_l2';
        await db.execute(
          `UPDATE productos SET ${columnaStock} = ? WHERE id = ?`,
          [(actual || 0) + item.cantidad, item.producto_id]
        );
      }
    }

    return { id: 'OK', total: -total };
  } catch (error) {
    if (checkOfflineError(error)) {
      await restaurarStockLocal();
      return { id: 'OFFLINE_OK', offline: true };
    }
    throw error;
  }
}

export async function getVentas({ localId = null, fechaDesde = null, fechaHasta = null, limit = 1000 } = {}) {
    const db = await Database.load("sqlite:cd_electronica.db");

    try {
        // --- 1. INTENTO NUBE ---
        let query = supabase.from('ventas')
            .select('*, locales(nombre), usuarios(nombre), venta_items(*, productos(nombre, marca, modelo, precio_costo, categoria_id, categorias(nombre)))')
            .order('fecha', { ascending: false })
            .limit(limit);

        if (localId) query = query.eq('local_id', localId);
        if (fechaDesde) query = query.gte('fecha', new Date(`${fechaDesde}T00:00:00`).toISOString());
        if (fechaHasta) query = query.lte('fecha', new Date(`${fechaHasta}T23:59:59`).toISOString());

        const { data, error } = await query;
        if (error) throw error;

        const formattedData = data?.map(v => {
            // Inyectar snapshot histórico como si fuera productos (para compatibilidad total)
            if (v.detalle_mixto?.items_snapshot?.length > 0) {
                const snapMap = {};
                v.detalle_mixto.items_snapshot.forEach(s => { snapMap[s.producto_id || 'null'] = s; });
                v.venta_items = v.venta_items?.map(item => ({
                    ...item,
                    productos: snapMap[item.producto_id || 'null'] ? {
                        nombre: snapMap[item.producto_id || 'null'].nombre,
                        marca: snapMap[item.producto_id || 'null'].marca,
                        modelo: snapMap[item.producto_id || 'null'].modelo,
                        precio_costo: snapMap[item.producto_id || 'null'].precio_costo,
                        categorias: { nombre: '' }
                    } : item.productos || { nombre: item.descripcion || 'Producto', marca: '', modelo: '', precio_costo: 0, categorias: { nombre: '' } }
                }));
            }
            return {
                ...v,
                local_nombre: v.locales?.nombre || 'S/D',
                vendedor: v.usuarios?.nombre || 'Sistema',
                productos_nombres: v.venta_items?.map(i => i.productos?.nombre || i.descripcion).join(', '),
                productos_marcas: [...new Set(v.venta_items?.map(i => i.productos?.marca).filter(Boolean))].join(', '),
                productos_modelos: [...new Set(v.venta_items?.map(i => i.productos?.modelo).filter(Boolean))].join(', '),
                categorias_nombres: [...new Set(v.venta_items?.map(i => i.productos?.categorias?.nombre).filter(Boolean))].join(', ') || 'Sin categoría',
                costo_total: v.detalle_mixto?.costo_reparacion || v.detalle_mixto?.costo_proporcional || v.venta_items?.reduce((acc, item) => acc + (item.cantidad * (item.productos?.precio_costo || 0)), 0) || 0,
                venta_items: v.venta_items?.map(item => ({
                    ...item,
                    categoria_nombre: item.productos?.categorias?.nombre || 'Sin categoría'
                }))
            };
        }) || [];

        // --- 2. SINCRONIZACIÓN AL ESPEJO LOCAL (todo en una transacción) ---
        await db.execute("BEGIN TRANSACTION");
        try {
            for (const v of formattedData) {
                await db.execute(
                    `INSERT OR REPLACE INTO ventas (id, fecha, total, metodo_pago, local_id, local_nombre, vendedor, productos_nombres, productos_marcas, productos_modelos, costo_total, detalle_mixto) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [v.id, v.fecha, v.total, v.metodo_pago, v.local_id, v.local_nombre, v.vendedor, v.productos_nombres, v.productos_marcas, v.productos_modelos, v.costo_total, v.detalle_mixto ? JSON.stringify(v.detalle_mixto) : null]
                );
                
                if (v.venta_items) {
                    await db.execute("DELETE FROM venta_items_local WHERE venta_id = ?", [v.id]);
                    for (const it of v.venta_items) {
                        await db.execute(
                            "INSERT INTO venta_items_local (venta_id, producto_id, nombre, marca, modelo, cantidad, precio_unitario, precio_costo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                            [v.id, it.producto_id, it.productos?.nombre || it.descripcion, it.productos?.marca || '', it.productos?.modelo || '', it.cantidad, it.precio_unitario, it.productos?.precio_costo || 0]
                        );
                    }
                }
            }
            await db.execute("COMMIT");
        } catch (e) {
            await db.execute("ROLLBACK");
            throw e;
        }
        return formattedData;

    } catch (error) {
        if (checkOfflineError(error)) {
            console.warn("🚀 MODO OFFLINE EN REPORTES");

            // A. Construir query con filtros de fecha compatibles con SQLite
            let sql = "SELECT * FROM ventas WHERE 1=1";
            let params = [];

            if (localId) { sql += " AND local_id = ?"; params.push(localId); }
            if (fechaDesde) { sql += " AND fecha >= ?"; params.push(new Date(`${fechaDesde}T00:00:00`).toISOString()); }
            if (fechaHasta) { sql += " AND fecha <= ?"; params.push(new Date(`${fechaHasta}T23:59:59`).toISOString()); }
            
            const historial = await db.select(sql + " ORDER BY fecha DESC LIMIT ?", [...params, limit]);

            // B. Rehidratar los items, detalle_mixto y snapshot de cada venta
            for (let v of historial) {
                const items = await db.select("SELECT * FROM venta_items_local WHERE venta_id = ?", [v.id]);
                v.venta_items = items;
                if (v.detalle_mixto && typeof v.detalle_mixto === 'string') {
                    v.detalle_mixto = JSON.parse(v.detalle_mixto);
                }
                // Inyectar snapshot histórico en items offline
                if (v.detalle_mixto?.items_snapshot?.length > 0) {
                    const snapMap = {};
                    v.detalle_mixto.items_snapshot.forEach(s => { snapMap[s.producto_id || 'null'] = s; });
                    v.venta_items = v.venta_items?.map(item => ({
                        ...item,
                        productos: snapMap[item.producto_id || 'null'] ? {
                            nombre: snapMap[item.producto_id || 'null'].nombre,
                            marca: snapMap[item.producto_id || 'null'].marca,
                            modelo: snapMap[item.producto_id || 'null'].modelo,
                            precio_costo: snapMap[item.producto_id || 'null'].precio_costo,
                            categorias: { nombre: '' }
                        } : { nombre: item.nombre || 'Producto', marca: item.marca || '', modelo: item.modelo || '', precio_costo: item.precio_costo || 0, categorias: { nombre: '' } }
                    }));
                } else {
                    // Fallback: usar datos de venta_items_local si no hay snapshot
                    v.venta_items = v.venta_items?.map(item => ({
                        ...item,
                        productos: { nombre: item.nombre || 'Producto', marca: item.marca || '', modelo: item.modelo || '', precio_costo: item.precio_costo || 0, categorias: { nombre: '' } }
                    }));
                }
            }

            // C. Pendientes (Ventas que hiciste sin wifi y todavía no subieron)
            const pendientesRaw = await db.select("SELECT * FROM ventas_pendientes");
            const pendientes = pendientesRaw.map(r => {
                const p = JSON.parse(r.payload);
                const items = p.items || [];
                return {
                    id: `PEND-${r.id}`,
                    fecha: p.fecha,
                    total: p.totalFinal,
                    metodo_pago: p.metodoPago,
                    local_id: p.localId,
                    local_nombre: p.localId === 1 ? 'LOCAL 1' : 'LOCAL 2',
                    vendedor: 'Vendedor Offline',
                    productos_nombres: items.map(i => i.nombre || i.descripcion).join(', '),
                    costo_total: items.reduce((sum, i) => sum + (i.cantidad || 0) * (i.precio_costo || 0), 0),
                    venta_items: items.map(i => ({
                        ...i,
                        productos: { nombre: i.nombre || i.descripcion || 'Producto', marca: i.marca || '', modelo: i.modelo || '', precio_costo: i.precio_costo || 0, categorias: { nombre: '' } }
                    })),
                    offline: true
                };
            });

            // Filtrar pendientes por fecha localmente para ser consistentes con la UI
            const pendientesFiltrados = pendientes.filter(p => {
                const f = p.fecha.split('T')[0];
                const d = fechaDesde || '1900-01-01';
                const h = fechaHasta || '2100-12-31';
                return f >= d && f <= h;
            });

            return [...pendientesFiltrados, ...historial];
        }
        throw error;
    }
}

export async function getVentasResumen({ localId = null, fechaDesde = null, fechaHasta = null, limit = 200 } = {}) {
    try {
        let query = supabase.from('ventas')
            .select('id, fecha, total, local_id, metodo_pago, detalle_mixto, venta_items(producto_id, cantidad, precio_unitario, descripcion, productos(precio_costo)), locales(nombre)')
            .order('fecha', { ascending: false });
        if (fechaDesde || fechaHasta) {
            query = query.range(0, 999);
        } else {
            query = query.limit(limit);
        }
        if (localId) query = query.eq('local_id', localId);
        if (fechaDesde) query = query.gte('fecha', new Date(`${fechaDesde}T00:00:00`).toISOString());
        if (fechaHasta) query = query.lte('fecha', new Date(`${fechaHasta}T23:59:59`).toISOString());
        const { data, error } = await query;
        if (error) throw error;
        console.log(`getVentasResumen: ${data?.length || 0} ventas`);
        return (data || []).map(v => ({
            ...v,
            costo_total: v.detalle_mixto?.costo_reparacion || v.detalle_mixto?.costo_proporcional || v.venta_items?.reduce((sum, i) => sum + (i.cantidad || 0) * (i.productos?.precio_costo || 0), 0) || 0,
            local_nombre: v.locales?.nombre || 'S/D',
            productos_nombres: v.venta_items?.map(i => i.descripcion).filter(Boolean).join(', ') || (v.detalle_mixto?.items_snapshot?.map(s => s.nombre).filter(Boolean).join(', ') || undefined),
            venta_items: v.venta_items?.map(i => ({
                producto_id: i.producto_id,
                descripcion: i.descripcion,
                cantidad: i.cantidad,
                precio_unitario: i.precio_unitario,
                productos: i.productos ? { precio_costo: i.productos.precio_costo } : undefined,
            })) || [],
        }));
    } catch (error) {
        if (checkOfflineError(error)) {
            try {
                const db = await Database.load("sqlite:cd_electronica.db");
                let sql = "SELECT id, fecha, total, local_id, metodo_pago, productos_nombres, costo_total, local_nombre FROM ventas WHERE 1=1";
                let params = [];
                if (localId) { sql += " AND local_id = ?"; params.push(localId); }
                if (fechaDesde) { sql += " AND fecha >= ?"; params.push(new Date(`${fechaDesde}T00:00:00`).toISOString()); }
                if (fechaHasta) { sql += " AND fecha <= ?"; params.push(new Date(`${fechaHasta}T23:59:59`).toISOString()); }
                const historial = await db.select(sql + " ORDER BY fecha DESC LIMIT ?", [...params, limit]);
                for (const v of historial) {
                    v.venta_items = (await db.select("SELECT * FROM venta_items_local WHERE venta_id = ?", [v.id])).map(i => ({ producto_id: i.producto_id, descripcion: i.nombre || '', cantidad: i.cantidad, precio_unitario: i.precio_unitario }));
                    if (!v.local_nombre) v.local_nombre = 'S/D';
                }
                return historial;
            } catch (e) { console.error("Error en offline path:", e); return []; }
        }
        console.error("Error en getVentasResumen:", error?.message || error);
        return [];
    }
}

export async function getVentaDetalle(ventaId) {
  const { data: venta, error: errV } = await supabase.from('ventas').select('*, locales(nombre), usuarios(nombre)').eq('id', ventaId).maybeSingle()
  const { data: itemsRaw, error: errI } = await supabase.from('venta_items').select('*, productos(nombre)').eq('venta_id', ventaId)
  if (errV || errI) throw (errV || errI);

  const items = itemsRaw?.map(i => ({ 
    producto: i.productos?.nombre || i.descripcion || "Ingreso Manual",
    cantidad: i.cantidad, precio_unitario: i.precio_unitario, subtotal: i.subtotal 
  }))
  return { venta: { ...venta, local_nombre: venta?.locales?.nombre, vendedor: venta?.usuarios?.nombre }, items }
}

export async function eliminarVenta(id) {
    const db = await Database.load("sqlite:cd_electronica.db");

    if (String(id).startsWith('PEND-')) {
        const realId = id.replace('PEND-', '');
        await db.execute("DELETE FROM ventas_pendientes WHERE id = ?", [realId]);
        return { ok: true };
    }

    if (!window.navigator.onLine) {
        return { ok: false, msg: "No podés eliminar ventas registradas sin conexión." };
    }

    try {
        const { data: venta, error: errV } = await supabase.from('ventas')
            .select('*, venta_items(producto_id, cantidad)')
            .eq('id', id)
            .maybeSingle();
        if (errV) throw errV;
        if (!venta) return { ok: false, msg: 'Venta no encontrada' };

        let localRestore = venta.local_id;
        const dm = venta.detalle_mixto;
        if (dm && typeof dm === 'object' && dm.local_original) {
            localRestore = dm.local_original;
        } else if (dm && typeof dm === 'object' && venta.metodo_pago === 'tarjeta') {
            const { data: hermanas } = await supabase.from('ventas')
                .select('local_id')
                .eq('fecha', venta.fecha)
                .neq('id', id)
                .limit(1);
            if (hermanas && hermanas.length > 0) localRestore = hermanas[0].local_id;
        }

        const items = venta.venta_items || [];
        for (const it of items) {
            if (!it.producto_id || !it.cantidad) continue;

            const { data: stockActual } = await supabase.from('stock')
                .select('cantidad')
                .eq('producto_id', it.producto_id)
                .eq('local_id', localRestore)
                .maybeSingle();

            const nuevaCant = (stockActual?.cantidad || 0) + it.cantidad;

            if (stockActual) {
                await supabase.from('stock').update({ cantidad: nuevaCant })
                    .eq('producto_id', it.producto_id)
                    .eq('local_id', localRestore);
            } else {
                await supabase.from('stock').insert({ producto_id: it.producto_id, local_id: localRestore, cantidad: nuevaCant });
            }

            const columna = localRestore === 1 ? 'stock_l1' : 'stock_l2';
            await db.execute(
                `UPDATE productos SET ${columna} = ${columna} + ? WHERE id = ?`,
                [it.cantidad, it.producto_id]
            );
        }

        const { error } = await supabase.from('ventas').delete().eq('id', id);
        if (error) throw error;

        await db.execute("DELETE FROM ventas WHERE id = ?", [id]);
        await db.execute("DELETE FROM venta_items_local WHERE venta_id = ?", [id]);

        return { ok: true, msg: 'Venta eliminada y stock restaurado' };
    } catch (error) {
        console.error("Error eliminando venta:", error);
        return { ok: false, msg: error.message };
    }
}

export async function actualizarVenta({ ventaId, items, localId, usuarioId, metodoPago, fecha }) {
  const db = await Database.load("sqlite:cd_electronica.db");

  if (!window.navigator.onLine) {
    return { ok: false, msg: "No podés editar ventas sin conexión." };
  }

  // Convertir fecha de date input (YYYY-MM-DD) a timestamp ISO local
  if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const [y, m, d] = fecha.split('-');
    fecha = new Date(Number(y), Number(m) - 1, Number(d)).toISOString();
  }

  try {
    const { data: venta, error: errV } = await supabase.from('ventas')
      .select('*, venta_items(*)')
      .eq('id', ventaId)
      .maybeSingle();
    if (errV) throw errV;
    if (!venta) return { ok: false, msg: 'Venta no encontrada' };

    const oldItems = venta.venta_items || [];
    let localRestore = venta.local_id;
    const dm = venta.detalle_mixto;
    if (dm && typeof dm === 'object' && dm.local_original) {
      localRestore = dm.local_original;
    } else if (dm && typeof dm === 'object' && venta.metodo_pago === 'tarjeta') {
      const { data: hermanas } = await supabase.from('ventas')
        .select('local_id')
        .eq('fecha', venta.fecha)
        .neq('id', ventaId)
        .limit(1);
      if (hermanas && hermanas.length > 0) localRestore = hermanas[0].local_id;
    }

    const restoreLocalId = localId || localRestore;

    // 1. Restaurar stock de items viejos
    for (const it of oldItems) {
      if (!it.producto_id || !it.cantidad) continue;
      const { data: stockActual } = await supabase.from('stock')
        .select('cantidad')
        .eq('producto_id', it.producto_id)
        .eq('local_id', restoreLocalId)
        .maybeSingle();
      const nuevaCant = (stockActual?.cantidad || 0) + it.cantidad;
      if (stockActual) {
        await supabase.from('stock').update({ cantidad: nuevaCant })
          .eq('producto_id', it.producto_id)
          .eq('local_id', restoreLocalId);
      } else {
        await supabase.from('stock').insert({ producto_id: it.producto_id, local_id: restoreLocalId, cantidad: nuevaCant });
      }
      const columna = restoreLocalId === 1 ? 'stock_l1' : 'stock_l2';
      await db.execute(`UPDATE productos SET ${columna} = ? WHERE id = ?`, [nuevaCant, it.producto_id]);
    }

    // 2. Descontar stock de items nuevos
    for (const item of items) {
      if (item.producto_id && !item.es_manual) {
        const { data: stockActual } = await supabase.from('stock')
          .select('cantidad')
          .eq('producto_id', item.producto_id)
          .eq('local_id', restoreLocalId)
          .maybeSingle();
        const nuevaCant = Math.max(0, (stockActual?.cantidad || 0) - item.cantidad);
        if (stockActual) {
          await supabase.from('stock').update({ cantidad: nuevaCant })
            .eq('producto_id', item.producto_id)
            .eq('local_id', restoreLocalId);
        } else {
          await supabase.from('stock').insert({ producto_id: item.producto_id, local_id: restoreLocalId, cantidad: nuevaCant });
        }
        const columna = restoreLocalId === 1 ? 'stock_l1' : 'stock_l2';
        await db.execute(`UPDATE productos SET ${columna} = ? WHERE id = ?`, [nuevaCant, item.producto_id]);
      }
    }

    // 3. Reemplazar venta_items
    await supabase.from('venta_items').delete().eq('venta_id', ventaId);
    const newTotal = items.reduce((s, i) => s + (i.cantidad || 0) * (i.precio_unitario || 0), 0);
    const detalleInsert = items.map(item => ({
      venta_id: ventaId,
      producto_id: item.producto_id || null,
      descripcion: item.nombre || item.descripcion || "Producto",
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      subtotal: (item.cantidad || 0) * (item.precio_unitario || 0)
    }));
    const { error: errInsert } = await supabase.from('venta_items').insert(detalleInsert);
    if (errInsert) throw errInsert;

    // 4. Actualizar total, costo y snapshot de la venta
    const nuevoCostoTotal = items.reduce((sum, i) => sum + (i.cantidad || 0) * (i.precio_costo || 0), 0);
    const itemsSnapshot = items.map(item => ({
      producto_id: item.producto_id,
      nombre: item.nombre || item.descripcion || 'Producto',
      marca: item.marca || '',
      modelo: item.modelo || '',
      precio_costo: item.precio_costo || 0,
      precio_unitario: item.precio_unitario,
      cantidad: item.cantidad
    }));
    const detalleActual = (typeof venta.detalle_mixto === 'object' && venta.detalle_mixto) ? venta.detalle_mixto : {};
    const { error: errUpdate } = await supabase.from('ventas')
      .update({
        total: newTotal,
        metodo_pago: metodoPago || venta.metodo_pago,
        detalle_mixto: { ...detalleActual, costo_proporcional: nuevoCostoTotal, items_snapshot: itemsSnapshot },
        ...(fecha ? { fecha } : {})
      })
      .eq('id', ventaId);
    if (errUpdate) throw errUpdate;

    // 5. Actualizar cache local
    await db.execute("DELETE FROM venta_items_local WHERE venta_id = ?", [ventaId]);
    for (const it of items) {
      await db.execute(
        "INSERT INTO venta_items_local (venta_id, producto_id, nombre, cantidad, precio_unitario, precio_costo) VALUES (?, ?, ?, ?, ?, ?)",
        [ventaId, it.producto_id, it.nombre || it.descripcion || "Producto", it.cantidad, it.precio_unitario, it.precio_costo || 0]
      );
    }
    const updateParts = ['total = ?', 'costo_total = ?', 'productos_nombres = ?'];
    const updateParams = [newTotal, nuevoCostoTotal, items.map(i => i.nombre || i.descripcion).filter(Boolean).join(', ')];
    if (fecha) {
      updateParts.push('fecha = ?');
      updateParams.push(fecha);
    }
    updateParams.push(ventaId);
    await db.execute(
      `UPDATE ventas SET ${updateParts.join(', ')} WHERE id = ?`,
      updateParams
    );

    return { ok: true };
  } catch (error) {
    console.error("Error actualizando venta:", error);
    return { ok: false, msg: error.message };
  }
}

/**
 * GASTOS
 */
export async function getGastos(desde, hasta) {
  try {
    const { data, error } = await supabase.from('gastos').select('*').gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false });
    if (error) throw error;
    if (data && data.length > 0) {
      const db = await Database.load("sqlite:cd_electronica.db");

      // Backup campos locales antes del sync
      const locales = await db.select(
        "SELECT id, dias_aplicados, metodo_pago, fecha_ingreso FROM gastos WHERE (dias_aplicados IS NOT NULL OR metodo_pago IS NOT NULL OR fecha_ingreso IS NOT NULL) AND fecha >= ? AND fecha <= ?",
        [desde, hasta]
      );
      const mapaDias = {}, mapaPago = {}, mapaIngreso = {};
      for (const l of locales) {
        if (l.dias_aplicados) mapaDias[l.id] = l.dias_aplicados;
        if (l.metodo_pago) mapaPago[l.id] = l.metodo_pago;
        if (l.fecha_ingreso) mapaIngreso[l.id] = l.fecha_ingreso;
      }

      await db.execute("BEGIN TRANSACTION");
      try {
        await db.execute("DELETE FROM gastos WHERE fecha >= ? AND fecha <= ?", [desde, hasta]);
        for (const g of data) {
          const diasSupabase = g.dias_aplicados ? (typeof g.dias_aplicados === 'string' ? g.dias_aplicados : JSON.stringify(g.dias_aplicados)) : null;
          const diasAplicados = mapaDias[g.id] || diasSupabase || null;
          const metodoPago = mapaPago[g.id] || g.metodo_pago || 'efectivo';
          const fechaIngreso = mapaIngreso[g.id] || g.fecha_ingreso || null;
          await db.execute(
            "INSERT INTO gastos (id, fecha, descripcion, monto, categoria, local_id, usuario_id, metodo_pago, sincronizado, dias_aplicados, fecha_ingreso) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
            [g.id, g.fecha, g.descripcion, g.monto, g.categoria, g.local_id, g.usuario_id, metodoPago, diasAplicados, fechaIngreso]
          );
          g.dias_aplicados = (() => {
            if (mapaDias[g.id]) return JSON.parse(mapaDias[g.id]);
            if (g.dias_aplicados) return Array.isArray(g.dias_aplicados) ? g.dias_aplicados : JSON.parse(g.dias_aplicados);
            return null;
          })();
          if (mapaPago[g.id]) g.metodo_pago = mapaPago[g.id];
          if (mapaIngreso[g.id]) g.fecha_ingreso = mapaIngreso[g.id];
        }
        await db.execute("COMMIT");
      } catch (e) {
        await db.execute("ROLLBACK");
        throw e;
      }
    }
    return data || [];
  } catch (error) {
    if (checkOfflineError(error)) {
      const db = await Database.load("sqlite:cd_electronica.db");
      let sql = "SELECT * FROM gastos WHERE 1=1";
      let params = [];
      if (desde) { sql += " AND fecha >= ?"; params.push(desde); }
      if (hasta) { sql += " AND fecha <= ?"; params.push(hasta); }
      sql += " ORDER BY fecha DESC";
      const localData = await db.select(sql, params);
      for (const g of localData) {
        if (g.dias_aplicados) g.dias_aplicados = JSON.parse(g.dias_aplicados);
      }
      return localData;
    }
    throw error;
  }
}

export async function registrarGasto(gasto) {
  const db = await Database.load("sqlite:cd_electronica.db");
  const diasAplicados = gasto.dias_aplicados?.length > 0 ? gasto.dias_aplicados : null;
  const metodoPago = gasto.metodo_pago || 'efectivo';
  const fechaIngreso = gasto.fecha_ingreso || new Date().toISOString();

  const supabasePayload = {
    fecha: gasto.fecha, 
    descripcion: (gasto.descripcion || 'GASTO SIN DESCRIPCIÓN').toUpperCase(),
    monto: parseFloat(gasto.monto || 0),
    categoria: gasto.categoria || 'VARIOS',
    local_id: gasto.local_id ? parseInt(gasto.local_id) : null,
    usuario_id: gasto.usuario_id ? parseInt(gasto.usuario_id) : null,
    metodo_pago: metodoPago,
    fecha_ingreso: fechaIngreso,
    dias_aplicados: diasAplicados,
  };

  const guardarGastoOffline = async () => {
    await db.execute(
      "INSERT INTO gastos_pendientes (payload, fecha) VALUES (?, ?)",
      [JSON.stringify({ ...supabasePayload, sincronizado: 1 }), new Date().toISOString()]
    );
    return { offline: true };
  };

  if (!window.navigator.onLine) return await guardarGastoOffline();

  try {
    const { data, error } = await supabase.from('gastos').insert([supabasePayload]).select().single();
    if (error) throw error;
    const g = data;
    const diasStr = diasAplicados ? JSON.stringify(diasAplicados) : null;
    await db.execute(
      "INSERT OR REPLACE INTO gastos (id, fecha, descripcion, monto, categoria, local_id, usuario_id, sincronizado, dias_aplicados, metodo_pago, fecha_ingreso) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
      [g.id, g.fecha, g.descripcion, g.monto, g.categoria, g.local_id, g.usuario_id, diasStr, metodoPago, fechaIngreso]
    );
    return { ...g, dias_aplicados: diasAplicados, metodo_pago: metodoPago, fecha_ingreso: fechaIngreso };
  } catch (error) {
    if (checkOfflineError(error)) return await guardarGastoOffline();
    // Si falla por columna faltante en Supabase, reintentar sin columnas extra
    if (error?.code === 'PGRST204' || error?.message?.includes('Could not find')) {
      delete supabasePayload.dias_aplicados;
      delete supabasePayload.fecha_ingreso;
      delete supabasePayload.metodo_pago;
      const { data, error: err2 } = await supabase.from('gastos').insert([supabasePayload]).select().single();
      if (err2) throw err2;
      const g = data;
      await db.execute(
        "INSERT OR REPLACE INTO gastos (id, fecha, descripcion, monto, categoria, local_id, usuario_id, sincronizado, dias_aplicados, metodo_pago, fecha_ingreso) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
        [g.id, g.fecha, g.descripcion, g.monto, g.categoria, g.local_id, g.usuario_id, JSON.stringify(diasAplicados), metodoPago, fechaIngreso]
      );
      return { ...g, dias_aplicados: diasAplicados, metodo_pago: metodoPago, fecha_ingreso: fechaIngreso };
    }
    throw error;
  }
}

export async function actualizarGasto(id, cambios) {
  const diasAplicados = cambios.dias_aplicados?.length > 0 ? cambios.dias_aplicados : null;
  const supabasePayload = {
    fecha: cambios.fecha,
    descripcion: cambios.descripcion?.toUpperCase(),
    monto: parseFloat(cambios.monto),
    categoria: cambios.categoria,
    local_id: cambios.local_id ? parseInt(cambios.local_id) : null,
    usuario_id: cambios.usuario_id ? parseInt(cambios.usuario_id) : null,
    metodo_pago: cambios.metodo_pago || 'efectivo',
    fecha_ingreso: cambios.fecha_ingreso || null,
    dias_aplicados: diasAplicados,
  };
  const columnasExtra = ['dias_aplicados', 'fecha_ingreso', 'metodo_pago'];
  let { error } = await supabase.from('gastos').update(supabasePayload).eq('id', id);
  // Fallback si faltan columnas en Supabase
  if (error && (error?.code === 'PGRST204' || error?.message?.includes('Could not find'))) {
    for (const col of columnasExtra) delete supabasePayload[col];
    const r = await supabase.from('gastos').update(supabasePayload).eq('id', id);
    error = r.error;
  }
  if (error) throw error;
  const db = await Database.load("sqlite:cd_electronica.db");
  await db.execute(
    "UPDATE gastos SET fecha = ?, descripcion = ?, monto = ?, categoria = ?, local_id = ?, usuario_id = ?, metodo_pago = ?, dias_aplicados = ?, fecha_ingreso = ? WHERE id = ?",
    [supabasePayload.fecha, supabasePayload.descripcion, supabasePayload.monto, supabasePayload.categoria, supabasePayload.local_id, supabasePayload.usuario_id, supabasePayload.metodo_pago || 'efectivo', JSON.stringify(diasAplicados), supabasePayload.fecha_ingreso || null, id]
  );
}

export async function eliminarGasto(id) {
  const { error } = await supabase.from('gastos').delete().eq('id', id);
  if (error) throw error;
  const db = await Database.load("sqlite:cd_electronica.db");
  await db.execute("DELETE FROM gastos WHERE id = ?", [id]);
}

/**
 * NOTAS
 */
export async function getNotas() {
  try {
    const { data, error } = await supabase.from('notas').select('*').order('created_at', { ascending: false })
    if (error) throw error
    if (data) {
      const db = await Database.load("sqlite:cd_electronica.db");
      for (const n of data) {
        await db.execute(
          "INSERT OR REPLACE INTO notas (id, titulo, contenido, usuario_id, created_at) VALUES (?, ?, ?, ?, ?)",
          [n.id, n.titulo, n.contenido, n.usuario_id, n.created_at]
        );
      }
    }
    return data || []
  } catch (error) {
    if (checkOfflineError(error)) {
      const db = await Database.load("sqlite:cd_electronica.db");
      return await db.select("SELECT * FROM notas ORDER BY created_at DESC");
    }
    throw error;
  }
}

export async function guardarNota({ titulo, contenido, usuario_id }) {
  const { data, error } = await supabase.from('notas').insert([{ titulo, contenido, usuario_id }]).select().single()
  if (error) throw error
  const db = await Database.load("sqlite:cd_electronica.db");
  await db.execute(
    "INSERT INTO notas (id, titulo, contenido, usuario_id, created_at) VALUES (?, ?, ?, ?, ?)",
    [data.id, data.titulo, data.contenido, data.usuario_id, data.created_at]
  );
  return data
}

export async function eliminarNota(id) {
  const { error } = await supabase.from('notas').delete().eq('id', id)
  if (error) throw error
  const db = await Database.load("sqlite:cd_electronica.db");
  await db.execute("DELETE FROM notas WHERE id = ?", [id]);
}

/**
 * REPARACIONES Y CLIENTES
 */
export async function getReparaciones(busqueda = '') {
  try {
    const db = await Database.load("sqlite:cd_electronica.db");
    
    let sql = "SELECT * FROM reparaciones ORDER BY fecha DESC";
    let params = [];

    if (busqueda.trim()) {
      sql = "SELECT * FROM reparaciones WHERE cliente LIKE ? OR equipo LIKE ? OR problema LIKE ? ORDER BY fecha DESC";
      const t = `%${busqueda.trim()}%`;
      params = [t, t, t];
    }

    const data = await db.select(sql, params);
      return data.map(r => {
      if (r.problema) {
        const mm = r.problema.match(/^MARCA\/MODELO:\s*(.*?)\s*$/m);
        if (mm) {
          const parts = mm[1].trim().split(/\s+/);
          if (!r.marca) r.marca = parts[0] || '';
          if (!r.modelo) r.modelo = parts.slice(1).join(' ') || '';
        }
        const ac = r.problema.match(/^ACCESORIOS:\s*(.*?)\s*$/m);
        if (ac && !r.accesorios) r.accesorios = ac[1].trim();
        const tr = r.problema.match(/^TRABAJO:\s*(.*?)\s*$/m);
        if (tr && !r.arreglo) r.arreglo = tr[1].trim();
      }
      const repuestos = r.repuestos ? (typeof r.repuestos === 'string' ? JSON.parse(r.repuestos) : r.repuestos) : [];
      return { ...r, precio: r.precio || 0, total: r.precio || r.costo || 0, repuestos };
    });
  } catch (error) {
    console.error("Error leyendo reparaciones de SQLite:", error);
    return [];
  }
}

export async function guardarReparacion(reparacion) {
  const db = await Database.load("sqlite:cd_electronica.db");

  const payload = {
    fecha: reparacion.fecha || new Date().toISOString(),
    cliente: reparacion.cliente?.trim(),
    equipo: reparacion.equipo?.trim(),
    problema: `
MARCA/MODELO: ${reparacion.marca || ''} ${reparacion.modelo || ''}
FALLA: ${reparacion.problema || ''}
ACCESORIOS: ${reparacion.accesorios || ''}
TRABAJO: ${reparacion.arreglo || ''}
    `.trim(),
    estado: reparacion.id ? (reparacion.estado || 'En Progreso') : 'En Progreso',
    precio: parseFloat(String(reparacion.precio || '0').replace(/\./g, '').replace(',', '.')),
    costo: parseFloat(String(reparacion.costo || '0').replace(/\./g, '').replace(',', '.')),
    tecnico_id: reparacion.tecnico_id ? parseInt(reparacion.tecnico_id) : null
  };

  // 1. Guardar primero en SQLite local (siempre funciona)
  const id = reparacion.id || Date.now()
  const repuestosJson = reparacion.repuestos?.length > 0 ? JSON.stringify(reparacion.repuestos) : null;
  await db.execute(`
    INSERT OR REPLACE INTO reparaciones (
      id, cliente, equipo, problema, estado, precio, costo, fecha, tecnico_id,
      marca, modelo, telefono, accesorios, arreglo, repuestos, cobrado
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, payload.cliente, payload.equipo, payload.problema, payload.estado, payload.precio, payload.costo, payload.fecha, payload.tecnico_id,
     reparacion.marca || '', reparacion.modelo || '', reparacion.telefono || '', reparacion.accesorios || '', reparacion.arreglo || '',
     repuestosJson, reparacion.cobrado ? 1 : 0]
  );

  // 2. Intentar en Supabase (si falla, el local ya quedó guardado)
  try {
    const { data, error } = await supabase
      .from('reparaciones')
      .upsert(reparacion.id ? { ...payload, id: reparacion.id } : { ...payload, id })
      .select()
      .single();

    if (!error && data && data.id && !reparacion.id) {
      // Si es nuevo y Supabase generó otro id, actualizamos el local
      await db.execute("UPDATE reparaciones SET id = ? WHERE id = ?", [data.id, id]);
    }
  } catch (e) {
    console.warn("Supabase no disponible, guardado solo local:", e.message);
  }

  return { id, ...payload };
}
export async function eliminarReparacion(id) {
  const db = await Database.load("sqlite:cd_electronica.db");
  await db.execute("DELETE FROM reparaciones WHERE id = ?", [id]);
  try {
    await supabase.from('reparaciones').delete().eq('id', id);
  } catch (e) {
    console.warn("Supabase no disponible al eliminar reparacion:", e.message);
  }
}

export async function getClientes(busqueda = '') {
  const db = await Database.load("sqlite:cd_electronica.db");

  // 1. Sincronizar desde Supabase a SQLite local si hay conexión
  if (window.navigator.onLine) {
    try {
      let query = supabase.from('clientes').select('*').order('nombre', { ascending: true });
      if (busqueda.trim()) query = query.or(`nombre.ilike.%${busqueda.trim()}%,cuit.ilike.%${busqueda.trim()}%`);
      const { data, error } = await query;
      if (!error && data) {
        localStorage.setItem('cd_clientes_cache', JSON.stringify(data));
        for (const c of data) {
          await db.execute(
            `INSERT OR REPLACE INTO clientes (id, nombre, cuit, telefono, email, direccion, razon_social, alias, nro_cuenta, condicion_iva, fecha_creacion)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [c.id, c.nombre, c.cuit, c.telefono, c.email, c.direccion, c.razon_social, c.alias, c.nro_cuenta, c.condicion_iva, c.fecha_creacion]
          );
        }
      }
    } catch (e) {
      console.warn("Supabase no disponible para clientes:", e.message);
    }
  }

  // 2. Siempre leer desde SQLite local (tiene todo: sync + guardados locales)
  let sql = "SELECT * FROM clientes";
  let params = [];
  if (busqueda.trim()) {
    sql += " WHERE nombre LIKE ? OR cuit LIKE ?";
    const t = `%${busqueda.trim()}%`;
    params = [t, t];
  }
  sql += " ORDER BY nombre";
  return await db.select(sql, params);
}

export async function guardarCliente(cliente) {
  const db = await Database.load("sqlite:cd_electronica.db");

  const id = cliente.id || Date.now();
  const payload = { 
    id,
    nombre: cliente.nombre, 
    cuit: cliente.cuit || null, 
    telefono: cliente.telefono || null, 
    email: cliente.email || null, 
    direccion: cliente.direccion || null,
    razon_social: cliente.razon_social || null,
    alias: cliente.alias || null,
    nro_cuenta: cliente.nro_cuenta || null,
    condicion_iva: cliente.condicion_iva || 'Consumidor Final',
    fecha_creacion: cliente.fecha_creacion || new Date().toISOString()
  };

  // 1. Guardar primero en SQLite local (siempre funciona)
  await db.execute(
    `INSERT OR REPLACE INTO clientes (id, nombre, cuit, telefono, email, direccion, razon_social, alias, nro_cuenta, condicion_iva, fecha_creacion)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [payload.id, payload.nombre, payload.cuit, payload.telefono, payload.email, payload.direccion, payload.razon_social, payload.alias, payload.nro_cuenta, payload.condicion_iva, payload.fecha_creacion]
  );

  // 2. Intentar en Supabase (si falla, el local ya quedó guardado)
  try {
    const { data, error } = await supabase.from('clientes').upsert(payload).select().single();
    if (!error && data && data.id !== id) {
      await db.execute("UPDATE clientes SET id = ? WHERE id = ?", [data.id, id]);
      payload.id = data.id;
    }
    if (error) {
      await db.execute(
        "INSERT OR REPLACE INTO clientes_pendientes (payload, fecha, sincronizado) VALUES (?, ?, 0)",
        [JSON.stringify(payload), new Date().toISOString()]
      );
    }
  } catch (e) {
    console.warn("Supabase no disponible, guardado solo local:", e.message);
    await db.execute(
      "INSERT OR REPLACE INTO clientes_pendientes (payload, fecha, sincronizado) VALUES (?, ?, 0)",
      [JSON.stringify(payload), new Date().toISOString()]
    );
  }

  return payload;
}

export async function eliminarCliente(id) {
  const db = await Database.load("sqlite:cd_electronica.db");
  await db.execute("DELETE FROM clientes WHERE id = ?", [id]);
  try {
    await supabase.from('clientes').delete().eq('id', id);
  } catch (e) {
    console.warn("Supabase no disponible al eliminar cliente:", e.message);
  }
}

/**
 * USUARIOS
 */
export async function getUsuarios() {
  try {
    const { data, error } = await supabase.from('usuarios').select('*, locales(nombre)').eq('activo', true).order('username', { ascending: true });
    if (error) throw error;
    const formatted = data.map(u => ({ ...u, local_nombre: u.locales?.nombre }));
    if (formatted) localStorage.setItem('cd_usuarios_cache', JSON.stringify(formatted));
    return formatted;
  } catch (error) {
    if (checkOfflineError(error)) return JSON.parse(localStorage.getItem('cd_usuarios_cache') || '[]');
    throw error;
  }
}

export async function crearUsuario({ username, password, rol, local_id, nombre }) {
  const hash = await hashPassword(password);
  const { data, error } = await supabase.from('usuarios').insert([{ username, password_hash: hash, rol, local_id, nombre, activo: true }]).select().single();
  if (error) throw error;
  const db = await Database.load("sqlite:cd_electronica.db");
  await db.execute(
    "INSERT OR REPLACE INTO usuarios (id, username, nombre, local_id, rol, activo) VALUES (?, ?, ?, ?, ?, ?)",
    [data.id, data.username, data.nombre, data.local_id, data.rol, 1]
  );
  return data;
}

export async function actualizarUsuario(id, cambios) {
  const datosAActualizar = { ...cambios };
  if (datosAActualizar.password) {
    datosAActualizar.password_hash = await hashPassword(datosAActualizar.password);
    delete datosAActualizar.password;
  }
  const { error } = await supabase.from('usuarios').update(datosAActualizar).eq('id', id);
  if (error) throw error;
  const db = await Database.load("sqlite:cd_electronica.db");
  const fields = [];
  const params = [];
  if (cambios.nombre !== undefined) { fields.push("nombre = ?"); params.push(cambios.nombre); }
  if (cambios.rol !== undefined) { fields.push("rol = ?"); params.push(cambios.rol); }
  if (cambios.local_id !== undefined) { fields.push("local_id = ?"); params.push(cambios.local_id); }
  if (cambios.activo !== undefined) { fields.push("activo = ?"); params.push(cambios.activo ? 1 : 0); }
  if (fields.length > 0) {
    params.push(id);
    await db.execute(`UPDATE usuarios SET ${fields.join(", ")} WHERE id = ?`, params);
  }
}

export async function eliminarUsuario(id) {
  await supabase.from('usuarios').update({ activo: false }).eq('id', id);
  const db = await Database.load("sqlite:cd_electronica.db");
  await db.execute("UPDATE usuarios SET activo = 0 WHERE id = ?", [id]);
}

/**
 * ESTADÍSTICAS Y REPORTES
 */

export const getStock = async ({ busqueda = '' } = {}) => {
  const db = await Database.load("sqlite:cd_electronica.db");
  
  try {
    // 1. Intento obtener de Supabase (La verdad de la nube)
    let query = supabase.from('productos').select(`*, stock(local_id, cantidad), categorias(nombre)`).eq('activo', true);
    if (busqueda.trim()) {
      const t = `%${busqueda.trim()}%`;
      query = query.or(`nombre.ilike.${t},codigo.ilike.${t},marca.ilike.${t},modelo.ilike.${t}`);
    }
    const { data, error } = await query.order('nombre');
    
    if (error) throw error;

    const formattedData = data.map(p => ({
      ...p,
      categoria: p.categorias?.nombre || 'General',
      stock_l1: p.stock?.find(s => s.local_id === 1)?.cantidad || 0,
      stock_l2: p.stock?.find(s => s.local_id === 2)?.cantidad || 0
    }));

    // 2. Sincronización inteligente: Extraer IDs bloqueados por ventas pendientes (un solo query)
    const pendientes = await db.select("SELECT payload FROM ventas_pendientes");
    const pendingProductIds = new Set();
    for (const row of pendientes) {
      try {
        const pl = JSON.parse(row.payload);
        if (pl.producto_id) pendingProductIds.add(pl.producto_id);
        if (pl.items) pl.items.forEach(i => pendingProductIds.add(i.producto_id));
      } catch (_) {}
    }

    await db.execute("BEGIN TRANSACTION");
    try {
      for (const p of formattedData) {
        if (pendingProductIds.has(p.id)) {
          console.log(`⏳ Protegiendo stock local de ${p.nombre} por venta pendiente en cola.`);
          continue;
        }
        await db.execute(
          `INSERT OR REPLACE INTO productos (
              id, codigo, nombre, precio_venta, precio_costo,
              precio_costo_usd, precio_promo, en_promo,
              categoria_id, marca, modelo, activo,
              proveedor_id, stock_l1, stock_l2
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
              p.id, p.codigo, p.nombre, p.precio_venta || 0, p.precio_costo || 0,
              p.precio_costo_usd || 0, p.precio_promo || 0, p.en_promo ? 1 : 0,
              p.categoria_id, p.marca, p.modelo, 1, p.proveedor_id, p.stock_l1, p.stock_l2
          ]
        );
      }
      await db.execute("COMMIT");
    } catch (e) {
      await db.execute("ROLLBACK");
      throw e;
    }

    return formattedData;

  } catch (error) {
    // 3. FALLBACK: Si no hay internet o falla Supabase, leemos lo que hay en SQLite
    if (checkOfflineError(error)) {
      console.log("Modo Offline: Leyendo stock desde SQLite local");
      let sql = "SELECT * FROM productos WHERE activo = 1";
      let params = [];

      if (busqueda.trim()) {
        sql += " AND (nombre LIKE ? OR codigo LIKE ? OR marca LIKE ? OR modelo LIKE ?)";
        const t = `%${busqueda.trim()}%`;
        params = [t, t, t, t];
      }
      
      const localData = await db.select(sql, params);
      return localData.map(p => ({ 
        ...p, 
        categoria: 'Cargando...',
        offline: true 
      }));
    }
    throw error;
  }
}

export async function getResumenHoy(localId) {
  try {
    const hoy = new Date(); hoy.setHours(0,0,0,0)
    const { data, error } = await supabase.from('ventas').select('total').eq('local_id', localId).gte('fecha', hoy.toISOString())
    if (error) throw error;
    return { cant: data?.length || 0, total: data?.reduce((s, v) => s + Number(v.total), 0) || 0 }
  } catch (error) {
    if (checkOfflineError(error)) return { cant: 0, total: 0, offline: true };
    throw error;
  }
}

export async function getMovimientos({ localId = null, limit = 150 } = {}) {
  try {
    let query = supabase.from('movimientos_stock').select('*, productos(codigo, nombre), locales(nombre), usuarios(nombre)').order('fecha', { ascending: false }).limit(limit)
    if (localId) query = query.eq('local_id', localId)
    const { data, error } = await query
    if (error) throw error;
    
    const formatted = data?.map(m => ({ ...m, codigo: m.productos?.codigo, producto: m.productos?.nombre, local_nombre: m.locales?.nombre, usuario_nombre: m.usuarios?.nombre })) || []
    if (formatted.length) localStorage.setItem('cd_movimientos_cache', JSON.stringify(formatted));
    return formatted;
  } catch (error) {
    if (checkOfflineError(error)) return JSON.parse(localStorage.getItem('cd_movimientos_cache') || '[]');
    throw error;
  }
}


export async function procesarGastosPendientes() {
    if (!window.navigator.onLine) return;
    try {
        const db = await Database.load("sqlite:cd_electronica.db");
        const pendientes = await db.select("SELECT * FROM gastos_pendientes WHERE sincronizado = 0");

        for (const row of pendientes) {
            try {
                const payload = JSON.parse(row.payload);
                // Quitar campos que solo existen en SQLite local, no en Supabase
                const { metodo_pago, dias_aplicados, fecha_ingreso, sincronizado, ...supabaseData } = payload;
                const { error } = await supabase.from('gastos').insert([supabaseData]);
                
                if (!error) {
                    await db.execute("DELETE FROM gastos_pendientes WHERE id = ?", [row.id]);
                    console.log(`Gasto pendiente ID ${row.id} sincronizado.`);
                }
            } catch (err) { console.error("Error subiendo gasto:", err); }
        }
    } catch (err) { console.error("Error en procesarGastosPendientes:", err); }
}

export async function procesarClientesPendientes() {
    if (!window.navigator.onLine) return;
    try {
        const db = await Database.load("sqlite:cd_electronica.db");
        const pendientes = await db.select("SELECT * FROM clientes_pendientes WHERE sincronizado = 0");

        for (const row of pendientes) {
            try {
                const payload = JSON.parse(row.payload);
                const { data, error } = await supabase.from('clientes').upsert(payload).select().single();
                
                if (!error && data) {
                    await db.execute(
                        `INSERT OR REPLACE INTO clientes (id, nombre, cuit, telefono, email, direccion, razon_social, alias, nro_cuenta, condicion_iva, fecha_creacion)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [data.id, data.nombre, data.cuit, data.telefono, data.email, data.direccion, data.razon_social, data.alias, data.nro_cuenta, data.condicion_iva, data.fecha_creacion]
                    );
                    await db.execute("DELETE FROM clientes_pendientes WHERE id = ?", [row.id]);
                    console.log(`Cliente pendiente ID ${row.id} sincronizado.`);
                }
            } catch (err) { console.error("Error subiendo cliente:", err); }
        }
    } catch (err) { console.error("Error en procesarClientesPendientes:", err); }
}
export async function sincronizarClientes() {
    try {
        const db = await Database.load("sqlite:cd_electronica.db");
        const { data: clientesNube, error } = await supabase.from('clientes').select('*');
        if (error) throw error;

        if (clientesNube) {
            for (const c of clientesNube) {
                // BI-Logic: ¿Tengo este cliente (por ID o por nombre) en la cola de salida?
                const enCola = await db.select(
                    "SELECT id FROM clientes_pendientes WHERE payload LIKE ?",
                    [`%"nombre":"${c.nombre}"%`]
                );

                if (enCola.length > 0) {
                  console.log(`⚠️ Cliente ${c.nombre} omitido en sincro por transacción pendiente.`);
                  continue;
                }

                await db.execute(
                    `INSERT OR REPLACE INTO clientes (id, nombre, cuit, telefono, email, direccion, razon_social, alias, nro_cuenta, condicion_iva, fecha_creacion)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [c.id, c.nombre, c.cuit, c.telefono, c.email, c.direccion, c.razon_social, c.alias, c.nro_cuenta, c.condicion_iva, c.fecha_creacion]
                );
            }
        }
    } catch (error) { console.error("Error sincronizando clientes:", error); }
}

export async function procesarReparacionesPendientes() {
    if (!window.navigator.onLine) return;
    try {
        const db = await Database.load("sqlite:cd_electronica.db");
        const pendientes = await db.select("SELECT * FROM reparaciones_pendientes WHERE sincronizado = 0");

        for (const row of pendientes) {
            try {
                const payload = JSON.parse(row.payload);
                const { error } = await supabase.from('reparaciones').upsert(payload);
                
                if (!error) {
                    await db.execute("DELETE FROM reparaciones_pendientes WHERE id = ?", [row.id]);
                    console.log(`Reparación pendiente ID ${row.id} sincronizada.`);
                }
            } catch (err) { console.error("Error subiendo reparación:", err); }
        }
    } catch (err) { console.error("Error en procesarReparacionesPendientes:", err); }
}

export async function procesarProductosPendientes() {
    if (!window.navigator.onLine) return;
    try {
        const db = await Database.load("sqlite:cd_electronica.db");
        const pendientes = await db.select("SELECT * FROM productos_pendientes WHERE sincronizado = 0");

        for (const row of pendientes) {
            try {
                const p = JSON.parse(row.payload);

                const { data: prod, error: errProd } = await supabase.from('productos')
                    .upsert({
                        codigo: p.codigo, nombre: p.nombre,
                        marca: p.marca, modelo: p.modelo,
                        precio_costo: p.precio_costo, precio_costo_usd: p.precio_costo_usd,
                        precio_venta: p.precio_venta, precio_promo: p.precio_promo,
                        en_promo: p.en_promo, categoria_id: p.categoria_id,
                        proveedor_id: p.proveedor_id, activo: true
                    }, { onConflict: 'codigo' })
                    .select('id')
                    .single()

                if (errProd || !prod) continue
                const realId = prod.id

                const stocks = []
                if (p.stock_l1 > 0) stocks.push({ producto_id: realId, local_id: 1, cantidad: p.stock_l1 })
                if (p.stock_l2 > 0) stocks.push({ producto_id: realId, local_id: 2, cantidad: p.stock_l2 })
                if (stocks.length > 0) {
                    const { error: errSt } = await supabase.from('stock').upsert(stocks, { onConflict: 'producto_id,local_id' })
                    if (errSt) continue
                }

                const movimientos = []
                if (p.stock_l1 > 0) movimientos.push({ producto_id: realId, local_id: 1, tipo: 'entrada', cantidad: p.stock_l1, referencia: 'Importación Excel', usuario_id: p.usuario_id })
                if (p.stock_l2 > 0) movimientos.push({ producto_id: realId, local_id: 2, tipo: 'entrada', cantidad: p.stock_l2, referencia: 'Importación Excel', usuario_id: p.usuario_id })
                if (movimientos.length > 0) {
                    await supabase.from('movimientos_stock').insert(movimientos)
                }

                // Actualizar SQLite con el id real de Supabase
                await db.execute("DELETE FROM productos WHERE codigo = ? AND id != ?", [p.codigo, realId])
                await db.execute(
                    `INSERT OR REPLACE INTO productos
                        (id, codigo, nombre, marca, modelo, precio_costo, precio_costo_usd,
                         precio_venta, precio_promo, en_promo, categoria_id, proveedor_id,
                         stock_l1, stock_l2, activo)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                    [realId, p.codigo, p.nombre, p.marca || '', p.modelo || '',
                     p.precio_costo || 0, p.precio_costo_usd || 0,
                     p.precio_venta || 0, p.precio_promo || 0, p.en_promo ? 1 : 0,
                     p.categoria_id, p.proveedor_id, p.stock_l1 || 0, p.stock_l2 || 0]
                )

                await db.execute("DELETE FROM productos_pendientes WHERE id = ?", [row.id])
                console.log(`Producto pendiente ID ${row.id} (${p.nombre}) sincronizado.`)
            } catch (err) { console.error("Error subiendo producto pendiente:", err) }
        }
    } catch (err) { console.error("Error en procesarProductosPendientes:", err) }
}

export async function sincronizarReparacionesMaestras() {
    try {
        const db = await Database.load("sqlite:cd_electronica.db");
        
        // 1. Traemos la "verdad" de la nube
        const { data: repNube, error } = await supabase.from('reparaciones').select('*');
        if (error) throw error;

        if (repNube) {
            for (const r of repNube) {
                // BI-Logic: ¿Tengo esta reparación (por ID) en la cola de pendientes locales?
                // Esto ocurre si el usuario actualizó el estado de una reparación existente estando offline.
                const enCola = await db.select(
                    "SELECT id FROM reparaciones_pendientes WHERE payload LIKE ?",
                    [`%"id":${r.id}%`]
                );

                if (enCola.length > 0) {
                  console.log(`⚠️ Reparación ID ${r.id} de ${r.cliente} omitida en sincro por actualización local pendiente.`);
                  continue; // Saltamos este registro, preservamos el cambio local
                }

                // 2. Si no hay conflicto, actualizamos nuestro espejo local
                await db.execute(
                    `INSERT OR REPLACE INTO reparaciones 
                    (id, cliente, equipo, problema, estado, precio, costo, fecha, tecnico_id,
                     marca, modelo, telefono, accesorios, arreglo, repuestos, cobrado) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [r.id, r.cliente, r.equipo, r.problema, r.estado,
                     r.precio || 0, r.costo || 0, r.fecha,
                     r.tecnico_id || null,
                     r.marca || '', r.modelo || '', r.telefono || '',
                     r.accesorios || '', r.arreglo || '',
                     r.repuestos || null, r.cobrado ? 1 : 0]
                );
            }
        }
        console.log("✅ Reparaciones sincronizadas correctamente.");
    } catch (error) {
        console.error("Error sincronizando reparaciones:", error);
    }
}


export async function inicializarBaseLocal() {
    try {
        const db = await Database.load("sqlite:cd_electronica.db");
        
        // --- TABLA CATEGORIAS ---
        await db.execute(`
            CREATE TABLE IF NOT EXISTS categorias (
                id INTEGER PRIMARY KEY,
                nombre TEXT NOT NULL
            );
        `);
  await db.execute(`
CREATE TABLE IF NOT EXISTS configuracion (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

INSERT OR IGNORE INTO configuracion (clave, valor) VALUES ('local_id', '1');
`);

        await db.execute(`
    CREATE TABLE IF NOT EXISTS reparaciones (
        id INTEGER PRIMARY KEY,
        cliente TEXT,
        equipo TEXT,
        problema TEXT,
        estado TEXT,
        costo REAL DEFAULT 0,
        fecha TEXT,
        tecnico_id INTEGER
    );
`);
        // Migración: agregar tecnico_id si no existe (bases viejas)
        try { await db.execute("ALTER TABLE reparaciones ADD COLUMN tecnico_id INTEGER"); } catch (e) {}
        // Migración: columnas para datos individuales
        try { await db.execute("ALTER TABLE reparaciones ADD COLUMN marca TEXT"); } catch (e) {}
        try { await db.execute("ALTER TABLE reparaciones ADD COLUMN modelo TEXT"); } catch (e) {}
        try { await db.execute("ALTER TABLE reparaciones ADD COLUMN telefono TEXT"); } catch (e) {}
        try { await db.execute("ALTER TABLE reparaciones ADD COLUMN accesorios TEXT"); } catch (e) {}
        try { await db.execute("ALTER TABLE reparaciones ADD COLUMN arreglo TEXT"); } catch (e) {}
        try { await db.execute("ALTER TABLE reparaciones ADD COLUMN repuestos TEXT"); } catch (e) {}
        try { await db.execute("ALTER TABLE reparaciones ADD COLUMN cobrado INTEGER DEFAULT 0"); } catch (e) {}
        try { await db.execute("ALTER TABLE reparaciones ADD COLUMN precio REAL DEFAULT 0"); } catch (e) {}

        // --- TABLA TECNICOS ---
        await db.execute(`
            CREATE TABLE IF NOT EXISTS tecnicos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL,
                telefono TEXT,
                especialidad TEXT
            );
        `);
        // --- TABLA PROVEEDORES ---
        await db.execute(`
            CREATE TABLE IF NOT EXISTS proveedores (
                id INTEGER PRIMARY KEY,
                nombre TEXT NOT NULL,
                contacto TEXT,
                telefono TEXT,
                email TEXT,
                direccion TEXT,
                activo INTEGER DEFAULT 1
            );
        `);

        // --- TABLA PRODUCTOS ---
        await db.execute(`
            CREATE TABLE IF NOT EXISTS productos (
        id INTEGER PRIMARY KEY,
        codigo TEXT UNIQUE,
        nombre TEXT,
        precio_venta REAL DEFAULT 0,
        precio_costo REAL DEFAULT 0,
        precio_costo_usd REAL DEFAULT 0, -- La columna del error
        precio_promo REAL DEFAULT 0,
        en_promo INTEGER DEFAULT 0, 
        categoria_id INTEGER,
        marca TEXT,
        modelo TEXT,
        activo INTEGER DEFAULT 1,
        proveedor_id INTEGER,
        stock_l1 INTEGER DEFAULT 0,
        stock_l2 INTEGER DEFAULT 0
    );
        `);


        await db.execute(`
            CREATE TABLE IF NOT EXISTS gastos_pendientes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payload TEXT NOT NULL,
                fecha TEXT NOT NULL,
                sincronizado INTEGER DEFAULT 0
            );
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS clientes_pendientes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payload TEXT NOT NULL,
                fecha TEXT NOT NULL,
                sincronizado INTEGER DEFAULT 0
            );
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS reparaciones_pendientes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payload TEXT NOT NULL,
                fecha TEXT NOT NULL,
                sincronizado INTEGER DEFAULT 0
            );
            `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS productos_pendientes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payload TEXT NOT NULL,
                fecha TEXT NOT NULL,
                sincronizado INTEGER DEFAULT 0
            );
        `);

        // --- TABLA CLIENTES ---
        await db.execute(`
            CREATE TABLE IF NOT EXISTS clientes (
                id INTEGER PRIMARY KEY,
                nombre TEXT NOT NULL,
                cuit TEXT,
                telefono TEXT,
                email TEXT,
                direccion TEXT,
                razon_social TEXT,
                alias TEXT,
                nro_cuenta TEXT,
                condicion_iva TEXT DEFAULT 'Consumidor Final',
                fecha_creacion TEXT
            );
        `);
        try { await db.execute("ALTER TABLE clientes ADD COLUMN razon_social TEXT"); } catch (_) {}
        try { await db.execute("ALTER TABLE clientes ADD COLUMN alias TEXT"); } catch (_) {}
        try { await db.execute("ALTER TABLE clientes ADD COLUMN nro_cuenta TEXT"); } catch (_) {}
        try { await db.execute("ALTER TABLE clientes ADD COLUMN condicion_iva TEXT DEFAULT 'Consumidor Final'"); } catch (_) {}

        // --- TABLA VENTAS (Para modo Offline) ---
        await db.execute(`
            CREATE TABLE IF NOT EXISTS ventas_pendientes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payload TEXT NOT NULL, -- Aquí guardamos el JSON completo de la venta
                fecha TEXT NOT NULL,
                sincronizado INTEGER DEFAULT 0
            );
        `);

        await db.execute(`
    CREATE TABLE IF NOT EXISTS ventas (
        id INTEGER PRIMARY KEY,
        fecha TEXT,
        total REAL,
        metodo_pago TEXT,
        local_id INTEGER,
        local_nombre TEXT,
        vendedor TEXT,
        productos_nombres TEXT,
        costo_total REAL
    );
`);
        // Migración: agregar columnas nuevas si no existen
        try { await db.execute("ALTER TABLE ventas ADD COLUMN productos_marcas TEXT"); } catch (_) {}
        try { await db.execute("ALTER TABLE ventas ADD COLUMN productos_modelos TEXT"); } catch (_) {}
        try { await db.execute("ALTER TABLE ventas ADD COLUMN detalle_mixto TEXT"); } catch (_) {}

await db.execute(`
    CREATE TABLE IF NOT EXISTS venta_items_local (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venta_id INTEGER,
        producto_id INTEGER,
        nombre TEXT,
        marca TEXT DEFAULT '',
        modelo TEXT DEFAULT '',
        cantidad REAL,
        precio_unitario REAL,
        precio_costo REAL DEFAULT 0
    );
`);
try { await db.execute("ALTER TABLE venta_items_local ADD COLUMN marca TEXT DEFAULT ''"); } catch (_) {}
try { await db.execute("ALTER TABLE venta_items_local ADD COLUMN modelo TEXT DEFAULT ''"); } catch (_) {}

        // --- TABLA USUARIOS (Para login offline si fuera necesario) ---
        await db.execute(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id INTEGER PRIMARY KEY,
                username TEXT UNIQUE,
                nombre TEXT,
                local_id INTEGER,
                rol TEXT,
                activo INTEGER DEFAULT 1
            );
        `);

        // --- TABLA GASTOS ---
        await db.execute(`
            CREATE TABLE IF NOT EXISTS gastos (
                id INTEGER PRIMARY KEY,
                fecha TEXT,
                descripcion TEXT,
                monto REAL,
                categoria TEXT,
                local_id INTEGER,
                usuario_id INTEGER,
                sincronizado INTEGER DEFAULT 0
            );
        `);

        // --- MIGRACIÓN: agregar columna dias_aplicados a gastos ---
        try {
            await db.execute("ALTER TABLE gastos ADD COLUMN dias_aplicados TEXT");
        } catch (e) {
            // ya existe, ignorar
        }

        // --- MIGRACIÓN: agregar columna metodo_pago a gastos ---
        try {
            await db.execute("ALTER TABLE gastos ADD COLUMN metodo_pago TEXT DEFAULT 'efectivo'");
        } catch (e) {
            // ya existe, ignorar
        }

        // --- MIGRACIÓN: agregar columna fecha_ingreso a gastos ---
        try {
            await db.execute("ALTER TABLE gastos ADD COLUMN fecha_ingreso TEXT");
        } catch (e) {
            // ya existe, ignorar
        }

        // --- TABLA NOTAS ---
        await db.execute(`
            CREATE TABLE IF NOT EXISTS notas (
                id INTEGER PRIMARY KEY,
                titulo TEXT,
                contenido TEXT,
                usuario_id INTEGER,
                created_at TEXT
            );
        `);

        // --- MIGRACIÓN: limpiar duplicados locales de productos por codigo ---
        try {
            const dups = await db.select(`
                SELECT codigo, COUNT(*) as cnt
                FROM productos
                WHERE codigo IS NOT NULL AND codigo != ''
                GROUP BY codigo
                HAVING COUNT(*) > 1
            `);
            if (dups.length > 0) {
                for (const { codigo } of dups) {
                    const rows = await db.select(
                        "SELECT id, stock_l1, stock_l2 FROM productos WHERE codigo = ? ORDER BY id ASC",
                        [codigo]
                    );
                    const [keep, ...remove] = rows;
                    const removeIds = remove.map(r => r.id);

                    await db.execute(
                        "UPDATE productos SET stock_l1 = ?, stock_l2 = ? WHERE id = ?",
                        [
                            (keep.stock_l1 || 0) + remove.reduce((s, r) => s + (r.stock_l1 || 0), 0),
                            (keep.stock_l2 || 0) + remove.reduce((s, r) => s + (r.stock_l2 || 0), 0),
                            keep.id
                        ]
                    );

                    for (const rid of removeIds) {
                        await db.execute(
                            "UPDATE OR IGNORE venta_items_local SET producto_id = ? WHERE producto_id = ?",
                            [keep.id, rid]
                        );
                    }

                    await db.execute(
                        `DELETE FROM productos WHERE id IN (${removeIds.map(() => '?').join(',')})`,
                        removeIds
                    );
                }
            }
        } catch (e) {
            console.warn("Migración duplicados:", e.message);
        }

        try {
            await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_productos_codigo_unique ON productos(codigo)");
        } catch (e) {
            console.warn("No se pudo crear índice único en productos.codigo:", e.message);
        }

        // --- ÍNDICES PARA PERFORMANCE ---
        await db.execute("CREATE INDEX IF NOT EXISTS idx_prod_codigo ON productos(codigo);");
        await db.execute("CREATE INDEX IF NOT EXISTS idx_prod_nombre ON productos(nombre);");

        console.log("Esquema local sincronizado con Supabase.");
    } catch (error) {
        console.error("Error inicializando base local:", error);
        throw error;
    }
}

/**
 * SINCRONIZAR TABLAS MAESTRAS
 * Baja categorías y productos desde Supabase y los vuelca al SQLite local.
 */

export async function sincronizarTablasMaestras() {
    try {
        // 1. Aseguramos que las tablas existan
        await inicializarBaseLocal();
        
        const db = await Database.load("sqlite:cd_electronica.db");

        // ─── Primero obtener todos los datos de Supabase (network) ───
        const [{ data: cats, error: errCats }, { data: provs, error: errProvs }, { data: tecs, error: errTecs }] = await Promise.all([
            supabase.from('categorias').select('*'),
            supabase.from('proveedores').select('*'),
            supabase.from('tecnicos').select('*').order('nombre', { ascending: true })
        ]);
        if (errCats) throw errCats;
        if (errProvs) throw errProvs;
        if (errTecs) throw errTecs;

        // 3. Sincronizar Productos (mapeando tipos de datos)
        const { data: prods, error: errProds } = await supabase.from('productos')
            .select('*, stock(local_id, cantidad)')
            .eq('activo', true);
            
        if (errProds) throw errProds;

        // ─── Escribir todo a SQLite en una sola transacción ───
        await db.execute("BEGIN TRANSACTION");
        if (cats) {
                await db.execute("DELETE FROM categorias");
                for (const c of cats) {
                    await db.execute(
                        "INSERT OR REPLACE INTO categorias (id, nombre) VALUES (?, ?)", 
                        [c.id, c.nombre]
                    );
                }
            }

            if (provs) {
                await db.execute("DELETE FROM proveedores");
                for (const p of provs) {
                    await db.execute(
                        "INSERT OR REPLACE INTO proveedores (id, nombre, contacto, telefono, email, direccion, activo) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        [p.id, p.nombre, p.contacto, p.telefono, p.email, p.direccion, p.activo ? 1 : 0]
                    );
                }
            }

            if (tecs) {
                await db.execute("DELETE FROM tecnicos");
                for (const t of tecs) {
                    await db.execute(
                        "INSERT OR REPLACE INTO tecnicos (id, nombre, telefono, especialidad) VALUES (?, ?, ?, ?)",
                        [t.id, t.nombre, t.telefono || null, t.especialidad || null]
                    );
                }
            }

        if (prods) {
            // ─── DEDUPLICAR: agrupar por codigo, fusionar stock, limpiar Supabase ───
            const grupos = new Map()
            for (const p of prods) {
                const cod = p.codigo?.toString().trim()
                if (!cod) continue
                if (!grupos.has(cod)) grupos.set(cod, [])
                grupos.get(cod).push(p)
            }

            for (const [cod, dups] of grupos) {
                if (dups.length <= 1) continue
                console.warn(`⚠️ Detectados ${dups.length} duplicados para codigo "${cod}". Fusionando...`)

                // Ordenar por ID ascendente: el primero es el original
                dups.sort((a, b) => a.id - b.id)
                const keep = dups[0]
                const toDelete = dups.slice(1)

                // Fusionar stock: sumar cantidades de los duplicados al original
                let s1 = keep.stock?.find(s => s.local_id === 1)?.cantidad || 0
                let s2 = keep.stock?.find(s => s.local_id === 2)?.cantidad || 0
                for (const dup of toDelete) {
                    s1 += dup.stock?.find(s => s.local_id === 1)?.cantidad || 0
                    s2 += dup.stock?.find(s => s.local_id === 2)?.cantidad || 0
                }

                // Actualizar stock del producto conservado en Supabase
                try {
                    const stocks = []
                    if (s1 > 0) stocks.push({ producto_id: keep.id, local_id: 1, cantidad: s1 })
                    if (s2 > 0) stocks.push({ producto_id: keep.id, local_id: 2, cantidad: s2 })
                    if (stocks.length > 0) {
                        await supabase.from('stock').upsert(stocks, { onConflict: 'producto_id,local_id' })
                    }
                } catch (e) { console.warn("Error actualizando stock fusionado:", e.message) }

                // Eliminar duplicados de Supabase (producto + stock)
                for (const dup of toDelete) {
                    try { await supabase.from('stock').delete().eq('producto_id', dup.id) } catch (e) {}
                    try { await supabase.from('productos').delete().eq('id', dup.id) } catch (e) {}
                }

                // Reemplazar en el array original
                const idx = prods.indexOf(keep)
                if (idx !== -1) {
                    if (!keep.stock) keep.stock = []
                    const setL1 = keep.stock.find(s => s.local_id === 1)
                    const setL2 = keep.stock.find(s => s.local_id === 2)
                    if (setL1) setL1.cantidad = s1
                    else if (s1 > 0) keep.stock.push({ local_id: 1, cantidad: s1 })
                    if (setL2) setL2.cantidad = s2
                    else if (s2 > 0) keep.stock.push({ local_id: 2, cantidad: s2 })
                }
                // Eliminar los duplicados del array
                for (const dup of toDelete) {
                    const di = prods.indexOf(dup)
                    if (di !== -1) prods.splice(di, 1)
                }
            }

            // ─── SINCRONIZAR A SQLITE (dentro de la misma transacción) ───
            // Extraer IDs de productos en ventas pendientes (un solo query en vez de N)
            const pendientes = await db.select("SELECT payload FROM ventas_pendientes");
            const pendingProductIds = new Set();
            for (const row of pendientes) {
                try {
                    const pl = JSON.parse(row.payload);
                    if (pl.producto_id) pendingProductIds.add(pl.producto_id);
                    if (pl.items) pl.items.forEach(i => pendingProductIds.add(i.producto_id));
                } catch (_) {}
            }

            for (const p of prods) {
                if (pendingProductIds.has(p.id)) {
                    console.log(`⚠️ Producto ${p.nombre} omitido en sincro por transacción pendiente.`);
                    continue;
                }

                const s1 = p.stock?.find(s => s.local_id === 1)?.cantidad || 0;
                const s2 = p.stock?.find(s => s.local_id === 2)?.cantidad || 0;

                await db.execute(
                    "DELETE FROM productos WHERE codigo = ? AND id != ?",
                    [p.codigo, p.id]
                );

                await db.execute(
                    `INSERT OR REPLACE INTO productos (
                        id, codigo, nombre, precio_venta, precio_costo, 
                        precio_costo_usd, precio_promo, en_promo, 
                        categoria_id, marca, modelo, activo, 
                        proveedor_id, stock_l1, stock_l2
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        p.id, p.codigo, p.nombre, p.precio_venta || 0, p.precio_costo || 0,
                        p.precio_costo_usd || 0, p.precio_promo || 0, p.en_promo ? 1 : 0, 
                        p.categoria_id, p.marca, p.modelo, 1, p.proveedor_id, s1, s2
                    ]
                );
            }
            // ─── LIMPIEZA: productos locales que ya no existen en la nube ───
            if (prods && prods.length > 0) {
                const codigosNube = new Set(prods.map(p => p.codigo?.toString().trim()).filter(Boolean))
                const localesActivos = await db.select(
                    "SELECT id, codigo FROM productos WHERE activo = 1"
                )
                for (const loc of localesActivos) {
                    const cod = loc.codigo?.toString().trim()
                    if (cod && !codigosNube.has(cod)) {
                        await db.execute("UPDATE productos SET activo = 0 WHERE id = ?", [loc.id])
                        console.log(`🧹 Producto local ID ${loc.id} (cod:${cod}) marcado inactivo - no existe en nube`)
                    }
                }
            }
        }
        // productos sin datos de la nube: solo marcar inactivos si prods es null
        if (!prods) {
            const localesActivos = await db.select(
                "SELECT id, codigo FROM productos WHERE activo = 1"
            )
            for (const loc of localesActivos) {
                await db.execute("UPDATE productos SET activo = 0 WHERE id = ?", [loc.id])
            }
        }

        await db.execute("COMMIT");

        console.log("✅ Sincronización maestra finalizada protegiendo datos locales.");
    } catch (error) {
        console.error("Error sincronizando maestros:", error);
        throw error; // Importante para que el try/catch de App.jsx se entere del fallo
    }
}


export async function procesarVentasPendientes() {
    // Si no hay internet, no tiene sentido intentar subir nada
    if (!window.navigator.onLine) return;

    try {
        const db = await Database.load("sqlite:cd_electronica.db");
        
        // Verificación de seguridad: ¿Existe la tabla?
        const checkTable = await db.select(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='ventas_pendientes'"
        );
        if (checkTable.length === 0) return;

        // Obtenemos solo las no sincronizadas
        const pendientes = await db.select("SELECT * FROM ventas_pendientes WHERE sincronizado = 0");

        for (const row of pendientes) {
            try {
                const v = JSON.parse(row.payload);
                
                const res = await registrarVenta(v);

                if (res.id === 'OK') {
                    await db.execute("DELETE FROM ventas_pendientes WHERE id = ?", [row.id]);
                    console.log(`Venta pendiente ID ${row.id} sincronizada y eliminada del local.`);

                    // Si la venta viene de un cobro de reparación, marcar cobrado en Supabase
                    if (v.reparacion_id) {
                        try {
                            await supabase.from('reparaciones').update({ cobrado: true, estado: 'Entregado' }).eq('id', v.reparacion_id);
                        } catch (e) {
                            console.warn("Supabase no disponible al actualizar reparación:", e.message);
                        }
                    }
                }
            } catch (err) {
                console.error(`Error procesando la venta pendiente ${row.id}:`, err);
                // No borramos la fila para reintentar en la próxima ejecución
            }
        }
    } catch (err) {
        console.error("Error general en el proceso de ventas pendientes:", err);
    }
}

/**
 * TECNICOS
 */
export async function getTecnicos() {
  const db = await Database.load("sqlite:cd_electronica.db");

  // Sincronizar desde Supabase a SQLite local si hay conexión
  if (window.navigator.onLine) {
    try {
      const { data, error } = await supabase.from('tecnicos').select('*').order('nombre', { ascending: true });
      if (!error && data) {
        for (const t of data) {
          await db.execute(
            `INSERT OR REPLACE INTO tecnicos (id, nombre, telefono, especialidad) VALUES (?, ?, ?, ?)`,
            [t.id, t.nombre, t.telefono || null, t.especialidad || null]
          );
        }
      }
    } catch (e) {
      console.warn("Supabase no disponible para técnicos:", e.message);
    }
  }

  return await db.select("SELECT * FROM tecnicos ORDER BY nombre");
}

export async function guardarTecnico(data) {
  const db = await Database.load("sqlite:cd_electronica.db");

  if (data.id) {
    // Actualizar existente: local + Supabase
    await db.execute("UPDATE tecnicos SET nombre = ?, telefono = ?, especialidad = ? WHERE id = ?",
      [data.nombre.trim(), data.telefono || null, data.especialidad || null, data.id]);
    try {
      await supabase.from('tecnicos').update({
        nombre: data.nombre.trim(), telefono: data.telefono || null, especialidad: data.especialidad || null
      }).eq('id', data.id);
    } catch (e) {
      console.warn("Supabase no disponible al actualizar técnico:", e.message);
    }
    return data;
  }

  // Nuevo: primero intentar en Supabase para obtener el ID real
  if (window.navigator.onLine) {
    try {
      const { data: supData, error } = await supabase.from('tecnicos').insert({
        nombre: data.nombre.trim(), telefono: data.telefono || null, especialidad: data.especialidad || null
      }).select().single();
      if (!error && supData) {
        await db.execute(
          "INSERT OR REPLACE INTO tecnicos (id, nombre, telefono, especialidad) VALUES (?, ?, ?, ?)",
          [supData.id, supData.nombre, supData.telefono || null, supData.especialidad || null]
        );
        return supData;
      }
    } catch (e) {
      console.warn("Supabase no disponible al crear técnico:", e.message);
    }
  }

  // Offline fallback: guardar solo local
  const r = await db.execute("INSERT INTO tecnicos (nombre, telefono, especialidad) VALUES (?, ?, ?)",
    [data.nombre.trim(), data.telefono || null, data.especialidad || null]);
  data.id = r.lastInsertId;
  return data;
}

export async function eliminarTecnico(id) {
  const db = await Database.load("sqlite:cd_electronica.db");
  await db.execute("UPDATE reparaciones SET tecnico_id = NULL WHERE tecnico_id = ?", [id]);
  await db.execute("DELETE FROM tecnicos WHERE id = ?", [id]);
  try {
    await supabase.from('tecnicos').delete().eq('id', id);
  } catch (e) {
    console.warn("Supabase no disponible al eliminar técnico:", e.message);
  }
}

export async function getReparacionesPorTecnico(tecnicoId) {
  const db = await Database.load("sqlite:cd_electronica.db");
  return await db.select(
    "SELECT id, cliente, equipo, problema, estado, costo, fecha FROM reparaciones WHERE tecnico_id = ? ORDER BY fecha DESC",
    [tecnicoId]
  );
}

/**
 * COBRAR REPARACIONES
 */
export async function getReparacionesSinCobrar(busqueda = '') {
  const db = await Database.load("sqlite:cd_electronica.db");
  let sql = "SELECT * FROM reparaciones WHERE cobrado IS NULL OR cobrado = 0";
  let params = [];
  if (busqueda.trim()) {
    sql += " AND (cliente LIKE ? OR equipo LIKE ?)";
    const t = `%${busqueda.trim()}%`;
    params = [t, t];
  }
  sql += " ORDER BY fecha DESC";
  const data = await db.select(sql, params);
  return data.map(r => {
    const repuestos = r.repuestos ? JSON.parse(r.repuestos) : [];
    return { ...r, precio: r.precio || 0, total: r.precio || r.costo || 0, repuestos };
  });
}

export async function registrarPagoReparacion({ reparacionId, localId, usuarioId, metodoPago, totalFinal: totalFinalParam, detalleMixto: detalleMixtoParam }) {
  const db = await Database.load("sqlite:cd_electronica.db");

  const [reparacion] = await db.select("SELECT * FROM reparaciones WHERE id = ?", [reparacionId]);
  if (!reparacion) throw new Error("Reparación no encontrada");

  const repuestos = reparacion.repuestos ? JSON.parse(reparacion.repuestos) : [];
  const totalBase = reparacion.precio || reparacion.costo || 0;
  const totalFinal = totalFinalParam ?? totalBase;

  const itemsRepuesto = repuestos.map(r => ({
    producto_id: r.producto_id,
    nombre: r.nombre || 'Repuesto reparación',
    precio_unitario: 0,
    cantidad: r.cantidad,
    es_manual: false,
    precio_costo: 0
  }));

  const descripcion = `REPARACIÓN: ${reparacion.cliente} - ${reparacion.equipo}`;
  const itemReparacion = {
    producto_id: null,
    nombre: descripcion,
    precio_unitario: totalBase,
    cantidad: 1,
    es_manual: true,
    precio_costo: 0
  };

  const items = [itemReparacion, ...itemsRepuesto];

  const detalleMixto = metodoPago === 'mixto'
    ? { ...(detalleMixtoParam || {}), es_reparacion: true, costo_reparacion: reparacion.costo || 0 }
    : { es_reparacion: true, costo_reparacion: reparacion.costo || 0 };

  // Marcar reparación como cobrada en local ANTES de registrarVenta
  // (para que si el stock se descuente offline, quede registrado)
  await db.execute("UPDATE reparaciones SET cobrado = 1, estado = 'Entregado' WHERE id = ?", [reparacionId]);

  const res = await registrarVenta({
    localId,
    usuarioId,
    items,
    metodoPago,
    totalFinal,
    detalleMixto,
    reparacion_id: reparacionId
  });

  if (res.id === 'OK' || res.id === 'OFFLINE_OK') {
    try {
      await supabase.from('reparaciones').update({ cobrado: true, estado: 'Entregado' }).eq('id', reparacionId);
    } catch (e) {
      console.warn("Supabase no disponible al marcar cobrado:", e.message);
    }
    return { ...res, reparacionId };
  }

  throw new Error("Error al registrar pago de reparación");
}

/**
 * Congelar ventas anteriores: backfill de items_snapshot para todas las ventas
 * que aún no tienen snapshot. Se ejecuta una sola vez por venta.
 */
export async function congelarVentasAnteriores() {
  if (!window.navigator.onLine) return 0;
  try {
    const { data: ventas, error } = await supabase.from('ventas')
      .select('id, detalle_mixto, venta_items(*, productos(nombre, marca, modelo, precio_costo))')
      .order('fecha', { ascending: false })
      .limit(500);

    if (error) throw error;
    if (!ventas || ventas.length === 0) return 0;

    let actualizadas = 0;
    for (const v of ventas) {
      const dm = v.detalle_mixto;
      if (dm && dm.items_snapshot) continue;

      const snapshot = (v.venta_items || [])
        .filter(i => i.producto_id)
        .map(i => ({
          producto_id: i.producto_id,
          nombre: i.productos?.nombre || i.descripcion || 'Producto',
          marca: i.productos?.marca || '',
          modelo: i.productos?.modelo || '',
          precio_costo: i.productos?.precio_costo || 0,
          precio_unitario: i.precio_unitario,
          cantidad: i.cantidad
        }));

      if (snapshot.length === 0) continue;

      const { error: errUpd } = await supabase.from('ventas').update({
        detalle_mixto: { ...(dm || {}), items_snapshot: snapshot }
      }).eq('id', v.id);

      if (!errUpd) actualizadas++;
    }

    if (actualizadas > 0) {
      console.log(`📸 ${actualizadas} ventas congeladas con snapshot histórico.`);
    }
    return actualizadas;
  } catch (error) {
    console.warn("Error congelando ventas:", error.message);
    return 0;
  }
}