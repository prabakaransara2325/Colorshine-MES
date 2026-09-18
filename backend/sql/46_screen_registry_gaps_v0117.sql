-- Colorshine MES v0.11.7 - fix screen registry gaps
-- Scope: Company 2000 / Plant 2000
--
-- mes.app_screen is the backend source of truth for Favorites and the
-- working-screen tab bar - frontend/src/navigation.ts alone is not enough.
-- RPT_PLANT_STOCK (6109 Plant Stock Report) was missing entirely, which is
-- why POST /api/user/working-screens always 404'd for it and the tab could
-- never actually persist - it silently dropped out whenever another tab's
-- "touch" request refreshed the list from the server. RMS_REVERSAL_REPORT
-- (1103) and RMS_GRN_QC_REVERSAL (1104), added earlier this release, had the
-- same gap (registered only in navigation.ts, never in this table).

INSERT INTO mes.app_screen(module_id,screen_code,screen_no,screen_name,screen_type,route_path,implementation_status,screen_status,sequence_no)
SELECT m.module_id,'RPT_PLANT_STOCK','6109','Plant Stock Report','REPORT','/reports/plant-stock','BUILT','ACTIVE',20
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT(screen_code) DO UPDATE SET
  screen_no=EXCLUDED.screen_no,screen_name=EXCLUDED.screen_name,screen_type=EXCLUDED.screen_type,
  route_path=EXCLUDED.route_path,implementation_status=EXCLUDED.implementation_status,screen_status=EXCLUDED.screen_status,
  updated_at=now();

INSERT INTO mes.app_screen(module_id,screen_code,screen_no,screen_name,screen_type,route_path,implementation_status,screen_status,sequence_no)
SELECT m.module_id,'RMS_REVERSAL_REPORT','1103','RM Reversal Report','REPORT','/rm-reversals','BUILT','ACTIVE',30
FROM mes.app_module m WHERE m.module_code='RMS'
ON CONFLICT(screen_code) DO UPDATE SET
  screen_no=EXCLUDED.screen_no,screen_name=EXCLUDED.screen_name,screen_type=EXCLUDED.screen_type,
  route_path=EXCLUDED.route_path,implementation_status=EXCLUDED.implementation_status,screen_status=EXCLUDED.screen_status,
  updated_at=now();

INSERT INTO mes.app_screen(module_id,screen_code,screen_no,screen_name,screen_type,route_path,implementation_status,screen_status,sequence_no)
SELECT m.module_id,'RMS_GRN_QC_REVERSAL','1104','GRN / QC Reversal','TRANSACTION','/rm-reversal-entry','BUILT','ACTIVE',40
FROM mes.app_module m WHERE m.module_code='RMS'
ON CONFLICT(screen_code) DO UPDATE SET
  screen_no=EXCLUDED.screen_no,screen_name=EXCLUDED.screen_name,screen_type=EXCLUDED.screen_type,
  route_path=EXCLUDED.route_path,implementation_status=EXCLUDED.implementation_status,screen_status=EXCLUDED.screen_status,
  updated_at=now();
