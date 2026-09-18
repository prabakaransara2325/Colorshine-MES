-- ============================================================================
-- COLORSHINE MES V2
-- 18_masters_module_and_tolerance.sql
-- Revision v2: qualified APP_SCREEN verification columns to avoid ambiguous route_path.
--
-- Purpose:
--   Create the dedicated Masters module and Plant 2000 master screens for:
--     7000 - Masters Dashboard
--     7101 - Thickness Matrix
--     7102 - Work Center Master
--     7103 - Work Center Tolerance Matrix
--
-- Notes:
--   * Thickness Matrix data remains Plant 2000 specific.
--   * Work Center master is generic by plant, initially seeded for Plant 2000.
--   * Tolerance matrix is work-center-wise and intentionally generic enough to
--     hold thickness, width, weight and other numeric capability/tolerance rows.
--   * No tolerance values are invented here. Business users can maintain them.
-- ============================================================================

SET search_path TO mes, public;
BEGIN;

INSERT INTO mes.schema_version(version_no, description)
VALUES ('1.6.0','Dedicated Masters module, Work Center master and Work Center Tolerance Matrix')
ON CONFLICT (version_no) DO NOTHING;

-- --------------------------------------------------------------------------
-- 1. Ensure Work Center master exists and seed Plant 2000 work centers.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.work_center_master (
    work_center_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_code           varchar(4) NOT NULL REFERENCES mes.plant_master(plant_code),
    work_center_code     varchar(20) NOT NULL,
    work_center_name     varchar(160) NOT NULL,
    process_area         varchar(80),
    display_sequence     integer,
    capacity_uom         varchar(10) NOT NULL DEFAULT 'MT',
    is_active            boolean NOT NULL DEFAULT true,
    source_system        varchar(20) NOT NULL DEFAULT 'MES',
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_work_center_plant_code UNIQUE (plant_code, work_center_code)
);

CREATE INDEX IF NOT EXISTS ix_work_center_plant_active
ON mes.work_center_master(plant_code, is_active, display_sequence);

INSERT INTO mes.work_center_master
(plant_code, work_center_code, work_center_name, process_area, display_sequence, capacity_uom, is_active, source_system)
VALUES
('2000','HRS01','HR Slitter Line','HR SLITTING',10,'MT',true,'MES'),
('2000','PPL01','Push Pull Pickling Line','PICKLING',20,'MT',true,'MES'),
('2000','CRM01','6Hi CR Mill','COLD ROLLING',30,'MT',true,'MES'),
('2000','CRS01','CR Rewinding & Trimming Line','CR REWINDING / TRIMMING',40,'MT',true,'MES'),
('2000','CGL01','Continuous Galvalume Line','GALVALUME COATING',50,'MT',true,'MES'),
('2000','PACK2','CIPL Packing Line','PACKING',60,'MT',true,'MES')
ON CONFLICT (plant_code, work_center_code) DO UPDATE
SET work_center_name = EXCLUDED.work_center_name,
    process_area = EXCLUDED.process_area,
    display_sequence = EXCLUDED.display_sequence,
    capacity_uom = EXCLUDED.capacity_uom,
    is_active = EXCLUDED.is_active,
    updated_at = now();

-- --------------------------------------------------------------------------
-- 2. Work Center Tolerance Matrix
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.work_center_tolerance_matrix (
    tolerance_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_code              varchar(4) NOT NULL REFERENCES mes.plant_master(plant_code),
    work_center_id          uuid NOT NULL REFERENCES mes.work_center_master(work_center_id),

    parameter_code          varchar(50) NOT NULL,
    parameter_name          varchar(140) NOT NULL,
    parameter_group         varchar(50) NOT NULL DEFAULT 'DIMENSION',
    product_group           varchar(30),
    material_code           varchar(60),

    input_min_value         numeric(18,6),
    input_max_value         numeric(18,6),
    output_target_value     numeric(18,6),
    output_min_value        numeric(18,6),
    output_max_value        numeric(18,6),
    tolerance_minus         numeric(18,6),
    tolerance_plus          numeric(18,6),
    uom                     varchar(20),

    priority_no             integer NOT NULL DEFAULT 100,
    validation_status       varchar(20) NOT NULL DEFAULT 'DRAFT',
    remarks                 varchar(1000),
    effective_from          date,
    effective_to            date,
    is_active               boolean NOT NULL DEFAULT true,

    approved_by_user_id     uuid REFERENCES mes.app_user(user_id),
    approved_at             timestamptz,
    created_by_user_id      uuid REFERENCES mes.app_user(user_id),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_wc_tol_status CHECK (validation_status IN ('DRAFT','VALID','REVIEW','REJECTED')),
    CONSTRAINT ck_wc_tol_dates CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
    CONSTRAINT ck_wc_tol_input_range CHECK (input_min_value IS NULL OR input_max_value IS NULL OR input_min_value <= input_max_value),
    CONSTRAINT ck_wc_tol_output_range CHECK (output_min_value IS NULL OR output_max_value IS NULL OR output_min_value <= output_max_value)
);

CREATE INDEX IF NOT EXISTS ix_wc_tol_lookup
ON mes.work_center_tolerance_matrix
(plant_code, work_center_id, parameter_code, product_group, material_code, validation_status, is_active, priority_no);

CREATE UNIQUE INDEX IF NOT EXISTS ux_wc_tol_business_key
ON mes.work_center_tolerance_matrix
(
  plant_code,
  work_center_id,
  parameter_code,
  (COALESCE(product_group,'')),
  (COALESCE(material_code,'')),
  priority_no
)
WHERE is_active = true;

