-- ============================================================
-- SCRIPT: Limpiar duplicados + agregar UNIQUE(codigo) en productos
-- EJECUTAR EN: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Limpiar duplicados: fusionar stock, eliminar repetidos
DO $$
DECLARE
  rec RECORD;
  dup_ids INT[];
  keep_id INT;
BEGIN
  FOR rec IN (
    SELECT codigo, array_agg(id ORDER BY id) AS ids
    FROM productos
    WHERE codigo IS NOT NULL AND codigo != ''
    GROUP BY codigo
    HAVING COUNT(*) > 1
  ) LOOP
    keep_id := rec.ids[1];
    dup_ids := rec.ids[2:array_length(rec.ids, 1)];

    RAISE NOTICE 'Fusionando % duplicados de codigo % en producto %',
      array_length(dup_ids, 1), rec.codigo, keep_id;

    -- Sumar stock de duplicados al original
    UPDATE stock s
    SET cantidad = s.cantidad + COALESCE((
      SELECT SUM(s2.cantidad) FROM stock s2
      WHERE s2.producto_id = ANY(dup_ids) AND s2.local_id = s.local_id
    ), 0)
    WHERE s.producto_id = keep_id;

    -- Mover movimientos de stock a producto original
    UPDATE movimientos_stock SET producto_id = keep_id
    WHERE producto_id = ANY(dup_ids);

    -- Mover venta_items a producto original
    UPDATE venta_items SET producto_id = keep_id
    WHERE producto_id = ANY(dup_ids);

    -- Eliminar stock de duplicados
    DELETE FROM stock WHERE producto_id = ANY(dup_ids);

    -- Eliminar productos duplicados
    DELETE FROM productos WHERE id = ANY(dup_ids);
  END LOOP;
END $$;

-- 2. Agregar UNIQUE constraint (evita futuros duplicados)
ALTER TABLE productos ADD CONSTRAINT productos_codigo_key UNIQUE (codigo);
