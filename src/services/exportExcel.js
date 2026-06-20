import * as XLSX from "xlsx"
import { save, open } from '@tauri-apps/plugin-dialog'
import { writeFile, readFile } from '@tauri-apps/plugin-fs'

function numberArrayToUint8Array(arr) {
  return new Uint8Array(arr)
}

const fmt = v => '$' + Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function formatFecha(f) {
  if (!f) return ''
  const d = new Date(f)
  const dia = String(d.getDate()).padStart(2, "0")
  const mes = String(d.getMonth() + 1).padStart(2, "0")
  const anio = d.getFullYear()
  return dia + "/" + mes + "/" + anio
}

export async function exportarProductosExcel(ventas = []) {
  try {
    if (!ventas || ventas.length === 0) {
      console.warn("No hay ventas para exportar")
      return false
    }

    // Extraer todos los items de productos de todas las ventas
    const productosMap = new Map()
    let tieneItems = false
    
    ventas.forEach(v => {
      const local = v.local_nombre || ''
      
      if (v.venta_items && Array.isArray(v.venta_items) && v.venta_items.length > 0) {
        tieneItems = true
        v.venta_items.forEach(item => {
          const productoId = item.producto_id || item.id || Math.random()
          const nombre = item.nombre || item.productos?.nombre || item.descripcion || 'Sin nombre'
          const marca = item.marca || item.productos?.marca || ''
          const modelo = item.modelo || item.productos?.modelo || ''
          const categoria = item.categoria_nombre || item.productos?.categorias?.nombre || 'Sin categoría'
          const costoUnitario = Number(item.productos?.precio_costo || item.precio_costo || 0)
          const precioUnitario = Number(item.precio_unitario || 0)
          const cantidad = Number(item.cantidad || 0)
          
          const key = `${productoId}_${local}`
          
          if (productosMap.has(key)) {
            const existente = productosMap.get(key)
            existente.Cantidad += cantidad
            existente._costoTotal += costoUnitario * cantidad
            existente._precioTotal += precioUnitario * cantidad
          } else {
            productosMap.set(key, {
              'Producto': nombre,
              'Marca': marca,
              'Modelo': modelo,
              'Categoria': categoria,
              'Local': local,
              'Cantidad': cantidad,
              _costoUnit: costoUnitario,
              _precioUnit: precioUnitario,
              _costoTotal: costoUnitario * cantidad,
              _precioTotal: precioUnitario * cantidad,
              _ganancia: (precioUnitario - costoUnitario) * cantidad
            })
          }
        })
      }
    })
    
    const entries = Array.from(productosMap.values())

    const mapearFila = p => ({
      'Producto': p['Producto'],
      'Marca': p['Marca'],
      'Modelo': p['Modelo'],
      'Categoria': p['Categoria'],
      'Local': p['Local'],
      'Cantidad': p['Cantidad'],
      'Costo Unit.': fmt(p._costoUnit),
      'Precio Unit.': fmt(p._precioUnit),
      'Costo Total': fmt(p._costoTotal),
      'Precio Total': fmt(p._precioTotal),
      'Ganancia': fmt(p._ganancia),
    })

    const filas = entries.map(mapearFila)
    
    // Fallback: si no hay items detallados, exportar cada venta como una fila
    if (!tieneItems) {
      const filasVenta = ventas.map(v => ({
        'Fecha': new Date(v.fecha).toLocaleDateString('es-AR'),
        'Productos': v.productos_nombres || '',
        'Local': v.local_nombre || '',
        'Vendedor': v.vendedor || '',
        'Método de Pago': v.metodo_pago || '',
        'Costo Total': fmt(Number(v.costo_total || 0)),
        'Total': fmt(Number(v.total || 0)),
        'Ganancia': fmt(Number(v.total || 0) - Number(v.costo_total || 0))
      }))

      const total = filasVenta.reduce((s, r) => s + Number(String(r['Total']).replace(/[$\s.]/g, '').replace(',', '.') || 0), 0)
      const costo = filasVenta.reduce((s, r) => s + Number(String(r['Costo Total']).replace(/[$\s.]/g, '').replace(',', '.') || 0), 0)
      filasVenta.push({
        'Fecha': '', 'Productos': 'TOTAL', 'Local': '', 'Vendedor': '', 'Método de Pago': '',
        'Costo Total': fmt(costo), 'Total': fmt(total), 'Ganancia': fmt(total - costo)
      })

      const ws = XLSX.utils.json_to_sheet(filasVenta)
      ws["!cols"] = [
        { wch: 14 }, { wch: 50 }, { wch: 10 }, { wch: 22 },
        { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }
      ]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, "Ventas")

      const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" })
      const uint8Array = numberArrayToUint8Array(buffer)

      const filePath = await save({
        title: 'Guardar reporte de ventas',
        defaultPath: `reporte_ventas_${new Date().toISOString().slice(0,10)}.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }]
      })

      if (!filePath) { return false }
      await writeFile(filePath, uint8Array)
      alert("Archivo Excel guardado correctamente en:\n" + filePath)
      return true
    }
    
    // Separar por local (usando raw entries)
    const local1Raw = entries.filter(e => e['Local'] === 'Local 1')
    const local2Raw = entries.filter(e => e['Local'] === 'Local 2')
    
    // Función para agregar totales (recibe raw entries)
    const agregarTotalProductos = (source, target) => {
      const costoTotal = source.reduce((s, r) => s + r._costoTotal, 0)
      const precioTotal = source.reduce((s, r) => s + r._precioTotal, 0)
      const gananciaTotal = source.reduce((s, r) => s + r._ganancia, 0)
      
      target.push({
        'Producto': 'TOTAL',
        'Marca': '',
        'Modelo': '',
        'Categoria': '',
        'Local': '',
        'Cantidad': source.reduce((s, r) => s + r['Cantidad'], 0),
        'Costo Unit.': '',
        'Precio Unit.': '',
        'Costo Total': fmt(costoTotal),
        'Precio Total': fmt(precioTotal),
        'Ganancia': fmt(gananciaTotal)
      })
    }
    
    const local1 = local1Raw.map(mapearFila)
    const local2 = local2Raw.map(mapearFila)
    
    if (local1.length) agregarTotalProductos(local1Raw, local1)
    if (local2.length) agregarTotalProductos(local2Raw, local2)
    agregarTotalProductos(entries, filas)
    
    const wb = XLSX.utils.book_new()
    
    // Crear hojas con columnas adecuadas
    const crearHojaProductos = (data) => {
      const ws = XLSX.utils.json_to_sheet(data)
      ws["!cols"] = [
        { wch: 40 },  // Producto
        { wch: 15 },  // Marca
        { wch: 15 },  // Modelo
        { wch: 20 },  // Categoria
        { wch: 12 },  // Local
        { wch: 10 },  // Cantidad
        { wch: 14 },  // Costo Unit.
        { wch: 14 },  // Precio Unit.
        { wch: 14 },  // Costo Total
        { wch: 14 },  // Precio Total
        { wch: 14 }   // Ganancia
      ]
      return ws
    }
    
    if (local1.length) XLSX.utils.book_append_sheet(wb, crearHojaProductos(local1), "Local 1")
    if (local2.length) XLSX.utils.book_append_sheet(wb, crearHojaProductos(local2), "Local 2")
    XLSX.utils.book_append_sheet(wb, crearHojaProductos(filas), "Total General")
    
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" })
    const uint8Array = numberArrayToUint8Array(buffer)
    
    // Cambiar el título del diálogo y usar basename
    const filePath = await save({
      title: 'Guardar reporte de ventas',
      defaultPath: `reporte_ventas_${new Date().toISOString().slice(0,10)}.xlsx`,
      filters: [{
        name: 'Excel',
        extensions: ['xlsx']
      }]
    })
    
    // Si el usuario cancela, filePath será null/undefined
    if (!filePath) {
      console.log("Exportación cancelada por el usuario")
      return false
    }
    
    await writeFile(filePath, uint8Array)
    console.log("Archivo guardado:", filePath)
    alert("Archivo Excel guardado correctamente en:\n" + filePath)
    return true
  } catch (error) {
    console.error("Error exportando ventas:", error)
    if (error.message !== 'canceled') {
      alert("Error al exportar: " + error.message)
    }
    return false
  }
}

export async function exportarGastosExcel(gastos = []) {
  try {
    if (!gastos || gastos.length === 0) {
      console.warn("No hay gastos para exportar")
      return false
    }
    
    const filas = gastos.map(g => {
      const fecha = new Date(g.fecha);
      const diasEnMes = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0).getDate();
      const cantDias = g.dias_aplicados?.length || diasEnMes;
      return {
        'Descripcion': g.descripcion || '',
        'Días': cantDias,
        'Metodo Pago': g.metodo_pago === 'transferencia' ? 'TRANSFERENCIA' : 'EFECTIVO',
        'Monto': fmt(Number(g.monto || 0))
      }
    })

    const total = gastos.reduce((s, g) => s + Number(g.monto || 0), 0)
    filas.push({
      'Descripcion': 'TOTAL',
      'Días': '',
      'Metodo Pago': '',
      'Monto': fmt(total)
    })

    const ws = XLSX.utils.json_to_sheet(filas)
    ws["!cols"] = [
      { wch: 50 },  // Descripcion
      { wch: 10 },  // Días
      { wch: 18 },  // Metodo Pago
      { wch: 15 }   // Monto
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Gastos")
    
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" })
    const uint8Array = numberArrayToUint8Array(buffer)
    
    const filePath = await save({
      title: 'Guardar reporte de gastos',
      defaultPath: `reporte_gastos_${new Date().toISOString().slice(0,10)}.xlsx`,
      filters: [{
        name: 'Excel',
        extensions: ['xlsx']
      }]
    })
    
    if (!filePath) {
      console.log("Exportación cancelada por el usuario")
      return false
    }
    
    await writeFile(filePath, uint8Array)
    console.log("Archivo guardado:", filePath)
    alert("Archivo Excel guardado correctamente en:\n" + filePath)
    return true
  } catch (error) {
    console.error("Error exportando gastos:", error)
    const msg = error?.message || error?.toString() || 'Error desconocido'
    if (msg !== 'canceled') {
      alert("Error al exportar: " + msg)
    }
    return false
  }
}

export async function exportarStockExcel(productos = [], filtroLocal = '') {
  try {
    if (!productos || productos.length === 0) {
      console.warn("No hay productos para exportar")
      return false
    }

    let datos = [...productos]

    if (filtroLocal === '1' || filtroLocal === '2') {
      const col = `stock_l${filtroLocal}`
      datos = datos.filter(p => Number(p[col] || 0) > 0)
    }

    const filas = datos.map(p => {
      const row = {
        'Producto': p.nombre || '',
        'Marca': p.marca || '',
        'Modelo': p.modelo || '',
        'Precio Venta': Number(p.precio_venta || 0),
      }

      if (filtroLocal === '1') {
        row['Stock L1'] = Number(p.stock_l1 || p.stockActual || 0)
      } else if (filtroLocal === '2') {
        row['Stock L2'] = Number(p.stock_l2 || 0)
      } else {
        row['Stock L1'] = Number(p.stock_l1 || p.stockActual || 0)
        row['Stock L2'] = Number(p.stock_l2 || 0)
      }

      if (p.precio_promo && Number(p.precio_promo) > 0) {
        row['Precio Promo'] = Number(p.precio_promo)
      }

      return row
    })

    const ws = XLSX.utils.json_to_sheet(filas)

    const cols = [
      { wch: 35 }, // Producto
      { wch: 15 }, // Marca
      { wch: 15 }, // Modelo
      { wch: 12 }, // Precio Venta
    ]
    if (filtroLocal === '1' || !filtroLocal) cols.push({ wch: 10 }) // Stock L1
    if (filtroLocal === '2' || !filtroLocal) cols.push({ wch: 10 }) // Stock L2
    const hasPromo = filas.some(r => r['Precio Promo'] !== undefined)
    if (hasPromo) cols.push({ wch: 12 }) // Precio Promo
    ws["!cols"] = cols

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Stock")
    
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" })
    const uint8Array = numberArrayToUint8Array(buffer)
    
    const filePath = await save({
      title: 'Guardar reporte de stock',
      defaultPath: `reporte_stock_${new Date().toISOString().slice(0,10)}.xlsx`,
      filters: [{
        name: 'Excel',
        extensions: ['xlsx']
      }]
    })
    
    if (!filePath) {
      console.log("Exportación cancelada por el usuario")
      return false
    }
    
    await writeFile(filePath, uint8Array)
    console.log("Archivo guardado:", filePath)
    alert("Archivo Excel guardado correctamente en:\n" + filePath)
    return true
  } catch (error) {
    console.error("Error exportando stock:", error)
    const msg = error?.message || error?.toString() || 'Error desconocido'
    if (msg !== 'canceled') {
      alert("Error al exportar: " + msg)
    }
    return false
  }
}

export async function importarStockExcel() {
  try {
    const filePath = await open({
      title: 'Seleccionar archivo Excel',
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
      multiple: false,
    })

    if (!filePath) return null

    const uint8Array = await readFile(filePath)
    const workbook = XLSX.read(uint8Array, { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName])

    if (!data || data.length === 0) {
      alert("El archivo Excel está vacío o no tiene datos en la primera hoja.")
      return null
    }

    return data
  } catch (error) {
    console.error("Error importando Excel:", error)
    if (error.message !== 'canceled') {
      alert("Error al importar: " + error.message)
    }
    return null
  }
}
