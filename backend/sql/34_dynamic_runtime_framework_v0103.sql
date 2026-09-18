-- ============================================================================
-- COLORSHINE MES V2 v0.10.3
-- OPERATION MASTER + SCREEN CONTROL BINDINGS + GENERIC RUNTIME VALIDATION
-- ============================================================================
-- This migration extends the v0.10.2 Group Code engine so Planning,
-- Production and Quality can consume the same business-maintained controls.
-- No business values are seeded here.
-- ============================================================================

SET search_path TO mes, public;
BEGIN;

-- --------------------------------------------------------------------------
-- 1. Operation Master: Company + Plant + Work Center specific
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.operation_master (
    operation_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_code             varchar(4) NOT NULL REFERENCES mes.company_master(company_code),
    plant_code               varchar(4) NOT NULL REFERENCES mes.plant_master(plant_code),
    work_center_id           uuid NOT NULL REFERENCES mes.work_center_master(work_center_id) ON DELETE CASCADE,
    operation_code           varchar(60) NOT NULL,
    operation_name           varchar(160) NOT NULL,
    description              varchar(1000),
    sequence_no              integer NOT NULL DEFAULT 100,
    planning_relevant        boolean NOT NULL DEFAULT true,
    confirmation_required    boolean NOT NULL DEFAULT true,
    quality_relevant         boolean NOT NULL DEFAULT false,
    is_active                boolean NOT NULL DEFAULT true,
    created_by_user_id       uuid REFERENCES mes.app_user(user_id),
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_operation_wc_code UNIQUE(work_center_id, operation_code)
);

CREATE INDEX IF NOT EXISTS ix_operation_scope
    ON mes.operation_master(company_code, plant_code, work_center_id, is_active, sequence_no);

CREATE OR REPLACE FUNCTION mes.validate_operation_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_wc_company varchar(4);
    v_wc_plant   varchar(4);
BEGIN
    NEW.operation_code := upper(trim(NEW.operation_code));
    NEW.operation_name := trim(NEW.operation_name);
    NEW.updated_at := now();

    SELECT company_code, plant_code
      INTO v_wc_company, v_wc_plant
      FROM mes.work_center_master
     WHERE work_center_id = NEW.work_center_id;

    IF v_wc_company IS NULL THEN
        RAISE EXCEPTION 'Work Center % does not exist.', NEW.work_center_id;
    END IF;

    IF NEW.company_code <> v_wc_company OR NEW.plant_code <> v_wc_plant THEN
        RAISE EXCEPTION 'Operation scope %/% does not match Work Center scope %/%.',
            NEW.company_code, NEW.plant_code, v_wc_company, v_wc_plant;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_operation_scope ON mes.operation_master;
CREATE TRIGGER trg_validate_operation_scope
BEFORE INSERT OR UPDATE ON mes.operation_master
FOR EACH ROW EXECUTE FUNCTION mes.validate_operation_scope();

CREATE OR REPLACE VIEW mes.vw_operation_master AS
SELECT
    o.*,
    c.company_name,
    c.short_name AS company_short_name,
    p.plant_name,
    w.work_center_code,
    w.work_center_name,
    w.process_area
FROM mes.operation_master o
JOIN mes.company_master c ON c.company_code=o.company_code
JOIN mes.plant_master p ON p.plant_code=o.plant_code
JOIN mes.work_center_master w ON w.work_center_id=o.work_center_id;

-- --------------------------------------------------------------------------
-- 2. Group Code missing-rule policy: configurable, not coded in transactions
-- --------------------------------------------------------------------------
ALTER TABLE mes.group_code_master
    ADD COLUMN IF NOT EXISTS missing_rule_action varchar(20) NOT NULL DEFAULT 'ERROR';
ALTER TABLE mes.group_code_master
    ADD COLUMN IF NOT EXISTS missing_rule_message varchar(500);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname='ck_group_code_missing_rule_action'
           AND conrelid='mes.group_code_master'::regclass
    ) THEN
        ALTER TABLE mes.group_code_master
          ADD CONSTRAINT ck_group_code_missing_rule_action
          CHECK (missing_rule_action IN ('ERROR','WARNING','INFO','IGNORE'));
    END IF;
END $$;

-- --------------------------------------------------------------------------
-- 3. Validate Group Code rule scope against Company/Plant/WC/Operation master
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mes.validate_group_code_rule_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_wc_company varchar(4);
    v_wc_plant   varchar(4);
    v_op_exists  boolean;
