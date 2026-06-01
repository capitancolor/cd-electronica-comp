#!/usr/bin/env python3
"""
Carga COMPLETA del stock desde COSTOS MAYO.xlsx a Supabase.
Limpia datos anteriores de stock y productos, y vuelca exactamente lo del Excel.

Uso:
    python3 scripts/cargar_stock_completo.py

Requisitos:
    pip install pandas openpyxl requests
"""

import pandas as pd
import requests
import os
import sys
import time
from datetime import datetime

EXCEL_PATH = '/home/pablo/Escritorio/COSTOS MAYO.xlsx'
SUPABASE_URL = 'https://ewynsxiqohlnwbsemagb.supabase.co'
SUPABASE_KEY = 'sb_publishable_eI3nkVm2YkHQSZuCGVS29g_2YVVIBIx'
COTIZACION = 1100

HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
}

def rest_get(table, params=None):
    h = {**HEADERS, 'Prefer': 'return=representation'}
    r = requests.get(f'{SUPABASE_URL}/rest/v1/{table}', headers=h, params=params or {})
    if r.status_code != 200:
        print(f'  ERROR GET {table}: {r.status_code} {r.text[:200]}')
        return None
    return r.json()

def rest_delete(table, filters=None):
    h = {**HEADERS, 'Prefer': 'return=minimal'}
    params = filters or {}
    r = requests.delete(f'{SUPABASE_URL}/rest/v1/{table}', headers=h, params=params)
    if r.status_code not in (200, 204):
        print(f'  ERROR DELETE {table}: {r.status_code} {r.text[:200]}')
        return False
    return True

def rest_upsert(table, data):
    h = {
        **HEADERS,
        'Prefer': 'resolution=merge-duplicates,return=representation',
    }
    if isinstance(data, list) and len(data) > 0:
        on_conflict = list(data[0].keys())[0]
    else:
        on_conflict = 'id'
    params = {'on_conflict': on_conflict}
    r = requests.post(f'{SUPABASE_URL}/rest/v1/{table}', headers=h, params=params, json=data)
    if r.status_code not in (200, 201):
        print(f'  ERROR UPSERT {table}: {r.status_code} {r.text[:300]}')
        return None
    return r.json()

def rest_insert(table, data):
    h = {**HEADERS, 'Prefer': 'return=representation'}
    r = requests.post(f'{SUPABASE_URL}/rest/v1/{table}', headers=h, json=data)
    if r.status_code not in (200, 201):
        print(f'  ERROR INSERT {table}: {r.status_code} {r.text[:300]}')
        return None
    return r.json()

def num(val):
    if val is None or val == '':
        return 0
    if isinstance(val, (int, float)):
        if pd.isna(val):
            return 0
        return val
    s = str(val).replace('$', '').replace(' ', '').strip()
    if not s:
        return 0
    try:
        return float(s.replace(',', '.'))
    except ValueError:
        return 0

