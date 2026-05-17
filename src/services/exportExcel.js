import * as XLSX from "xlsx"
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'

function numberArrayToUint8Array(arr) {
  return new Uint8Array(arr)
}

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
    
    ventas.forEach(v => {
      const local = v.local_nombre || ''
      
      if (v.venta_items && Array.isArray(v.venta_items)) {
        v.venta_items.forEach(item => {
          const productoId = item.producto_id || item.id || Math.random()
          const nombre = item.nombre || item.productos?.nombre || item.descripcion || 'Sin nombre'
          const categoria = item.categoria_nombre || item.productos?.categorias?.nombre || 'Sin categoría'
          const costoUnitario = Number(item.productos?.precio_costo || item.precio_costo || 0)
          const precioUnitario = Number(item.precio_unitario || 0)
          const cantidad = Number(item.cantidad || 0)
          
          const key = `${productoId}_${local}`
          
          if (productosMap.has(key)) {
            const existente = productosMap.get(key)
            existente.Cantidad += cantidad
            existente['Costo Total'] += costoUnitario * cantidad
            existente['Precio Total'] += precioUnitario * cantidad
          } else {
            productosMap.set(key, {
              'Producto': nombre,
              'Categoria': categoria,
              'Local': local,
              'Cantidad': cantidad,
              'Costo Unit.': costoUnitario,
              'Precio Unit.': precioUnitario,
              'Costo Total': costoUnitario * cantidad,
              'Precio Total': precioUnitario * cantidad,
              'Ganancia': (precioUnitario - costoUnitario) * cantidad
            })
          }
        })
      }
    })
    
    const filas = Array.from(productosMap.values())
    
    // Separar por local
    const local1 = filas.filter(f => f['Local'] === 'Local 1')
    const local2 = filas.filter(f => f['Local'] === 'Local 2')
    
    // Función para agregar totales
    const agregarTotalProductos = (data) => {
      const costoTotal = data.reduce((s, r) => s + Number(r['Costo Total'] || 0), 0)
      const precioTotal = data.reduce((s, r) => s + Number(r['Precio Total'] || 0), 0)
      const gananciaTotal = data.reduce((s, r) => s + Number(r['Ganancia'] || 0), 0)
      
      data.push({
        'Producto': 'TOTAL',
        'Categoria': '',
        'Local': '',
        'Cantidad': data.reduce((s, r) => s + Number(r.Cantidad || 0), 0),
        'Costo Unit.': '',
        'Precio Unit.': '',
        'Costo Total': costoTotal,
        'Precio Total': precioTotal,
        'Ganancia': gananciaTotal
      })
    }
    
    if (local1.length) agregarTotalProductos(local1)
    if (local2.length) agregarTotalProductos(local2)
    agregarTotalProductos(filas)
    
    const wb = XLSX.utils.book_new()
    
    // Crear hojas con columnas adecuadas
    const crearHojaProductos = (data) => {
      const ws = XLSX.utils.json_to_sheet(data)
      ws["!cols"] = [
        { wch: 40 },  // Producto
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
    
    const filas = gastos.map(g => ({
      'Fecha': new Date(g.fecha).toLocaleDateString('es-AR'),
      'Descripcion': g.descripcion || '',
      'Categoria': g.categoria || 'VARIOS',
      'Monto': Number(g.monto || 0)
    }))

    const total = filas.reduce((s, r) => s + Number(r['Monto'] || 0), 0)
    filas.push({
      'Fecha': '',
      'Descripcion': 'TOTAL',
      'Categoria': '',
      'Monto': total
    })

    const ws = XLSX.utils.json_to_sheet(filas)
    ws["!cols"] = [
      { wch: 18 },  // Fecha
      { wch: 50 },  // Descripcion
      { wch: 18 },  // Categoria
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

export async function exportarStockExcel(productos = []) {
  try {
    if (!productos || productos.length === 0) {
      console.warn("No hay productos para exportar")
      return false
    }
    
    const filas = productos.map(p => ({
      'Codigo': Number(p.codigo) || '',
      'Producto': p.nombre || '',
      'Categoria': p.categoria || 'General',
      'Marca': p.marca || '',
      'Modelo': p.modelo || '',
      'Precio Costo': Number(p.precio_costo || 0),
      'Precio Venta': Number(p.precio_venta || 0),
      'Stock L1': Number(p.stock_l1 || p.stockActual || 0),
      'Stock L2': Number(p.stock_l2 || 0),
      'En Promo': p.en_promo ? 'SI' : 'NO'
    }))

    const ws = XLSX.utils.json_to_sheet(filas)
    ws["!cols"] = [
      { wch: 12 }, // Codigo
      { wch: 35 }, // Producto
      { wch: 18 }, // Categoria
      { wch: 15 }, // Marca
      { wch: 15 }, // Modelo
      { wch: 12 }, // Precio Costo
      { wch: 12 }, // Precio Venta
      { wch: 10 }, // Stock L1
      { wch: 10 }, // Stock L2
      { wch: 10 }  // En Promo
    ]

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
