import * as XLSX from 'xlsx'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import { supabase } from '../supabase'
import Database from '@tauri-apps/plugin-sql'

function lookup(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== '') return String(obj[k]).trim()
  }
  return ''
}

function numVal(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== '') {
      let s = String(obj[k]).replace(/[^0-9.,]/g, '').trim()
      if (!s) continue
      if (s.includes(',')) {
        s = s.replace(/\./g, '').replace(',', '.')
      } else if (s.includes('.')) {
        const parts = s.split('.')
        if (parts.length === 2 && parts[1].length === 3) {
          s = parts.join('')
        } else if (parts.length > 2) {
          s = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1]
        }
      }
      const v = parseFloat(s)
      if (!isNaN(v)) return v
    }
  }
  return 0
}

export async function importarStockExcel({ cotizacion = 1100, usuarioId = null } = {}) {
  const selected = await open({
    title: 'Seleccionar archivo Excel de stock',
    filters: [{ name: 'Excel', extensions: ['xls', 'xlsx'] }]
  })
  if (!selected) return null

  console.log('[IMPORT] Archivo:', selected)
  const buffer = await readFile(selected)
  console.log('[IMPORT] Bytes:', buffer?.byteLength)

  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

  if (!rows.length) throw new Error('El archivo Excel está vacío')

  const cols = Object.keys(rows[0])
  console.log('[IMPORT] Columnas detectadas (raw):', cols)
  console.log('[IMPORT] Columnas normalizadas:', cols.map(c => c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()))
  console.log('[IMPORT] Primera fila:', rows[0])

  const db = await Database.load('sqlite:cd_electronica.db')

  const { data: catsExistentes } = await supabase.from('categorias').select('*')
  const catMap = new Map()
  if (catsExistentes) catsExistentes.forEach(c => catMap.set(c.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(), c.id))

  const result = { importados: 0, actualizados: 0, errores: 0, total: rows.length, detalles: [] }

  const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  const col = (name) => cols.find(c => norm(c) === norm(name))

  // Mapeo key → key canónica
  const keyNombre =    col('articulo') || col('descripcion') || col('nombre') || col('producto') || 'ARTICULO'
  const keyCodigo =    col('codigo') || col('código') || col('cod') || 'CÓDIGO'
  const keyMarca =     col('marca') || 'MARCA'
  const keyModelo =    col('modelo') || 'MODELO'
  const keyCategoria = col('categoria') || col('categoría') || 'CATEGORÍA'
  const keyStockL1 =   col('casa stock') || col('casa_stock') || col('stock l1') || 'CASA STOCK'
  const keyStockL2 =   col('tours stock') || col('tours_stock') || col('stock l2') || 'TOURS STOCK'
  const keyOferta =    col('oferta') || 'OFERTA'
  const keyCosto =     col('costo fijo') || col('costo_fijo') || col('precio costo') || col('precio_costo') || col('costo') || 'COSTO FIJO'
  const keyVenta =     col('precio de venta') || col('precio_de_venta') || col('precio venta') || col('precio_venta') || col('venta') || col('precio') || 'PRECIO DE VENTA'

  console.log('[IMPORT] Mapeo:', { keyNombre, keyCodigo, keyMarca, keyModelo, keyCategoria, keyStockL1, keyStockL2, keyOferta, keyCosto, keyVenta })

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const filaNum = i + 2

    try {
      const nombre = lookup(row, keyNombre)
      const codigo = lookup(row, keyCodigo)
      const marca = lookup(row, keyMarca)
      const modelo = lookup(row, keyModelo)
      const catNombre = lookup(row, keyCategoria)
      const stockL1 = numVal(row, keyStockL1)
      const stockL2 = numVal(row, keyStockL2)
      const ofertaVal = numVal(row, keyOferta)
      const costo = numVal(row, keyCosto)
      const venta = numVal(row, keyVenta)
      const enPromo = ofertaVal > 0

      console.log(`[IMPORT] Fila ${filaNum}:`, { nombre, codigo, marca, modelo, catNombre, stockL1, stockL2, ofertaVal, costo, venta })

      if (!nombre) {
        console.warn(`[IMPORT] Fila ${filaNum}: sin nombre (buscando columna "${keyNombre}", disponible: ${JSON.stringify(Object.keys(row))})`)
        result.errores++
        result.detalles.push({ fila: filaNum, error: `Nombre vacío (columna buscada: "${keyNombre}")` })
        continue
      }

      let catId = null
      if (catNombre) {
        const key = catNombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        if (catMap.has(key)) {
          catId = catMap.get(key)
        } else {
          console.log(`[IMPORT] Nueva categoría: "${catNombre}"`)
          const { data: nc, error: errCat } = await supabase.from('categorias').insert({ nombre: catNombre }).select().single()
          if (errCat || !nc) {
            console.warn(`[IMPORT] Error creando categoría "${catNombre}":`, errCat?.message)
            result.detalles.push({ fila: filaNum, error: `Error categoría "${catNombre}": ${errCat?.message}` })
          } else {
            catId = nc.id
            catMap.set(key, catId)
            await db.execute('INSERT OR IGNORE INTO categorias (id, nombre) VALUES (?, ?)', [catId, catNombre])
          }
        }
      }

      const costoUsd = cotizacion > 0 ? +(costo / cotizacion).toFixed(2) : 0

      const upsertStock = async (prodId) => {
        await supabase.from('stock').upsert(
          { producto_id: prodId, local_id: 1, cantidad: stockL1 },
          { onConflict: 'producto_id,local_id' }
        ).maybeSingle()
        await supabase.from('stock').upsert(
          { producto_id: prodId, local_id: 2, cantidad: stockL2 },
          { onConflict: 'producto_id,local_id' }
        ).maybeSingle()
      }

      // Buscar existente por código o por nombre exacto
      let prodExistente = null
      if (codigo) {
        const { data } = await supabase.from('productos').select('id').eq('codigo', codigo).limit(1)
        if (data?.length) prodExistente = data[0]
      }
      if (!prodExistente) {
        const { data } = await supabase.from('productos').select('id').eq('nombre', nombre).limit(1)
        if (data?.length) prodExistente = data[0]
      }

      if (prodExistente) {
        console.log(`[IMPORT] Actualizando producto ID ${prodExistente.id}:`, { costo, venta, costoUsd, stockL1, stockL2, ofertaVal })
        const { error: errUpd } = await supabase.from('productos').update({
          nombre, marca, modelo, categoria_id: catId,
          precio_costo: costo, precio_costo_usd: costoUsd, precio_venta: venta,
          precio_promo: ofertaVal, en_promo: enPromo
        }).eq('id', prodExistente.id)
        if (errUpd) throw errUpd

        await upsertStock(prodExistente.id)
        await db.execute(
          `UPDATE productos SET nombre=?, marca=?, modelo=?, categoria_id=?,
           precio_costo=?, precio_costo_usd=?, precio_venta=?,
           precio_promo=?, en_promo=?, stock_l1=?, stock_l2=?
           WHERE id=?`,
          [nombre, marca, modelo, catId, costo, costoUsd, venta, ofertaVal, enPromo ? 1 : 0, stockL1, stockL2, prodExistente.id]
        )
        result.actualizados++
        continue
      }

      const codigoFinal = codigo || `IMP${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`
      console.log(`[IMPORT] Insertando nuevo producto:`, { codigoFinal, nombre, costo, venta, stockL1, stockL2 })
      const { data: np, error: errIns } = await supabase.from('productos').insert({
        codigo: codigoFinal, nombre, marca, modelo, categoria_id: catId,
        precio_costo: costo, precio_costo_usd: costoUsd, precio_venta: venta,
        precio_promo: ofertaVal, en_promo: enPromo, activo: true
      }).select().single()

      if (errIns || !np) throw new Error(`Error al insertar: ${errIns?.message}`)

      await upsertStock(np.id)

      if (usuarioId) {
        const movimientos = []
        if (stockL1 > 0) movimientos.push({ producto_id: np.id, local_id: 1, tipo: 'entrada', cantidad: stockL1, referencia: 'Importación Excel L1', usuario_id: usuarioId })
        if (stockL2 > 0) movimientos.push({ producto_id: np.id, local_id: 2, tipo: 'entrada', cantidad: stockL2, referencia: 'Importación Excel L2', usuario_id: usuarioId })
        if (movimientos.length > 0) {
          const { error: errMov } = await supabase.from('movimientos_stock').insert(movimientos)
          if (errMov) console.warn('[IMPORT] Error movimientos:', errMov.message)
        }
      }

      await db.execute(
        `INSERT INTO productos (id, codigo, nombre, marca, modelo, categoria_id,
         precio_costo, precio_costo_usd, precio_venta, precio_promo, en_promo,
         stock_l1, stock_l2, activo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [np.id, codigoFinal, nombre, marca, modelo, catId, costo, costoUsd, venta, ofertaVal, enPromo ? 1 : 0, stockL1, stockL2]
      )
      result.importados++
    } catch (e) {
      console.error(`[IMPORT] Error fila ${filaNum}:`, e)
      result.errores++
      result.detalles.push({ fila: filaNum, error: e.message })
    }
  }

  console.log('[IMPORT] Resultado:', result)
  return result
}