BEGIN
    NEW.operation_code := upper(NULLIF(trim(NEW.operation_code),''));
    NEW.material_code := upper(NULLIF(trim(NEW.material_code),''));
    NEW.product_group := upper(NULLIF(trim(NEW.product_group),''));
    NEW.company_code := upper(NULLIF(trim(NEW.company_code),''));
    NEW.plant_code := upper(NULLIF(trim(NEW.plant_code),''));
    NEW.usage_context := upper(COALESCE(NULLIF(trim(NEW.usage_context),''),'ANY'));
    NEW.validation_action := upper(COALESCE(NULLIF(trim(NEW.validation_action),''),'ERROR'));
    NEW.updated_at := now();

    IF NEW.plant_code IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM mes.plant_master p WHERE p.plant_code=NEW.plant_code) THEN
            RAISE EXCEPTION 'Plant % does not exist.', NEW.plant_code;
        END IF;
        IF NEW.company_code IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM mes.plant_master p
             WHERE p.plant_code=NEW.plant_code AND p.company_code=NEW.company_code
        ) THEN
            RAISE EXCEPTION 'Plant % is not assigned to Company %.', NEW.plant_code, NEW.company_code;
        END IF;
    END IF;

    IF NEW.work_center_id IS NOT NULL THEN
        SELECT company_code, plant_code
          INTO v_wc_company, v_wc_plant
          FROM mes.work_center_master
         WHERE work_center_id=NEW.work_center_id;
        IF v_wc_company IS NULL THEN
            RAISE EXCEPTION 'Work Center % does not exist.', NEW.work_center_id;
        END IF;

        IF NEW.company_code IS NULL THEN NEW.company_code := v_wc_company; END IF;
        IF NEW.plant_code IS NULL THEN NEW.plant_code := v_wc_plant; END IF;

        IF NEW.company_code<>v_wc_company OR NEW.plant_code<>v_wc_plant THEN
            RAISE EXCEPTION 'Rule Company/Plant %/% does not match Work Center %/%.',
                NEW.company_code,NEW.plant_code,v_wc_company,v_wc_plant;
        END IF;
    END IF;

    IF NEW.operation_code IS NOT NULL THEN
        IF NEW.work_center_id IS NULL THEN
            RAISE EXCEPTION 'Operation Code requires a Work Center on the rule.';
        END IF;
        SELECT EXISTS(
            SELECT 1 FROM mes.operation_master o
             WHERE o.work_center_id=NEW.work_center_id
               AND o.operation_code=NEW.operation_code
               AND o.is_active=true
        ) INTO v_op_exists;
        IF NOT v_op_exists THEN
            RAISE EXCEPTION 'Operation % is not active for the selected Work Center.', NEW.operation_code;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_group_code_rule_scope ON mes.group_code_rule;
CREATE TRIGGER trg_validate_group_code_rule_scope
BEFORE INSERT OR UPDATE ON mes.group_code_rule
FOR EACH ROW EXECUTE FUNCTION mes.validate_group_code_rule_scope();

-- --------------------------------------------------------------------------
-- 4. Screen -> Group Code binding
--    This lets a screen declare which configurable controls it consumes.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.screen_group_control_binding (
    binding_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    screen_id               uuid NOT NULL REFERENCES mes.app_screen(screen_id) ON DELETE CASCADE,
    control_key             varchar(80) NOT NULL,
    group_code_id           uuid NOT NULL REFERENCES mes.group_code_master(group_code_id) ON DELETE CASCADE,
    usage_context           varchar(20) NOT NULL DEFAULT 'ANY',
    validation_timing       varchar(20) NOT NULL DEFAULT 'ON_SAVE',
    input_mode              varchar(20) NOT NULL DEFAULT 'AUTO',
    is_required             boolean NOT NULL DEFAULT false,
    sequence_no             integer NOT NULL DEFAULT 100,
    is_active               boolean NOT NULL DEFAULT true,
    created_by_user_id      uuid REFERENCES mes.app_user(user_id),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_screen_control_key UNIQUE(screen_id, control_key),
    CONSTRAINT ck_screen_control_context CHECK (usage_context IN ('ANY','PLANNING','PRODUCTION','QUALITY')),
    CONSTRAINT ck_screen_control_timing CHECK (validation_timing IN ('LOAD','ON_CHANGE','ON_SAVE','ON_CONFIRM')),
    CONSTRAINT ck_screen_control_input_mode CHECK (input_mode IN ('AUTO','NUMBER','CODE','TEXT','BOOLEAN','NONE'))
);

