-- ============================================================================
-- COLORSHINE MES V2 v0.10.2
-- WORK CENTER CAPACITY MILESTONES + DYNAMIC GROUP CODE CONTROL ENGINE
-- ============================================================================
-- PURPOSE
--   1. Keep Work Centers company + plant specific.
--   2. Maintain year/month/day capacity milestones without hardcoding.
--   3. Provide a reusable Group Code engine for Planning, Production and Quality.
--   4. Allow work-center / operation / material scoped min/max/target controls.
--   5. Provide one resolver function that application logic can call at runtime.
--
-- IMPORTANT
--   This migration creates STRUCTURE ONLY. It does not seed business master data
--   or invent any control values.
-- ============================================================================

SET search_path TO mes, public;
BEGIN;

-- --------------------------------------------------------------------------
-- 0. Enforce Company + Plant + Work Center scope (idempotent)
-- --------------------------------------------------------------------------
ALTER TABLE mes.work_center_master ADD COLUMN IF NOT EXISTS company_code varchar(4);

-- This fresh-start build is expected to have no legacy Work Centers. If any
-- exist, stop instead of guessing their Company Code.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM mes.work_center_master WHERE company_code IS NULL) THEN
        RAISE EXCEPTION 'Work Center rows without Company Code exist. Assign Company Code before applying v0.10.2.';
    END IF;
END $$;

ALTER TABLE mes.work_center_master ALTER COLUMN company_code SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname='fk_work_center_company'
           AND conrelid='mes.work_center_master'::regclass
    ) THEN
        ALTER TABLE mes.work_center_master
          ADD CONSTRAINT fk_work_center_company FOREIGN KEY(company_code)
          REFERENCES mes.company_master(company_code);
    END IF;
END $$;

ALTER TABLE mes.work_center_master DROP CONSTRAINT IF EXISTS ux_work_center_plant_code;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname='ux_work_center_company_plant_code'
           AND conrelid='mes.work_center_master'::regclass
    ) THEN
        ALTER TABLE mes.work_center_master
          ADD CONSTRAINT ux_work_center_company_plant_code UNIQUE(company_code,plant_code,work_center_code);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION mes.validate_work_center_company_plant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_company_code varchar(4);
BEGIN
    SELECT p.company_code INTO v_company_code
      FROM mes.plant_master p WHERE p.plant_code=NEW.plant_code;
    IF v_company_code IS NULL THEN
        RAISE EXCEPTION 'Plant % does not exist in Plant Master.',NEW.plant_code;
    END IF;
    IF NEW.company_code<>v_company_code THEN
        RAISE EXCEPTION 'Work Center company % does not match Plant % company %.',NEW.company_code,NEW.plant_code,v_company_code;
    END IF;
    RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_work_center_company_plant ON mes.work_center_master;
CREATE TRIGGER trg_validate_work_center_company_plant
BEFORE INSERT OR UPDATE OF company_code,plant_code ON mes.work_center_master
FOR EACH ROW EXECUTE FUNCTION mes.validate_work_center_company_plant();

-- --------------------------------------------------------------------------
-- 1. Work-center annual/monthly/daily capacity milestone history
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.work_center_capacity_milestone (
    capacity_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_center_id        uuid NOT NULL REFERENCES mes.work_center_master(work_center_id) ON DELETE CASCADE,
    capacity_year         integer NOT NULL,
    year_capacity         numeric(18,3),
    month_capacity        numeric(18,3),
    day_capacity          numeric(18,3),
    capacity_uom          varchar(20) NOT NULL DEFAULT 'MT',
    remarks               varchar(500),
    is_active             boolean NOT NULL DEFAULT true,
    created_by_user_id    uuid REFERENCES mes.app_user(user_id),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_wc_capacity_year UNIQUE (work_center_id, capacity_year),
    CONSTRAINT ck_wc_capacity_year CHECK (capacity_year BETWEEN 2000 AND 2200),
    CONSTRAINT ck_wc_year_capacity CHECK (year_capacity IS NULL OR year_capacity >= 0),
    CONSTRAINT ck_wc_month_capacity CHECK (month_capacity IS NULL OR month_capacity >= 0),
    CONSTRAINT ck_wc_day_capacity CHECK (day_capacity IS NULL OR day_capacity >= 0)
);

