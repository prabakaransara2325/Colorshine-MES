-- ============================================================================
-- COLORSHINE MES V2
-- 15_planning_plant2000_foundation.sql
--
-- CORRECTED SCOPE: PLANT 2000 / CIPL ONLY
--
-- This replaces the earlier Plant-1000 planning draft.
-- The user's InventoryMaster sample also contains Plant=2000 in all 983 rows,
-- which is consistent with the corrected business scope.
--
-- IMPORTANT:
--   If the old Plant-1000 planning foundation was already used to create
--   transactional planning data, this migration stops instead of silently
--   converting those transactions to Plant 2000.
-- ============================================================================

SET search_path TO mes, public;

BEGIN;

-- Safety check for old wrongly-scoped transactional data.
DO $$
DECLARE
    v_cnt bigint := 0;
BEGIN
    IF to_regclass('mes.planning_order_requirement') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM mes.planning_order_requirement WHERE plant_code <> ''2000''' INTO v_cnt;
        IF v_cnt > 0 THEN
            RAISE EXCEPTION
              'Existing planning_order_requirement contains % non-2000 row(s). Review before applying corrected Plant 2000 scope.',
              v_cnt;
        END IF;
    END IF;

    IF to_regclass('mes.planning_run') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM mes.planning_run WHERE plant_code <> ''2000''' INTO v_cnt;
        IF v_cnt > 0 THEN
            RAISE EXCEPTION
              'Existing planning_run contains % non-2000 row(s). Review before applying corrected Plant 2000 scope.',
              v_cnt;
        END IF;
    END IF;

    IF to_regclass('mes.planning_allocation') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM mes.planning_allocation WHERE plant_code <> ''2000''' INTO v_cnt;
        IF v_cnt > 0 THEN
            RAISE EXCEPTION
              'Existing planning_allocation contains % non-2000 row(s). Review before applying corrected Plant 2000 scope.',
              v_cnt;
        END IF;
    END IF;

    IF to_regclass('mes.planning_exception') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM mes.planning_exception WHERE plant_code <> ''2000''' INTO v_cnt;
        IF v_cnt > 0 THEN
            RAISE EXCEPTION
              'Existing planning_exception contains % non-2000 row(s). Review before applying corrected Plant 2000 scope.',
              v_cnt;
        END IF;
    END IF;
END $$;

INSERT INTO mes.schema_version(version_no, description)
VALUES ('1.5.1','Corrected Planning foundation: Plant 2000 / CIPL')
ON CONFLICT (version_no) DO NOTHING;

-- --------------------------------------------------------------------------
-- Thickness matrix
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.planning_thickness_matrix (
    matrix_id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_code              varchar(4) NOT NULL DEFAULT '2000'
                            REFERENCES mes.plant_master(plant_code),
    source_uuid             varchar(20) NOT NULL,
    source_row_no           integer,
    material_code           varchar(60) NOT NULL,
    product_group           varchar(20) NOT NULL,
    coating_gsm             numeric(10,3),
    finished_thk_target_mm  numeric(10,4),
    finished_thk_min_mm     numeric(10,4),
    finished_thk_max_mm     numeric(10,4),
    cr_thk_target_mm        numeric(10,4),
    cr_thk_min_mm           numeric(10,4),
    cr_thk_max_mm           numeric(10,4),
    hr_thk_target_mm        numeric(10,4),
    hr_thk_min_mm           numeric(10,4),
    hr_thk_max_mm           numeric(10,4),
    validation_status       varchar(20) NOT NULL DEFAULT 'REVIEW',
    validation_notes        text,
    is_active               boolean NOT NULL DEFAULT false,
    effective_from          date,
    effective_to            date,
    approved_by_user_id     uuid REFERENCES mes.app_user(user_id),
    approved_at             timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_pln_thk_source UNIQUE (plant_code, source_uuid)
);

-- Correct earlier draft constraint/default if table already existed.
ALTER TABLE mes.planning_thickness_matrix DROP CONSTRAINT IF EXISTS ck_pln_thk_plant1000;
ALTER TABLE mes.planning_thickness_matrix DROP CONSTRAINT IF EXISTS ck_pln_thk_plant2000;
ALTER TABLE mes.planning_thickness_matrix ALTER COLUMN plant_code SET DEFAULT '2000';

