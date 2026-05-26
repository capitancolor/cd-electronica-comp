import XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf-8')
  env.split('\n').filter(Boolean).forEach(line => {
    const [k, ...v] = line.split('=')
    process.env[k.trim()] = v.join('=').trim()
  })
}

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY
if (!supabaseUrl || !supabaseKey) { console.error('Faltan variables de .env'); process.exit(1) }

const supabase = createClient(supabaseUrl, supabaseKey)
const EXCEL_PATH = '/home/pablo/Escritorio/COSTOS 2.xlsx'
const COTIZACION = 1100

const wb = XLSX.readFile(EXCEL_PATH)
const ws = wb.Sheets[wb.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 })

const num = v => {
  if (v === '' || v === undefined || v === null) return 0
  if (typeof v === 'number') return v
  const s = String(v).replace(/[^0-9.,]/g, '').trim()
  if (!s) return 0
  return parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) || 0
}

const productos = []
for (let i = 3; i < rows.length; i++) {
  const r = rows[i]
  const cod = r[0]; const art = (r[1] || '').toString().trim()
  if (cod === '' || isNaN(Number(cod)) || Number(cod) <= 0 || !art) continue
  productos.push({
    codigo: String(Number(cod)),
    nombre: art,
    marca: (r[2] || '').toString().trim(),
    modelo: (r[3] || '').toString().trim(),
    precio_costo: num(r[4]),
    precio_venta: num(r[9]),
    stock_l1: num(r[7]),
    stock_l2: num(r[10]),
    precio_promo: num(r[14]),
    en_promo: num(r[14]) > 0
  })
}

console.log(`📋 ${productos.length} productos para procesar\n`)

async function upsertStock(prodId, l1, l2) {
  await supabase.from('stock').upsert(
    { producto_id: prodId, local_id: 1, cantidad: l1 },
    { onConflict: 'producto_id,local_id' }
  )
  await supabase.from('stock').upsert(
    { producto_id: prodId, local_id: 2, cantidad: l2 },
    { onConflict: 'producto_id,local_id' }
  )
}

async function main() {
  let procesados = 0, errores = 0

  for (let i = 0; i < productos.length; i++) {
    const d = productos[i]
    const costoUsd = COTIZACION > 0 ? +(d.precio_costo / COTIZACION).toFixed(2) : 0

    try {
      const { data: nuevo, error: errIns } = await supabase.from('productos').upsert({
        codigo: d.codigo, nombre: d.nombre, marca: d.marca || null, modelo: d.modelo || null,
        precio_costo: d.precio_costo, precio_costo_usd: costoUsd,
        precio_venta: d.precio_venta, precio_promo: d.precio_promo, en_promo: d.en_promo, activo: true
      }, { onConflict: 'codigo' }).select('id').single()

      if (errIns || !nuevo) throw new Error(errIns?.message || 'sin respuesta')

      await upsertStock(nuevo.id, d.stock_l1, d.stock_l2)

      const movs = []
      if (d.stock_l1 > 0) movs.push({ producto_id: nuevo.id, local_id: 1, tipo: 'entrada', cantidad: d.stock_l1, referencia: 'Carga inicial L1 (Excel)' })
      if (d.stock_l2 > 0) movs.push({ producto_id: nuevo.id, local_id: 2, tipo: 'entrada', cantidad: d.stock_l2, referencia: 'Carga inicial L2 (Excel)' })
      if (movs.length > 0) await supabase.from('movimientos_stock').insert(movs)

      procesados++
      process.stdout.write(`\r${i + 1}/${productos.length} · ${procesados} procesados · ${errores} errores`)
    } catch (e) {
      errores++
      console.error(`\n❌ Código ${d.codigo} - ${d.nombre}: ${e.message}`)
    }
  }

  console.log(`\n\n✅ Finalizado. ${procesados} procesados, ${errores} errores`)
}

main().catch(console.error)