CREATE INDEX IF NOT EXISTS ix_wc_capacity_active
    ON mes.work_center_capacity_milestone(work_center_id, capacity_year DESC, is_active);

COMMENT ON TABLE mes.work_center_capacity_milestone IS
'Year/month/day capacity milestones maintained against a company+plant Work Center. Values are business-maintained and never hardcoded in application logic.';

-- --------------------------------------------------------------------------
-- 2. Group Code master
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.group_code_master (
    group_code_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_code            varchar(60) NOT NULL UNIQUE,
    group_name            varchar(140) NOT NULL,
    description           varchar(1000),
    control_mode          varchar(20) NOT NULL DEFAULT 'LOOKUP',
    value_type            varchar(20) NOT NULL DEFAULT 'CODE',
    default_uom           varchar(20),
    use_in_planning       boolean NOT NULL DEFAULT false,
    use_in_production     boolean NOT NULL DEFAULT false,
    use_in_quality        boolean NOT NULL DEFAULT false,
    is_active             boolean NOT NULL DEFAULT true,
    created_by_user_id    uuid REFERENCES mes.app_user(user_id),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_group_code_mode CHECK (control_mode IN ('LOOKUP','RANGE','VALUE','BOOLEAN','TEXT')),
    CONSTRAINT ck_group_code_value_type CHECK (value_type IN ('CODE','NUMBER','TEXT','BOOLEAN'))
);

COMMENT ON TABLE mes.group_code_master IS
'Central dynamic control master. Planning/Production/Quality behavior should read these values instead of embedding business limits in code.';

-- --------------------------------------------------------------------------
-- 3. Code Details under each Group Code
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.group_code_detail (
    detail_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_code_id         uuid NOT NULL REFERENCES mes.group_code_master(group_code_id) ON DELETE CASCADE,
    detail_code           varchar(80) NOT NULL,
    short_description     varchar(160) NOT NULL,
    description           varchar(1000),
    numeric_value         numeric(18,6),
    text_value            varchar(1000),
    uom                   varchar(20),
    sequence_no           integer NOT NULL DEFAULT 100,
    is_active             boolean NOT NULL DEFAULT true,
    created_by_user_id    uuid REFERENCES mes.app_user(user_id),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_group_code_detail UNIQUE (group_code_id, detail_code)
);

CREATE INDEX IF NOT EXISTS ix_group_code_detail_active
    ON mes.group_code_detail(group_code_id, is_active, sequence_no, detail_code);

COMMENT ON TABLE mes.group_code_detail IS
'Code/parameter details belonging to a Group Code, e.g. Usage Decision codes, Quality levels, operation reasons, configurable lookup values.';