CREATE INDEX IF NOT EXISTS ix_screen_control_binding_lookup
    ON mes.screen_group_control_binding(screen_id,is_active,sequence_no);
CREATE INDEX IF NOT EXISTS ix_screen_control_binding_group
    ON mes.screen_group_control_binding(group_code_id,is_active);

CREATE OR REPLACE FUNCTION mes.normalize_screen_control_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_plan boolean;
    v_prod boolean;
    v_qual boolean;
BEGIN
    NEW.control_key := upper(trim(NEW.control_key));
    NEW.usage_context := upper(trim(NEW.usage_context));
    NEW.validation_timing := upper(trim(NEW.validation_timing));
    NEW.input_mode := upper(trim(NEW.input_mode));
    NEW.updated_at := now();

    SELECT use_in_planning,use_in_production,use_in_quality
      INTO v_plan,v_prod,v_qual
      FROM mes.group_code_master WHERE group_code_id=NEW.group_code_id;

    IF NEW.usage_context='PLANNING' AND NOT COALESCE(v_plan,false) THEN
        RAISE EXCEPTION 'This Group Code is not enabled for Planning.';
    ELSIF NEW.usage_context='PRODUCTION' AND NOT COALESCE(v_prod,false) THEN
        RAISE EXCEPTION 'This Group Code is not enabled for Production.';
    ELSIF NEW.usage_context='QUALITY' AND NOT COALESCE(v_qual,false) THEN
        RAISE EXCEPTION 'This Group Code is not enabled for Quality.';
    END IF;

    RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_normalize_screen_control_binding ON mes.screen_group_control_binding;
CREATE TRIGGER trg_normalize_screen_control_binding
BEFORE INSERT OR UPDATE ON mes.screen_group_control_binding
FOR EACH ROW EXECUTE FUNCTION mes.normalize_screen_control_binding();

CREATE OR REPLACE VIEW mes.vw_screen_group_control_binding AS
SELECT
    b.binding_id,
    b.screen_id,
    s.screen_no,
    s.screen_code,
    s.screen_name,
    m.module_code,
    b.control_key,
    b.group_code_id,
    g.group_code,
    g.group_name,
    g.control_mode,
    g.value_type,
    g.default_uom,
    b.usage_context,
    b.validation_timing,
    b.input_mode,
    b.is_required,
    b.sequence_no,
    b.is_active,
    b.created_at,
    b.updated_at
FROM mes.screen_group_control_binding b
JOIN mes.app_screen s ON s.screen_id=b.screen_id
JOIN mes.app_module m ON m.module_id=s.module_id
JOIN mes.group_code_master g ON g.group_code_id=b.group_code_id;

