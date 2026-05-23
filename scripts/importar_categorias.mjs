import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL || 'https://ewynsxiqohlnwbsemagb.supabase.co';
const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || 'sb_publishable_eI3nkVm2YkHQSZuCGVS29g_2YVVIBIx';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const EXCEL_PATH = '/home/pablo/Escritorio/COSTOS 2_2.xlsx';

async function main() {
  // 1. Leer categorías del Excel
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets['Hoja1'];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  const categoriasExcel = new Set();
  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    const cat = row[4]; // columna E = índice 4
    if (cat && String(cat).trim()) {
      categoriasExcel.add(String(cat).trim().toUpperCase());
    }
  }

  console.log(`Categorías encontradas en Excel: ${categoriasExcel.size}`);
  for (const c of [...categoriasExcel].sort()) {
    console.log(`  - ${c}`);
  }

  // 2. Obtener categorías existentes en Supabase
  const { data: existentes, error } = await supabase
    .from('categorias')
    .select('nombre')
    .order('nombre');

  if (error) {
    console.error('Error al leer categorías de Supabase:', error);
    process.exit(1);
  }

  const nombresExistentes = new Set((existentes || []).map(c => c.nombre.toUpperCase().trim()));
  console.log(`\nCategorías existentes en Supabase: ${nombresExistentes.size}`);

  // 3. Insertar solo las faltantes
  const aInsertar = [...categoriasExcel]
    .filter(c => !nombresExistentes.has(c))
    .sort();

  if (aInsertar.length === 0) {
    console.log('\nNo hay categorías nuevas para insertar.');
    return;
  }

  console.log(`\nInsertando ${aInsertar.length} categorías nuevas:`);
  for (const nombre of aInsertar) {
    const { data, error: err } = await supabase
      .from('categorias')
      .insert({ nombre })
      .select()
      .single();

    if (err) {
      console.error(`  ✗ Error al insertar "${nombre}":`, err.message);
    } else {
      console.log(`  ✓ "${nombre}" → id=${data.id}`);
    }
  }

  console.log('\n✅ Importación completada.');
  console.log('Para sincronizar local, abre la app y navega a una pantalla que cargue categorías, o ejecuta sincronizarTablasMaestras().');
}

main().catch(console.error);