-- --------------------------------------------------------------------------
-- 4. Dynamic rules / assignments
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.group_code_rule (
    rule_id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_code_id         uuid NOT NULL REFERENCES mes.group_code_master(group_code_id) ON DELETE CASCADE,
    rule_name             varchar(160) NOT NULL,

    company_code          varchar(4) REFERENCES mes.company_master(company_code),
    plant_code            varchar(4) REFERENCES mes.plant_master(plant_code),
    work_center_id        uuid REFERENCES mes.work_center_master(work_center_id),
    operation_code        varchar(60),
    material_code         varchar(60),
    product_group         varchar(60),
    usage_context         varchar(20) NOT NULL DEFAULT 'ANY',

    detail_id             uuid REFERENCES mes.group_code_detail(detail_id),
    min_value             numeric(18,6),
    max_value             numeric(18,6),
    target_value          numeric(18,6),
    text_value            varchar(1000),
    boolean_value         boolean,
    uom                   varchar(20),

    validation_action     varchar(20) NOT NULL DEFAULT 'ERROR',
    validation_message    varchar(500),
    priority_no           integer NOT NULL DEFAULT 100,
    effective_from        date,
    effective_to          date,
    is_active             boolean NOT NULL DEFAULT true,

    created_by_user_id    uuid REFERENCES mes.app_user(user_id),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_group_rule_context CHECK (usage_context IN ('ANY','PLANNING','PRODUCTION','QUALITY')),
    CONSTRAINT ck_group_rule_action CHECK (validation_action IN ('ERROR','WARNING','INFO')),
    CONSTRAINT ck_group_rule_range CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value),
    CONSTRAINT ck_group_rule_dates CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS ix_group_rule_resolve
    ON mes.group_code_rule(group_code_id, company_code, plant_code, work_center_id, operation_code,
                           usage_context, is_active, priority_no, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS ix_group_rule_material
    ON mes.group_code_rule(group_code_id, material_code, product_group, is_active);

COMMENT ON TABLE mes.group_code_rule IS
'Dynamic scoped control values. Example: Group Code RUNTIME + Work Center CRM01 + min/max minutes. Screens resolve this table at runtime instead of hardcoding limits.';

-- Ensure a selected detail always belongs to the same Group Code as the rule.
CREATE OR REPLACE FUNCTION mes.validate_group_code_rule()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_wc_company varchar(4);
    v_wc_plant varchar(4);
    v_detail_group uuid;
BEGIN
    IF NEW.work_center_id IS NOT NULL THEN
        SELECT company_code, plant_code
          INTO v_wc_company, v_wc_plant
          FROM mes.work_center_master
         WHERE work_center_id = NEW.work_center_id;

        IF v_wc_company IS NULL THEN
            RAISE EXCEPTION 'Invalid Work Center selected for Group Code rule.';
        END IF;

        IF NEW.company_code IS NULL THEN NEW.company_code := v_wc_company; END IF;
        IF NEW.plant_code IS NULL THEN NEW.plant_code := v_wc_plant; END IF;

        IF NEW.company_code <> v_wc_company OR NEW.plant_code <> v_wc_plant THEN
            RAISE EXCEPTION 'Group Code rule Company/Plant does not match selected Work Center.';
        END IF;
    END IF;

    IF NEW.plant_code IS NOT NULL THEN
        PERFORM 1
          FROM mes.plant_master p
         WHERE p.plant_code = NEW.plant_code
           AND (NEW.company_code IS NULL OR p.company_code = NEW.company_code);
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Plant % does not belong to Company %.', NEW.plant_code, COALESCE(NEW.company_code,'(blank)');
        END IF;
    END IF;

    IF NEW.detail_id IS NOT NULL THEN
        SELECT group_code_id INTO v_detail_group
          FROM mes.group_code_detail
         WHERE detail_id = NEW.detail_id;
        IF v_detail_group IS DISTINCT FROM NEW.group_code_id THEN
            RAISE EXCEPTION 'Selected Code Detail does not belong to the selected Group Code.';
        END IF;
    END IF;

    NEW.operation_code := NULLIF(upper(trim(COALESCE(NEW.operation_code,''))), '');
    NEW.material_code := NULLIF(upper(trim(COALESCE(NEW.material_code,''))), '');
    NEW.product_group := NULLIF(upper(trim(COALESCE(NEW.product_group,''))), '');
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_group_code_rule ON mes.group_code_rule;
CREATE TRIGGER trg_validate_group_code_rule
BEFORE INSERT OR UPDATE ON mes.group_code_rule
FOR EACH ROW EXECUTE FUNCTION mes.validate_group_code_rule();

-- --------------------------------------------------------------------------
-- 5. Read views
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW mes.vw_work_center_master_capacity AS
SELECT
    w.work_center_id,
    w.company_code,
    c.company_name,
    c.short_name AS company_short_name,
    w.plant_code,
    p.plant_name,
    w.work_center_code,
    w.work_center_name,
    w.process_area,
    w.display_sequence,
    w.capacity_uom,
    w.is_active,
    w.source_system,
    w.created_at,
    w.updated_at,
    cap.capacity_id,
    cap.capacity_year,
    cap.year_capacity,
    cap.month_capacity,
    cap.day_capacity,
    COALESCE(cap.capacity_uom,w.capacity_uom) AS milestone_uom,
    cap.remarks AS capacity_remarks
FROM mes.work_center_master w
JOIN mes.company_master c ON c.company_code=w.company_code
JOIN mes.plant_master p ON p.plant_code=w.plant_code
LEFT JOIN LATERAL (
    SELECT x.*
      FROM mes.work_center_capacity_milestone x
     WHERE x.work_center_id=w.work_center_id
       AND x.is_active=true
     ORDER BY x.capacity_year DESC, x.updated_at DESC
     LIMIT 1
) cap ON true;

CREATE OR REPLACE VIEW mes.vw_group_code_rule AS
SELECT
    r.rule_id,
    r.group_code_id,
    g.group_code,
    g.group_name,
    g.control_mode,
    g.value_type,
    r.rule_name,
    r.company_code,
    c.short_name AS company_short_name,
    r.plant_code,
    p.plant_name,
    r.work_center_id,
    w.work_center_code,
    w.work_center_name,
    r.operation_code,
    r.material_code,
    r.product_group,
    r.usage_context,
    r.detail_id,
    d.detail_code,
    d.short_description AS detail_description,
    r.min_value,
    r.max_value,
    r.target_value,
    r.text_value,
    r.boolean_value,
    COALESCE(r.uom,g.default_uom,d.uom) AS uom,
    r.validation_action,
    r.validation_message,
    r.priority_no,
    r.effective_from,
    r.effective_to,
    r.is_active,
    r.created_at,
    r.updated_at
FROM mes.group_code_rule r
JOIN mes.group_code_master g ON g.group_code_id=r.group_code_id
LEFT JOIN mes.company_master c ON c.company_code=r.company_code
LEFT JOIN mes.plant_master p ON p.plant_code=r.plant_code
LEFT JOIN mes.work_center_master w ON w.work_center_id=r.work_center_id
LEFT JOIN mes.group_code_detail d ON d.detail_id=r.detail_id;

-- --------------------------------------------------------------------------
-- 6. Runtime resolver used by Planning / Production / Quality
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mes.resolve_group_control(
    p_group_code       varchar,
    p_company_code     varchar DEFAULT NULL,
    p_plant_code       varchar DEFAULT NULL,
    p_work_center_code varchar DEFAULT NULL,
    p_operation_code   varchar DEFAULT NULL,
    p_material_code    varchar DEFAULT NULL,
    p_product_group    varchar DEFAULT NULL,
    p_usage_context    varchar DEFAULT 'ANY',
    p_on_date          date DEFAULT current_date
)
RETURNS TABLE (
    group_code           varchar,
    group_name           varchar,
    control_mode         varchar,
    value_type           varchar,
    rule_found           boolean,
    rule_id              uuid,
    rule_name            varchar,
    detail_code          varchar,
    detail_description   varchar,
    min_value            numeric,
    max_value            numeric,
    target_value         numeric,
    text_value           varchar,
    boolean_value        boolean,
    uom                   varchar,
    validation_action    varchar,
    validation_message   varchar,
    priority_no           integer
)
LANGUAGE sql
STABLE
AS $$
SELECT
    g.group_code,
    g.group_name,
    g.control_mode,
    g.value_type,
    (r.rule_id IS NOT NULL) AS rule_found,
    r.rule_id,
    r.rule_name,
    r.detail_code,
    r.detail_description,
    r.min_value,
    r.max_value,
    r.target_value,
    r.text_value,
    r.boolean_value,
    COALESCE(r.uom,g.default_uom) AS uom,
    r.validation_action,
    r.validation_message,
    r.priority_no
FROM mes.group_code_master g
LEFT JOIN LATERAL (
    SELECT v.*,
           (
             CASE WHEN v.work_center_id IS NOT NULL THEN 64 ELSE 0 END +
             CASE WHEN v.operation_code IS NOT NULL THEN 32 ELSE 0 END +
             CASE WHEN v.plant_code IS NOT NULL THEN 16 ELSE 0 END +
             CASE WHEN v.company_code IS NOT NULL THEN 8 ELSE 0 END +
             CASE WHEN v.material_code IS NOT NULL THEN 4 ELSE 0 END +
             CASE WHEN v.product_group IS NOT NULL THEN 2 ELSE 0 END +
             CASE WHEN v.usage_context <> 'ANY' THEN 1 ELSE 0 END
           ) AS specificity_score
      FROM mes.vw_group_code_rule v
     WHERE v.group_code=g.group_code
       AND v.is_active=true
       AND (v.effective_from IS NULL OR v.effective_from <= p_on_date)
       AND (v.effective_to IS NULL OR v.effective_to >= p_on_date)
       AND (v.company_code IS NULL OR v.company_code=upper(NULLIF(trim(p_company_code),'')))
       AND (v.plant_code IS NULL OR v.plant_code=upper(NULLIF(trim(p_plant_code),'')))
       AND (v.work_center_code IS NULL OR v.work_center_code=upper(NULLIF(trim(p_work_center_code),'')))
       AND (v.operation_code IS NULL OR v.operation_code=upper(NULLIF(trim(p_operation_code),'')))
       AND (v.material_code IS NULL OR v.material_code=upper(NULLIF(trim(p_material_code),'')))
       AND (v.product_group IS NULL OR v.product_group=upper(NULLIF(trim(p_product_group),'')))
       AND (v.usage_context='ANY' OR v.usage_context=upper(COALESCE(NULLIF(trim(p_usage_context),''),'ANY')))
     ORDER BY specificity_score DESC, v.priority_no ASC, v.updated_at DESC
     LIMIT 1
) r ON true
WHERE g.group_code=upper(trim(p_group_code))
  AND g.is_active=true
  AND (
      upper(COALESCE(NULLIF(trim(p_usage_context),''),'ANY'))='ANY'
      OR (upper(p_usage_context)='PLANNING' AND g.use_in_planning)
      OR (upper(p_usage_context)='PRODUCTION' AND g.use_in_production)
      OR (upper(p_usage_context)='QUALITY' AND g.use_in_quality)
  );
$$;

COMMENT ON FUNCTION mes.resolve_group_control IS
'Generic runtime resolver. Application modules call this function with Group Code + context to obtain business-maintained limits/values. This removes hardcoded business control values from Planning, Production and Quality code.';

-- --------------------------------------------------------------------------
-- 7. Register Group Code screen 7104 in Masters module
-- --------------------------------------------------------------------------
INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MDM_GROUP_CODES','7104','7104','Group Code & Dynamic Controls','MASTER',
       'Central parameter, lookup and runtime-control master for Planning, Production and Quality',
       '/masters/group-codes','Phase 1','BUILT','ACTIVE',true,true,7104,true
FROM mes.app_module m WHERE m.module_code='MDM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,screen_no=EXCLUDED.screen_no,proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,screen_type=EXCLUDED.screen_type,description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,phase=EXCLUDED.phase,implementation_status=EXCLUDED.implementation_status,
 screen_status=EXCLUDED.screen_status,direct_call_enabled=EXCLUDED.direct_call_enabled,
 is_authorizable=EXCLUDED.is_authorizable,sequence_no=EXCLUDED.sequence_no,is_active=EXCLUDED.is_active,updated_at=now();

UPDATE mes.app_screen
   SET description='Company + Plant specific Work Center master with year/month/day capacity milestones',
       updated_at=now()
 WHERE screen_code='MDM_WORK_CENTERS';

COMMIT;

INSERT INTO mes.schema_version(version_no, description)
VALUES ('2.0.2', 'Work Center capacity milestones + dynamic Group Code control engine for Planning/Production/Quality')
ON CONFLICT (version_no) DO UPDATE
SET description=EXCLUDED.description, applied_at=now();

-- Verification
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema='mes'
   AND table_name IN ('work_center_capacity_milestone','group_code_master','group_code_detail','group_code_rule')
 ORDER BY table_name;

SELECT screen_no,screen_code,screen_name,route_path
FROM mes.app_screen WHERE screen_code='MDM_GROUP_CODES';
