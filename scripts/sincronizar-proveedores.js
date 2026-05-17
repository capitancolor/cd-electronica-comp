import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
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

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)

// Mapeo: nombre en COSTOS 2.xlsx → nombre exacto en Supabase (null = crear nuevo)
const MAPEO = {
  '3D72':           null,
  'ANALIA':         'ANALIA',
  'AXA':            'AXA COMPUTACION S.A',
  'AZRAA':          'AZRAA',
  'CAJON':          'CAJON',
  'CARLOS':         'CARLOS',
  'CARREFOUR':      'CARREFOUR',
  'CHINO PASTEUR':  'CHINO PASTEUR',
  'CLARO':          'CLARO',
  'CORRALON':       'CORRALON SOCIAL',
  'DAMIAN':         'DAMIAN',
  'DAVID NOGA':     'DAVID NOGA',
  'ELECTROFER':     'ELECTROFER',
  'FERRETERIA':     'FERRETERIA ELECGENERAL',
  'GTC':            'GTC',
  'HERNAN':         'HERNAN',
  'JUAN BKT':       'JUAN BKT',
  'LEO':            null,
  'LOTE V.ADELINA':'LOTE VILLA ADELINA',
  'LUIS PERSONAL':  'LUIS PERSONAL',
  'MARTIN FLOW':    'MARTIN FLOW',
  'MERCADO L.':     'MERCADO LIBRE',
  'MIRIAM':         'MIRIAM',
  'MOVISTAR':       'MOVISTAR',
  'NISHAD':         'NISHAD',
  'PASTEUR':        null,
  'PASTEUR 112':    'PASTEUR 112',
  'PASTEUR 227':    'PASTEUR 227',
  'PASTEUR 228':    null,
  'PATEUR 227':     'PASTEUR 227', // typo
  'PERSONAL':       'PERSONAL',
  'SANTIAGO':       'SANTIAGO DEXXA',
  'TOP CELL':       'TOP CELL',
}

// 1. Obtener proveedores existentes en Supabase
const { data: existentes, error: errExist } = await supabase.from('proveedores').select('*')
if (errExist) { console.error('Error leyendo proveedores:', errExist); process.exit(1) }

const provPorNombre = {}
existentes.forEach(p => { provPorNombre[p.nombre.toUpperCase().trim()] = p })

console.log(`Proveedores existentes en Supabase: ${existentes.length}`)

// 2. Crear los que faltan
const nombresACrear = new Set()
for (const [nombreExcel, nombreSupabase] of Object.entries(MAPEO)) {
  const key = (nombreSupabase || nombreExcel).toUpperCase().trim()
  if (!provPorNombre[key]) {
    nombresACrear.add(nombreSupabase || nombreExcel)
  }
}

console.log(`\nProveedores a crear (${nombresACrear.size}):`)
for (const n of nombresACrear) console.log(`  - ${n}`)

for (const nombre of nombresACrear) {
  const { data: nuevo, error } = await supabase.from('proveedores').insert({
    nombre,
    activo: true
  }).select().single()

  if (error) {
    console.error(`  Error creando "${nombre}":`, error.message)
  } else {
    console.log(`  ✅ Creado: ${nombre} (id=${nuevo.id})`)
    provPorNombre[nombre.toUpperCase().trim()] = nuevo
  }
}

// 3. Reconstruir mapa de nombre Excel → id en Supabase
const excelAId = {}
for (const [nombreExcel, nombreSupabase] of Object.entries(MAPEO)) {
  const key = (nombreSupabase || nombreExcel).toUpperCase().trim()
  const prov = provPorNombre[key]
  if (prov) {
    excelAId[nombreExcel.toUpperCase().trim()] = prov.id
  } else {
    console.warn(`  ⚠️  Sin mapping para "${nombreExcel}"`)
  }
}

// 4. Leer COSTOS 2.xlsx y actualizar proveedor_id de cada producto
import { readFileSync } from 'fs'
import XLSX from 'xlsx'

const wb = XLSX.readFile('/home/pablo/Escritorio/COSTOS 2.xlsx')
const ws = wb.Sheets[wb.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 })

let actualizados = 0, sinCambio = 0, errores = 0

for (let i = 3; i < rows.length; i++) {
  const r = rows[i]
  const cod = r[0]
  const provNombre = r[6] ? String(r[6]).trim() : ''
  if (cod === '' || isNaN(Number(cod)) || Number(cod) <= 0) continue
  if (!provNombre) continue

  const codigo = String(Number(cod))
  const provId = excelAId[provNombre.toUpperCase().trim()]
  if (!provId) {
    console.warn(`  ⚠️  Sin proveedor para cod ${codigo}: "${provNombre}"`)
    continue
  }

  // Check current proveedor_id
  const { data: prod } = await supabase
    .from('productos')
    .select('id, proveedor_id')
    .eq('codigo', codigo)
    .maybeSingle()

  if (!prod) continue

  if (prod.proveedor_id === provId) {
    sinCambio++
  } else {
    const { error: errUpd } = await supabase
      .from('productos')
      .update({ proveedor_id: provId })
      .eq('id', prod.id)

    if (errUpd) {
      errores++
      console.error(`  ❌ Error actualizando cod ${codigo}: ${errUpd.message}`)
    } else {
      actualizados++
    }
  }
}

console.log(`\nProductos actualizados: ${actualizados}`)
console.log(`Sin cambio: ${sinCambio}`)
console.log(`Errores: ${errores}`)
console.log('✅ FIN')