COMMENT ON TABLE mes.work_center_tolerance_matrix IS
'Work-center-wise numeric capability/tolerance master. Business maintains actual values; the system does not invent tolerances.';

-- --------------------------------------------------------------------------
-- 3. Dedicated Masters Module (Module 7)
-- --------------------------------------------------------------------------
INSERT INTO mes.app_module
(module_no,module_code,module_name,description,route_path,is_business_module,is_admin_module,sequence_no,is_active)
VALUES
(7,'MDM','Masters','Manufacturing master data used by planning, production, quality and maintenance','/modules/masters',true,false,70,true)
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

-- Dashboard 7000
INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MDM_DASHBOARD','7000','7000','Masters Dashboard','DASHBOARD',
       'Central manufacturing master-data dashboard','/modules/masters','Phase 1','BUILT','ACTIVE',true,true,7000,true
FROM mes.app_module m WHERE m.module_code='MDM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,screen_no=EXCLUDED.screen_no,proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,screen_type=EXCLUDED.screen_type,description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,phase=EXCLUDED.phase,implementation_status=EXCLUDED.implementation_status,
 screen_status=EXCLUDED.screen_status,direct_call_enabled=EXCLUDED.direct_call_enabled,
 is_authorizable=EXCLUDED.is_authorizable,sequence_no=EXCLUDED.sequence_no,is_active=EXCLUDED.is_active,updated_at=now();

-- Thickness Matrix 7101
INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MDM_THICKNESS_MATRIX','7101','7101','Thickness Matrix','MASTER',
       'Plant 2000 finished/CR/HR thickness conversion matrix','/masters/thickness-matrix','Phase 1','BUILT','ACTIVE',true,true,7101,true
FROM mes.app_module m WHERE m.module_code='MDM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,screen_no=EXCLUDED.screen_no,proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,screen_type=EXCLUDED.screen_type,description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,phase=EXCLUDED.phase,implementation_status=EXCLUDED.implementation_status,
 screen_status=EXCLUDED.screen_status,direct_call_enabled=EXCLUDED.direct_call_enabled,
 is_authorizable=EXCLUDED.is_authorizable,sequence_no=EXCLUDED.sequence_no,is_active=EXCLUDED.is_active,updated_at=now();

-- Work Centers 7102
INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MDM_WORK_CENTERS','7102','7102','Work Center Master','MASTER',
       'Plant 2000 manufacturing work-center master','/masters/work-centers','Phase 1','BUILT','ACTIVE',true,true,7102,true
FROM mes.app_module m WHERE m.module_code='MDM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,screen_no=EXCLUDED.screen_no,proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,screen_type=EXCLUDED.screen_type,description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,phase=EXCLUDED.phase,implementation_status=EXCLUDED.implementation_status,
 screen_status=EXCLUDED.screen_status,direct_call_enabled=EXCLUDED.direct_call_enabled,
 is_authorizable=EXCLUDED.is_authorizable,sequence_no=EXCLUDED.sequence_no,is_active=EXCLUDED.is_active,updated_at=now();

-- Work Center Tolerance Matrix 7103
INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MDM_WC_TOLERANCE','7103','7103','Work Center Tolerance Matrix','MASTER',
       'Work-center-wise capability and tolerance matrix','/masters/work-center-tolerance','Phase 1','BUILT','ACTIVE',true,true,7103,true
FROM mes.app_module m WHERE m.module_code='MDM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,screen_no=EXCLUDED.screen_no,proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,screen_type=EXCLUDED.screen_type,description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,phase=EXCLUDED.phase,implementation_status=EXCLUDED.implementation_status,
 screen_status=EXCLUDED.screen_status,direct_call_enabled=EXCLUDED.direct_call_enabled,
 is_authorizable=EXCLUDED.is_authorizable,sequence_no=EXCLUDED.sequence_no,is_active=EXCLUDED.is_active,updated_at=now();

-- --------------------------------------------------------------------------
-- 4. Helpful read views
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW mes.vw_work_center_tolerance_matrix AS
SELECT
    t.tolerance_id,
    t.plant_code,
    w.work_center_code,
    w.work_center_name,
    w.process_area,
    t.parameter_code,
    t.parameter_name,
    t.parameter_group,
    t.product_group,
    t.material_code,
    t.input_min_value,
    t.input_max_value,
    t.output_target_value,
    t.output_min_value,
    t.output_max_value,
    t.tolerance_minus,
    t.tolerance_plus,
    t.uom,
    t.priority_no,
    t.validation_status,
    t.remarks,
    t.effective_from,
    t.effective_to,
    t.is_active,
    t.approved_at,
    t.created_at,
    t.updated_at
FROM mes.work_center_tolerance_matrix t
JOIN mes.work_center_master w ON w.work_center_id=t.work_center_id;

COMMIT;

-- Verification
SELECT module_no,module_code,module_name,route_path,is_active
FROM mes.app_module
WHERE module_code='MDM';

SELECT
    s.screen_no,
    s.screen_code,
    s.screen_name,
    s.route_path,
    s.screen_status
FROM mes.app_screen s
JOIN mes.app_module m
  ON m.module_id = s.module_id
WHERE m.module_code = 'MDM'
ORDER BY s.screen_no;

SELECT plant_code,work_center_code,work_center_name,process_area,is_active
FROM mes.work_center_master
WHERE plant_code='2000'
ORDER BY display_sequence;

SELECT count(*) AS tolerance_rows
FROM mes.work_center_tolerance_matrix
WHERE plant_code='2000';
