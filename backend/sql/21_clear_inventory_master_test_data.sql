-- ============================================================================
-- COLORSHINE MES V2
-- 21_clear_inventory_master_test_data.sql
--
-- Purpose:
--   Remove ALL rows previously uploaded into mes.inventory_master so that the
--   corrected inventory file can be re-uploaded cleanly.
--
-- Scope:
--   ONLY mes.inventory_master / vw_inventory_master_report test snapshot.
--   This DOES NOT delete real RM GRN / RM quality / RM UD / inventory movement
--   transactional tables.
-- ============================================================================

SET search_path TO mes, public;

BEGIN;

-- Before delete
SELECT
    count(*) AS rows_before,
    COALESCE(round(sum(batch_qty_mt),3),0) AS qty_before_mt
FROM mes.inventory_master;

DELETE FROM mes.inventory_master;

-- After delete: expected rows_after = 0 and qty_after_mt = 0
SELECT
    count(*) AS rows_after,
    COALESCE(round(sum(batch_qty_mt),3),0) AS qty_after_mt
FROM mes.inventory_master;

COMMIT;

-- Final verification
SELECT
    plant_code,
    stock_stage,
    count(*) AS rows,
    COALESCE(round(sum(batch_qty_mt),3),0) AS qty_mt
FROM mes.inventory_master
GROUP BY plant_code, stock_stage
ORDER BY plant_code, stock_stage;
