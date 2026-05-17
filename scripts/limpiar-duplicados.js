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

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY
if (!supabaseUrl || !supabaseKey) { console.error('Faltan variables de .env'); process.exit(1) }

const supabase = createClient(supabaseUrl, supabaseKey)

const { data: productos, error } = await supabase
  .from('productos')
  .select('id, codigo, nombre')
  .eq('activo', true)

if (error) { console.error('Error consultando productos:', error); process.exit(1) }

const aEliminar = productos.filter(p => /[^0-9]/.test(p.codigo))
console.log(`\n📊 Total productos en Supabase: ${productos.length}`)
console.log(`🔴 Productos con código no-numérico: ${aEliminar.length}\n`)

if (aEliminar.length === 0) {
  console.log('✅ No hay productos con código no-numérico. Saliendo.')
  process.exit(0)
}

aEliminar.slice(0, 10).forEach(p => console.log(`  ${p.codigo} - ${p.nombre}`))
console.log('')

console.log('⚠️  Presioná Ctrl+C para cancelar o Enter para continuar...')
await new Promise(resolve => process.stdin.once('data', resolve))

let ok = 0, fail = 0
for (const p of aEliminar) {
  try {
    await supabase.from('stock').delete().eq('producto_id', p.id)
    await supabase.from('movimientos_stock').delete().eq('producto_id', p.id)
    await supabase.from('venta_items').delete().eq('producto_id', p.id)
    const { error: errDel } = await supabase.from('productos').delete().eq('id', p.id)
    if (errDel) throw errDel
    ok++
  } catch (e) {
    fail++
    console.error(`\n❌ Error ${p.codigo}: ${e.message}`)
  }
  process.stdout.write(`\rProcesando: ${ok + fail}/${aEliminar.length} · OK: ${ok} · Fallos: ${fail}`)
}

console.log(`\n\n✅ Supabase: ${ok} eliminados, ${fail} fallos.`)
