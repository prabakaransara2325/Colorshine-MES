-- ============================================================================
-- COLORSHINE MES V2 v0.10.4
-- MASTER CREATION FROM "Masters Creation(1).xlsx"
-- ============================================================================
-- Source sheets: Route, Material Master, ThicknessMatrix, WorkCenters,
--                Sales Order Types
--
-- IMPORTANT DATA RULE CONFIRMED BY BUSINESS
--   Finished/GL Thickness Min = Target - 0.005 mm
--   Finished/GL Thickness Max = Target + 0.005 mm
--   CR Thickness Min          = Target - 0.005 mm
--   CR Thickness Max          = Target + 0.005 mm
--
-- 0.005 mm is used. 0.050 mm is NOT used.
--
-- The tolerance is stored as master data and min/max are derived by trigger,
-- so application code does not hardcode manual min/max values.
--
-- Data quality handling:
--   * No exact duplicate master rows were found.
--   * 6 repeated finished-thickness keys have different CR/HR process values;
--     they are retained as numbered variants, not deleted as false duplicates.
--   * Thickness UUID 10077 and 10078 have invalid source HR ranges and are
--     loaded REVIEW + inactive.
--   * Route GLAZ150CF/S2 has 4 work centers but only 4 material nodes; it is
--     loaded REVIEW + inactive and no route steps are created.
--   * Work-center capacity values are NOT in the workbook, so none are invented.
-- ============================================================================
SET search_path TO mes, public;
BEGIN;


-- 1. Company / Plant foundation
INSERT INTO mes.company_master(company_code,company_name,short_name,is_active)
VALUES
('1000','COLORSHINE COATED PRIVATE LIMITED','CCPL',true),
('2000','COLORSHINE INDIA PRIVATE LIMITED','CIPL',true)
ON CONFLICT (company_code) DO UPDATE SET
 company_name=EXCLUDED.company_name,short_name=EXCLUDED.short_name,is_active=true,updated_at=now();

INSERT INTO mes.plant_master(plant_code,company_code,plant_name,timezone_name,is_active,source_system)
VALUES
('1000','1000','CCPL PLANT 1000','Asia/Kolkata',true,'MES'),
('2000','2000','CIPL PLANT 2000','Asia/Kolkata',true,'MES')
ON CONFLICT (plant_code) DO UPDATE SET
 company_code=EXCLUDED.company_code,plant_name=EXCLUDED.plant_name,timezone_name=EXCLUDED.timezone_name,
 is_active=true,source_system='MES',updated_at=now();


