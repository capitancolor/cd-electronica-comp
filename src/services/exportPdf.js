import jsPDF from 'jspdf'
import { writeFile } from '@tauri-apps/plugin-fs'
import { save } from '@tauri-apps/plugin-dialog'

function formatFecha(f) {
  const d = new Date(f)
  const dia = String(d.getDate()).padStart(2, "0")
  const mes = String(d.getMonth() + 1).padStart(2, "0")
  const anio = d.getFullYear()
  return `${dia}/${mes}/${anio}`
}

function formatHora(f) {
  const d = new Date(f)
  const hora = String(d.getHours()).padStart(2, "0")
  const min = String(d.getMinutes()).padStart(2, "0")
  return `${hora}:${min}`
}

export async function exportarVentaPDF(carrito, totalFinal, metodoPago, localNombre, usuarioNombre, detalleMixto = null) {
  const doc = new jsPDF()

  // Configuración
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 20
  let yPosition = margin

  // Función auxiliar para añadir texto centrado
  const addCenteredText = (text, y, fontSize = 12, fontWeight = 'normal') => {
    doc.setFontSize(fontSize)
    doc.setFont('helvetica', fontWeight)
    const textWidth = doc.getTextWidth(text)
    const x = (pageWidth - textWidth) / 2
    doc.text(text, x, y)
  }

  // Función auxiliar para añadir texto alineado a la izquierda
  const addLeftText = (text, y, fontSize = 10, fontWeight = 'normal') => {
    doc.setFontSize(fontSize)
    doc.setFont('helvetica', fontWeight)
    doc.text(text, margin, y)
  }

  // Función auxiliar para añadir texto alineado a la derecha
  const addRightText = (text, y, fontSize = 10, fontWeight = 'normal') => {
    doc.setFontSize(fontSize)
    doc.setFont('helvetica', fontWeight)
    const textWidth = doc.getTextWidth(text)
    const x = pageWidth - margin - textWidth
    doc.text(text, x, y)
  }

  // Título
  addCenteredText('RECIBO DE VENTA', yPosition, 20, 'bold')
  yPosition += 15

  // Subtítulo
  addCenteredText('CD-Electrónica', yPosition, 14, 'bold')
  yPosition += 10

  // Información de fecha y método de pago
  addLeftText(`Fecha: ${formatFecha(new Date())}`, yPosition, 10)
  yPosition += 8
  addLeftText(`Hora: ${formatHora(new Date())}`, yPosition, 10)
  yPosition += 8
  addLeftText(`Método de Pago: ${metodoPago}`, yPosition, 10)
  yPosition += 15

  // Línea separadora
  doc.setLineWidth(0.5)
  doc.line(margin, yPosition, pageWidth - margin, yPosition)
  yPosition += 10

  // Encabezados de la tabla
  const colWidths = [80, 20, 30, 30] // Descripción, Cant, Precio U, Subtotal
  const headers = ['Producto', 'Cant.', 'P.Unit', 'Subtotal']
  let xPosition = margin

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  headers.forEach((header, i) => {
    doc.text(header, xPosition, yPosition)
    xPosition += colWidths[i]
  })
  yPosition += 8

  // Línea bajo encabezados
  doc.line(margin, yPosition, pageWidth - margin, yPosition)
  yPosition += 5

  // Items del carrito
  doc.setFont('helvetica', 'normal')
  carrito.forEach(item => {
    if (yPosition > pageHeight - 40) {
      doc.addPage()
      yPosition = margin
    }

    xPosition = margin
    const descripcion = item.nombre.length > 25 ? item.nombre.substring(0, 22) + '...' : item.nombre
    doc.text(descripcion, xPosition, yPosition)
    xPosition += colWidths[0]

    doc.text(item.cantidad.toString(), xPosition, yPosition)
    xPosition += colWidths[1]

    doc.text('$' + Number(item.precio_unitario).toLocaleString('es-AR'), xPosition, yPosition)
    xPosition += colWidths[2]

    doc.text('$' + Number(item.cantidad * item.precio_unitario).toLocaleString('es-AR'), xPosition, yPosition)
    yPosition += 8
  })

  // Línea separadora
  yPosition += 5
  doc.line(margin, yPosition, pageWidth - margin, yPosition)
  yPosition += 10

  // Totales
  const subtotal = carrito.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0)
  const recargoTarjeta = (metodoPago === 'tarjeta') ? (subtotal * 0.10) : 0

  addRightText(`Subtotal: $${subtotal.toLocaleString('es-AR')}`, yPosition, 12)
  yPosition += 8

  if (recargoTarjeta > 0) {
    addRightText(`Recargo Tarjeta (10%): $${recargoTarjeta.toLocaleString('es-AR')}`, yPosition, 12)
    yPosition += 8
  }

  if (detalleMixto && metodoPago === 'mixto') {
    yPosition += 5
    addLeftText('Detalle Pago Mixto:', yPosition, 10, 'bold')
    yPosition += 8
    if (detalleMixto.efectivo && Number(detalleMixto.efectivo) > 0) {
      addLeftText(`Efectivo: $${Number(detalleMixto.efectivo).toLocaleString('es-AR')}`, yPosition, 10)
      yPosition += 6
    }
    if (detalleMixto.tarjeta && Number(detalleMixto.tarjeta) > 0) {
      addLeftText(`Tarjeta: $${Number(detalleMixto.tarjeta).toLocaleString('es-AR')}`, yPosition, 10)
      yPosition += 6
    }
    if (detalleMixto.transferencia && Number(detalleMixto.transferencia) > 0) {
      addLeftText(`Transferencia: $${Number(detalleMixto.transferencia).toLocaleString('es-AR')}`, yPosition, 10)
      yPosition += 6
    }
    yPosition += 5
  }

  addRightText(`TOTAL: $${totalFinal.toLocaleString('es-AR')}`, yPosition, 14, 'bold')

  // Guardar el PDF usando Tauri
  const fechaHora = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
  const fileName = `venta_${fechaHora}.pdf`

  try {
    // Mostrar diálogo para guardar archivo
    const filePath = await save({
      title: 'Guardar PDF de Venta',
      filters: [{
        name: 'PDF',
        extensions: ['pdf']
      }],
      defaultPath: fileName
    })

    if (filePath) {
      // Convertir el PDF a array buffer
      const pdfBuffer = doc.output('arraybuffer')

      // Escribir el archivo usando Tauri
      await writeFile(filePath, new Uint8Array(pdfBuffer))

      return true // Éxito
    }
    return false // Cancelado por usuario
  } catch (error) {
    console.error('Error al guardar el PDF:', error)
    throw error // Lanzar el error para que lo maneje el componente
  }
}

