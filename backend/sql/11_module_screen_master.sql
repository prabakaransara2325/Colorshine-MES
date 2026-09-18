-- ============================================================================
-- COLORSHINE MES V2
-- 11_module_screen_master.sql
--
-- Purpose:
--   Database-driven module and screen register.
--   Screen numbers are no longer intended to remain hard-coded in frontend.
--
-- Design:
--   app_module = permanent module master
--   app_screen = permanent screen technical identity + proposed/final screen no
--
-- IMPORTANT:
--   Authorization must reference screen_id / screen_code, NOT screen_no.
--   This allows screen numbers to be changed before final release without
--   breaking access permissions.
-- ============================================================================

SET search_path TO mes, public;
BEGIN;

INSERT INTO mes.schema_version(version_no, description)
VALUES ('1.3.0', 'Module master and database-driven screen register')
ON CONFLICT (version_no) DO NOTHING;

CREATE TABLE IF NOT EXISTS mes.app_module (
    module_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    module_no              smallint NOT NULL UNIQUE,
    module_code            varchar(10) NOT NULL UNIQUE,
    module_name            varchar(80) NOT NULL,
    description            varchar(300),
    route_path             varchar(200),
    is_business_module     boolean NOT NULL DEFAULT true,
    is_admin_module        boolean NOT NULL DEFAULT false,
    sequence_no            integer NOT NULL DEFAULT 0,
    is_active              boolean NOT NULL DEFAULT true,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mes.app_screen (
    screen_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id              uuid NOT NULL REFERENCES mes.app_module(module_id),
    screen_code            varchar(80) NOT NULL UNIQUE,
    screen_no              varchar(4),
    proposed_screen_no     varchar(4),
    screen_name            varchar(140) NOT NULL,
    screen_type            varchar(30) NOT NULL,
    description            varchar(500),
    route_path             varchar(220),
    phase                  varchar(30),
    implementation_status  varchar(30) NOT NULL DEFAULT 'PLANNED',
    screen_status          varchar(20) NOT NULL DEFAULT 'DRAFT',
    direct_call_enabled    boolean NOT NULL DEFAULT true,
    is_authorizable        boolean NOT NULL DEFAULT true,
    sequence_no            integer NOT NULL DEFAULT 0,
    is_active              boolean NOT NULL DEFAULT true,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_app_screen_no_format
      CHECK (screen_no IS NULL OR screen_no ~ '^[0-9]{4}$'),
    CONSTRAINT ck_app_screen_proposed_no_format
      CHECK (proposed_screen_no IS NULL OR proposed_screen_no ~ '^[0-9]{4}$'),
    CONSTRAINT ck_app_screen_status
      CHECK (screen_status IN ('DRAFT','ACTIVE','INACTIVE','RETIRED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_app_screen_screen_no
    ON mes.app_screen(screen_no)
    WHERE screen_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_app_screen_module
    ON mes.app_screen(module_id, sequence_no, screen_name);

CREATE INDEX IF NOT EXISTS ix_app_screen_status
    ON mes.app_screen(screen_status, is_active);

CREATE OR REPLACE FUNCTION mes.normalize_module_screen_codes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_TABLE_NAME = 'app_module' THEN
        NEW.module_code := upper(trim(NEW.module_code));
    ELSE
        NEW.screen_code := upper(trim(NEW.screen_code));
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_app_module ON mes.app_module;
CREATE TRIGGER trg_normalize_app_module
BEFORE INSERT OR UPDATE ON mes.app_module
FOR EACH ROW EXECUTE FUNCTION mes.normalize_module_screen_codes();

DROP TRIGGER IF EXISTS trg_normalize_app_screen ON mes.app_screen;
CREATE TRIGGER trg_normalize_app_screen
BEFORE INSERT OR UPDATE ON mes.app_screen
FOR EACH ROW EXECUTE FUNCTION mes.normalize_module_screen_codes();

INSERT INTO mes.app_module
(module_no,module_code,module_name,description,route_path,is_business_module,is_admin_module,sequence_no,is_active)
VALUES
(0,'MES','Common / MES','Common MES screens and enterprise overview','/',false,false,0,true),
(1,'RMS','RM Stores','Raw-material receipt, traceability and inventory','/modules/rm-stores',true,false,10,true),
(2,'PLN','Planning','Order planning, capacity and production scheduling','/modules/planning',true,false,20,true),
(3,'PRD','Production','Production execution, confirmations and genealogy','/modules/production',true,false,30,true),
(4,'QLT','Quality','RM, in-process and finished-goods quality','/modules/quality',true,false,40,true),
(5,'MNT','Maintenance','Equipment availability, PM and breakdown control','/modules/maintenance',true,false,50,true),
(6,'RPT','Reports','Operational, quality and management reporting','/modules/reports',true,false,60,true),
(9,'ADM','Administration','Users, authorization and application masters','/admin',false,true,90,true)
ON CONFLICT (module_code) DO UPDATE SET
 module_no=EXCLUDED.module_no,
 module_name=EXCLUDED.module_name,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 is_business_module=EXCLUDED.is_business_module,
 is_admin_module=EXCLUDED.is_admin_module,
 sequence_no=EXCLUDED.sequence_no,
 is_active=EXCLUDED.is_active,
 updated_at=now();

-- Draft screen catalogue.
-- Existing built screens keep their CURRENT number active until the user approves
-- the final screen register. Planned screens are inserted with screen_no = NULL
-- and proposed_screen_no populated.

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MES_OVERVIEW','0001','0001','MES Overview','DASHBOARD','Enterprise overview','/','Phase 1','BUILT','ACTIVE',true,true,1,true
FROM mes.app_module m WHERE m.module_code='MES'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MES_MY_TASKS',NULL,'0002','My Tasks / Inbox','WORKLIST',NULL,'/my-tasks','Future','PLANNED','DRAFT',true,true,2,true
FROM mes.app_module m WHERE m.module_code='MES'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MES_NOTIFICATIONS',NULL,'0003','Notifications','WORKLIST',NULL,'/notifications','Future','PLANNED','DRAFT',true,true,3,true
FROM mes.app_module m WHERE m.module_code='MES'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RMS_DASHBOARD','1000','1000','RM Stores Dashboard','DASHBOARD',NULL,'/modules/rm-stores','Phase 1','BUILT','ACTIVE',true,true,4,true
FROM mes.app_module m WHERE m.module_code='RMS'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RMS_GRN_MONITOR','1101','1101','GRN Monitor','TRANSACTION',NULL,'/grn','Phase 1','BUILT','ACTIVE',true,true,5,true
FROM mes.app_module m WHERE m.module_code='RMS'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RMS_RM_INVENTORY','1102','1102','RM Inventory','TRANSACTION',NULL,'/inventory','Phase 1','BUILT','ACTIVE',true,true,6,true
FROM mes.app_module m WHERE m.module_code='RMS'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RMS_GRN_DETAIL',NULL,'1103','GRN / Coil Detail','DISPLAY',NULL,'/rm-stores/grn-detail','Phase 1','PLANNED','DRAFT',true,true,7,true
FROM mes.app_module m WHERE m.module_code='RMS'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RMS_BATCH_ANALYSIS',NULL,'1104','RM Batch Analysis','DISPLAY',NULL,'/rm-stores/batch-analysis','Phase 1','PLANNED','DRAFT',true,true,8,true
FROM mes.app_module m WHERE m.module_code='RMS'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RMS_SUPPLIER_TC',NULL,'1105','Supplier TC / Test Certificate','DISPLAY',NULL,'/rm-stores/supplier-tc','Phase 1','PLANNED','DRAFT',true,true,9,true
FROM mes.app_module m WHERE m.module_code='RMS'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RMS_STOCK_MOVEMENT',NULL,'1106','RM Stock Movement','TRANSACTION',NULL,'/rm-stores/stock-movement','Phase 2','PLANNED','DRAFT',true,true,10,true
FROM mes.app_module m WHERE m.module_code='RMS'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RMS_HOLD_BLOCK',NULL,'1107','Quality Hold / Blocked Stock','WORKLIST',NULL,'/rm-stores/hold-blocked','Phase 1','PLANNED','DRAFT',true,true,11,true
FROM mes.app_module m WHERE m.module_code='RMS'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RMS_RESERVATION',NULL,'1108','RM Reservation','TRANSACTION',NULL,'/rm-stores/reservation','Phase 2','PLANNED','DRAFT',true,true,12,true
FROM mes.app_module m WHERE m.module_code='RMS'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RMS_ISSUE_PRODUCTION',NULL,'1109','RM Issue to Production','TRANSACTION',NULL,'/rm-stores/issue-production','Phase 2','PLANNED','DRAFT',true,true,13,true
FROM mes.app_module m WHERE m.module_code='RMS'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RMS_RETURN_PRODUCTION',NULL,'1110','RM Return from Production','TRANSACTION',NULL,'/rm-stores/return-production','Future','PLANNED','DRAFT',true,true,14,true
FROM mes.app_module m WHERE m.module_code='RMS'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RMS_INTERPLANT_TRANSFER',NULL,'1111','Inter-Plant RM Transfer','TRANSACTION',NULL,'/rm-stores/interplant-transfer','Future','PLANNED','DRAFT',true,true,15,true
FROM mes.app_module m WHERE m.module_code='RMS'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RMS_STOCK_ADJUSTMENT',NULL,'1112','RM Stock Adjustment','TRANSACTION',NULL,'/rm-stores/stock-adjustment','Future','PLANNED','DRAFT',true,true,16,true
FROM mes.app_module m WHERE m.module_code='RMS'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RMS_AGEING',NULL,'1113','RM Ageing','DISPLAY',NULL,'/rm-stores/ageing','Phase 2','PLANNED','DRAFT',true,true,17,true
FROM mes.app_module m WHERE m.module_code='RMS'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RMS_PHYSICAL_STOCK',NULL,'1114','RM Physical Stock / Cycle Count','TRANSACTION',NULL,'/rm-stores/physical-stock','Future','PLANNED','DRAFT',true,true,18,true
FROM mes.app_module m WHERE m.module_code='RMS'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RMS_BATCH_LOOKUP',NULL,'1115','RM Barcode / QR Batch Lookup','DISPLAY',NULL,'/rm-stores/batch-lookup','Future','PLANNED','DRAFT',true,true,19,true
FROM mes.app_module m WHERE m.module_code='RMS'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_DASHBOARD','2000','2000','Planning Dashboard','DASHBOARD','Dashboard shell exists','/modules/planning','Phase 2','BUILT','ACTIVE',true,true,20,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_SO_MONITOR',NULL,'2101','Sales Order Monitor','WORKLIST',NULL,'/planning/sales-orders','Phase 2','PLANNED','DRAFT',true,true,21,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_SO_DETAIL',NULL,'2102','Sales Order Detail','DISPLAY',NULL,'/planning/sales-order-detail','Phase 2','PLANNED','DRAFT',true,true,22,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_PROCESS_PATH',NULL,'2103','Process Path / Routing','DISPLAY',NULL,'/planning/process-path','Phase 2','PLANNED','DRAFT',true,true,23,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_WEEKLY_SPLIT',NULL,'2104','Sales Order Weekly Split','TRANSACTION',NULL,'/planning/weekly-split','Phase 2','PLANNED','DRAFT',true,true,24,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_RM_REQUIREMENT',NULL,'2105','RM Requirement Planning','TRANSACTION',NULL,'/planning/rm-requirement','Phase 2','PLANNED','DRAFT',true,true,25,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_RM_ALLOCATION',NULL,'2106','RM Allocation','TRANSACTION',NULL,'/planning/rm-allocation','Phase 2','PLANNED','DRAFT',true,true,26,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_PRODUCTION_PLAN',NULL,'2107','Production Plan','TRANSACTION',NULL,'/planning/production-plan','Phase 2','PLANNED','DRAFT',true,true,27,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_PRODUCTION_SCHEDULE',NULL,'2108','Production Schedule','TRANSACTION',NULL,'/planning/schedule','Phase 2','PLANNED','DRAFT',true,true,28,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_WC_CAPACITY',NULL,'2109','Work Center Capacity','DISPLAY',NULL,'/planning/workcenter-capacity','Phase 2','PLANNED','DRAFT',true,true,29,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_CAPACITY_RESERVATION',NULL,'2110','Capacity Reservation','TRANSACTION',NULL,'/planning/capacity-reservation','Phase 2','PLANNED','DRAFT',true,true,30,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_CAMPAIGN',NULL,'2111','Campaign Planning','TRANSACTION',NULL,'/planning/campaign','Phase 2','PLANNED','DRAFT',true,true,31,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_DOWNTIME_IMPACT',NULL,'2112','Planned Downtime Impact','DISPLAY',NULL,'/planning/downtime-impact','Phase 2','PLANNED','DRAFT',true,true,32,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_ORDER_CREATE',NULL,'2113','Production Order Creation','TRANSACTION',NULL,'/planning/order-create','Phase 2','PLANNED','DRAFT',true,true,33,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_ORDER_RELEASE',NULL,'2114','Production Order Release','TRANSACTION',NULL,'/planning/order-release','Phase 2','PLANNED','DRAFT',true,true,34,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_RESCHEDULE',NULL,'2115','Order Reschedule / Priority','TRANSACTION',NULL,'/planning/reschedule','Phase 2','PLANNED','DRAFT',true,true,35,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_ORDER_PROMISE',NULL,'2116','Order Promising / Delivery Commitment','TRANSACTION',NULL,'/planning/order-promising','Future','PLANNED','DRAFT',true,true,36,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_RM_SHORTAGE',NULL,'2117','RM Shortage Monitor','WORKLIST',NULL,'/planning/rm-shortage','Phase 2','PLANNED','DRAFT',true,true,37,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_PLAN_CAPACITY',NULL,'2118','Plan vs Capacity','DISPLAY',NULL,'/planning/plan-capacity','Phase 2','PLANNED','DRAFT',true,true,38,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_DASHBOARD','3000','3000','Production Dashboard','DASHBOARD','Dashboard shell exists','/modules/production','Phase 2','BUILT','ACTIVE',true,true,39,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_ORDER_MONITOR',NULL,'3101','Production Order Monitor','WORKLIST',NULL,'/production/orders','Phase 2','PLANNED','DRAFT',true,true,40,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_WC_QUEUE',NULL,'3102','Work Center Queue','WORKLIST',NULL,'/production/workcenter-queue','Phase 2','PLANNED','DRAFT',true,true,41,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_OPERATION_EXEC',NULL,'3103','Operation Execution','TRANSACTION',NULL,'/production/operation','Phase 2','PLANNED','DRAFT',true,true,42,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_L2_PDI',NULL,'3104','L2 Schedule / PDI Monitor','WORKLIST',NULL,'/production/l2-pdi','Phase 2','PLANNED','DRAFT',true,true,43,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_L2_PDO',NULL,'3105','L2 Production / PDO Monitor','WORKLIST',NULL,'/production/l2-pdo','Phase 2','PLANNED','DRAFT',true,true,44,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_MANUAL_CONFIRM',NULL,'3106','Manual Production Confirmation','TRANSACTION',NULL,'/production/manual-confirmation','Phase 2','PLANNED','DRAFT',true,true,45,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_CONFIRM_HISTORY',NULL,'3107','Production Confirmation History','DISPLAY',NULL,'/production/confirmation-history','Phase 2','PLANNED','DRAFT',true,true,46,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_MATERIAL_CONSUMPTION',NULL,'3108','Material Consumption','TRANSACTION',NULL,'/production/material-consumption','Phase 2','PLANNED','DRAFT',true,true,47,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_OUTPUT_BATCH',NULL,'3109','Output Batch','TRANSACTION',NULL,'/production/output-batch','Phase 2','PLANNED','DRAFT',true,true,48,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_MATERIAL_BALANCE',NULL,'3110','Material Balance','TRANSACTION',NULL,'/production/material-balance','Phase 2','PLANNED','DRAFT',true,true,49,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_GENEALOGY',NULL,'3111','Batch Genealogy','DISPLAY',NULL,'/production/genealogy','Phase 2','PLANNED','DRAFT',true,true,50,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_SPLIT_CONSUMPTION',NULL,'3112','Split / Partial Consumption','TRANSACTION',NULL,'/production/split-consumption','Phase 2','PLANNED','DRAFT',true,true,51,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_SCRAP_ARISING',NULL,'3113','Scrap / Arising','TRANSACTION',NULL,'/production/scrap-arising','Phase 2','PLANNED','DRAFT',true,true,52,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_REWORK',NULL,'3114','Rework Execution','TRANSACTION',NULL,'/production/rework','Phase 2','PLANNED','DRAFT',true,true,53,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_PROCESS_PARAMETERS',NULL,'3115','Process Parameters','DISPLAY',NULL,'/production/process-parameters','Phase 2','PLANNED','DRAFT',true,true,54,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_DOWNTIME',NULL,'3116','Production Downtime','TRANSACTION',NULL,'/production/downtime','Phase 2','PLANNED','DRAFT',true,true,55,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_SHIFT_HANDOVER',NULL,'3117','Shift Handover','TRANSACTION',NULL,'/production/shift-handover','Future','PLANNED','DRAFT',true,true,56,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_SAP_CONFIRM_QUEUE',NULL,'3118','SAP Confirmation Queue','WORKLIST',NULL,'/production/sap-confirmation','Phase 2','PLANNED','DRAFT',true,true,57,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PRD_EXCEPTION',NULL,'3119','Production Exception Monitor','WORKLIST',NULL,'/production/exceptions','Phase 2','PLANNED','DRAFT',true,true,58,true
FROM mes.app_module m WHERE m.module_code='PRD'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_DASHBOARD','4000','4000','Quality Dashboard','DASHBOARD','Dashboard shell exists','/modules/quality','Phase 2','BUILT','ACTIVE',true,true,59,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_RM_UD','4101','4101','RM Usage Decision','TRANSACTION',NULL,'/quality','Phase 1','BUILT','ACTIVE',true,true,60,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_RM_INSPECTION',NULL,'4102','RM Inspection','TRANSACTION',NULL,'/quality/rm-inspection','Phase 1','PLANNED','DRAFT',true,true,61,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_RM_HOLD_RELEASE',NULL,'4103','RM Hold / Release','TRANSACTION',NULL,'/quality/rm-hold-release','Phase 2','PLANNED','DRAFT',true,true,62,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_RM_REINSPECTION',NULL,'4104','RM Reinspection','TRANSACTION',NULL,'/quality/rm-reinspection','Phase 2','PLANNED','DRAFT',true,true,63,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_TDC','4201','4201','TDC Management','TRANSACTION',NULL,'/tdc','Phase 1','BUILT','ACTIVE',true,true,64,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_TDC_REVISION',NULL,'4202','TDC Revision','TRANSACTION',NULL,'/quality/tdc-revision','Phase 1','PLANNED','DRAFT',true,true,65,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_TDC_APPROVAL',NULL,'4203','TDC Approval','APPROVAL',NULL,'/quality/tdc-approval','Phase 1','PLANNED','DRAFT',true,true,66,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_TDC_COMPARE',NULL,'4204','TDC Comparison','DISPLAY',NULL,'/quality/tdc-comparison','Phase 2','PLANNED','DRAFT',true,true,67,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_INPROCESS_INSPECTION',NULL,'4301','In-Process Inspection','TRANSACTION',NULL,'/quality/inprocess-inspection','Phase 2','PLANNED','DRAFT',true,true,68,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_INPROCESS_RESULTS',NULL,'4302','In-Process Quality Results','DISPLAY',NULL,'/quality/inprocess-results','Phase 2','PLANNED','DRAFT',true,true,69,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_FG_INSPECTION',NULL,'4303','Finished Goods Inspection','TRANSACTION',NULL,'/quality/fg-inspection','Phase 2','PLANNED','DRAFT',true,true,70,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_FG_UD',NULL,'4304','Finished Goods Usage Decision','TRANSACTION',NULL,'/quality/fg-ud','Phase 2','PLANNED','DRAFT',true,true,71,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_FG_HOLD_RELEASE',NULL,'4305','FG Hold / Release','TRANSACTION',NULL,'/quality/fg-hold-release','Phase 2','PLANNED','DRAFT',true,true,72,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_DEVIATION',NULL,'4306','Quality Deviation','TRANSACTION',NULL,'/quality/deviation','Phase 2','PLANNED','DRAFT',true,true,73,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_REWORK_REASSIGN',NULL,'4307','Rework / Reassignment','TRANSACTION',NULL,'/quality/rework-reassignment','Phase 2','PLANNED','DRAFT',true,true,74,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_LAB_RESULTS',NULL,'4308','Lab Result Entry','TRANSACTION',NULL,'/quality/lab-results','Phase 2','PLANNED','DRAFT',true,true,75,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_EXCEPTION',NULL,'4309','Quality Exception Monitor','WORKLIST',NULL,'/quality/exceptions','Phase 2','PLANNED','DRAFT',true,true,76,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'QLT_SPEC_COMPLIANCE',NULL,'4310','Customer Spec / TDC Compliance','DISPLAY',NULL,'/quality/spec-compliance','Phase 2','PLANNED','DRAFT',true,true,77,true
FROM mes.app_module m WHERE m.module_code='QLT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MNT_DASHBOARD','5000','5000','Maintenance Dashboard','DASHBOARD','Dashboard shell exists','/modules/maintenance','Phase 3','BUILT','ACTIVE',true,true,78,true
FROM mes.app_module m WHERE m.module_code='MNT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MNT_EQUIPMENT_MONITOR',NULL,'5101','Equipment / Work Center Monitor','WORKLIST',NULL,'/maintenance/equipment','Phase 3','PLANNED','DRAFT',true,true,79,true
FROM mes.app_module m WHERE m.module_code='MNT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MNT_PM_PLAN',NULL,'5102','Preventive Maintenance Plan','TRANSACTION',NULL,'/maintenance/pm-plan','Phase 3','PLANNED','DRAFT',true,true,80,true
FROM mes.app_module m WHERE m.module_code='MNT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MNT_PM_SCHEDULE',NULL,'5103','Preventive Maintenance Schedule','TRANSACTION',NULL,'/maintenance/pm-schedule','Phase 3','PLANNED','DRAFT',true,true,81,true
FROM mes.app_module m WHERE m.module_code='MNT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MNT_WORK_ORDER',NULL,'5104','Maintenance Work Order','TRANSACTION',NULL,'/maintenance/work-order','Phase 3','PLANNED','DRAFT',true,true,82,true
FROM mes.app_module m WHERE m.module_code='MNT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MNT_PM_CONFIRM',NULL,'5105','Maintenance Confirmation','TRANSACTION',NULL,'/maintenance/confirmation','Phase 3','PLANNED','DRAFT',true,true,83,true
FROM mes.app_module m WHERE m.module_code='MNT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MNT_BREAKDOWN_ENTRY',NULL,'5106','Breakdown Entry','TRANSACTION',NULL,'/maintenance/breakdown-entry','Phase 3','PLANNED','DRAFT',true,true,84,true
FROM mes.app_module m WHERE m.module_code='MNT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MNT_BREAKDOWN_MONITOR',NULL,'5107','Breakdown Monitor','WORKLIST',NULL,'/maintenance/breakdowns','Phase 3','PLANNED','DRAFT',true,true,85,true
FROM mes.app_module m WHERE m.module_code='MNT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MNT_DOWNTIME',NULL,'5108','Maintenance Downtime Entry','TRANSACTION',NULL,'/maintenance/downtime','Phase 3','PLANNED','DRAFT',true,true,86,true
FROM mes.app_module m WHERE m.module_code='MNT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MNT_DOWNTIME_CAUSE',NULL,'5109','Downtime Cause','TRANSACTION',NULL,'/maintenance/downtime-cause','Phase 3','PLANNED','DRAFT',true,true,87,true
FROM mes.app_module m WHERE m.module_code='MNT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MNT_AGENCY',NULL,'5110','Maintenance Agency Allocation','TRANSACTION',NULL,'/maintenance/agency','Phase 3','PLANNED','DRAFT',true,true,88,true
FROM mes.app_module m WHERE m.module_code='MNT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MNT_CALENDAR',NULL,'5111','Maintenance Calendar','DISPLAY',NULL,'/maintenance/calendar','Phase 3','PLANNED','DRAFT',true,true,89,true
FROM mes.app_module m WHERE m.module_code='MNT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MNT_AVAILABILITY',NULL,'5112','Equipment Availability','DISPLAY',NULL,'/maintenance/availability','Phase 3','PLANNED','DRAFT',true,true,90,true
FROM mes.app_module m WHERE m.module_code='MNT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MNT_MTBF_MTTR',NULL,'5113','MTBF / MTTR','DISPLAY',NULL,'/maintenance/mtbf-mttr','Phase 3','PLANNED','DRAFT',true,true,91,true
FROM mes.app_module m WHERE m.module_code='MNT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MNT_HISTORY',NULL,'5114','Maintenance History','DISPLAY',NULL,'/maintenance/history','Phase 3','PLANNED','DRAFT',true,true,92,true
FROM mes.app_module m WHERE m.module_code='MNT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_DASHBOARD','6000','6000','Reports Dashboard','DASHBOARD','Dashboard shell exists','/modules/reports','Phase 2','BUILT','ACTIVE',true,true,93,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_SUPPLIER','6101','6101','Supplier-wise RM Report','REPORT',NULL,'/suppliers','Phase 1','BUILT','ACTIVE',true,true,94,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_GRN',NULL,'6102','GRN Report','REPORT',NULL,'/reports/grn','Phase 1','PLANNED','DRAFT',true,true,95,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_RM_INVENTORY',NULL,'6103','RM Inventory Report','REPORT',NULL,'/reports/rm-inventory','Phase 1','PLANNED','DRAFT',true,true,96,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_RM_BATCH_ANALYSIS',NULL,'6104','RM Batch Analysis Report','REPORT',NULL,'/reports/rm-batch-analysis','Phase 1','PLANNED','DRAFT',true,true,97,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_SUPPLIER_QUALITY',NULL,'6105','Supplier Quality Performance','REPORT',NULL,'/reports/supplier-quality','Phase 1','PLANNED','DRAFT',true,true,98,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_RM_AGEING',NULL,'6106','RM Ageing Report','REPORT',NULL,'/reports/rm-ageing','Phase 2','PLANNED','DRAFT',true,true,99,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_RM_MOVEMENT',NULL,'6107','RM Stock Movement Report','REPORT',NULL,'/reports/rm-movement','Phase 2','PLANNED','DRAFT',true,true,100,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_RM_UD',NULL,'6108','RM Usage Decision Report','REPORT',NULL,'/reports/rm-ud','Phase 1','PLANNED','DRAFT',true,true,101,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_PLAN_ACTUAL',NULL,'6201','Planning vs Actual','REPORT',NULL,'/reports/plan-vs-actual','Phase 2','PLANNED','DRAFT',true,true,102,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_CAPACITY',NULL,'6202','Capacity Utilization','REPORT',NULL,'/reports/capacity','Phase 2','PLANNED','DRAFT',true,true,103,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_RM_SHORTAGE',NULL,'6203','RM Shortage Report','REPORT',NULL,'/reports/rm-shortage','Phase 2','PLANNED','DRAFT',true,true,104,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_PRODUCTION',NULL,'6301','Production Report','REPORT',NULL,'/reports/production','Phase 2','PLANNED','DRAFT',true,true,105,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_SHIFT_PRODUCTION',NULL,'6302','Shift Production Report','REPORT',NULL,'/reports/shift-production','Phase 2','PLANNED','DRAFT',true,true,106,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_PRODUCTION_YIELD',NULL,'6303','Production Yield Report','REPORT',NULL,'/reports/production-yield','Phase 2','PLANNED','DRAFT',true,true,107,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_WC_PERFORMANCE',NULL,'6304','Work Center Performance','REPORT',NULL,'/reports/workcenter-performance','Phase 2','PLANNED','DRAFT',true,true,108,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_MATERIAL_BALANCE',NULL,'6305','Material Balance Report','REPORT',NULL,'/reports/material-balance','Phase 2','PLANNED','DRAFT',true,true,109,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_GENEALOGY',NULL,'6306','Batch Genealogy Report','REPORT',NULL,'/reports/genealogy','Phase 2','PLANNED','DRAFT',true,true,110,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_L2_EXCEPTION',NULL,'6307','L2 Exception Report','REPORT',NULL,'/reports/l2-exceptions','Phase 2','PLANNED','DRAFT',true,true,111,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_QUALITY_YIELD',NULL,'6401','Quality Yield Report','REPORT',NULL,'/reports/quality-yield','Phase 2','PLANNED','DRAFT',true,true,112,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_REJECTION_REWORK',NULL,'6402','Rejection / Rework Report','REPORT',NULL,'/reports/rejection-rework','Phase 2','PLANNED','DRAFT',true,true,113,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_TDC_COMPLIANCE',NULL,'6403','TDC Compliance Report','REPORT',NULL,'/reports/tdc-compliance','Phase 2','PLANNED','DRAFT',true,true,114,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_QUALITY_DEVIATION',NULL,'6404','Quality Deviation Report','REPORT',NULL,'/reports/quality-deviation','Phase 2','PLANNED','DRAFT',true,true,115,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_DOWNTIME',NULL,'6501','Downtime Report','REPORT',NULL,'/reports/downtime','Phase 3','PLANNED','DRAFT',true,true,116,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_MAINT_KPI',NULL,'6502','Maintenance KPI Report','REPORT',NULL,'/reports/maintenance-kpi','Phase 3','PLANNED','DRAFT',true,true,117,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_OEE',NULL,'6503','OEE Report','REPORT',NULL,'/reports/oee','Phase 3','PLANNED','DRAFT',true,true,118,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_SO_PERFORMANCE',NULL,'6601','Sales Order Performance','REPORT',NULL,'/reports/so-performance','Phase 2','PLANNED','DRAFT',true,true,119,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_MANAGEMENT',NULL,'6602','Management Dashboard','DASHBOARD',NULL,'/reports/management','Phase 2','PLANNED','DRAFT',true,true,120,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_AUDIT',NULL,'6603','Audit Trail Report','REPORT',NULL,'/reports/audit','Phase 2','PLANNED','DRAFT',true,true,121,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_INTEGRATION_ERROR',NULL,'6604','Integration Error Report','REPORT',NULL,'/reports/integration-errors','Phase 2','PLANNED','DRAFT',true,true,122,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'RPT_EXPORT_CENTER',NULL,'6605','Report Export Center','REPORT',NULL,'/reports/export-center','Future','PLANNED','DRAFT',true,true,123,true
FROM mes.app_module m WHERE m.module_code='RPT'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_USERS','9001','9001','User Management','ADMIN',NULL,'/admin/users','Phase 1','BUILT','ACTIVE',true,true,124,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_ACCESS_GROUP',NULL,'9002','Access Group Management','ADMIN',NULL,'/admin/access-groups','Phase 1','PLANNED','DRAFT',true,true,125,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_AUTH_MATRIX',NULL,'9003','Authorization Matrix','ADMIN',NULL,'/admin/authorization','Phase 1','PLANNED','DRAFT',true,true,126,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_COMPANY',NULL,'9004','Company Master','MASTER',NULL,'/admin/company','Phase 1','PLANNED','DRAFT',true,true,127,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_PLANT',NULL,'9005','Plant Master','MASTER',NULL,'/admin/plant','Phase 1','PLANNED','DRAFT',true,true,128,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_SUPPLIER',NULL,'9006','Supplier Master','MASTER',NULL,'/admin/suppliers','Phase 1','PLANNED','DRAFT',true,true,129,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_MATERIAL',NULL,'9007','Material Master','MASTER',NULL,'/admin/materials','Phase 1','PLANNED','DRAFT',true,true,130,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_STORAGE_LOCATION',NULL,'9008','Storage Location Master','MASTER',NULL,'/admin/storage-locations','Phase 1','PLANNED','DRAFT',true,true,131,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_CUSTOMER',NULL,'9009','Customer Master','MASTER',NULL,'/admin/customers','Phase 1','PLANNED','DRAFT',true,true,132,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_BRAND',NULL,'9010','Brand Master','MASTER',NULL,'/admin/brands','Phase 1','PLANNED','DRAFT',true,true,133,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_QUALITY_PARAMETER',NULL,'9011','Quality Parameter Master','MASTER',NULL,'/admin/quality-parameters','Phase 1','PLANNED','DRAFT',true,true,134,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_WORKCENTER',NULL,'9012','Work Center Master','MASTER',NULL,'/admin/workcenters','Phase 2','PLANNED','DRAFT',true,true,135,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_SHIFT',NULL,'9013','Shift Master','MASTER',NULL,'/admin/shifts','Phase 2','PLANNED','DRAFT',true,true,136,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_UOM',NULL,'9014','UOM Master','MASTER',NULL,'/admin/uom','Phase 2','PLANNED','DRAFT',true,true,137,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_REASON_CODE',NULL,'9015','Reason Code Master','MASTER',NULL,'/admin/reason-codes','Phase 2','PLANNED','DRAFT',true,true,138,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_MODULE',NULL,'9016','Module Master','ADMIN',NULL,'/admin/modules','Phase 1','PLANNED','DRAFT',true,true,139,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_SCREEN_REGISTER',NULL,'9017','Screen Register','ADMIN',NULL,'/admin/screens','Phase 1','PLANNED','DRAFT',true,true,140,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_ACTION',NULL,'9018','Action Master','ADMIN',NULL,'/admin/actions','Phase 1','PLANNED','DRAFT',true,true,141,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_ROLE_TEMPLATE',NULL,'9019','Role Template','ADMIN',NULL,'/admin/roles','Phase 1','PLANNED','DRAFT',true,true,142,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_INTERFACE_CONFIG',NULL,'9020','Interface Configuration','ADMIN',NULL,'/admin/interfaces','Phase 2','PLANNED','DRAFT',true,true,143,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_MASTER_DATA_LEGACY','9002','9021','Master Data (Current Combined Screen)','MASTER','Current combined master screen; can be retired after split masters are built','/masters','Phase 1','BUILT','ACTIVE',true,true,144,true
FROM mes.app_module m WHERE m.module_code='ADM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 sequence_no=EXCLUDED.sequence_no,
 updated_at=now();


CREATE OR REPLACE VIEW mes.vw_screen_register AS
SELECT
    m.module_no,
    m.module_code,
    m.module_name,
    s.screen_id,
    s.screen_code,
    s.screen_no,
    s.proposed_screen_no,
    s.screen_name,
    s.screen_type,
    s.route_path,
    s.phase,
    s.implementation_status,
    s.screen_status,
    s.direct_call_enabled,
    s.is_authorizable,
    s.sequence_no,
    s.is_active
FROM mes.app_screen s
JOIN mes.app_module m ON m.module_id = s.module_id
ORDER BY m.sequence_no, s.sequence_no, s.screen_name;

CREATE OR REPLACE FUNCTION mes.screen_id_from_no(p_screen_no varchar)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT screen_id
    FROM mes.app_screen
    WHERE screen_no = p_screen_no
      AND is_active = true
      AND screen_status = 'ACTIVE'
      AND direct_call_enabled = true
    LIMIT 1;
$$;

COMMIT;

-- Verification
SELECT
    module_no,module_code,module_name,screen_no,proposed_screen_no,
    screen_code,screen_name,screen_type,implementation_status,screen_status
FROM mes.vw_screen_register
ORDER BY module_no, sequence_no;