def main():
    print('=' * 60)
    print('CARGA COMPLETA DE STOCK DESDE EXCEL A SUPABASE')
    print(f'Excel: {EXCEL_PATH}')
    print(f'Supabase: {SUPABASE_URL}')
    print('=' * 60)

    # ── 1. LEER EXCEL ──
    print('\n[1/6] Leyendo Excel...')
    df = pd.read_excel(EXCEL_PATH, header=None, skiprows=3)
    df = df.dropna(subset=[0])
    df = df[pd.to_numeric(df[0], errors='coerce') > 0]
    print(f'  {len(df)} productos con datos válidos')

    # ── 2. PREPARAR CATEGORÍAS Y PROVEEDORES ──
    print('\n[2/6] Sincronizando categorías y proveedores en Supabase...')

    categorias_excel = sorted(df[4].dropna().apply(lambda x: str(x).strip().upper()).unique())
    proveedores_excel = sorted(df[6].dropna().apply(lambda x: str(x).strip()).unique())

    existing_cats = rest_get('categorias', {'select': 'id,nombre'})
    existing_cats_map = {c['nombre'].upper().strip(): c['id'] for c in (existing_cats or [])}

    for cat in categorias_excel:
        if cat not in existing_cats_map:
            result = rest_insert('categorias', {'nombre': cat})
            if result and len(result) > 0:
                existing_cats_map[cat] = result[0]['id']
                print(f'  + Categoría creada: {cat} → id={result[0]["id"]}')
            else:
                print(f'  ERROR creando categoría: {cat}')

    existing_provs = rest_get('proveedores', {'select': 'id,nombre'})
    existing_provs_map = {p['nombre'].strip(): p['id'] for p in (existing_provs or [])}
    existing_provs_norm = {}
    for k, v in existing_provs_map.items():
        existing_provs_norm[k.upper()] = v

    for prov in proveedores_excel:
        key = prov.upper().strip()
        if key not in existing_provs_norm:
            result = rest_insert('proveedores', {'nombre': prov.strip(), 'activo': True})
            if result and len(result) > 0:
                existing_provs_norm[key] = result[0]['id']
                print(f'  + Proveedor creado: {prov} → id={result[0]["id"]}')
            else:
                print(f'  ERROR creando proveedor: {prov}')

    print(f'  Categorías: {len(categorias_excel)} | Proveedores: {len(proveedores_excel)}')

    # ── 3. LIMPIAR DATOS ANTERIORES ──
    print('\n[3/6] Limpiando datos anteriores en Supabase...')

    # Obtener IDs de productos actuales antes de borrar
    productos_actuales = rest_get('productos', {'select': 'id,codigo', 'activo': 'eq.true'})
    ids_actuales = [p['id'] for p in (productos_actuales or [])]
    print(f'  {len(ids_actuales)} productos activos encontrados')

    # Eliminar movimientos_stock
    rest_delete('movimientos_stock', {'id': 'gte.0'})
    print('  movimientos_stock → limpiado')

    # Eliminar stock (usa producto_id en vez de id porque no tiene columna id)
    rest_delete('stock', {'producto_id': 'gte.0'})
    print('  stock → limpiado')

    # ── 4. UPSERT PRODUCTOS ──
    print('\n[4/6] Cargando productos en Supabase...')

    codigos_nuevos = set()
    productos_data = []
    for _, row in df.iterrows():
        codigo = str(int(row[0]))
        codigos_nuevos.add(codigo)

        nombre = str(row[1]).strip() if pd.notna(row[1]) else ''
        if not nombre:
            continue

        marca = str(row[2]).strip() if pd.notna(row[2]) else ''
        modelo = str(row[3]).strip() if pd.notna(row[3]) else ''
        categoria_str = str(row[4]).strip().upper() if pd.notna(row[4]) else ''
        proveedor_str = str(row[6]).strip() if pd.notna(row[6]) else ''

        categoria_id = existing_cats_map.get(categoria_str)
        proveedor_id = existing_provs_norm.get(proveedor_str.upper().strip())

        precio_costo = num(row[5])
        precio_costo_usd = round(precio_costo / COTIZACION, 2) if COTIZACION > 0 else 0
        precio_venta = num(row[9])
        precio_promo = num(row[14])
        en_promo = precio_promo > 0

        prod = {
            'codigo': codigo,
            'nombre': nombre,
            'marca': marca or None,
            'modelo': modelo or None,
            'precio_costo': precio_costo,
            'precio_costo_usd': precio_costo_usd,
            'precio_venta': precio_venta,
            'precio_promo': precio_promo,
            'en_promo': en_promo,
            'categoria_id': categoria_id,
            'proveedor_id': proveedor_id,
            'activo': True,
        }
        productos_data.append(prod)

    print(f'  {len(productos_data)} productos para procesar')

    # Insertar en lotes de 50 para evitar timeouts
    BATCH = 50
    productos_creados = []
    for i in range(0, len(productos_data), BATCH):
        batch = productos_data[i:i + BATCH]
        result = rest_upsert('productos', batch)
        if result is not None:
            productos_creados.extend(result)
        sys.stdout.write(f'\r  Procesados: {min(i + BATCH, len(productos_data))}/{len(productos_data)}')
        sys.stdout.flush()
        time.sleep(0.1)
    print()

    # Mapa codigo → id de los productos insertados
    codigo_a_id = {}
    for p in productos_creados:
        if p.get('codigo'):
            codigo_a_id[str(p['codigo'])] = p['id']
    print(f'  {len(codigo_a_id)} productos insertados/actualizados en Supabase')

    # ── 5. CARGAR STOCK ──
    print('\n[5/6] Cargando stock en Supabase...')

    stock_data = []
    movimientos_data = []
    for _, row in df.iterrows():
        codigo = str(int(row[0]))
        prod_id = codigo_a_id.get(codigo)
        if not prod_id:
            continue

        cantidad_l1 = int(num(row[7]))
        cantidad_l2 = int(num(row[10]))

        if cantidad_l1 > 0:
            stock_data.append({
                'producto_id': prod_id,
                'local_id': 1,
                'cantidad': cantidad_l1,
            })
            movimientos_data.append({
                'producto_id': prod_id,
                'local_id': 1,
                'tipo': 'entrada',
                'cantidad': cantidad_l1,
                'referencia': 'Carga inicial L1 (Excel COSTOS MAYO)',
            })

        if cantidad_l2 > 0:
            stock_data.append({
                'producto_id': prod_id,
                'local_id': 2,
                'cantidad': cantidad_l2,
            })
            movimientos_data.append({
                'producto_id': prod_id,
                'local_id': 2,
                'tipo': 'entrada',
                'cantidad': cantidad_l2,
                'referencia': 'Carga inicial L2 (Excel COSTOS MAYO)',
            })

    # Stock en lotes (INSERT simple porque ya limpiamos todo)
    for i in range(0, len(stock_data), BATCH):
        batch = stock_data[i:i + BATCH]
        rest_insert('stock', batch)
        sys.stdout.write(f'\r  Stock: {min(i + BATCH, len(stock_data))}/{len(stock_data)} registros')
        sys.stdout.flush()
        time.sleep(0.1)
    print()

    # Movimientos en lotes
    for i in range(0, len(movimientos_data), BATCH):
        batch = movimientos_data[i:i + BATCH]
        rest_insert('movimientos_stock', batch)
        sys.stdout.write(f'\r  Movimientos: {min(i + BATCH, len(movimientos_data))}/{len(movimientos_data)} registros')
        sys.stdout.flush()
        time.sleep(0.1)
    print()

    # ── 6. DESACTIVAR PRODUCTOS QUE NO ESTÁN EN EL EXCEL ──
    print('\n[6/6] Desactivando productos que no están en el Excel...')

    desactivados = 0
    for p in (productos_actuales or []):
        if str(p.get('codigo', '')) not in codigos_nuevos:
            h = {**HEADERS, 'Prefer': 'return=minimal'}
            r = requests.patch(
                f'{SUPABASE_URL}/rest/v1/productos?id=eq.{p["id"]}',
                headers=h,
                json={'activo': False}
            )
            if r.status_code in (200, 204):
                desactivados += 1

    print(f'  {desactivados} productos desactivados (ya no están en el Excel)')

    # ── RESUMEN ──
    print('\n' + '=' * 60)
    print('✅ CARGA COMPLETADA EXITOSAMENTE')
    print(f'   Productos cargados: {len(productos_data)}')
    print(f'   Registros de stock: {len(stock_data)}')
    print(f'   Movimientos: {len(movimientos_data)}')
    print(f'   Productos desactivados: {desactivados}')
    print(f'   Categorías: {len(categorias_excel)}')
    print(f'   Proveedores: {len(proveedores_excel)}')
    print('=' * 60)

if __name__ == '__main__':
    main()