export async function exportarNotaCreditoPDF(items, total, localNombre, usuarioNombre, motivo) {
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 20
  let yPosition = margin

  const addCenteredText = (text, y, fontSize = 12, fontWeight = 'normal') => {
    doc.setFontSize(fontSize)
    doc.setFont('helvetica', fontWeight)
    const textWidth = doc.getTextWidth(text)
    const x = (pageWidth - textWidth) / 2
    doc.text(text, x, y)
  }

  const addLeftText = (text, y, fontSize = 10, fontWeight = 'normal') => {
    doc.setFontSize(fontSize)
    doc.setFont('helvetica', fontWeight)
    doc.text(text, margin, y)
  }

  const addRightText = (text, y, fontSize = 10, fontWeight = 'normal') => {
    doc.setFontSize(fontSize)
    doc.setFont('helvetica', fontWeight)
    const textWidth = doc.getTextWidth(text)
    const x = pageWidth - margin - textWidth
    doc.text(text, x, y)
  }

  addCenteredText('NOTA DE CRÉDITO', yPosition, 20, 'bold')
  yPosition += 15
  addCenteredText('CD-Electrónica', yPosition, 14, 'bold')
  yPosition += 10

  addLeftText(`Fecha: ${formatFecha(new Date())}`, yPosition, 10)
  yPosition += 8
  addLeftText(`Hora: ${formatHora(new Date())}`, yPosition, 10)
  yPosition += 8
  addLeftText(`Local: ${localNombre}`, yPosition, 10)
  yPosition += 8
  addLeftText(`Vendedor: ${usuarioNombre}`, yPosition, 10)
  yPosition += 8
  if (motivo) {
    addLeftText(`Motivo: ${motivo}`, yPosition, 10)
    yPosition += 8
  }
  yPosition += 7

  doc.setLineWidth(0.5)
  doc.line(margin, yPosition, pageWidth - margin, yPosition)
  yPosition += 10

  const colWidths = [70, 30, 20, 30, 30]
  const headers = ['Producto', 'Marca/Modelo', 'Cant.', 'P.Unit', 'Subtotal']
  let xPosition = margin

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  headers.forEach((header, i) => {
    doc.text(header, xPosition, yPosition)
    xPosition += colWidths[i]
  })
  yPosition += 8
  doc.line(margin, yPosition, pageWidth - margin, yPosition)
  yPosition += 5

  doc.setFont('helvetica', 'normal')
  items.forEach(item => {
    if (yPosition > pageHeight - 40) {
      doc.addPage()
      yPosition = margin
    }
    xPosition = margin
    const nombre = item.nombre.length > 20 ? item.nombre.substring(0, 18) + '...' : item.nombre
    doc.text(nombre, xPosition, yPosition)
    xPosition += colWidths[0]

    const marcaModelo = [item.marca, item.modelo].filter(Boolean).join(' / ') || '-'
    const mm = marcaModelo.length > 18 ? marcaModelo.substring(0, 16) + '...' : marcaModelo
    doc.text(mm, xPosition, yPosition)
    xPosition += colWidths[1]

    doc.text(item.cantidad.toString(), xPosition, yPosition)
    xPosition += colWidths[2]

    doc.text('$' + Number(item.precio_unitario).toLocaleString('es-AR'), xPosition, yPosition)
    xPosition += colWidths[3]

    doc.text('-$' + Number(item.cantidad * item.precio_unitario).toLocaleString('es-AR'), xPosition, yPosition)
    yPosition += 8
  })

  yPosition += 5
  doc.line(margin, yPosition, pageWidth - margin, yPosition)
  yPosition += 10

  addRightText(`TOTAL DEVUELTO: -$${Math.abs(total).toLocaleString('es-AR')}`, yPosition, 14, 'bold')

  const fechaHora = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
  const fileName = `nota_credito_${fechaHora}.pdf`

  try {
    const filePath = await save({
      title: 'Guardar Nota de Crédito',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      defaultPath: fileName
    })
    if (filePath) {
      const pdfBuffer = doc.output('arraybuffer')
      await writeFile(filePath, new Uint8Array(pdfBuffer))
      return true
    }
    return false
  } catch (error) {
    console.error('Error al guardar el PDF:', error)
    throw error
  }
}