-- 2. Thickness matrix safety: configurable tolerance, derived min/max, variants
ALTER TABLE mes.planning_thickness_matrix
  ADD COLUMN IF NOT EXISTS matrix_variant_no integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS finished_tolerance_mm numeric(10,4) NOT NULL DEFAULT 0.005,
  ADD COLUMN IF NOT EXISTS cr_tolerance_mm numeric(10,4) NOT NULL DEFAULT 0.005,
  ADD COLUMN IF NOT EXISTS source_file varchar(160);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='ck_pln_thk_finished_tol_positive'
       AND conrelid='mes.planning_thickness_matrix'::regclass
  ) THEN
    ALTER TABLE mes.planning_thickness_matrix
      ADD CONSTRAINT ck_pln_thk_finished_tol_positive CHECK (finished_tolerance_mm > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='ck_pln_thk_cr_tol_positive'
       AND conrelid='mes.planning_thickness_matrix'::regclass
  ) THEN
    ALTER TABLE mes.planning_thickness_matrix
      ADD CONSTRAINT ck_pln_thk_cr_tol_positive CHECK (cr_tolerance_mm > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='ck_pln_thk_hr_valid_when_active'
       AND conrelid='mes.planning_thickness_matrix'::regclass
  ) THEN
    ALTER TABLE mes.planning_thickness_matrix
      ADD CONSTRAINT ck_pln_thk_hr_valid_when_active
      CHECK (
        NOT (is_active AND validation_status='VALID')
        OR hr_thk_target_mm IS NULL OR hr_thk_min_mm IS NULL OR hr_thk_max_mm IS NULL
        OR (hr_thk_min_mm <= hr_thk_target_mm AND hr_thk_target_mm <= hr_thk_max_mm)
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION mes.derive_thickness_matrix_minmax()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.finished_thk_target_mm IS NOT NULL THEN
    NEW.finished_thk_min_mm := round(NEW.finished_thk_target_mm - NEW.finished_tolerance_mm,4);
    NEW.finished_thk_max_mm := round(NEW.finished_thk_target_mm + NEW.finished_tolerance_mm,4);
  ELSE
    NEW.finished_thk_min_mm := NULL;
    NEW.finished_thk_max_mm := NULL;
  END IF;

  IF NEW.cr_thk_target_mm IS NOT NULL THEN
    NEW.cr_thk_min_mm := round(NEW.cr_thk_target_mm - NEW.cr_tolerance_mm,4);
    NEW.cr_thk_max_mm := round(NEW.cr_thk_target_mm + NEW.cr_tolerance_mm,4);
  ELSE
    NEW.cr_thk_min_mm := NULL;
    NEW.cr_thk_max_mm := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_derive_thickness_matrix_minmax ON mes.planning_thickness_matrix;
CREATE TRIGGER trg_derive_thickness_matrix_minmax
BEFORE INSERT OR UPDATE OF finished_thk_target_mm,finished_tolerance_mm,cr_thk_target_mm,cr_tolerance_mm
ON mes.planning_thickness_matrix
FOR EACH ROW EXECUTE FUNCTION mes.derive_thickness_matrix_minmax();

CREATE UNIQUE INDEX IF NOT EXISTS ux_pln_thk_variant
ON mes.planning_thickness_matrix
(plant_code,material_code,coating_gsm,finished_thk_target_mm,matrix_variant_no)
WHERE material_code IS NOT NULL AND finished_thk_target_mm IS NOT NULL;


-- 3. Route Master: normalized route header + operation/material steps
CREATE TABLE IF NOT EXISTS mes.route_master (
    route_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_code             varchar(4) NOT NULL REFERENCES mes.company_master(company_code),
    plant_code               varchar(4) NOT NULL REFERENCES mes.plant_master(plant_code),
    finished_material_code   varchar(60) NOT NULL REFERENCES mes.material_master(sap_material_code),
    route_indicator          varchar(20) NOT NULL,
    process_path             varchar(1000) NOT NULL,
    material_tree            varchar(2000) NOT NULL,
    validation_status        varchar(20) NOT NULL DEFAULT 'REVIEW',
    validation_notes         varchar(1000),
    is_active                boolean NOT NULL DEFAULT false,
    source_file              varchar(160),
    source_row_no            integer,
    created_by_user_id       uuid REFERENCES mes.app_user(user_id),
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_route_business_key UNIQUE(company_code,plant_code,finished_material_code,route_indicator),
    CONSTRAINT ck_route_status CHECK (validation_status IN ('VALID','REVIEW','REJECTED'))
);

CREATE TABLE IF NOT EXISTS mes.route_step (
    route_step_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id                 uuid NOT NULL REFERENCES mes.route_master(route_id) ON DELETE CASCADE,
    step_no                  integer NOT NULL,
    work_center_id           uuid NOT NULL REFERENCES mes.work_center_master(work_center_id),
    operation_id             uuid REFERENCES mes.operation_master(operation_id),
    input_material_code      varchar(60) NOT NULL REFERENCES mes.material_master(sap_material_code),
    output_material_code     varchar(60) NOT NULL REFERENCES mes.material_master(sap_material_code),
    is_active                boolean NOT NULL DEFAULT true,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_route_step UNIQUE(route_id,step_no)
);

CREATE INDEX IF NOT EXISTS ix_route_lookup
ON mes.route_master(plant_code,finished_material_code,route_indicator,validation_status,is_active);
CREATE INDEX IF NOT EXISTS ix_route_step_route
ON mes.route_step(route_id,step_no);

CREATE OR REPLACE VIEW mes.vw_route_master AS
SELECT r.*,
       c.short_name AS company_short_name,
       p.plant_name,
       m.material_description AS finished_material_description,
       count(s.route_step_id) FILTER (WHERE s.is_active)::int AS active_steps
FROM mes.route_master r
JOIN mes.company_master c ON c.company_code=r.company_code
JOIN mes.plant_master p ON p.plant_code=r.plant_code
JOIN mes.material_master m ON m.sap_material_code=r.finished_material_code
LEFT JOIN mes.route_step s ON s.route_id=r.route_id
GROUP BY r.route_id,c.short_name,p.plant_name,m.material_description;

CREATE OR REPLACE VIEW mes.vw_route_step AS
SELECT s.route_step_id,s.route_id,s.step_no,
       r.company_code,r.plant_code,r.finished_material_code,r.route_indicator,
       w.work_center_code,w.work_center_name,
       o.operation_code,o.operation_name,
       s.input_material_code,s.output_material_code,s.is_active
FROM mes.route_step s
JOIN mes.route_master r ON r.route_id=s.route_id
JOIN mes.work_center_master w ON w.work_center_id=s.work_center_id
LEFT JOIN mes.operation_master o ON o.operation_id=s.operation_id;


-- 4. Register Material Master 7106 and Route Master 7107
INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MDM_MATERIALS','7106','7106','Material Master','MASTER',
       'MES material master created from approved master workbook',
       '/masters/materials','Phase 1','BUILT','ACTIVE',true,true,7106,true
FROM mes.app_module m WHERE m.module_code='MDM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,screen_no=EXCLUDED.screen_no,proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,screen_type=EXCLUDED.screen_type,description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,phase=EXCLUDED.phase,implementation_status=EXCLUDED.implementation_status,
 screen_status=EXCLUDED.screen_status,direct_call_enabled=EXCLUDED.direct_call_enabled,
 is_authorizable=EXCLUDED.is_authorizable,sequence_no=EXCLUDED.sequence_no,is_active=true,updated_at=now();

INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MDM_ROUTES','7107','7107','Route Master','MASTER',
       'Finished-material route indicator, process path and normalized material-flow steps',
       '/masters/routes','Phase 1','BUILT','ACTIVE',true,true,7107,true
FROM mes.app_module m WHERE m.module_code='MDM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,screen_no=EXCLUDED.screen_no,proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,screen_type=EXCLUDED.screen_type,description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,phase=EXCLUDED.phase,implementation_status=EXCLUDED.implementation_status,
 screen_status=EXCLUDED.screen_status,direct_call_enabled=EXCLUDED.direct_call_enabled,
 is_authorizable=EXCLUDED.is_authorizable,sequence_no=EXCLUDED.sequence_no,is_active=true,updated_at=now();


-- 5. Material Master - 12 unique source rows
INSERT INTO mes.material_master
(sap_material_code,material_description,material_type,material_group,product_group,product_type,base_uom,material_category,is_batch_managed,is_active,source_system)
VALUES
('BGLAZ150CF','BGL AZ150 COIL','FG',NULL,'BGL',NULL,'MT','FINISHED_GOOD',true,true,'MES_XLSX'),
('BGLAZ70CF','BGL AZ70 COIL','FG',NULL,'BGL',NULL,'MT','FINISHED_GOOD',true,true,'MES_XLSX'),
('GLAZ150CF','GL AZ150 COIL','FG',NULL,'GL',NULL,'MT','FINISHED_GOOD',true,true,'MES_XLSX'),
('GLAZ70CF','GL AZ70 COIL','FG',NULL,'GL',NULL,'MT','FINISHED_GOOD',true,true,'MES_XLSX'),
('GLAZ70CFPR','GL AZ70 COIL PRATHAM','FG',NULL,'GL',NULL,'MT','FINISHED_GOOD',true,true,'MES_XLSX'),
('R_HR>3MM_CO','HR BLACK COIL','RM',NULL,'HR',NULL,'MT','RAW_MATERIAL',true,true,'MES_XLSX'),
('R_HR_CO','HR BLACK COIL','RM',NULL,'HR',NULL,'MT','RAW_MATERIAL',true,true,'MES_XLSX'),
('HRPOCW','HR PICKLED COIL WIP','WIP',NULL,'HRP',NULL,'MT','SEMI_FINISHED',true,true,'MES_XLSX'),
('HRTRCW','HR TRIMMED COIL WIP','WIP',NULL,'HR',NULL,'MT','SEMI_FINISHED',true,true,'MES_XLSX'),
('HRTPCW','HR TRIMMED PICKLED COIL WIP','WIP',NULL,'HRP',NULL,'MT','SEMI_FINISHED',true,true,'MES_XLSX'),
('CRFHCW','CR FULL HARD COIL','WIP',NULL,'CR',NULL,'MT','SEMI_FINISHED',true,true,'MES_XLSX'),
('CRFHTCW','CR FULL HARD TRIMMED COIL','WIP',NULL,'CR',NULL,'MT','SEMI_FINISHED',true,true,'MES_XLSX')
ON CONFLICT (sap_material_code) DO UPDATE SET
 material_description=EXCLUDED.material_description,
 material_type=EXCLUDED.material_type,
 material_group=EXCLUDED.material_group,
 product_group=EXCLUDED.product_group,
 product_type=EXCLUDED.product_type,
 base_uom=EXCLUDED.base_uom,
 material_category=EXCLUDED.material_category,
 is_batch_managed=EXCLUDED.is_batch_managed,
 is_active=true,
 source_system=EXCLUDED.source_system,
 updated_at=now();


-- 6. Work Centers - Company + Plant specific; capacity values intentionally blank
INSERT INTO mes.work_center_master
(company_code,plant_code,work_center_code,work_center_name,process_area,display_sequence,capacity_uom,is_active,source_system)
VALUES
('2000','2000','HRS01','HR Slitting/Trimming Line','TRIMMING',10,'MT',true,'MES_XLSX'),
('2000','2000','HRS02','HR Slitting/Trimming Line','SLITTING',20,'MT',true,'MES_XLSX'),
('2000','2000','PKL01','Pickling Line','PICKLING',30,'MT',true,'MES_XLSX'),
('2000','2000','CRM01','CR Mill','CRM',40,'MT',true,'MES_XLSX'),
('2000','2000','CRS01','CR Trimming Line','CR TRIMMING',50,'MT',true,'MES_XLSX'),
('2000','2000','CRS02','CR Trimming Line','REWINDING',60,'MT',true,'MES_XLSX'),
('2000','2000','CGL01','Continuous Galvalume Line','AZ COATING',70,'MT',true,'MES_XLSX'),
('1000','1000','CCL01','Colour Coating Line','COLOUR COATING',10,'MT',true,'MES_XLSX'),
('1000','1000','GPS01','GP Slitter','GPS',20,'MT',true,'MES_XLSX'),
('1000','1000','PFL01','Profile Line','PROFILE',30,'MT',true,'MES_XLSX'),
('1000','1000','PACK1','CCPL Packing','CCPL PACKING',40,'MT',true,'MES_XLSX'),
('2000','2000','PACK2','CIPL Packing','CIPL PACKING',80,'MT',true,'MES_XLSX')
ON CONFLICT (company_code,plant_code,work_center_code) DO UPDATE SET
 work_center_name=EXCLUDED.work_center_name,
 process_area=EXCLUDED.process_area,
 display_sequence=EXCLUDED.display_sequence,
 capacity_uom=EXCLUDED.capacity_uom,
 is_active=true,
 source_system=EXCLUDED.source_system,
 updated_at=now();


-- 7. Operations - source operation assignment per Work Center
WITH src(company_code,plant_code,work_center_code,operation_code,operation_name,sequence_no,planning_relevant,confirmation_required,quality_relevant,is_active) AS (
VALUES
('2000','2000','HRS01','10','Trimming',10,true,true,false,true),
('2000','2000','HRS02','20','Slitting',20,true,true,false,true),
('2000','2000','PKL01','10','Pickling',10,true,true,false,true),
('2000','2000','CRM01','10','CRM',10,true,true,false,true),
('2000','2000','CRS01','10','CR Trimming',10,true,true,false,true),
('2000','2000','CRS02','20','Rewinding',20,true,true,false,true),
('2000','2000','CGL01','10','AZ Coating',10,true,true,false,true),
('1000','1000','CCL01','10','Colour Coating',10,true,true,false,true),
('1000','1000','GPS01','10','GPS',10,true,true,false,true),
('1000','1000','PFL01','10','Profile',10,true,true,false,true),
('1000','1000','PACK1','10','CCPL Packing',10,true,true,false,true),
('2000','2000','PACK2','10','CIPL Packing',10,true,true,false,true)
)
INSERT INTO mes.operation_master
(company_code,plant_code,work_center_id,operation_code,operation_name,sequence_no,planning_relevant,confirmation_required,quality_relevant,is_active)
SELECT s.company_code,s.plant_code,w.work_center_id,s.operation_code,s.operation_name,s.sequence_no::integer,
       s.planning_relevant,s.confirmation_required,s.quality_relevant,s.is_active
FROM src s
JOIN mes.work_center_master w
  ON w.company_code=s.company_code AND w.plant_code=s.plant_code AND w.work_center_code=s.work_center_code
ON CONFLICT (work_center_id,operation_code) DO UPDATE SET
 operation_name=EXCLUDED.operation_name,
 sequence_no=EXCLUDED.sequence_no,
 planning_relevant=EXCLUDED.planning_relevant,
 confirmation_required=EXCLUDED.confirmation_required,
 quality_relevant=EXCLUDED.quality_relevant,
 is_active=true,
 updated_at=now();


-- 8. Thickness Matrix - 94 source rows
--    92 VALID + ACTIVE
--    2 REVIEW + INACTIVE (UUID 10077,10078 due invalid source HR range)
INSERT INTO mes.planning_thickness_matrix
(plant_code,source_uuid,source_row_no,material_code,product_group,coating_gsm,matrix_variant_no,
 finished_thk_target_mm,finished_tolerance_mm,finished_thk_min_mm,finished_thk_max_mm,
 cr_thk_target_mm,cr_tolerance_mm,cr_thk_min_mm,cr_thk_max_mm,
 hr_thk_target_mm,hr_thk_min_mm,hr_thk_max_mm,
 validation_status,validation_notes,is_active,source_file)
VALUES
('2000','10001',2,'GLAZ70CFPR','GL',70,1,0.25,0.005,0.245,0.255,0.23,0.005,0.225,0.235,2,1.6,2,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10002',3,'GLAZ70CFPR','GL',70,1,0.27,0.005,0.265,0.275,0.25,0.005,0.245,0.255,2,1.6,2,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10003',4,'GLAZ70CFPR','GL',70,1,0.29,0.005,0.285,0.295,0.27,0.005,0.265,0.275,2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10004',5,'GLAZ70CFPR','GL',70,1,0.3,0.005,0.295,0.305,0.28,0.005,0.275,0.285,2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10005',6,'GLAZ70CFPR','GL',70,1,0.32,0.005,0.315,0.325,0.3,0.005,0.295,0.305,2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10006',7,'GLAZ70CFPR','GL',70,1,0.35,0.005,0.345,0.355,0.33,0.005,0.325,0.335,2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10007',8,'GLAZ70CFPR','GL',70,1,0.37,0.005,0.365,0.375,0.35,0.005,0.345,0.355,2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10008',9,'GLAZ70CFPR','GL',70,1,0.4,0.005,0.395,0.405,0.38,0.005,0.375,0.385,2.2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10009',10,'GLAZ70CFPR','GL',70,1,0.42,0.005,0.415,0.425,0.395,0.005,0.39,0.4,2.2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10010',11,'GLAZ70CFPR','GL',70,1,0.44,0.005,0.435,0.445,0.42,0.005,0.415,0.425,2.2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10011',12,'GLAZ70CFPR','GL',70,1,0.47,0.005,0.465,0.475,0.45,0.005,0.445,0.455,2.5,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10012',13,'GLAZ70CFPR','GL',70,1,0.57,0.005,0.565,0.575,0.55,0.005,0.545,0.555,2.5,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10013',14,'GLAZ70CFPR','GL',70,1,0.67,0.005,0.665,0.675,0.65,0.005,0.645,0.655,2.5,2.2,3,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10014',15,'GLAZ70CFPR','GL',70,1,0.77,0.005,0.765,0.775,0.75,0.005,0.745,0.755,2.8,2.5,3.2,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10015',16,'GLAZ70CFPR','GL',70,1,0.87,0.005,0.865,0.875,0.85,0.005,0.845,0.855,2.8,2.8,3.2,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10016',17,'GLAZ70CFPR','GL',70,1,0.97,0.005,0.965,0.975,0.95,0.005,0.945,0.955,3,2.8,3.2,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10017',18,'GLAZ70CF','GL',70,1,0.25,0.005,0.245,0.255,0.23,0.005,0.225,0.235,2,1.6,2,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10018',19,'GLAZ70CF','GL',70,1,0.27,0.005,0.265,0.275,0.24,0.005,0.235,0.245,2,1.6,2,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10019',20,'GLAZ70CF','GL',70,1,0.29,0.005,0.285,0.295,0.27,0.005,0.265,0.275,2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10020',21,'GLAZ70CF','GL',70,1,0.3,0.005,0.295,0.305,0.28,0.005,0.275,0.285,2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10021',22,'GLAZ70CF','GL',70,1,0.31,0.005,0.305,0.315,0.29,0.005,0.285,0.295,2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10022',23,'GLAZ70CF','GL',70,1,0.35,0.005,0.345,0.355,0.33,0.005,0.325,0.335,2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10023',24,'GLAZ70CF','GL',70,1,0.37,0.005,0.365,0.375,0.35,0.005,0.345,0.355,2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10024',25,'GLAZ70CF','GL',70,1,0.4,0.005,0.395,0.405,0.38,0.005,0.375,0.385,2.2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10025',26,'GLAZ70CF','GL',70,1,0.42,0.005,0.415,0.425,0.395,0.005,0.39,0.4,2.2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10026',27,'GLAZ70CF','GL',70,1,0.44,0.005,0.435,0.445,0.42,0.005,0.415,0.425,2.2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10027',28,'GLAZ70CF','GL',70,1,0.47,0.005,0.465,0.475,0.45,0.005,0.445,0.455,2.5,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10028',29,'GLAZ70CF','GL',70,1,0.57,0.005,0.565,0.575,0.55,0.005,0.545,0.555,2.5,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10029',30,'GLAZ70CF','GL',70,1,0.67,0.005,0.665,0.675,0.65,0.005,0.645,0.655,2.5,2.2,3,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10030',31,'GLAZ70CF','GL',70,1,0.77,0.005,0.765,0.775,0.75,0.005,0.745,0.755,2.8,2.5,3.2,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10031',32,'GLAZ70CF','GL',70,1,0.87,0.005,0.865,0.875,0.85,0.005,0.845,0.855,2.8,2.8,3.2,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10032',33,'GLAZ70CF','GL',70,1,0.97,0.005,0.965,0.975,0.95,0.005,0.945,0.955,3,2.8,3.2,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10033',34,'GLAZ150CF','GL',150,1,0.25,0.005,0.245,0.255,0.21,0.005,0.205,0.215,2,1.6,2,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10034',35,'GLAZ150CF','GL',150,1,0.27,0.005,0.265,0.275,0.23,0.005,0.225,0.235,2,1.6,2,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10035',36,'GLAZ150CF','GL',150,1,0.29,0.005,0.285,0.295,0.25,0.005,0.245,0.255,2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10036',37,'GLAZ150CF','GL',150,1,0.3,0.005,0.295,0.305,0.26,0.005,0.255,0.265,2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10037',38,'GLAZ150CF','GL',150,1,0.32,0.005,0.315,0.325,0.28,0.005,0.275,0.285,2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10038',39,'GLAZ150CF','GL',150,1,0.35,0.005,0.345,0.355,0.31,0.005,0.305,0.315,2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10039',40,'GLAZ150CF','GL',150,1,0.37,0.005,0.365,0.375,0.33,0.005,0.325,0.335,2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10040',41,'GLAZ150CF','GL',150,1,0.4,0.005,0.395,0.405,0.36,0.005,0.355,0.365,2.2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10041',42,'GLAZ150CF','GL',150,1,0.42,0.005,0.415,0.425,0.38,0.005,0.375,0.385,2.2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10042',43,'GLAZ150CF','GL',150,1,0.41,0.005,0.405,0.415,0.37,0.005,0.365,0.375,2.2,1.6,2.5,'VALID','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule.',true,'Masters Creation(1).xlsx'),
('2000','10043',44,'GLAZ150CF','GL',150,1,0.47,0.005,0.465,0.475,0.43,0.005,0.425,0.435,2.5,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10044',45,'GLAZ150CF','GL',150,1,0.57,0.005,0.565,0.575,0.53,0.005,0.525,0.535,2.5,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10045',46,'GLAZ150CF','GL',150,1,0.67,0.005,0.665,0.675,0.63,0.005,0.625,0.635,2.5,2.2,3,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10046',47,'GLAZ150CF','GL',150,1,0.77,0.005,0.765,0.775,0.73,0.005,0.725,0.735,2.8,2.5,3.2,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10047',48,'GLAZ150CF','GL',150,1,0.87,0.005,0.865,0.875,0.83,0.005,0.825,0.835,2.8,2.8,3.2,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10048',49,'GLAZ150CF','GL',150,1,0.97,0.005,0.965,0.975,0.93,0.005,0.925,0.935,3,2.8,3.2,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10049',50,'BGLAZ70CF','BGL',70,1,0.5,0.005,0.495,0.505,0.43,0.005,0.425,0.435,2.5,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10050',51,'BGLAZ70CF','BGL',70,1,0.47,0.005,0.465,0.475,0.4,0.005,0.395,0.405,2.5,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10051',52,'BGLAZ70CF','BGL',70,1,0.45,0.005,0.445,0.455,0.38,0.005,0.375,0.385,2.5,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10052',53,'BGLAZ70CF','BGL',70,1,0.43,0.005,0.425,0.435,0.36,0.005,0.355,0.365,2.2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10053',54,'BGLAZ70CF','BGL',70,1,0.4,0.005,0.395,0.405,0.33,0.005,0.325,0.335,2.2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10054',55,'BGLAZ70CF','BGL',70,1,0.38,0.005,0.375,0.385,0.32,0.005,0.315,0.325,2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10055',56,'BGLAZ70CF','BGL',70,1,0.35,0.005,0.345,0.355,0.29,0.005,0.285,0.295,2,1.6,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10056',57,'BGLAZ150CF','BGL',150,1,0.7,0.005,0.695,0.705,0.66,0.005,0.655,0.665,2.5,2.2,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10057',58,'BGLAZ150CF','BGL',150,1,0.9,0.005,0.895,0.905,0.855,0.005,0.85,0.86,2.8,2.5,2.8,'VALID','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule.',true,'Masters Creation(1).xlsx'),
('2000','10058',59,'BGLAZ70CF','BGL',70,1,0.7,0.005,0.695,0.705,0.665,0.005,0.66,0.67,2.5,2.2,2.8,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10059',60,'BGLAZ70CF','BGL',70,1,0.8,0.005,0.795,0.805,0.765,0.005,0.76,0.77,2.5,2.2,2.8,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10060',61,'BGLAZ70CF','BGL',70,1,0.9,0.005,0.895,0.905,0.865,0.005,0.86,0.87,2.8,2.5,3,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10061',62,'BGLAZ70CF','BGL',70,1,1,0.005,0.995,1.005,0.96,0.005,0.955,0.965,2.8,2.5,3,'VALID','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule.',true,'Masters Creation(1).xlsx'),
('2000','10062',63,'BGLAZ70CF','BGL',70,1,1.2,0.005,1.195,1.205,1.165,0.005,1.16,1.17,2.8,2.5,3,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10063',64,'GLAZ70CFPR','GL',70,1,0.45,0.005,0.445,0.455,0.43,0.005,0.425,0.435,2.5,2.2,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10064',65,'BGLAZ150CF','BGL',150,1,0.5,0.005,0.495,0.505,0.43,0.005,0.425,0.435,2.5,2.2,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10065',66,'BGLAZ150CF','BGL',150,1,1.2,0.005,1.195,1.205,1.155,0.005,1.15,1.16,3,2.8,3.2,'VALID','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule.',true,'Masters Creation(1).xlsx'),
('2000','10066',67,'BGLAZ150CF','BGL',150,1,1.4,0.005,1.395,1.405,1.355,0.005,1.35,1.36,4,3.5,4,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10067',68,'GLAZ70CF','GL',70,2,0.27,0.005,0.265,0.275,0.245,0.005,0.24,0.25,2,1.6,2.2,'VALID','Alternate matrix variant for same finished material/thickness; CR/HR process values differ.',true,'Masters Creation(1).xlsx'),
('2000','10068',69,'BGLAZ70CF','BGL',70,1,1.4,0.005,1.395,1.405,1.36,0.005,1.355,1.365,3.5,3.2,4,'VALID','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule.',true,'Masters Creation(1).xlsx'),
('2000','10069',70,'BGLAZ70CF','BGL',70,1,1.5,0.005,1.495,1.505,1.465,0.005,1.46,1.47,3.5,3.2,4,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10070',71,'BGLAZ70CF','BGL',70,1,1.6,0.005,1.595,1.605,1.565,0.005,1.56,1.57,3.5,3.2,4,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10071',72,'BGLAZ70CF','BGL',70,1,0.42,0.005,0.415,0.425,0.35,0.005,0.345,0.355,2.2,2,2.2,'VALID','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule.',true,'Masters Creation(1).xlsx'),
('2000','10072',73,'GLAZ150CF','GL',150,2,0.47,0.005,0.465,0.475,0.43,0.005,0.425,0.435,2.2,2,2.2,'VALID','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule. Alternate matrix variant for same finished material/thickness; CR/HR process values differ.',true,'Masters Creation(1).xlsx'),
('2000','10073',74,'BGLAZ70CF','BGL',70,1,1.35,0.005,1.345,1.355,1.31,0.005,1.305,1.315,3,2.8,3.6,'VALID','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule.',true,'Masters Creation(1).xlsx'),
('2000','10074',75,'GLAZ150CF','GL',150,2,0.57,0.005,0.565,0.575,0.53,0.005,0.525,0.535,2.5,2.2,2.8,'VALID','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule. Alternate matrix variant for same finished material/thickness; CR/HR process values differ.',true,'Masters Creation(1).xlsx'),
('2000','10075',76,'BGLAZ150CF','BGL',150,1,1,0.005,0.995,1.005,0.955,0.005,0.95,0.96,2.8,2.5,3.2,'VALID','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule.',true,'Masters Creation(1).xlsx'),
('2000','10076',77,'GLAZ150CF','GL',150,3,0.47,0.005,0.465,0.475,0.43,0.005,0.425,0.435,2.2,2,2.5,'VALID','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule. Alternate matrix variant for same finished material/thickness; CR/HR process values differ.',true,'Masters Creation(1).xlsx'),
('2000','10077',78,'GLAZ70CF','GL',70,1,0.45,0.005,0.445,0.455,0.435,0.005,0.43,0.44,2.5,2.2,2,'REVIEW','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule. Source HR range invalid: target 2.5, min 2.2, max 2; kept inactive for review.',false,'Masters Creation(1).xlsx'),
('2000','10078',79,'GLAZ70CF','GL',70,1,0.55,0.005,0.545,0.555,0.535,0.005,0.53,0.54,2.5,2.2,2,'REVIEW','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule. Source HR range invalid: target 2.5, min 2.2, max 2; kept inactive for review.',false,'Masters Creation(1).xlsx'),
('2000','10079',80,'BGLAZ150CF','BGL',150,1,0.45,0.005,0.445,0.455,0.38,0.005,0.375,0.385,2.2,2,2.5,'VALID','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule.',true,'Masters Creation(1).xlsx'),
('2000','10080',81,'BGLAZ150CF','BGL',150,1,0.47,0.005,0.465,0.475,0.4,0.005,0.395,0.405,2.2,2,2.5,'VALID','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule.',true,'Masters Creation(1).xlsx'),
('2000','10081',82,'GLAZ70CF','GL',70,1,0.38,0.005,0.375,0.385,0.36,0.005,0.355,0.365,2.2,2,2.5,'VALID','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule.',true,'Masters Creation(1).xlsx'),
('2000','10082',83,'BGLAZ70CF','BGL',70,1,0.6,0.005,0.595,0.605,0.53,0.005,0.525,0.535,2.5,2,2.8,'VALID','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule.',true,'Masters Creation(1).xlsx'),
('2000','10083',84,'GLAZ70CF','GL',70,1,0.28,0.005,0.275,0.285,0.26,0.005,0.255,0.265,2.2,2,2.5,'VALID','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule.',true,'Masters Creation(1).xlsx'),
('2000','10084',85,'GLAZ70CF','GL',70,1,0.32,0.005,0.315,0.325,0.3,0.005,0.295,0.305,2,1.6,2.2,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10085',86,'GLAZ70CFPR','GL',70,2,0.67,0.005,0.665,0.675,0.65,0.005,0.645,0.655,2.5,2.2,2.8,'VALID','Alternate matrix variant for same finished material/thickness; CR/HR process values differ.',true,'Masters Creation(1).xlsx'),
('2000','10086',87,'GLAZ70CFPR','GL',70,2,0.42,0.005,0.415,0.425,0.395,0.005,0.39,0.4,2.2,2,2.5,'VALID','Alternate matrix variant for same finished material/thickness; CR/HR process values differ.',true,'Masters Creation(1).xlsx'),
('2000','10087',88,'BGLAZ70CF','BGL',70,2,0.8,0.005,0.795,0.805,0.77,0.005,0.765,0.775,2.8,2.5,3,'VALID','Alternate matrix variant for same finished material/thickness; CR/HR process values differ.',true,'Masters Creation(1).xlsx'),
('2000','10088',89,'GLAZ150CF','GL',150,1,0.56,0.005,0.555,0.565,0.52,0.005,0.515,0.525,2.2,2,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10089',90,'GLAZ150CF','GL',150,1,0.52,0.005,0.515,0.525,0.48,0.005,0.475,0.485,2.5,2,2.8,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10090',91,'GLAZ150CF','GL',150,1,0.46,0.005,0.455,0.465,0.42,0.005,0.415,0.425,2.5,2.2,2.8,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10091',92,'GLAZ150CF','GL',150,1,0.34,0.005,0.335,0.345,0.3,0.005,0.295,0.305,2.2,2,2.5,'VALID','GL/CR min-max normalized to target ±0.005 mm per approved tolerance rule.',true,'Masters Creation(1).xlsx'),
('2000','10092',93,'GLAZ70CF','GL',70,1,0.41,0.005,0.405,0.415,0.39,0.005,0.385,0.395,2.2,2,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10093',94,'GLAZ70CF','GL',70,1,0.34,0.005,0.335,0.345,0.32,0.005,0.315,0.325,2.2,2,2.5,'VALID',NULL,true,'Masters Creation(1).xlsx'),
('2000','10094',95,'BGLAZ150CF','BGL',150,1,1.5,0.005,1.495,1.505,1.455,0.005,1.45,1.46,3.2,3,3.6,'VALID',NULL,true,'Masters Creation(1).xlsx')
ON CONFLICT (plant_code,source_uuid) DO UPDATE SET
 source_row_no=EXCLUDED.source_row_no,
 material_code=EXCLUDED.material_code,
 product_group=EXCLUDED.product_group,
 coating_gsm=EXCLUDED.coating_gsm,
 matrix_variant_no=EXCLUDED.matrix_variant_no,
 finished_thk_target_mm=EXCLUDED.finished_thk_target_mm,
 finished_tolerance_mm=EXCLUDED.finished_tolerance_mm,
 cr_thk_target_mm=EXCLUDED.cr_thk_target_mm,
 cr_tolerance_mm=EXCLUDED.cr_tolerance_mm,
 hr_thk_target_mm=EXCLUDED.hr_thk_target_mm,
 hr_thk_min_mm=EXCLUDED.hr_thk_min_mm,
 hr_thk_max_mm=EXCLUDED.hr_thk_max_mm,
 validation_status=EXCLUDED.validation_status,
 validation_notes=EXCLUDED.validation_notes,
 is_active=EXCLUDED.is_active,
 source_file=EXCLUDED.source_file,
 updated_at=now();


-- 9. Route Master - 33 headers; 32 active VALID, 1 REVIEW inactive
INSERT INTO mes.route_master
(company_code,plant_code,finished_material_code,route_indicator,process_path,material_tree,
 validation_status,validation_notes,is_active,source_file,source_row_no)
VALUES
('2000','2000','BGLAZ150CF','P1','HRS01-PKL01-CRM01-CRS01-CGL01','R_HR_CO-HRTRCW-HRTPCW-CRFHCW-CRFHTCW-BGLAZ150CF','VALID',NULL,true,'Masters Creation(1).xlsx',2),
('2000','2000','BGLAZ150CF','S1','HRS01-PKL01-CRM01-CGL01','R_HR_CO-HRTRCW-HRTPCW-CRFHCW-BGLAZ150CF','VALID',NULL,true,'Masters Creation(1).xlsx',3),
('2000','2000','BGLAZ150CF','S2','PKL01-CRM01-CRS01-CGL01','R_HR_CO-HRPOCW-CRFHCW-CRFHTCW-BGLAZ150CF','VALID',NULL,true,'Masters Creation(1).xlsx',4),
('2000','2000','BGLAZ150CF','S3','PKL01-CRM01-CGL01','R_HR_CO-HRPOCW-CRFHCW-BGLAZ150CF','VALID',NULL,true,'Masters Creation(1).xlsx',5),
('2000','2000','BGLAZ150CF','S4','PKL01-CRM01-CGL01','R_HR>3MM_CO-HRPOCW-CRFHCW-BGLAZ150CF','VALID',NULL,true,'Masters Creation(1).xlsx',6),
('2000','2000','BGLAZ150CF','S5','HRS01-PKL01-CRM01-CGL01','R_HR>3MM_CO-HRTRCW-HRTPCW-CRFHCW-BGLAZ150CF','VALID',NULL,true,'Masters Creation(1).xlsx',7),
('2000','2000','BGLAZ70CF','P1','HRS01-PKL01-CRM01-CRS01-CGL01','R_HR_CO-HRTRCW-HRTPCW-CRFHCW-CRFHTCW-BGLAZ70CF','VALID',NULL,true,'Masters Creation(1).xlsx',8),
('2000','2000','BGLAZ70CF','S1','HRS01-PKL01-CRM01-CGL01','R_HR_CO-HRTRCW-HRTPCW-CRFHCW-BGLAZ70CF','VALID',NULL,true,'Masters Creation(1).xlsx',9),
('2000','2000','BGLAZ70CF','S2','PKL01-CRM01-CRS01-CGL01','R_HR_CO-HRPOCW-CRFHCW-CRFHTCW-BGLAZ70CF','VALID',NULL,true,'Masters Creation(1).xlsx',10),
('2000','2000','BGLAZ70CF','S3','HRS01-PKL01-CRM01-CGL01','R_HR>3MM_CO-HRTRCW-HRTPCW-CRFHCW-BGLAZ70CF','VALID',NULL,true,'Masters Creation(1).xlsx',11),
('2000','2000','BGLAZ70CF','S4','PKL01-CRM01-CGL01','R_HR>3MM_CO-HRPOCW-CRFHCW-BGLAZ70CF','VALID',NULL,true,'Masters Creation(1).xlsx',12),
('2000','2000','BGLAZ70CF','S5','PKL01-CRM01-CGL01','R_HR_CO-HRPOCW-CRFHCW-BGLAZ70CF','VALID',NULL,true,'Masters Creation(1).xlsx',13),
('2000','2000','GLAZ150CF','P1','HRS01-PKL01-CRM01-CRS01-CGL01','R_HR_CO-HRTRCW-HRTPCW-CRFHCW-CRFHTCW-GLAZ150CF','VALID',NULL,true,'Masters Creation(1).xlsx',14),
('2000','2000','GLAZ150CF','S1','HRS01-PKL01-CRM01-CGL01','R_HR_CO-HRTRCW-HRTPCW-CRFHCW-GLAZ150CF','VALID',NULL,true,'Masters Creation(1).xlsx',15),
('2000','2000','GLAZ150CF','S2','HRS01-PKL01-CRM01-CGL01','R_HR_CO-HRPOCW-CRFHCW-GLAZ150CF','REVIEW','Source route cannot be normalized into steps: 4 work centers require 5 material nodes, but 4 were supplied.',false,'Masters Creation(1).xlsx',16),
('2000','2000','GLAZ150CF','S3','PKL01-CRM01-CRS01-CGL01','R_HR_CO-HRPOCW-CRFHCW-CRFHTCW-GLAZ150CF','VALID',NULL,true,'Masters Creation(1).xlsx',17),
('2000','2000','GLAZ150CF','S4','PKL01-CRM01-CGL01','R_HR_CO-HRPOCW-CRFHCW-GLAZ150CF','VALID',NULL,true,'Masters Creation(1).xlsx',18),
('2000','2000','GLAZ70CF','P1','HRS01-PKL01-CRM01-CRS01-CGL01','R_HR_CO-HRTRCW-HRTPCW-CRFHCW-CRFHTCW-GLAZ70CF','VALID',NULL,true,'Masters Creation(1).xlsx',19),
('2000','2000','GLAZ70CF','S1','HRS01-PKL01-CRM01-CGL01','R_HR_CO-HRTRCW-HRTPCW-CRFHCW-GLAZ70CF','VALID',NULL,true,'Masters Creation(1).xlsx',20),
('2000','2000','GLAZ70CF','S2','PKL01-CRM01-CRS01-CGL01','R_HR_CO-HRPOCW-CRFHCW-CRFHTCW-GLAZ70CF','VALID',NULL,true,'Masters Creation(1).xlsx',21),
('2000','2000','GLAZ70CF','S3','PKL01-CRM01-CGL01','R_HR_CO-HRPOCW-CRFHCW-GLAZ70CF','VALID',NULL,true,'Masters Creation(1).xlsx',22),
('2000','2000','GLAZ70CF','S4','HRS01-PKL01-CRM01-CRS01-CGL01','R_HR>3MM_CO-HRTRCW-HRTPCW-CRFHCW-CRFHTCW-GLAZ70CF','VALID',NULL,true,'Masters Creation(1).xlsx',23),
('2000','2000','GLAZ70CF','S5','HRS01-PKL01-CRM01-CGL01','R_HR>3MM_CO-HRTRCW-HRTPCW-CRFHCW-GLAZ70CF','VALID',NULL,true,'Masters Creation(1).xlsx',24),
('2000','2000','GLAZ70CF','S6','PKL01-CRM01-CRS01-CGL01','R_HR>3MM_CO-HRPOCW-CRFHCW-CRFHTCW-GLAZ70CF','VALID',NULL,true,'Masters Creation(1).xlsx',25),
('2000','2000','GLAZ70CF','S7','HRS01-PKL01-CRM01-CGL01','R_HR>3MM_CO-HRTRCW-HRTPCW-CRFHCW-GLAZ70CF','VALID',NULL,true,'Masters Creation(1).xlsx',26),
('2000','2000','GLAZ70CFPR','P1','HRS01-PKL01-CRM01-CRS01-CGL01','R_HR_CO-HRTRCW-HRTPCW-CRFHCW-CRFHTCW-GLAZ70CFPR','VALID',NULL,true,'Masters Creation(1).xlsx',27),
('2000','2000','GLAZ70CFPR','S1','HRS01-PKL01-CRM01-CGL01','R_HR_CO-HRTRCW-HRTPCW-CRFHCW-GLAZ70CFPR','VALID',NULL,true,'Masters Creation(1).xlsx',28),
('2000','2000','GLAZ70CFPR','S2','PKL01-CRM01-CRS01-CGL01','R_HR_CO-HRPOCW-CRFHCW-CRFHTCW-GLAZ70CFPR','VALID',NULL,true,'Masters Creation(1).xlsx',29),
('2000','2000','GLAZ70CFPR','S3','PKL01-CRM01-CGL01','R_HR_CO-HRPOCW-CRFHCW-GLAZ70CFPR','VALID',NULL,true,'Masters Creation(1).xlsx',30),
('2000','2000','GLAZ70CFPR','S4','HRS01-PKL01-CRM01-CRS01-CGL01','R_HR>3MM_CO-HRTRCW-HRTPCW-CRFHCW-CRFHTCW-GLAZ70CFPR','VALID',NULL,true,'Masters Creation(1).xlsx',31),
('2000','2000','GLAZ70CFPR','S5','HRS01-PKL01-CRM01-CGL01','R_HR>3MM_CO-HRTRCW-HRTPCW-CRFHCW-GLAZ70CFPR','VALID',NULL,true,'Masters Creation(1).xlsx',32),
('2000','2000','GLAZ70CFPR','S6','PKL01-CRM01-CRS01-CGL01','R_HR>3MM_CO-HRPOCW-CRFHCW-CRFHTCW-GLAZ70CFPR','VALID',NULL,true,'Masters Creation(1).xlsx',33),
('2000','2000','GLAZ70CFPR','S7','PKL01-CRM01-CGL01','R_HR>3MM_CO-HRPOCW-CRFHCW-GLAZ70CFPR','VALID',NULL,true,'Masters Creation(1).xlsx',34)
ON CONFLICT (company_code,plant_code,finished_material_code,route_indicator) DO UPDATE SET
 process_path=EXCLUDED.process_path,
 material_tree=EXCLUDED.material_tree,
 validation_status=EXCLUDED.validation_status,
 validation_notes=EXCLUDED.validation_notes,
 is_active=EXCLUDED.is_active,
 source_file=EXCLUDED.source_file,
 source_row_no=EXCLUDED.source_row_no,
 updated_at=now();

DELETE FROM mes.route_step s
USING mes.route_master r
WHERE s.route_id=r.route_id AND r.source_file='Masters Creation(1).xlsx';


WITH src(finished_material_code,route_indicator,step_no,work_center_code,operation_code,input_material_code,output_material_code) AS (
VALUES
('BGLAZ150CF','P1',1,'HRS01','10','R_HR_CO','HRTRCW'),
('BGLAZ150CF','P1',2,'PKL01','10','HRTRCW','HRTPCW'),
('BGLAZ150CF','P1',3,'CRM01','10','HRTPCW','CRFHCW'),
('BGLAZ150CF','P1',4,'CRS01','10','CRFHCW','CRFHTCW'),
('BGLAZ150CF','P1',5,'CGL01','10','CRFHTCW','BGLAZ150CF'),
('BGLAZ150CF','S1',1,'HRS01','10','R_HR_CO','HRTRCW'),
('BGLAZ150CF','S1',2,'PKL01','10','HRTRCW','HRTPCW'),
('BGLAZ150CF','S1',3,'CRM01','10','HRTPCW','CRFHCW'),
('BGLAZ150CF','S1',4,'CGL01','10','CRFHCW','BGLAZ150CF'),
('BGLAZ150CF','S2',1,'PKL01','10','R_HR_CO','HRPOCW'),
('BGLAZ150CF','S2',2,'CRM01','10','HRPOCW','CRFHCW'),
('BGLAZ150CF','S2',3,'CRS01','10','CRFHCW','CRFHTCW'),
('BGLAZ150CF','S2',4,'CGL01','10','CRFHTCW','BGLAZ150CF'),
('BGLAZ150CF','S3',1,'PKL01','10','R_HR_CO','HRPOCW'),
('BGLAZ150CF','S3',2,'CRM01','10','HRPOCW','CRFHCW'),
('BGLAZ150CF','S3',3,'CGL01','10','CRFHCW','BGLAZ150CF'),
('BGLAZ150CF','S4',1,'PKL01','10','R_HR>3MM_CO','HRPOCW'),
('BGLAZ150CF','S4',2,'CRM01','10','HRPOCW','CRFHCW'),
('BGLAZ150CF','S4',3,'CGL01','10','CRFHCW','BGLAZ150CF'),
('BGLAZ150CF','S5',1,'HRS01','10','R_HR>3MM_CO','HRTRCW'),
('BGLAZ150CF','S5',2,'PKL01','10','HRTRCW','HRTPCW'),
('BGLAZ150CF','S5',3,'CRM01','10','HRTPCW','CRFHCW'),
('BGLAZ150CF','S5',4,'CGL01','10','CRFHCW','BGLAZ150CF'),
('BGLAZ70CF','P1',1,'HRS01','10','R_HR_CO','HRTRCW'),
('BGLAZ70CF','P1',2,'PKL01','10','HRTRCW','HRTPCW'),
('BGLAZ70CF','P1',3,'CRM01','10','HRTPCW','CRFHCW'),
('BGLAZ70CF','P1',4,'CRS01','10','CRFHCW','CRFHTCW'),
('BGLAZ70CF','P1',5,'CGL01','10','CRFHTCW','BGLAZ70CF'),
('BGLAZ70CF','S1',1,'HRS01','10','R_HR_CO','HRTRCW'),
('BGLAZ70CF','S1',2,'PKL01','10','HRTRCW','HRTPCW'),
('BGLAZ70CF','S1',3,'CRM01','10','HRTPCW','CRFHCW'),
('BGLAZ70CF','S1',4,'CGL01','10','CRFHCW','BGLAZ70CF'),
('BGLAZ70CF','S2',1,'PKL01','10','R_HR_CO','HRPOCW'),
('BGLAZ70CF','S2',2,'CRM01','10','HRPOCW','CRFHCW'),
('BGLAZ70CF','S2',3,'CRS01','10','CRFHCW','CRFHTCW'),
('BGLAZ70CF','S2',4,'CGL01','10','CRFHTCW','BGLAZ70CF'),
('BGLAZ70CF','S3',1,'HRS01','10','R_HR>3MM_CO','HRTRCW'),
('BGLAZ70CF','S3',2,'PKL01','10','HRTRCW','HRTPCW'),
('BGLAZ70CF','S3',3,'CRM01','10','HRTPCW','CRFHCW'),
('BGLAZ70CF','S3',4,'CGL01','10','CRFHCW','BGLAZ70CF'),
('BGLAZ70CF','S4',1,'PKL01','10','R_HR>3MM_CO','HRPOCW'),
('BGLAZ70CF','S4',2,'CRM01','10','HRPOCW','CRFHCW'),
('BGLAZ70CF','S4',3,'CGL01','10','CRFHCW','BGLAZ70CF'),
('BGLAZ70CF','S5',1,'PKL01','10','R_HR_CO','HRPOCW'),
('BGLAZ70CF','S5',2,'CRM01','10','HRPOCW','CRFHCW'),
('BGLAZ70CF','S5',3,'CGL01','10','CRFHCW','BGLAZ70CF'),
('GLAZ150CF','P1',1,'HRS01','10','R_HR_CO','HRTRCW'),
('GLAZ150CF','P1',2,'PKL01','10','HRTRCW','HRTPCW'),
('GLAZ150CF','P1',3,'CRM01','10','HRTPCW','CRFHCW'),
('GLAZ150CF','P1',4,'CRS01','10','CRFHCW','CRFHTCW'),
('GLAZ150CF','P1',5,'CGL01','10','CRFHTCW','GLAZ150CF'),
('GLAZ150CF','S1',1,'HRS01','10','R_HR_CO','HRTRCW'),
('GLAZ150CF','S1',2,'PKL01','10','HRTRCW','HRTPCW'),
('GLAZ150CF','S1',3,'CRM01','10','HRTPCW','CRFHCW'),
('GLAZ150CF','S1',4,'CGL01','10','CRFHCW','GLAZ150CF'),
('GLAZ150CF','S3',1,'PKL01','10','R_HR_CO','HRPOCW'),
('GLAZ150CF','S3',2,'CRM01','10','HRPOCW','CRFHCW'),
('GLAZ150CF','S3',3,'CRS01','10','CRFHCW','CRFHTCW'),
('GLAZ150CF','S3',4,'CGL01','10','CRFHTCW','GLAZ150CF'),
('GLAZ150CF','S4',1,'PKL01','10','R_HR_CO','HRPOCW'),
('GLAZ150CF','S4',2,'CRM01','10','HRPOCW','CRFHCW'),
('GLAZ150CF','S4',3,'CGL01','10','CRFHCW','GLAZ150CF'),
('GLAZ70CF','P1',1,'HRS01','10','R_HR_CO','HRTRCW'),
('GLAZ70CF','P1',2,'PKL01','10','HRTRCW','HRTPCW'),
('GLAZ70CF','P1',3,'CRM01','10','HRTPCW','CRFHCW'),
('GLAZ70CF','P1',4,'CRS01','10','CRFHCW','CRFHTCW'),
('GLAZ70CF','P1',5,'CGL01','10','CRFHTCW','GLAZ70CF'),
('GLAZ70CF','S1',1,'HRS01','10','R_HR_CO','HRTRCW'),
('GLAZ70CF','S1',2,'PKL01','10','HRTRCW','HRTPCW'),
('GLAZ70CF','S1',3,'CRM01','10','HRTPCW','CRFHCW'),
('GLAZ70CF','S1',4,'CGL01','10','CRFHCW','GLAZ70CF'),
('GLAZ70CF','S2',1,'PKL01','10','R_HR_CO','HRPOCW'),
('GLAZ70CF','S2',2,'CRM01','10','HRPOCW','CRFHCW'),
('GLAZ70CF','S2',3,'CRS01','10','CRFHCW','CRFHTCW'),
('GLAZ70CF','S2',4,'CGL01','10','CRFHTCW','GLAZ70CF'),
('GLAZ70CF','S3',1,'PKL01','10','R_HR_CO','HRPOCW'),
('GLAZ70CF','S3',2,'CRM01','10','HRPOCW','CRFHCW'),
('GLAZ70CF','S3',3,'CGL01','10','CRFHCW','GLAZ70CF'),
('GLAZ70CF','S4',1,'HRS01','10','R_HR>3MM_CO','HRTRCW'),
('GLAZ70CF','S4',2,'PKL01','10','HRTRCW','HRTPCW'),
('GLAZ70CF','S4',3,'CRM01','10','HRTPCW','CRFHCW'),
('GLAZ70CF','S4',4,'CRS01','10','CRFHCW','CRFHTCW'),
('GLAZ70CF','S4',5,'CGL01','10','CRFHTCW','GLAZ70CF'),
('GLAZ70CF','S5',1,'HRS01','10','R_HR>3MM_CO','HRTRCW'),
('GLAZ70CF','S5',2,'PKL01','10','HRTRCW','HRTPCW'),
('GLAZ70CF','S5',3,'CRM01','10','HRTPCW','CRFHCW'),
('GLAZ70CF','S5',4,'CGL01','10','CRFHCW','GLAZ70CF'),
('GLAZ70CF','S6',1,'PKL01','10','R_HR>3MM_CO','HRPOCW'),
('GLAZ70CF','S6',2,'CRM01','10','HRPOCW','CRFHCW'),
('GLAZ70CF','S6',3,'CRS01','10','CRFHCW','CRFHTCW'),
('GLAZ70CF','S6',4,'CGL01','10','CRFHTCW','GLAZ70CF'),
('GLAZ70CF','S7',1,'HRS01','10','R_HR>3MM_CO','HRTRCW'),
('GLAZ70CF','S7',2,'PKL01','10','HRTRCW','HRTPCW'),
('GLAZ70CF','S7',3,'CRM01','10','HRTPCW','CRFHCW'),
('GLAZ70CF','S7',4,'CGL01','10','CRFHCW','GLAZ70CF'),
('GLAZ70CFPR','P1',1,'HRS01','10','R_HR_CO','HRTRCW'),
('GLAZ70CFPR','P1',2,'PKL01','10','HRTRCW','HRTPCW'),
('GLAZ70CFPR','P1',3,'CRM01','10','HRTPCW','CRFHCW'),
('GLAZ70CFPR','P1',4,'CRS01','10','CRFHCW','CRFHTCW'),
('GLAZ70CFPR','P1',5,'CGL01','10','CRFHTCW','GLAZ70CFPR'),
('GLAZ70CFPR','S1',1,'HRS01','10','R_HR_CO','HRTRCW'),
('GLAZ70CFPR','S1',2,'PKL01','10','HRTRCW','HRTPCW'),
('GLAZ70CFPR','S1',3,'CRM01','10','HRTPCW','CRFHCW'),
('GLAZ70CFPR','S1',4,'CGL01','10','CRFHCW','GLAZ70CFPR'),
('GLAZ70CFPR','S2',1,'PKL01','10','R_HR_CO','HRPOCW'),
('GLAZ70CFPR','S2',2,'CRM01','10','HRPOCW','CRFHCW'),
('GLAZ70CFPR','S2',3,'CRS01','10','CRFHCW','CRFHTCW'),
('GLAZ70CFPR','S2',4,'CGL01','10','CRFHTCW','GLAZ70CFPR'),
('GLAZ70CFPR','S3',1,'PKL01','10','R_HR_CO','HRPOCW'),
('GLAZ70CFPR','S3',2,'CRM01','10','HRPOCW','CRFHCW'),
('GLAZ70CFPR','S3',3,'CGL01','10','CRFHCW','GLAZ70CFPR'),
('GLAZ70CFPR','S4',1,'HRS01','10','R_HR>3MM_CO','HRTRCW'),
('GLAZ70CFPR','S4',2,'PKL01','10','HRTRCW','HRTPCW'),
('GLAZ70CFPR','S4',3,'CRM01','10','HRTPCW','CRFHCW'),
('GLAZ70CFPR','S4',4,'CRS01','10','CRFHCW','CRFHTCW'),
('GLAZ70CFPR','S4',5,'CGL01','10','CRFHTCW','GLAZ70CFPR'),
('GLAZ70CFPR','S5',1,'HRS01','10','R_HR>3MM_CO','HRTRCW'),
('GLAZ70CFPR','S5',2,'PKL01','10','HRTRCW','HRTPCW'),
('GLAZ70CFPR','S5',3,'CRM01','10','HRTPCW','CRFHCW'),
('GLAZ70CFPR','S5',4,'CGL01','10','CRFHCW','GLAZ70CFPR'),
('GLAZ70CFPR','S6',1,'PKL01','10','R_HR>3MM_CO','HRPOCW'),
('GLAZ70CFPR','S6',2,'CRM01','10','HRPOCW','CRFHCW'),
('GLAZ70CFPR','S6',3,'CRS01','10','CRFHCW','CRFHTCW'),
('GLAZ70CFPR','S6',4,'CGL01','10','CRFHTCW','GLAZ70CFPR'),
('GLAZ70CFPR','S7',1,'PKL01','10','R_HR>3MM_CO','HRPOCW'),
('GLAZ70CFPR','S7',2,'CRM01','10','HRPOCW','CRFHCW'),
('GLAZ70CFPR','S7',3,'CGL01','10','CRFHCW','GLAZ70CFPR')
)
INSERT INTO mes.route_step
(route_id,step_no,work_center_id,operation_id,input_material_code,output_material_code,is_active)
SELECT r.route_id,s.step_no,w.work_center_id,o.operation_id,s.input_material_code,s.output_material_code,true
FROM src s
JOIN mes.route_master r
  ON r.company_code='2000' AND r.plant_code='2000'
 AND r.finished_material_code=s.finished_material_code
 AND r.route_indicator=s.route_indicator
JOIN mes.work_center_master w
  ON w.company_code='2000' AND w.plant_code='2000' AND w.work_center_code=s.work_center_code
LEFT JOIN mes.operation_master o
  ON o.work_center_id=w.work_center_id AND o.operation_code=s.operation_code
WHERE r.validation_status='VALID' AND r.is_active=true
ON CONFLICT (route_id,step_no) DO UPDATE SET
 work_center_id=EXCLUDED.work_center_id,
 operation_id=EXCLUDED.operation_id,
 input_material_code=EXCLUDED.input_material_code,
 output_material_code=EXCLUDED.output_material_code,
 is_active=true,
 updated_at=now();


-- 10. Group Codes derived from attached master workbook
INSERT INTO mes.group_code_master
(group_code,group_name,description,control_mode,value_type,default_uom,
 use_in_planning,use_in_production,use_in_quality,missing_rule_action,missing_rule_message,is_active)
VALUES
('SALES_ORDER_TYPE','Sales Order Type','Sales order type lookup from approved master workbook','LOOKUP','CODE',NULL,true,false,false,'ERROR','Sales Order Type is not configured.',true),
('ROUTE_INDICATOR','Route Indicator','Planning/production route indicator from approved Route master','LOOKUP','CODE',NULL,true,true,false,'ERROR','Route Indicator is not configured.',true),
('MATERIAL_TYPE','Material Type','Material type values used by MES masters','LOOKUP','CODE',NULL,true,true,true,'ERROR','Material Type is not configured.',true),
('PRODUCT_GROUP','Product Group','Product groups derived from approved Material master','LOOKUP','CODE',NULL,true,true,true,'ERROR','Product Group is not configured.',true)
ON CONFLICT (group_code) DO UPDATE SET
 group_name=EXCLUDED.group_name,description=EXCLUDED.description,control_mode=EXCLUDED.control_mode,
 value_type=EXCLUDED.value_type,default_uom=EXCLUDED.default_uom,
 use_in_planning=EXCLUDED.use_in_planning,use_in_production=EXCLUDED.use_in_production,use_in_quality=EXCLUDED.use_in_quality,
 missing_rule_action=EXCLUDED.missing_rule_action,missing_rule_message=EXCLUDED.missing_rule_message,is_active=true,updated_at=now();


WITH src(group_code,detail_code,short_description,description,sequence_no) AS (
VALUES
('SALES_ORDER_TYPE','DEALER','DEALER','DEALER',10),
('SALES_ORDER_TYPE','OEM','OEM','OEM',20),
('SALES_ORDER_TYPE','EXPORT','EXPORT','EXPORT',30),
('SALES_ORDER_TYPE','MTS','MTS','MTS',40),
('ROUTE_INDICATOR','P1','P1','P1',10),
('ROUTE_INDICATOR','S1','S1','S1',20),
('ROUTE_INDICATOR','S2','S2','S2',30),
('ROUTE_INDICATOR','S3','S3','S3',40),
('ROUTE_INDICATOR','S4','S4','S4',50),
('ROUTE_INDICATOR','S5','S5','S5',60),
('ROUTE_INDICATOR','S6','S6','S6',70),
('ROUTE_INDICATOR','S7','S7','S7',80),
('MATERIAL_TYPE','FG','Finished Good','Finished Good',10),
('MATERIAL_TYPE','RM','Raw Material','Raw Material',20),
('MATERIAL_TYPE','WIP','Work In Process','Work In Process',30),
('PRODUCT_GROUP','BGL','BGL','BGL',10),
('PRODUCT_GROUP','CR','CR','CR',20),
('PRODUCT_GROUP','GL','GL','GL',30),
('PRODUCT_GROUP','HR','HR','HR',40),
('PRODUCT_GROUP','HRP','HRP','HRP',50)
)
INSERT INTO mes.group_code_detail
(group_code_id,detail_code,short_description,description,sequence_no,is_active)
SELECT g.group_code_id,s.detail_code,s.short_description,s.description,s.sequence_no,true
FROM src s
JOIN mes.group_code_master g ON g.group_code=s.group_code
ON CONFLICT (group_code_id,detail_code) DO UPDATE SET
 short_description=EXCLUDED.short_description,
 description=EXCLUDED.description,
 sequence_no=EXCLUDED.sequence_no,
 is_active=true,
 updated_at=now();


COMMIT;

INSERT INTO mes.schema_version(version_no,description)
VALUES ('2.0.4','Approved master creation from Masters Creation(1).xlsx; ±0.005 mm thickness tolerance, route master, material master')
ON CONFLICT (version_no) DO UPDATE SET description=EXCLUDED.description,applied_at=now();

-- Verification
SELECT 'company_master' AS master,count(*)::int AS rows FROM mes.company_master
UNION ALL SELECT 'plant_master',count(*)::int FROM mes.plant_master
UNION ALL SELECT 'material_master',count(*)::int FROM mes.material_master WHERE source_system='MES_XLSX'
UNION ALL SELECT 'work_center_master',count(*)::int FROM mes.work_center_master WHERE source_system='MES_XLSX'
UNION ALL SELECT 'operation_master',count(*)::int FROM mes.operation_master
UNION ALL SELECT 'thickness_matrix',count(*)::int FROM mes.planning_thickness_matrix WHERE source_file='Masters Creation(1).xlsx'
UNION ALL SELECT 'route_master',count(*)::int FROM mes.route_master WHERE source_file='Masters Creation(1).xlsx'
UNION ALL SELECT 'route_step',count(*)::int FROM mes.route_step
ORDER BY master;

SELECT
 count(*) FILTER (WHERE validation_status='VALID' AND is_active)::int AS thickness_valid_active,
 count(*) FILTER (WHERE validation_status='REVIEW')::int AS thickness_review,
 min(finished_tolerance_mm) AS min_gl_tolerance,
 max(finished_tolerance_mm) AS max_gl_tolerance,
 min(cr_tolerance_mm) AS min_cr_tolerance,
 max(cr_tolerance_mm) AS max_cr_tolerance
FROM mes.planning_thickness_matrix
WHERE source_file='Masters Creation(1).xlsx';

SELECT source_uuid,material_code,finished_thk_target_mm,finished_thk_min_mm,finished_thk_max_mm,
       cr_thk_target_mm,cr_thk_min_mm,cr_thk_max_mm,validation_status,is_active,validation_notes
FROM mes.planning_thickness_matrix
WHERE source_uuid IN ('10077','10078')
ORDER BY source_uuid;

SELECT finished_material_code,route_indicator,validation_status,is_active,validation_notes
FROM mes.route_master
WHERE finished_material_code='GLAZ150CF' AND route_indicator='S2';