-- --------------------------------------------------------------------------
-- 5. Generic runtime validator
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mes.validate_group_control(
    p_group_code       varchar,
    p_company_code     varchar DEFAULT NULL,
    p_plant_code       varchar DEFAULT NULL,
    p_work_center_code varchar DEFAULT NULL,
    p_operation_code   varchar DEFAULT NULL,
    p_material_code    varchar DEFAULT NULL,
    p_product_group    varchar DEFAULT NULL,
    p_usage_context    varchar DEFAULT 'ANY',
    p_on_date          date DEFAULT current_date,
    p_actual_number    numeric DEFAULT NULL,
    p_actual_code      varchar DEFAULT NULL,
    p_actual_text      varchar DEFAULT NULL,
    p_actual_boolean   boolean DEFAULT NULL
)
RETURNS TABLE (
    group_code           varchar,
    group_name           varchar,
    control_mode         varchar,
    value_type           varchar,
    configured           boolean,
    rule_found           boolean,
    passed               boolean,
    blocks_transaction   boolean,
    result_action        varchar,
    result_message       varchar,
    actual_number        numeric,
    actual_code          varchar,
    actual_text          varchar,
    actual_boolean       boolean,
    min_value            numeric,
    max_value            numeric,
    target_value         numeric,
    expected_code        varchar,
    expected_text        varchar,
    expected_boolean     boolean,
    uom                   varchar,
    rule_id               uuid,
    rule_name             varchar
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v record;
    v_missing_action varchar(20);
    v_missing_message varchar(500);
    v_pass boolean;
    v_action varchar(20);
    v_message varchar(500);
    v_lookup_ok boolean;
BEGIN
    SELECT
        g.group_code_id,
        g.group_code AS master_group_code,
        g.group_name AS master_group_name,
        g.control_mode AS master_control_mode,
        g.value_type AS master_value_type,
        g.default_uom AS master_uom,
        g.missing_rule_action,
        g.missing_rule_message,
        r.rule_found,
        r.rule_id,
        r.rule_name,
        r.detail_code,
        r.detail_description,
        r.min_value,
        r.max_value,
        r.target_value,
        r.text_value,
        r.boolean_value,
        r.uom,
        r.validation_action,
        r.validation_message,
        r.priority_no
      INTO v
      FROM mes.group_code_master g
      LEFT JOIN LATERAL mes.resolve_group_control(
          g.group_code,p_company_code,p_plant_code,p_work_center_code,p_operation_code,
          p_material_code,p_product_group,p_usage_context,p_on_date
      ) r ON true
     WHERE g.group_code=upper(trim(p_group_code)) AND g.is_active=true;

    IF NOT FOUND THEN
        RETURN QUERY SELECT
            upper(trim(p_group_code))::varchar,NULL::varchar,NULL::varchar,NULL::varchar,
            false,false,false,true,'ERROR'::varchar,
            'Group Code is not configured or inactive.'::varchar,
            p_actual_number,upper(NULLIF(trim(p_actual_code),''))::varchar,p_actual_text,p_actual_boolean,
            NULL::numeric,NULL::numeric,NULL::numeric,NULL::varchar,NULL::varchar,NULL::boolean,NULL::varchar,NULL::uuid,NULL::varchar;
        RETURN;
    END IF;

    v_missing_action := COALESCE(v.missing_rule_action,'ERROR');
    v_missing_message := COALESCE(v.missing_rule_message,'No applicable active rule is maintained for this context.');
    v_pass := true;
    v_action := 'OK';
    v_message := 'Validation passed.';

    IF v.master_control_mode='LOOKUP' THEN
        IF p_actual_code IS NULL OR trim(p_actual_code)='' THEN
            v_pass := false;
            v_action := COALESCE(v.validation_action,v_missing_action);
            v_message := COALESCE(v.validation_message,'A valid code is required.');
        ELSE
            SELECT EXISTS(
                SELECT 1
                  FROM mes.group_code_detail d
                 WHERE d.group_code_id=v.group_code_id
                   AND d.detail_code=upper(trim(p_actual_code))
                   AND d.is_active=true
                   AND (v.detail_code IS NULL OR d.detail_code=v.detail_code)
            ) INTO v_lookup_ok;
            v_pass := v_lookup_ok;
            IF NOT v_pass THEN
                v_action := COALESCE(v.validation_action,'ERROR');
                v_message := COALESCE(v.validation_message,'The selected code is not allowed by the current Group Code configuration.');
            END IF;
        END IF;

    ELSIF NOT COALESCE(v.rule_found,false) THEN
        v_pass := (v_missing_action='IGNORE');
        v_action := v_missing_action;
        v_message := v_missing_message;

    ELSIF v.master_control_mode='RANGE' THEN
        v_pass := p_actual_number IS NOT NULL
                  AND (v.min_value IS NULL OR p_actual_number>=v.min_value)
                  AND (v.max_value IS NULL OR p_actual_number<=v.max_value);
        IF NOT v_pass THEN
            v_action := COALESCE(v.validation_action,'ERROR');
            v_message := COALESCE(v.validation_message,
                'Entered value is outside the configured minimum/maximum range.');
        END IF;

    ELSIF v.master_control_mode='VALUE' THEN
        v_pass := p_actual_number IS NOT NULL AND v.target_value IS NOT NULL AND p_actual_number=v.target_value;
        IF NOT v_pass THEN
            v_action := COALESCE(v.validation_action,'ERROR');
            v_message := COALESCE(v.validation_message,'Entered value does not match the configured target value.');
        END IF;

    ELSIF v.master_control_mode='BOOLEAN' THEN
        v_pass := p_actual_boolean IS NOT NULL AND v.boolean_value IS NOT NULL AND p_actual_boolean=v.boolean_value;
        IF NOT v_pass THEN
            v_action := COALESCE(v.validation_action,'ERROR');
            v_message := COALESCE(v.validation_message,'Entered option does not match the configured control.');
        END IF;

    ELSIF v.master_control_mode='TEXT' THEN
        v_pass := p_actual_text IS NOT NULL AND v.text_value IS NOT NULL AND p_actual_text=v.text_value;
        IF NOT v_pass THEN
            v_action := COALESCE(v.validation_action,'ERROR');
            v_message := COALESCE(v.validation_message,'Entered text does not match the configured control.');
        END IF;
    END IF;

    RETURN QUERY SELECT
        v.master_group_code::varchar,
        v.master_group_name::varchar,
        v.master_control_mode::varchar,
        v.master_value_type::varchar,
        true,
        COALESCE(v.rule_found,false),
        v_pass,
        (NOT v_pass AND v_action='ERROR'),
        v_action::varchar,
        v_message::varchar,
        p_actual_number,
        upper(NULLIF(trim(p_actual_code),''))::varchar,
        p_actual_text,
        p_actual_boolean,
        v.min_value,
        v.max_value,
        v.target_value,
        v.detail_code::varchar,
        v.text_value::varchar,
        v.boolean_value,
        COALESCE(v.uom,v.master_uom)::varchar,
        v.rule_id,
        v.rule_name::varchar;
END;
$$;

COMMENT ON FUNCTION mes.validate_group_control IS
'One generic validator for Planning, Production and Quality. It resolves the most-specific active Group Code rule at runtime, validates the entered value and returns whether the transaction must be blocked.';

-- --------------------------------------------------------------------------
-- 6. Resolve every configured control for a screen in one call
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mes.resolve_screen_controls(
    p_screen_code       varchar,
    p_company_code      varchar DEFAULT NULL,
    p_plant_code        varchar DEFAULT NULL,
    p_work_center_code  varchar DEFAULT NULL,
    p_operation_code    varchar DEFAULT NULL,
    p_material_code     varchar DEFAULT NULL,
    p_product_group     varchar DEFAULT NULL,
    p_on_date           date DEFAULT current_date
)
RETURNS TABLE (
    binding_id           uuid,
    control_key          varchar,
    screen_code          varchar,
    group_code           varchar,
    group_name           varchar,
    control_mode         varchar,
    value_type           varchar,
    usage_context        varchar,
    validation_timing    varchar,
    input_mode           varchar,
    is_required          boolean,
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
    sequence_no          integer
)
LANGUAGE sql
STABLE
AS $$
SELECT
    b.binding_id,
    b.control_key,
    b.screen_code,
    b.group_code,
    b.group_name,
    r.control_mode,
    r.value_type,
    b.usage_context,
    b.validation_timing,
    b.input_mode,
    b.is_required,
    COALESCE(r.rule_found,false),
    r.rule_id,
    r.rule_name,
    r.detail_code,
    r.detail_description,
    r.min_value,
    r.max_value,
    r.target_value,
    r.text_value,
    r.boolean_value,
    r.uom,
    r.validation_action,
    r.validation_message,
    b.sequence_no
FROM mes.vw_screen_group_control_binding b
LEFT JOIN LATERAL mes.resolve_group_control(
    b.group_code,
    p_company_code,p_plant_code,p_work_center_code,p_operation_code,
    p_material_code,p_product_group,b.usage_context,p_on_date
) r ON true
WHERE b.screen_code=upper(trim(p_screen_code))
  AND b.is_active=true
ORDER BY b.sequence_no,b.control_key;
$$;

-- --------------------------------------------------------------------------
-- 7. Register Operation Master screen 7105
-- --------------------------------------------------------------------------
INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'MDM_OPERATIONS','7105','7105','Operation Master','MASTER',
       'Company + Plant + Work Center specific operations used by Planning, Production, Quality and Group Code controls',
       '/masters/operations','Phase 1','BUILT','ACTIVE',true,true,7105,true
FROM mes.app_module m WHERE m.module_code='MDM'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,screen_no=EXCLUDED.screen_no,proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,screen_type=EXCLUDED.screen_type,description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,phase=EXCLUDED.phase,implementation_status=EXCLUDED.implementation_status,
 screen_status=EXCLUDED.screen_status,direct_call_enabled=EXCLUDED.direct_call_enabled,
 is_authorizable=EXCLUDED.is_authorizable,sequence_no=EXCLUDED.sequence_no,is_active=EXCLUDED.is_active,updated_at=now();

COMMIT;

INSERT INTO mes.schema_version(version_no, description)
VALUES ('2.0.3', 'Operation Master + screen Group Code bindings + generic runtime validation framework')
ON CONFLICT (version_no) DO UPDATE
SET description=EXCLUDED.description, applied_at=now();

-- Verification
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema='mes'
   AND table_name IN ('operation_master','screen_group_control_binding')
 ORDER BY table_name;
SELECT screen_no,screen_code,screen_name,route_path
  FROM mes.app_screen WHERE screen_code='MDM_OPERATIONS';
