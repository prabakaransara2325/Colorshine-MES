-- ============================================================================
-- COLORSHINE MES V2
-- 20_reports_plant_stock.sql
-- Version: 1.9.2
--
-- Purpose:
--   Register the detailed Plant Stock Report under Reports module.
--   Screen 6109 - Plant Stock Report
--
-- Notes:
--   * RM Stores screen 1102 remains RM-only.
--   * Plant Stock Report is the consolidated RM/WIP/FG report.
--   * The underlying InventoryMaster_MES data is already loaded by SQL 19.
-- ============================================================================

SET search_path TO mes, public;
BEGIN;

INSERT INTO mes.schema_version(version_no, description)
VALUES ('1.9.2','RM-only Stores inventory and detailed Plant Stock Report')
ON CONFLICT (version_no) DO NOTHING;

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT
  m.module_id,
  'RPT_PLANT_STOCK',
  '6109',
  '6109',
  'Plant Stock Report',
  'REPORT',
  'Detailed plant stock across RM, WIP and FG with inventory, genealogy, quality and order-linkage fields',
  '/reports/plant-stock',
  'Phase 1',
  'BUILT',
  'ACTIVE',
  true,
  true,
  124,
  true
FROM mes.app_module m
WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
  module_id=EXCLUDED.module_id,
  screen_no=EXCLUDED.screen_no,
  proposed_screen_no=EXCLUDED.proposed_screen_no,
  screen_name=EXCLUDED.screen_name,
  screen_type=EXCLUDED.screen_type,
  description=EXCLUDED.description,
  route_path=EXCLUDED.route_path,
  phase=EXCLUDED.phase,
  implementation_status=EXCLUDED.implementation_status,
  screen_status=EXCLUDED.screen_status,
  direct_call_enabled=EXCLUDED.direct_call_enabled,
  is_authorizable=EXCLUDED.is_authorizable,
  sequence_no=EXCLUDED.sequence_no,
  is_active=EXCLUDED.is_active,
  updated_at=now();

COMMIT;

SELECT
  s.screen_no,
  s.screen_code,
  s.screen_name,
  s.route_path,
  s.screen_status,
  s.implementation_status
FROM mes.app_screen s
JOIN mes.app_module m ON m.module_id=s.module_id
WHERE m.module_code='RPT'
  AND s.screen_code='RPT_PLANT_STOCK';
