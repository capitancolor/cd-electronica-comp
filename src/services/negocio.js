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
  // 1. Borrar de Supabase
  await supabase.from('stock').delete().eq('producto_id', id);
  await supabase.from('movimientos_stock').delete().eq('producto_id', id);
  await supabase.from('venta_items').delete().eq('producto_id', id);
  const { error } = await supabase.from('productos').delete().eq('id', id);
  
  if (error) throw error;

  // --- NUEVO: BORRAR DE SQLITE LOCAL ---
  const db = await Database.load("sqlite:cd_electronica.db");
  // Opción A: Borrado físico
  await db.execute("DELETE FROM productos WHERE id = ?", [id]);
  // Opción B: Si usás borrado lógico
  // await db.execute("UPDATE productos SET activo = 0 WHERE id = ?", [id]);

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
export async function registrarVenta({ localId, usuarioId, items, metodoPago, totalFinal, detalleMixto }) {
  const detalleConOrigen = metodoPago === 'mixto' ? { ...(detalleMixto || {}), local_original: localId } : null;
  const db = await Database.load("sqlite:cd_electronica.db");

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
      [JSON.stringify({ localId, usuarioId, items, metodoPago, totalFinal, detalleMixto, fecha }), fecha]
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
      const { data: venta, error: errorVenta } = await supabase.from('ventas').insert([{
        local_id: v.local, 
        usuario_id: usuarioId, 
        total: v.total, 
        metodo_pago: v.metodo,
        detalle_mixto: detalleConOrigen, 
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

        const formattedData = data?.map(v => ({
            ...v,
            local_nombre: v.locales?.nombre || 'S/D',
            vendedor: v.usuarios?.nombre || 'Sistema',
            productos_nombres: v.venta_items?.map(i => i.productos?.nombre || i.descripcion).join(', '),
            productos_marcas: [...new Set(v.venta_items?.map(i => i.productos?.marca).filter(Boolean))].join(', '),
            productos_modelos: [...new Set(v.venta_items?.map(i => i.productos?.modelo).filter(Boolean))].join(', '),
            categorias_nombres: [...new Set(v.venta_items?.map(i => i.productos?.categorias?.nombre).filter(Boolean))].join(', ') || 'Sin categoría',
            costo_total: v.venta_items?.reduce((acc, item) => acc + (item.cantidad * (item.productos?.precio_costo || 0)), 0) || 0,
            venta_items: v.venta_items?.map(item => ({
                ...item,
                categoria_nombre: item.productos?.categorias?.nombre || 'Sin categoría'
            })) // Crucial para los contadores de la UI
        })) || [];

        // --- 2. SINCRONIZACIÓN AL ESPEJO LOCAL ---
        for (const v of formattedData) {
            await db.execute(
                `INSERT OR REPLACE INTO ventas (id, fecha, total, metodo_pago, local_id, local_nombre, vendedor, productos_nombres, productos_marcas, productos_modelos, costo_total) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [v.id, v.fecha, v.total, v.metodo_pago, v.local_id, v.local_nombre, v.vendedor, v.productos_nombres, v.productos_marcas, v.productos_modelos, v.costo_total]
            );
            
            if (v.venta_items) {
                await db.execute("DELETE FROM venta_items_local WHERE venta_id = ?", [v.id]);
                for (const it of v.venta_items) {
                    await db.execute(
                        "INSERT INTO venta_items_local (venta_id, producto_id, nombre, cantidad, precio_unitario) VALUES (?, ?, ?, ?, ?)",
                        [v.id, it.producto_id, it.productos?.nombre || it.descripcion, it.cantidad, it.precio_unitario]
                    );
                }
            }
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

            // B. Rehidratar los items de cada venta (Para que el contador de Reportes.jsx no de 0)
            for (let v of historial) {
                const items = await db.select("SELECT * FROM venta_items_local WHERE venta_id = ?", [v.id]);
                v.venta_items = items; // Esto arregla el cálculo de "Artículos Vendidos"
            }

            // C. Pendientes (Ventas que hiciste sin wifi y todavía no subieron)
            const pendientesRaw = await db.select("SELECT * FROM ventas_pendientes");
            const pendientes = pendientesRaw.map(r => {
                const p = JSON.parse(r.payload);
                return {
                    id: `PEND-${r.id}`,
                    fecha: p.fecha,
                    total: p.totalFinal,
                    metodo_pago: p.metodoPago,
                    local_id: p.localId,
                    local_nombre: p.localId === 1 ? 'LOCAL 1' : 'LOCAL 2',
                    vendedor: 'Vendedor Offline',
                    productos_nombres: p.items?.map(i => i.nombre || i.descripcion).join(', '),
                    costo_total: 0,
                    venta_items: p.items, // Importante para la UI
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

/**
 * GASTOS
 */
export async function getGastos(desde, hasta) {
  try {
    const { data, error } = await supabase.from('gastos').select('*').gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false });
    if (error) throw error;
    if (data) {
      const db = await Database.load("sqlite:cd_electronica.db");
      for (const g of data) {
        await db.execute(
          "INSERT OR REPLACE INTO gastos (id, fecha, descripcion, monto, categoria, local_id, usuario_id, sincronizado) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
          [g.id, g.fecha, g.descripcion, g.monto, g.categoria, g.local_id, g.usuario_id]
        );
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
      return await db.select(sql, params);
    }
    throw error;
  }
}

export async function registrarGasto(gasto) {
  const db = await Database.load("sqlite:cd_electronica.db");
  const payload = {
    fecha: gasto.fecha, 
    descripcion: (gasto.descripcion || 'GASTO SIN DESCRIPCIÓN').toUpperCase(),
    monto: parseFloat(gasto.monto || 0),
    categoria: gasto.categoria || 'VARIOS',
    local_id: gasto.local_id ? parseInt(gasto.local_id) : null,
    usuario_id: gasto.usuario_id ? parseInt(gasto.usuario_id) : null, 
    sincronizado: 1 
  };

  const guardarGastoOffline = async () => {
    await db.execute(
      "INSERT INTO gastos_pendientes (payload, fecha) VALUES (?, ?)",
      [JSON.stringify(payload), new Date().toISOString()]
    );
    return { offline: true };
  };

  if (!window.navigator.onLine) return await guardarGastoOffline();

  try {
    const { data, error } = await supabase.from('gastos').insert([payload]).select().single();
    if (error) throw error;
    return data;
  } catch (error) {
    if (checkOfflineError(error)) return await guardarGastoOffline();
    throw error;
  }
}

export async function actualizarGasto(id, cambios) {
  const payload = {
    fecha: cambios.fecha,
    descripcion: cambios.descripcion?.toUpperCase(),
    monto: parseFloat(cambios.monto),
    categoria: cambios.categoria,
    local_id: cambios.local_id ? parseInt(cambios.local_id) : null,
    usuario_id: cambios.usuario_id ? parseInt(cambios.usuario_id) : null
  };
  const { error } = await supabase.from('gastos').update(payload).eq('id', id);
  if (error) throw error;
  const db = await Database.load("sqlite:cd_electronica.db");
  await db.execute(
    "UPDATE gastos SET fecha = ?, descripcion = ?, monto = ?, categoria = ?, local_id = ?, usuario_id = ? WHERE id = ?",
    [payload.fecha, payload.descripcion, payload.monto, payload.categoria, payload.local_id, payload.usuario_id, id]
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
    return data.map(r => ({ ...r, total: r.costo }));
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
    estado: reparacion.id ? (reparacion.estado || 'Pendiente') : 'Pendiente',
    costo: parseFloat(reparacion.total || 0),
    tecnico_id: reparacion.tecnico_id ? parseInt(reparacion.tecnico_id) : null
  };

  // 1. Guardar primero en SQLite local (siempre funciona)
  const id = reparacion.id || Date.now()
  await db.execute(`
    INSERT OR REPLACE INTO reparaciones (
      id, cliente, equipo, problema, estado, costo, fecha, tecnico_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, payload.cliente, payload.equipo, payload.problema, payload.estado, payload.costo, payload.fecha, payload.tecnico_id]
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
  try {
    let query = supabase.from('clientes').select('*').order('nombre', { ascending: true });
    if (busqueda.trim()) query = query.or(`nombre.ilike.%${busqueda.trim()}%,cuit.ilike.%${busqueda.trim()}%`);
    const { data, error } = await query;
    if (error) throw error;
    if (data) localStorage.setItem('cd_clientes_cache', JSON.stringify(data));
    return data || [];
  } catch (error) {
    if (checkOfflineError(error)) {
      let cache = JSON.parse(localStorage.getItem('cd_clientes_cache') || '[]');
      if (busqueda.trim()) {
        const b = busqueda.toLowerCase();
        cache = cache.filter(c => c.nombre?.toLowerCase().includes(b) || c.cuit?.toLowerCase().includes(b));
      }
      return cache;
    }
    throw error;
  }
}

export async function guardarCliente(cliente) {
  const db = await Database.load("sqlite:cd_electronica.db");
  const payload = { 
    nombre: cliente.nombre, 
    cuit: cliente.cuit || null, 
    telefono: cliente.telefono || null, 
    email: cliente.email || null, 
    direccion: cliente.direccion || null 
  };
  if (cliente.id) payload.id = cliente.id; // Puede ser un update

  const guardarClienteOffline = async () => {
    await db.execute(
      "INSERT INTO clientes_pendientes (payload, fecha) VALUES (?, ?)",
      [JSON.stringify(payload), new Date().toISOString()]
    );
    return { offline: true };
  };

  if (!window.navigator.onLine) return await guardarClienteOffline();

  try {
    const { data, error } = await supabase.from('clientes').upsert(payload).select().single();
    if (error) throw error;
    return data;
  } catch (error) {
    if (checkOfflineError(error)) return await guardarClienteOffline();
    throw error;
  }
}

export async function eliminarCliente(id) {
  const { error } = await supabase.from('clientes').delete().eq('id', id);
  if (error) throw error;
  const db = await Database.load("sqlite:cd_electronica.db");
  await db.execute("DELETE FROM clientes WHERE id = ?", [id]);
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

    // 2. Sincronización inteligente: Solo actualizo si no hay ventas pendientes de ese producto
    for (const p of formattedData) {
      // Verificamos si este producto está en alguna venta que aún no llegó a la nube
      const pendientes = await db.select(
        "SELECT id FROM ventas_pendientes WHERE payload LIKE ?",
        [`%"producto_id":${p.id}%`]
      );

      // Si hay pendientes, NO hacemos el REPLACE. Mantenemos el stock local restado.
      if (pendientes.length === 0) {
        await db.execute(
          `INSERT OR REPLACE INTO productos (id, nombre, codigo, marca, modelo, precio_venta, precio_costo, stock_l1, stock_l2, activo) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [p.id, p.nombre, p.codigo, p.marca, p.modelo, p.precio_venta, p.precio_costo, p.stock_l1, p.stock_l2]
        );
      } else {
        console.log(`⏳ Protegiendo stock local de ${p.nombre} por venta pendiente en cola.`);
      }
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
                const { error } = await supabase.from('gastos').insert([payload]);
                
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
                const { error } = await supabase.from('clientes').upsert(payload);
                
                if (!error) {
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
                    "INSERT OR REPLACE INTO clientes (id, nombre, cuit, telefono, email, direccion, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [c.id, c.nombre, c.cuit, c.telefono, c.email, c.direccion, c.fecha_creacion]
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
                    (id, cliente, equipo, problema, estado, costo, fecha) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [r.id, r.cliente, r.equipo, r.problema, r.estado, r.costo, r.fecha]
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
                fecha_creacion TEXT
            );
        `);

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

await db.execute(`
    CREATE TABLE IF NOT EXISTS venta_items_local (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venta_id INTEGER,
        producto_id INTEGER,
        nombre TEXT,
        cantidad REAL,
        precio_unitario REAL,
        precio_costo REAL
    );
`);

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

        // 2. Sincronizar Categorías
        const { data: cats, error: errCats } = await supabase.from('categorias').select('*');
        if (errCats) throw errCats;
        if (cats) {
            await db.execute("DELETE FROM categorias");
            for (const c of cats) {
                await db.execute(
                    "INSERT OR REPLACE INTO categorias (id, nombre) VALUES (?, ?)", 
                    [c.id, c.nombre]
                );
            }
        }

        // 2b. Sincronizar Proveedores
        const { data: provs, error: errProvs } = await supabase.from('proveedores').select('*');
        if (errProvs) throw errProvs;
        if (provs) {
            await db.execute("DELETE FROM proveedores");
            for (const p of provs) {
                await db.execute(
                    "INSERT OR REPLACE INTO proveedores (id, nombre, contacto, telefono, email, direccion, activo) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [p.id, p.nombre, p.contacto, p.telefono, p.email, p.direccion, p.activo ? 1 : 0]
                );
            }
        }

        // 3. Sincronizar Productos (mapeando tipos de datos)
        const { data: prods, error: errProds } = await supabase.from('productos')
            .select('*, stock(local_id, cantidad)')
            .eq('activo', true);
            
        if (errProds) throw errProds;

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

            // ─── SINCRONIZAR A SQLITE ───
            for (const p of prods) {
                // BI-Logic: ¿Tengo este producto en la cola de salida (ventas pendientes)?
                const enCola = await db.select(
                    "SELECT id FROM ventas_pendientes WHERE payload LIKE ?",
                    [`%"producto_id":${p.id}%`]
                );

                if (enCola.length > 0) {
                  console.log(`⚠️ Producto ${p.nombre} omitido en sincro por transacción pendiente.`);
                  continue;
                }

                const s1 = p.stock?.find(s => s.local_id === 1)?.cantidad || 0;
                const s2 = p.stock?.find(s => s.local_id === 2)?.cantidad || 0;
                
                // Eliminar duplicados locales con mismo codigo pero distinto id
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
  return await db.select("SELECT * FROM tecnicos ORDER BY nombre");
}

export async function guardarTecnico(data) {
  const db = await Database.load("sqlite:cd_electronica.db");
  if (data.id) {
    await db.execute("UPDATE tecnicos SET nombre = ?, telefono = ?, especialidad = ? WHERE id = ?",
      [data.nombre.trim(), data.telefono || null, data.especialidad || null, data.id]);
  } else {
    const r = await db.execute("INSERT INTO tecnicos (nombre, telefono, especialidad) VALUES (?, ?, ?)",
      [data.nombre.trim(), data.telefono || null, data.especialidad || null]);
    data.id = r.lastInsertId;
  }
  return data;
}

export async function eliminarTecnico(id) {
  const db = await Database.load("sqlite:cd_electronica.db");
  await db.execute("UPDATE reparaciones SET tecnico_id = NULL WHERE tecnico_id = ?", [id]);
  await db.execute("DELETE FROM tecnicos WHERE id = ?", [id]);
}

export async function getReparacionesPorTecnico(tecnicoId) {
  const db = await Database.load("sqlite:cd_electronica.db");
  return await db.select(
    "SELECT id, cliente, equipo, problema, estado, costo, fecha FROM reparaciones WHERE tecnico_id = ? ORDER BY fecha DESC",
    [tecnicoId]
  );
}