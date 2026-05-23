import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ewynsxiqohlnwbsemagb.supabase.co';
const supabaseAnonKey = 'sb_publishable_eI3nkVm2YkHQSZuCGVS29g_2YVVIBIx';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const EXCEL_PATH = '/home/pablo/Escritorio/COSTOS 2_2.xlsx';

async function main() {
  // 1. Leer Excel: armar mapa codigo → nombre_categoria
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets['Hoja1'];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  const codigoACategoria = new Map();
  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    const codigo = row[0];       // col A: CODIGO
    const categoria = row[4];    // col E: CATEGORIA
    if (codigo != null && categoria && String(categoria).trim()) {
      codigoACategoria.set(String(codigo).trim(), String(categoria).trim().toUpperCase());
    }
  }
  console.log(`Productos en Excel con categoría: ${codigoACategoria.size}`);

  // 2. Obtener mapa nombre_categoria → id desde Supabase
  const { data: cats, error: errCats } = await supabase.from('categorias').select('id, nombre');
  if (errCats) { console.error('Error leyendo categorías:', errCats); process.exit(1); }

  const nombreAId = new Map();
  for (const c of cats) {
    nombreAId.set(c.nombre.toUpperCase().trim(), c.id);
  }
  console.log(`Categorías en Supabase: ${nombreAId.size}`);

  // 3. Obtener todos los productos de Supabase (mapear codigo → id)
  const { data: prods, error: errProds } = await supabase
    .from('productos')
    .select('id, codigo, nombre, categoria_id');

  if (errProds) { console.error('Error leyendo productos:', errProds); process.exit(1); }

  const codigoAProducto = new Map();
  for (const p of prods) {
    if (p.codigo) codigoAProducto.set(String(p.codigo).trim(), p);
  }
  console.log(`Productos en Supabase: ${prods.length}`);

  // 4. Actualizar categoria_id donde haga falta
  let actualizados = 0;
  let sinMatch = 0;
  let sinCategoria = 0;

  for (const [codigo, catNombre] of codigoACategoria) {
    const producto = codigoAProducto.get(codigo);
    if (!producto) {
      sinMatch++;
      continue;
    }
    const catId = nombreAId.get(catNombre);
    if (!catId) {
      sinCategoria++;
      console.warn(`  ⚠ Categoría "${catNombre}" no encontrada en Supabase para código ${codigo}`);
      continue;
    }
    if (producto.categoria_id === catId) continue; // ya está correcta

    const { error: errUpd } = await supabase
      .from('productos')
      .update({ categoria_id: catId })
      .eq('id', producto.id);

    if (errUpd) {
      console.error(`  ✗ Error actualizando código ${codigo} (id=${producto.id}):`, errUpd.message);
    } else {
      console.log(`  ✓ ${producto.nombre} (código ${codigo}) → categoria_id=${catId} (${catNombre})`);
      actualizados++;
    }
  }

  console.log(`\n✅ Resumen:
    Productos actualizados: ${actualizados}
    Sin match en Supabase: ${sinMatch}
    Categoría no encontrada: ${sinCategoria}
  `);
}

main().catch(console.error);