-- If the only old data is the wrongly-scoped matrix seed, move it safely.
UPDATE mes.planning_thickness_matrix
SET plant_code = '2000',
    updated_at = now()
WHERE plant_code = '1000';

ALTER TABLE mes.planning_thickness_matrix
ADD CONSTRAINT ck_pln_thk_plant2000 CHECK (plant_code = '2000');

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname='ck_pln_thk_status'
          AND conrelid='mes.planning_thickness_matrix'::regclass
    ) THEN
        ALTER TABLE mes.planning_thickness_matrix
        ADD CONSTRAINT ck_pln_thk_status
        CHECK (validation_status IN ('VALID','REVIEW','REJECTED'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_pln_thk_lookup
ON mes.planning_thickness_matrix
(plant_code, material_code, product_group, coating_gsm, validation_status, is_active);

-- --------------------------------------------------------------------------
-- Order requirement
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.planning_order_requirement (
    requirement_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_code              varchar(4) NOT NULL REFERENCES mes.plant_master(plant_code),
    sales_order_no          varchar(20) NOT NULL,
    sales_order_item        varchar(10) NOT NULL,
    final_material_code     varchar(60) NOT NULL,
    product_group           varchar(20),
    required_qty_mt         numeric(14,4) NOT NULL,
    open_qty_mt             numeric(14,4) NOT NULL,
    required_date           date,
    finished_thickness_mm   numeric(10,4),
    width_mm                numeric(12,3),
    temper                  varchar(30),
    quality_grade           varchar(30),
    coating_code            varchar(30),
    coating_gsm             numeric(10,3),
    min_coil_weight_mt      numeric(14,4),
    max_coil_weight_mt      numeric(14,4),
    logo_requirement        varchar(80),
    spangle_requirement     varchar(80),
    jet_printing            varchar(30),
    tll_requirement         varchar(80),
    requirement_status      varchar(30) NOT NULL DEFAULT 'OPEN',
    source_system           varchar(30) NOT NULL DEFAULT 'SAP',
    source_updated_at       timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_pln_req_so_item UNIQUE (plant_code, sales_order_no, sales_order_item)
);

ALTER TABLE mes.planning_order_requirement DROP CONSTRAINT IF EXISTS ck_pln_req_plant1000;
ALTER TABLE mes.planning_order_requirement DROP CONSTRAINT IF EXISTS ck_pln_req_plant2000;
ALTER TABLE mes.planning_order_requirement
ADD CONSTRAINT ck_pln_req_plant2000 CHECK (plant_code = '2000');

-- --------------------------------------------------------------------------
-- Planning run
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.planning_run (
    planning_run_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_code              varchar(4) NOT NULL REFERENCES mes.plant_master(plant_code),
    requirement_id          uuid NOT NULL REFERENCES mes.planning_order_requirement(requirement_id),
    matrix_id               uuid REFERENCES mes.planning_thickness_matrix(matrix_id),
    run_status              varchar(30) NOT NULL DEFAULT 'SIMULATED',
    qty_required_mt         numeric(14,4) NOT NULL,
    qty_covered_mt          numeric(14,4) NOT NULL DEFAULT 0,
    qty_shortfall_mt        numeric(14,4) NOT NULL DEFAULT 0,
    source_stage_selected   varchar(20),
    created_by_user_id      uuid REFERENCES mes.app_user(user_id),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mes.planning_run DROP CONSTRAINT IF EXISTS ck_pln_run_plant1000;
ALTER TABLE mes.planning_run DROP CONSTRAINT IF EXISTS ck_pln_run_plant2000;
ALTER TABLE mes.planning_run
ADD CONSTRAINT ck_pln_run_plant2000 CHECK (plant_code = '2000');

-- --------------------------------------------------------------------------
-- Candidate stock
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.planning_run_candidate (
    candidate_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    planning_run_id         uuid NOT NULL REFERENCES mes.planning_run(planning_run_id) ON DELETE CASCADE,
    batch_no                varchar(40) NOT NULL,
    stock_stage_class       varchar(10) NOT NULL,
    material_type           varchar(20),
    material_code           varchar(60),
    storage_location        varchar(10),
    available_qty_mt        numeric(14,4),
    selected_qty_mt         numeric(14,4) NOT NULL DEFAULT 0,
    qa_grade                varchar(30),
    thickness_mm            numeric(10,4),
    width_mm                numeric(12,3),
    temper                  varchar(30),
    coating_code            varchar(30),
    stock_age_days          integer,
    existing_so_no          varchar(20),
    existing_so_item        varchar(10),
    existing_mes_po         varchar(40),
    rm_steel_grade          varchar(40),
    supplier_batch          varchar(80),
    heat_no                 varchar(80),
    rm_supplier             varchar(200),
    match_status            varchar(20) NOT NULL,
    match_score             numeric(8,3),
    match_reason            text,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_pln_candidate_run
ON mes.planning_run_candidate(planning_run_id, match_status, match_score DESC);

-- --------------------------------------------------------------------------
-- Allocation
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.planning_allocation (
    allocation_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_code              varchar(4) NOT NULL REFERENCES mes.plant_master(plant_code),
    requirement_id          uuid NOT NULL REFERENCES mes.planning_order_requirement(requirement_id),
    planning_run_id         uuid REFERENCES mes.planning_run(planning_run_id),
    batch_no                varchar(40) NOT NULL,
    allocated_qty_mt        numeric(14,4) NOT NULL,
    allocation_status       varchar(20) NOT NULL DEFAULT 'RESERVED',
    reserved_by_user_id     uuid REFERENCES mes.app_user(user_id),
    reserved_at             timestamptz NOT NULL DEFAULT now(),
    released_by_user_id     uuid REFERENCES mes.app_user(user_id),
    released_at             timestamptz,
    release_reason          varchar(500),
    created_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mes.planning_allocation DROP CONSTRAINT IF EXISTS ck_pln_alloc_plant1000;
ALTER TABLE mes.planning_allocation DROP CONSTRAINT IF EXISTS ck_pln_alloc_plant2000;
ALTER TABLE mes.planning_allocation
ADD CONSTRAINT ck_pln_alloc_plant2000 CHECK (plant_code = '2000');

CREATE INDEX IF NOT EXISTS ix_pln_alloc_active_batch
ON mes.planning_allocation(plant_code, batch_no, allocation_status);

-- --------------------------------------------------------------------------
-- Exceptions
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.planning_exception (
    exception_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_code              varchar(4) NOT NULL REFERENCES mes.plant_master(plant_code),
    requirement_id          uuid REFERENCES mes.planning_order_requirement(requirement_id),
    planning_run_id         uuid REFERENCES mes.planning_run(planning_run_id),
    exception_type          varchar(60) NOT NULL,
    severity                varchar(20) NOT NULL DEFAULT 'WARNING',
    reference_value         varchar(200),
    message                 varchar(1000) NOT NULL,
    exception_status        varchar(20) NOT NULL DEFAULT 'OPEN',
    assigned_to_user_id     uuid REFERENCES mes.app_user(user_id),
    resolved_by_user_id     uuid REFERENCES mes.app_user(user_id),
    resolved_at             timestamptz,
    resolution_remarks      varchar(1000),
    created_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mes.planning_exception DROP CONSTRAINT IF EXISTS ck_pln_exc_plant1000;
ALTER TABLE mes.planning_exception DROP CONSTRAINT IF EXISTS ck_pln_exc_plant2000;
ALTER TABLE mes.planning_exception
ADD CONSTRAINT ck_pln_exc_plant2000 CHECK (plant_code = '2000');

CREATE OR REPLACE VIEW mes.vw_planning_thickness_matrix_active AS
SELECT *
FROM mes.planning_thickness_matrix
WHERE plant_code = '2000'
  AND validation_status = 'VALID'
  AND is_active = true
  AND (effective_from IS NULL OR effective_from <= current_date)
  AND (effective_to IS NULL OR effective_to >= current_date);

COMMIT;

SELECT 'PLANNING_SCOPE' AS check_name,
       count(*) AS matrix_rows,
       min(plant_code) AS min_plant,
       max(plant_code) AS max_plant
FROM mes.planning_thickness_matrix;
