BEGIN;

INSERT INTO mes.schema_version(version_no, description)
VALUES ('1.10.8', 'Simple active UI: hide undeveloped module/dashboard shells and retire legacy combined masters screen')
ON CONFLICT (version_no) DO NOTHING;

-- Keep modules with implemented business screens visible. Production and Maintenance
-- currently contain only dashboard shells, so they remain in the database history but
-- are hidden until a usable transaction screen is released.
UPDATE mes.app_module
   SET is_active = CASE WHEN module_code IN ('PRD','MNT') THEN false ELSE true END,
       route_path = CASE
         WHEN module_code='PLN' THEN '/planning/sales-orders'
         WHEN module_code='QLT' THEN '/quality'
         WHEN module_code='RPT' THEN '/suppliers'
         ELSE route_path END,
       updated_at = now()
 WHERE module_code IN ('RMS','PLN','PRD','QLT','MNT','RPT','MDM');

-- Reaffirm the screen register for every UI screen that is currently usable.
UPDATE mes.app_screen
   SET implementation_status='BUILT',
       screen_status='ACTIVE',
       direct_call_enabled=true,
       is_active=true,
       updated_at=now()
 WHERE screen_code IN (
   'MES_OVERVIEW',
   'RMS_DASHBOARD','RMS_GRN_MONITOR','RMS_RM_INVENTORY',
   'PLN_SAP_SO_MONITOR',
   'QLT_RM_UD','QLT_TDC',
   'RPT_SUPPLIER','RPT_PLANT_STOCK',
   'MDM_DASHBOARD','MDM_THICKNESS_MATRIX','MDM_WORK_CENTERS','MDM_WC_TOLERANCE',
   'MDM_GROUP_CODES','MDM_OPERATIONS','MDM_MATERIALS','MDM_ROUTES',
   'ADM_USERS','ADM_USER_MAINTENANCE'
 );

-- Placeholder dashboard shells are no longer exposed as live screens.
UPDATE mes.app_screen
   SET implementation_status='PLANNED',
       screen_status='DRAFT',
       direct_call_enabled=false,
       is_active=false,
       updated_at=now()
 WHERE screen_code IN ('PLN_DASHBOARD','PRD_DASHBOARD','QLT_DASHBOARD','MNT_DASHBOARD','RPT_DASHBOARD');

-- The old combined reference master screen has been superseded by Module 7 Masters.
UPDATE mes.app_screen
   SET implementation_status='RETIRED',
       screen_status='RETIRED',
       direct_call_enabled=false,
       is_active=false,
       updated_at=now()
 WHERE screen_code='ADM_MASTER_DATA_LEGACY';

-- Keep the new Masters landing screen name aligned with the UI.
UPDATE mes.app_screen
   SET screen_name='Masters Control Center',
       description='Live control center for active manufacturing master data',
       implementation_status='BUILT',
       screen_status='ACTIVE',
       is_active=true,
       direct_call_enabled=true,
       updated_at=now()
 WHERE screen_code='MDM_DASHBOARD';

-- Clean user quick-access rows that point to screens deliberately hidden above.
DO $$
BEGIN
  IF to_regclass('mes.app_user_favorite_screen') IS NOT NULL THEN
    DELETE FROM mes.app_user_favorite_screen f
    USING mes.app_screen s
    WHERE f.screen_id=s.screen_id
      AND s.screen_code IN ('PLN_DASHBOARD','PRD_DASHBOARD','QLT_DASHBOARD','MNT_DASHBOARD','RPT_DASHBOARD','ADM_MASTER_DATA_LEGACY');
  END IF;

  IF to_regclass('mes.app_user_working_screen') IS NOT NULL THEN
    DELETE FROM mes.app_user_working_screen ws
    USING mes.app_screen s
    WHERE ws.screen_id=s.screen_id
      AND s.screen_code IN ('PLN_DASHBOARD','PRD_DASHBOARD','QLT_DASHBOARD','MNT_DASHBOARD','RPT_DASHBOARD','ADM_MASTER_DATA_LEGACY');
  END IF;
END $$;

COMMIT;
