-- ============================================================================
-- COLORSHINE MES V2 v0.11.0
-- TDC TEMPLATE-FIRST FOUNDATION + SYSTEM NUMBER OBJECT + VERSIONED APPROVAL FLOW
-- Scope: Company 2000 / Plant 2000 only for this phase.
-- ============================================================================
SET search_path TO mes, public;
BEGIN;

-- --------------------------------------------------------------------------
-- 1. Dynamic category and series masters
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.tdc_category_master (
    category_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category_code        varchar(40) NOT NULL UNIQUE,
    category_name        varchar(140) NOT NULL,
    tdc_prefix           varchar(20) NOT NULL,
    description          varchar(500),
    is_active            boolean NOT NULL DEFAULT true,
    created_by_user_id   uuid REFERENCES mes.app_user(user_id),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mes.tdc_series_master (
    series_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    series_code          varchar(20) NOT NULL UNIQUE,
    series_name          varchar(120) NOT NULL,
    description          varchar(500),
    is_active            boolean NOT NULL DEFAULT true,
    created_by_user_id   uuid REFERENCES mes.app_user(user_id),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION mes.normalize_tdc_codes()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME='tdc_category_master' THEN
        NEW.category_code := upper(trim(NEW.category_code));
        NEW.tdc_prefix := upper(trim(NEW.tdc_prefix));
    ELSIF TG_TABLE_NAME='tdc_series_master' THEN
        NEW.series_code := upper(trim(NEW.series_code));
    ELSIF TG_TABLE_NAME='tdc_characteristic_master' THEN
        NEW.characteristic_code := upper(trim(NEW.characteristic_code));
    ELSIF TG_TABLE_NAME='tdc_template_header' THEN
        NEW.template_code := upper(trim(NEW.template_code));
        NEW.tdc_prefix := upper(trim(NEW.tdc_prefix));
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_normalize_tdc_category ON mes.tdc_category_master;
CREATE TRIGGER trg_normalize_tdc_category BEFORE INSERT OR UPDATE ON mes.tdc_category_master
FOR EACH ROW EXECUTE FUNCTION mes.normalize_tdc_codes();
DROP TRIGGER IF EXISTS trg_normalize_tdc_series ON mes.tdc_series_master;
CREATE TRIGGER trg_normalize_tdc_series BEFORE INSERT OR UPDATE ON mes.tdc_series_master
FOR EACH ROW EXECUTE FUNCTION mes.normalize_tdc_codes();

-- --------------------------------------------------------------------------
-- 2. Characteristic master. Every characteristic is also a Group Code detail.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.tdc_characteristic_master (
    characteristic_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    characteristic_code    varchar(80) NOT NULL UNIQUE,
    characteristic_name    varchar(180) NOT NULL,
    group_code_id           uuid NOT NULL REFERENCES mes.group_code_master(group_code_id),
    group_detail_id         uuid NOT NULL REFERENCES mes.group_code_detail(detail_id),
    data_type               varchar(20) NOT NULL DEFAULT 'TEXT',
    default_uom             varchar(20),
    default_value_mode      varchar(30) NOT NULL DEFAULT 'TEXT',
    help_text               varchar(1000),
    is_active               boolean NOT NULL DEFAULT true,
    created_by_user_id      uuid REFERENCES mes.app_user(user_id),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_tdc_char_data_type CHECK(data_type IN ('TEXT','NUMBER','BOOLEAN','DATE')),
    CONSTRAINT ck_tdc_char_value_mode CHECK(default_value_mode IN ('EXACT','MIN','MAX','RANGE','PLUS_MINUS','AS_PER_SO','AS_PER_PO','AS_PER_STANDARD','TEXT','NA')),
    CONSTRAINT ux_tdc_char_group_detail UNIQUE(group_detail_id)
);

DROP TRIGGER IF EXISTS trg_normalize_tdc_characteristic ON mes.tdc_characteristic_master;
CREATE TRIGGER trg_normalize_tdc_characteristic BEFORE INSERT OR UPDATE ON mes.tdc_characteristic_master
FOR EACH ROW EXECUTE FUNCTION mes.normalize_tdc_codes();

-- --------------------------------------------------------------------------
-- 3. Template header and template-characteristic mapping
-- ACTIVE templates are immutable in application logic. Copy creates a new DRAFT.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.tdc_template_header (
    template_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_code           varchar(80) NOT NULL UNIQUE,
    template_name           varchar(180) NOT NULL,
    company_code            varchar(4) NOT NULL REFERENCES mes.company_master(company_code),
    plant_code              varchar(4) NOT NULL REFERENCES mes.plant_master(plant_code),
    category_id             uuid NOT NULL REFERENCES mes.tdc_category_master(category_id),
    tdc_prefix              varchar(20) NOT NULL,
    template_status         varchar(20) NOT NULL DEFAULT 'DRAFT',
    is_system_template      boolean NOT NULL DEFAULT false,
    source_template_id      uuid REFERENCES mes.tdc_template_header(template_id),
    description             varchar(1000),
    is_active               boolean NOT NULL DEFAULT true,
    created_by_user_id      uuid REFERENCES mes.app_user(user_id),
    created_at              timestamptz NOT NULL DEFAULT now(),
    activated_at            timestamptz,
    deactivated_at          timestamptz,
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_tdc_template_status CHECK(template_status IN ('DRAFT','ACTIVE','INACTIVE'))
);

DROP TRIGGER IF EXISTS trg_normalize_tdc_template ON mes.tdc_template_header;
CREATE TRIGGER trg_normalize_tdc_template BEFORE INSERT OR UPDATE ON mes.tdc_template_header
FOR EACH ROW EXECUTE FUNCTION mes.normalize_tdc_codes();

CREATE TABLE IF NOT EXISTS mes.tdc_template_characteristic (
    template_characteristic_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id                uuid NOT NULL REFERENCES mes.tdc_template_header(template_id) ON DELETE CASCADE,
    characteristic_id          uuid NOT NULL REFERENCES mes.tdc_characteristic_master(characteristic_id),
    section_code               varchar(40) NOT NULL,
    sequence_no                integer NOT NULL DEFAULT 100,
    display_label              varchar(180),
    is_required                boolean NOT NULL DEFAULT false,
    default_value_mode         varchar(30),
    default_uom                varchar(20),
    default_specification      varchar(2000),
    is_active                  boolean NOT NULL DEFAULT true,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_tdc_template_characteristic UNIQUE(template_id, characteristic_id),
    CONSTRAINT ck_tdc_template_section CHECK(section_code IN ('GENERAL','DIMENSION','CHEMICAL','MECHANICAL','SURFACE_COATING','DISPATCH_PACKING')),
    CONSTRAINT ck_tdc_template_value_mode CHECK(default_value_mode IS NULL OR default_value_mode IN ('EXACT','MIN','MAX','RANGE','PLUS_MINUS','AS_PER_SO','AS_PER_PO','AS_PER_STANDARD','TEXT','NA'))
);

CREATE INDEX IF NOT EXISTS ix_tdc_template_char_order
ON mes.tdc_template_characteristic(template_id,section_code,sequence_no);

-- --------------------------------------------------------------------------
-- 4. Number object - one counter by Plant + Prefix + Series.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.tdc_number_object (
    number_object_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_code             varchar(4) NOT NULL REFERENCES mes.plant_master(plant_code),
    tdc_prefix             varchar(20) NOT NULL,
    series_id              uuid NOT NULL REFERENCES mes.tdc_series_master(series_id),
    current_number         integer NOT NULL DEFAULT 0,
    padding_length         integer NOT NULL DEFAULT 4,
    is_active              boolean NOT NULL DEFAULT true,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_tdc_number_object UNIQUE(plant_code,tdc_prefix,series_id),
    CONSTRAINT ck_tdc_number_positive CHECK(current_number>=0),
    CONSTRAINT ck_tdc_padding CHECK(padding_length BETWEEN 3 AND 8)
);

CREATE OR REPLACE FUNCTION mes.next_tdc_number(p_plant_code varchar,p_tdc_prefix varchar,p_series_code varchar)
RETURNS varchar
LANGUAGE plpgsql
AS $$
DECLARE
    v_series_id uuid;
    v_series_code varchar(20);
    v_next integer;
    v_padding integer;
    v_prefix varchar(20):=upper(trim(p_tdc_prefix));
BEGIN
    SELECT series_id,series_code INTO v_series_id,v_series_code
      FROM mes.tdc_series_master
     WHERE series_code=upper(trim(p_series_code)) AND is_active=true;
    IF v_series_id IS NULL THEN
        RAISE EXCEPTION 'TDC Series % is not active.',p_series_code;
    END IF;

    INSERT INTO mes.tdc_number_object(plant_code,tdc_prefix,series_id,current_number,padding_length,is_active)
    VALUES(p_plant_code,v_prefix,v_series_id,0,4,true)
    ON CONFLICT(plant_code,tdc_prefix,series_id) DO NOTHING;

    SELECT current_number+1,padding_length INTO v_next,v_padding
      FROM mes.tdc_number_object
     WHERE plant_code=p_plant_code AND tdc_prefix=v_prefix AND series_id=v_series_id AND is_active=true
     FOR UPDATE;
    IF v_next IS NULL THEN
        RAISE EXCEPTION 'TDC Number Object is inactive for Plant %, Prefix %, Series %.',p_plant_code,v_prefix,p_series_code;
    END IF;

    UPDATE mes.tdc_number_object
       SET current_number=v_next,updated_at=now()
     WHERE plant_code=p_plant_code AND tdc_prefix=v_prefix AND series_id=v_series_id;

    RETURN v_prefix||'/'||v_series_code||'/'||lpad(v_next::text,v_padding,'0');
END $$;

-- --------------------------------------------------------------------------
-- 5. TDC document and immutable versions
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.tdc_master (
    tdc_id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tdc_no                  varchar(80) NOT NULL UNIQUE,
    company_code            varchar(4) NOT NULL REFERENCES mes.company_master(company_code),
    plant_code              varchar(4) NOT NULL REFERENCES mes.plant_master(plant_code),
    category_id             uuid NOT NULL REFERENCES mes.tdc_category_master(category_id),
    series_id               uuid NOT NULL REFERENCES mes.tdc_series_master(series_id),
    template_id             uuid NOT NULL REFERENCES mes.tdc_template_header(template_id),
    customer_code           varchar(40),
    customer_name           varchar(220) NOT NULL,
    document_title          varchar(300),
    customer_reference      varchar(120),
    sales_order_reference   varchar(120),
    current_version_no      integer NOT NULL DEFAULT 1,
    approved_version_no     integer,
    overall_status          varchar(30) NOT NULL DEFAULT 'DRAFT',
    is_active               boolean NOT NULL DEFAULT true,
    deactivation_reason     varchar(1000),
    deactivated_by_user_id  uuid REFERENCES mes.app_user(user_id),
    deactivated_at          timestamptz,
    created_by_user_id      uuid NOT NULL REFERENCES mes.app_user(user_id),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_tdc_master_status CHECK(overall_status IN ('DRAFT','PENDING_QC','PENDING_PPC','PENDING_PLANT','APPROVED','RETURNED','SUPERSEDED','INACTIVE'))
);

CREATE TABLE IF NOT EXISTS mes.tdc_version (
    tdc_version_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tdc_id                  uuid NOT NULL REFERENCES mes.tdc_master(tdc_id),
    version_no              integer NOT NULL,
    version_label           varchar(10) NOT NULL,
    template_id             uuid NOT NULL REFERENCES mes.tdc_template_header(template_id),
    tdc_date                date NOT NULL DEFAULT current_date,
    customer_code           varchar(40),
    customer_name           varchar(220) NOT NULL DEFAULT '',
    document_title          varchar(300),
    customer_reference      varchar(120),
    sales_order_reference   varchar(120),
    status                  varchar(30) NOT NULL DEFAULT 'DRAFT',
    approval_stage          varchar(30) NOT NULL DEFAULT 'CREATOR',
    revision_reason         varchar(1000),
    general_remarks         varchar(2000),
    source_version_id       uuid REFERENCES mes.tdc_version(tdc_version_id),
    created_by_user_id      uuid NOT NULL REFERENCES mes.app_user(user_id),
    submitted_at            timestamptz,
    approved_at             timestamptz,
    superseded_at           timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_tdc_version UNIQUE(tdc_id,version_no),
    CONSTRAINT ck_tdc_version_status CHECK(status IN ('DRAFT','PENDING_QC','PENDING_PPC','PENDING_PLANT','APPROVED','RETURNED','SUPERSEDED','INACTIVE')),
    CONSTRAINT ck_tdc_version_stage CHECK(approval_stage IN ('CREATOR','QC_HEAD','PPC_HEAD','PLANT_HEAD','COMPLETE','RETURNED'))
);

CREATE INDEX IF NOT EXISTS ix_tdc_version_document ON mes.tdc_version(tdc_id,version_no DESC);
CREATE INDEX IF NOT EXISTS ix_tdc_version_approval ON mes.tdc_version(status,approval_stage);

CREATE TABLE IF NOT EXISTS mes.tdc_characteristic_value (
    value_id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tdc_version_id             uuid NOT NULL REFERENCES mes.tdc_version(tdc_version_id) ON DELETE CASCADE,
    characteristic_id          uuid NOT NULL REFERENCES mes.tdc_characteristic_master(characteristic_id),
    characteristic_code        varchar(80) NOT NULL,
    characteristic_name        varchar(180) NOT NULL,
    section_code               varchar(40) NOT NULL,
    sequence_no                integer NOT NULL,
    display_label              varchar(180) NOT NULL,
    is_required                boolean NOT NULL DEFAULT false,
    uom                        varchar(20),
    value_mode                 varchar(30) NOT NULL DEFAULT 'TEXT',
    colorshine_specification   varchar(2000),
    customer_comment           varchar(2000),
    final_agreed_specification varchar(2000),
    min_value                  numeric(18,6),
    max_value                  numeric(18,6),
    target_value               numeric(18,6),
    tolerance_minus            numeric(18,6),
    tolerance_plus             numeric(18,6),
    updated_at                 timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_tdc_version_characteristic UNIQUE(tdc_version_id,characteristic_id),
    CONSTRAINT ck_tdc_value_mode CHECK(value_mode IN ('EXACT','MIN','MAX','RANGE','PLUS_MINUS','AS_PER_SO','AS_PER_PO','AS_PER_STANDARD','TEXT','NA'))
);

CREATE INDEX IF NOT EXISTS ix_tdc_value_section ON mes.tdc_characteristic_value(tdc_version_id,section_code,sequence_no);

-- --------------------------------------------------------------------------
-- 6. Approval history and e-mail outbox
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.tdc_workflow_approval (
    approval_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tdc_version_id          uuid NOT NULL REFERENCES mes.tdc_version(tdc_version_id) ON DELETE CASCADE,
    approval_sequence       integer NOT NULL,
    approval_stage          varchar(30) NOT NULL,
    approver_group_code     varchar(60),
    approval_status         varchar(20) NOT NULL DEFAULT 'WAITING',
    action_by_user_id       uuid REFERENCES mes.app_user(user_id),
    action_by_username      varchar(80),
    action_at               timestamptz,
    remarks                 varchar(2000),
    intended_email          varchar(1000),
    actual_email            varchar(1000),
    email_status            varchar(30),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_tdc_workflow_approval_stage UNIQUE(tdc_version_id,approval_sequence),
    CONSTRAINT ck_tdc_workflow_approval_stage CHECK(approval_stage IN ('CREATOR','QC_HEAD','PPC_HEAD','PLANT_HEAD')),
    CONSTRAINT ck_tdc_workflow_approval_status CHECK(approval_status IN ('WAITING','PENDING','APPROVED','RETURNED'))
);

CREATE TABLE IF NOT EXISTS mes.tdc_email_outbox (
    email_id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tdc_version_id          uuid REFERENCES mes.tdc_version(tdc_version_id) ON DELETE SET NULL,
    approval_id             uuid REFERENCES mes.tdc_workflow_approval(approval_id) ON DELETE SET NULL,
    event_code              varchar(60) NOT NULL,
    intended_to_email       varchar(1000),
    to_email                varchar(1000) NOT NULL,
    subject                 varchar(300) NOT NULL,
    html_body               text NOT NULL,
    email_status            varchar(30) NOT NULL DEFAULT 'QUEUED',
    attempt_count           integer NOT NULL DEFAULT 0,
    last_error              varchar(2000),
    queued_at               timestamptz NOT NULL DEFAULT now(),
    sent_at                 timestamptz,
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_tdc_email_status CHECK(email_status IN ('QUEUED','WAITING_SMTP','SENDING','SENT','FAILED'))
);

CREATE INDEX IF NOT EXISTS ix_tdc_email_pending ON mes.tdc_email_outbox(email_status,queued_at);

-- --------------------------------------------------------------------------
-- 7. Read views
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW mes.vw_tdc_register AS
SELECT
    m.tdc_id,m.tdc_no,m.company_code,m.plant_code,m.customer_code,m.customer_name,
    m.document_title,m.customer_reference,m.sales_order_reference,m.current_version_no,
    m.approved_version_no,m.overall_status,m.is_active,m.created_at,m.updated_at,
    c.category_code,c.category_name,c.tdc_prefix,s.series_code,s.series_name,
    t.template_code,t.template_name,
    v.tdc_version_id,v.version_label,v.tdc_date,v.status AS version_status,
    v.approval_stage,v.revision_reason,v.general_remarks,v.created_by_user_id,
    u.username AS created_by_username,u.display_name AS created_by_name
FROM mes.tdc_master m
JOIN mes.tdc_category_master c ON c.category_id=m.category_id
JOIN mes.tdc_series_master s ON s.series_id=m.series_id
JOIN mes.tdc_template_header t ON t.template_id=m.template_id
LEFT JOIN mes.tdc_version v ON v.tdc_id=m.tdc_id AND v.version_no=m.current_version_no
LEFT JOIN mes.app_user u ON u.user_id=v.created_by_user_id;

CREATE OR REPLACE VIEW mes.vw_tdc_number_object AS
SELECT n.number_object_id,n.plant_code,n.tdc_prefix,s.series_code,s.series_name,n.current_number,n.padding_length,
       n.tdc_prefix||'/'||s.series_code||'/'||lpad((n.current_number+1)::text,n.padding_length,'0') AS next_tdc_no,
       n.is_active,n.updated_at
FROM mes.tdc_number_object n
JOIN mes.tdc_series_master s ON s.series_id=n.series_id;

-- --------------------------------------------------------------------------
-- 8. Seed central TDC group codes
-- --------------------------------------------------------------------------
INSERT INTO mes.group_code_master(group_code,group_name,description,control_mode,value_type,default_uom,use_in_planning,use_in_production,use_in_quality,is_active)
VALUES
('TDC_GENERAL','TDC - General Characteristics','Reusable General/Data characteristics for TDC templates.','LOOKUP','CODE',NULL,false,false,true,true),
('TDC_DIMENSION','TDC - Dimensional Characteristics','Reusable dimensional characteristics for TDC templates.','LOOKUP','CODE','MM',false,false,true,true),
('TDC_CHEMICAL','TDC - Chemical Characteristics','Reusable chemical characteristics for TDC templates.','LOOKUP','CODE','%',false,false,true,true),
('TDC_MECHANICAL','TDC - Mechanical Characteristics','Reusable mechanical characteristics for TDC templates.','LOOKUP','CODE',NULL,false,false,true,true),
('TDC_SURFACE','TDC - Surface & Coating Characteristics','Reusable surface/coating characteristics for TDC templates.','LOOKUP','CODE',NULL,false,false,true,true),
('TDC_DISPATCH','TDC - Dispatch & Packing Characteristics','Reusable dispatch and packing characteristics for TDC templates.','LOOKUP','CODE',NULL,false,false,true,true),
('TDC_CATEGORY','TDC Category','Available TDC categories. New categories can be maintained without code change.','LOOKUP','CODE',NULL,false,false,true,true),
('TDC_SERIES','TDC Series','Available TDC numbering series such as OEM/DOM/CIPL.','LOOKUP','CODE',NULL,false,false,true,true),
('TDC_SECTION','TDC Wizard Section','TDC wizard tab/section definitions.','LOOKUP','CODE',NULL,false,false,true,true),
('TDC_VALUE_MODE','TDC Specification Value Mode','How the TDC specification value is interpreted.','LOOKUP','CODE',NULL,false,false,true,true),
('TDC_UOM','TDC Unit of Measure','Allowed TDC display units.','LOOKUP','CODE',NULL,false,false,true,true),
('TDC_APPROVAL_STAGE','TDC Approval Stage','TDC approval workflow stages.','LOOKUP','CODE',NULL,false,false,true,true),
('TDC_STATUS','TDC Status','TDC document/version statuses.','LOOKUP','CODE',NULL,false,false,true,true)
ON CONFLICT(group_code) DO UPDATE SET group_name=EXCLUDED.group_name,description=EXCLUDED.description,use_in_quality=true,is_active=true,updated_at=now();

-- Control group details
INSERT INTO mes.group_code_detail(group_code_id,detail_code,short_description,sequence_no,is_active)
SELECT g.group_code_id,x.code,x.descr,x.seq,true FROM mes.group_code_master g JOIN (VALUES
('TDC_CATEGORY','BGL_GL','BGL / GL',10),('TDC_CATEGORY','CRFH','CRFH',20),('TDC_CATEGORY','HRPO','HRPO',30),
('TDC_SERIES','OEM','OEM',10),('TDC_SERIES','DOM','DOM',20),('TDC_SERIES','CIPL','CIPL',30),
('TDC_SECTION','GENERAL','General Data',10),('TDC_SECTION','DIMENSION','Dimensions',20),('TDC_SECTION','CHEMICAL','Chemical',30),('TDC_SECTION','MECHANICAL','Mechanical',40),('TDC_SECTION','SURFACE_COATING','Surface & Coating',50),('TDC_SECTION','DISPATCH_PACKING','Dispatch & Packing',60),
('TDC_VALUE_MODE','EXACT','Exact Value',10),('TDC_VALUE_MODE','MIN','Minimum',20),('TDC_VALUE_MODE','MAX','Maximum',30),('TDC_VALUE_MODE','RANGE','Range',40),('TDC_VALUE_MODE','PLUS_MINUS','Plus / Minus Tolerance',50),('TDC_VALUE_MODE','AS_PER_SO','As per Sales Order',60),('TDC_VALUE_MODE','AS_PER_PO','As per Purchase Order',70),('TDC_VALUE_MODE','AS_PER_STANDARD','As per Standard',80),('TDC_VALUE_MODE','TEXT','Free Text',90),('TDC_VALUE_MODE','NA','Not Applicable',100),
('TDC_UOM','NA','NA',10),('TDC_UOM','MM','mm',20),('TDC_UOM','GSM','GSM',30),('TDC_UOM','MPA','MPa',40),('TDC_UOM','HRB','HRB',50),('TDC_UOM','PERCENT','%',60),('TDC_UOM','HOURS','Hours',70),('TDC_UOM','JOULES','Joules',80),('TDC_UOM','MT','MT',90),('TDC_UOM','MICRON','Micron',100),('TDC_UOM','MTR','Mtr',110),
('TDC_APPROVAL_STAGE','CREATOR','Creator Approval',10),('TDC_APPROVAL_STAGE','QC_HEAD','QC Head Approval',20),('TDC_APPROVAL_STAGE','PPC_HEAD','PPC Head Approval',30),('TDC_APPROVAL_STAGE','PLANT_HEAD','Plant Head Approval',40),
('TDC_STATUS','DRAFT','Draft',10),('TDC_STATUS','PENDING_QC','Pending QC Head',20),('TDC_STATUS','PENDING_PPC','Pending PPC Head',30),('TDC_STATUS','PENDING_PLANT','Pending Plant Head',40),('TDC_STATUS','APPROVED','Approved',50),('TDC_STATUS','RETURNED','Returned',60),('TDC_STATUS','SUPERSEDED','Superseded',70),('TDC_STATUS','INACTIVE','Inactive',80)
) x(group_code,code,descr,seq) ON g.group_code=x.group_code
ON CONFLICT(group_code_id,detail_code) DO UPDATE SET short_description=EXCLUDED.short_description,sequence_no=EXCLUDED.sequence_no,is_active=true,updated_at=now();

-- --------------------------------------------------------------------------
-- 9. Seed 45 reusable characteristic details + characteristic master
-- --------------------------------------------------------------------------
WITH chars(group_code,code,name,uom,data_type,value_mode,seq,help_text) AS (VALUES
('TDC_GENERAL','CONFIRMING_STANDARD','Confirming Standard','NA','TEXT','TEXT',10,'Applicable IS/EN/ASTM/customer standard.'),
('TDC_GENERAL','SPEC_GRADE','Specification Grade','NA','TEXT','TEXT',20,'Customer/product specification grade.'),
('TDC_GENERAL','BASE_METAL','Base Metal','NA','TEXT','TEXT',30,'Base metal specification or standard.'),
('TDC_GENERAL','BASE_METAL_GRADE','Base Metal Grade','NA','TEXT','TEXT',40,'Base metal grade.'),
('TDC_GENERAL','GRADE_DESIGNATION','Grade Designation','NA','TEXT','TEXT',50,'Grade designation.'),
('TDC_GENERAL','END_USE','End Use','NA','TEXT','TEXT',60,'Customer end use / application.'),
('TDC_GENERAL','TEST_CERTIFICATE','Test Certificate','NA','TEXT','TEXT',70,'Test certificate requirement.'),
('TDC_GENERAL','NOTE_1','Note-1','NA','TEXT','TEXT',80,'Additional contractual or standard note.'),

('TDC_DIMENSION','THICKNESS','Thickness','MM','NUMBER','RANGE',10,'Finished/product thickness requirement.'),
('TDC_DIMENSION','THICKNESS_TOLERANCE','Thickness Tolerance','MM','NUMBER','PLUS_MINUS',20,'Permitted thickness tolerance.'),
('TDC_DIMENSION','WIDTH','Width','MM','NUMBER','TEXT',30,'Width or permitted widths.'),
('TDC_DIMENSION','WIDTH_TOLERANCE','Width Tolerance','MM','TEXT','TEXT',40,'Mill/trimmed edge width tolerance.'),
('TDC_DIMENSION','COIL_WEIGHT','Coil Weight','MT','NUMBER','RANGE',50,'Permitted coil weight range.'),
('TDC_DIMENSION','ID_DIAMETER','ID Diameter','MM','NUMBER','EXACT',60,'Coil inner diameter.'),
('TDC_DIMENSION','OUTER_DIAMETER','Outer Diameter','MM','NUMBER','MAX',70,'Maximum / specified coil OD.'),
('TDC_DIMENSION','TELESCOPE','Telescope','MM','NUMBER','MAX',80,'Coil telescope limit.'),
('TDC_DIMENSION','RMT','RMT','MTR','TEXT','TEXT',90,'Running meter requirement / chart reference.'),

('TDC_CHEMICAL','CARBON','Carbon','%','NUMBER','MAX',10,'Carbon chemical limit.'),
('TDC_CHEMICAL','MANGANESE','Manganese','%','NUMBER','MAX',20,'Manganese chemical limit.'),
('TDC_CHEMICAL','PHOSPHORUS','Phosphorus','%','NUMBER','MAX',30,'Phosphorus chemical limit.'),
('TDC_CHEMICAL','SULFUR','Sulfur','%','NUMBER','MAX',40,'Sulfur chemical limit.'),
('TDC_CHEMICAL','CHEMICAL_COMPOSITION_BASE_METAL','Chemical Composition - Base Metal','NA','TEXT','AS_PER_STANDARD',50,'Base-metal chemical composition standard/reference.'),

('TDC_MECHANICAL','YIELD_STRENGTH','Yield Strength','MPA','NUMBER','MIN',10,'Yield strength requirement.'),
('TDC_MECHANICAL','TENSILE_STRENGTH','Tensile Strength','MPA','NUMBER','MIN',20,'Tensile/ultimate tensile strength requirement.'),
('TDC_MECHANICAL','HARDNESS','Hardness','HRB','NUMBER','MIN',30,'Hardness requirement.'),
('TDC_MECHANICAL','ELONGATION','Elongation','%','NUMBER','MIN',40,'Elongation requirement.'),
('TDC_MECHANICAL','IMPACT_TEST','Impact Test','JOULES','TEXT','TEXT',50,'Impact test requirement.'),
('TDC_MECHANICAL','BEND_TEST_TOP','Bend Test Top','NA','TEXT','TEXT',60,'Top-side bend requirement.'),
('TDC_MECHANICAL','BEND_TEST_BOTTOM','Bend Test Bottom','NA','TEXT','TEXT',70,'Bottom-side bend requirement.'),

('TDC_SURFACE','MASS_OF_ZINC_COATING','Mass of Zinc / Al-Zn Coating','GSM','TEXT','TEXT',10,'Metallic coating mass / class.'),
('TDC_SURFACE','PASSIVATION','Passivation Type','GSM','TEXT','TEXT',20,'Chromating/passivation requirement.'),
('TDC_SURFACE','SURFACE_COATING_ACRYLIC','Surface Coating (Acrylic)','GSM','TEXT','TEXT',30,'Acrylic / AFP surface coating.'),
('TDC_SURFACE','SURFACE_CONDITION_SPANGLE','Surface Condition / Spangle Quality','NA','TEXT','TEXT',40,'Surface condition and spangle requirement.'),
('TDC_SURFACE','OIL','Oil','GSM','TEXT','TEXT',50,'Oil / oiled-surface requirement.'),
('TDC_SURFACE','SALT_SPRAY_TEST','Salt Spray Test','HOURS','NUMBER','MIN',60,'Salt spray test duration.'),
('TDC_SURFACE','SHAPE_FLATNESS','Shape / Flatness','NA','TEXT','TEXT',70,'Flatness / I-value / wave requirement.'),
('TDC_SURFACE','SURFACE_FINISH','Surface Finish','NA','TEXT','TEXT',80,'Surface finish requirement.'),
('TDC_SURFACE','RA_VALUE','Ra Value','MICRON','NUMBER','MAX',90,'Surface roughness limit.'),
('TDC_SURFACE','CAMBER','Camber','MM','TEXT','TEXT',100,'Camber requirement.'),
('TDC_SURFACE','EDGE_CONDITION','Edge Condition (Mill/Trim)','NA','TEXT','TEXT',110,'Mill / trimmed edge condition.'),
('TDC_SURFACE','FREE_FROM_DEFECTS','Free From Defects','NA','TEXT','TEXT',120,'Defect-free surface/material requirement.'),

('TDC_DISPATCH','PACKING','Packing','NA','TEXT','TEXT',10,'Packing construction and standard.'),
('TDC_DISPATCH','SLEEVE','ID Sleeve','NA','TEXT','TEXT',20,'Sleeve requirement.'),
('TDC_DISPATCH','PRINTING_MARKING','Printing / Marking','NA','TEXT','TEXT',30,'Printing/marking requirement.'),
('TDC_DISPATCH','LOGO','Logo','NA','TEXT','TEXT',40,'Logo / branding requirement.')
), ins_detail AS (
    INSERT INTO mes.group_code_detail(group_code_id,detail_code,short_description,description,uom,sequence_no,is_active)
    SELECT g.group_code_id,c.code,c.name,c.help_text,c.uom,c.seq,true
      FROM chars c JOIN mes.group_code_master g ON g.group_code=c.group_code
    ON CONFLICT(group_code_id,detail_code) DO UPDATE SET short_description=EXCLUDED.short_description,description=EXCLUDED.description,uom=EXCLUDED.uom,sequence_no=EXCLUDED.sequence_no,is_active=true,updated_at=now()
    RETURNING detail_id,group_code_id,detail_code
)
INSERT INTO mes.tdc_characteristic_master(characteristic_code,characteristic_name,group_code_id,group_detail_id,data_type,default_uom,default_value_mode,help_text,is_active)
SELECT c.code,c.name,g.group_code_id,d.detail_id,c.data_type,c.uom,c.value_mode,c.help_text,true
  FROM chars c
  JOIN mes.group_code_master g ON g.group_code=c.group_code
  JOIN mes.group_code_detail d ON d.group_code_id=g.group_code_id AND d.detail_code=c.code
ON CONFLICT(characteristic_code) DO UPDATE SET characteristic_name=EXCLUDED.characteristic_name,group_code_id=EXCLUDED.group_code_id,group_detail_id=EXCLUDED.group_detail_id,data_type=EXCLUDED.data_type,default_uom=EXCLUDED.default_uom,default_value_mode=EXCLUDED.default_value_mode,help_text=EXCLUDED.help_text,is_active=true,updated_at=now();

-- --------------------------------------------------------------------------
-- 10. Category + series master seed for Plant 2000 source formats
-- --------------------------------------------------------------------------
INSERT INTO mes.tdc_category_master(category_code,category_name,tdc_prefix,description,is_active)
VALUES
('BGL_GL','BGL / GL','BGL','Bare Galvalume / Galvalume technical delivery conditions.',true),
('CRFH','CRFH','CRFH','Cold Rolled Full Hard coil technical delivery conditions.',true),
('HRPO','HRPO','HRPO','Hot Rolled Pickled and Oiled coil technical delivery conditions.',true)
ON CONFLICT(category_code) DO UPDATE SET category_name=EXCLUDED.category_name,tdc_prefix=EXCLUDED.tdc_prefix,description=EXCLUDED.description,is_active=true,updated_at=now();

INSERT INTO mes.tdc_series_master(series_code,series_name,description,is_active)
VALUES ('OEM','OEM','OEM customer TDC series.',true),('DOM','DOM','Domestic customer TDC series.',true),('CIPL','CIPL','CIPL customer TDC series.',true)
ON CONFLICT(series_code) DO UPDATE SET series_name=EXCLUDED.series_name,description=EXCLUDED.description,is_active=true,updated_at=now();

-- --------------------------------------------------------------------------
-- 11. System-created initial templates - forms only, no customer-specific values.
-- --------------------------------------------------------------------------
INSERT INTO mes.tdc_template_header(template_code,template_name,company_code,plant_code,category_id,tdc_prefix,template_status,is_system_template,description,is_active,activated_at)
SELECT x.template_code,x.template_name,'2000','2000',c.category_id,c.tdc_prefix,'ACTIVE',true,x.description,true,now()
FROM (VALUES
('SYS_BGL_GL_2000_V1','BGL / GL Standard Format - Plant 2000','System-created first BGL/GL TDC format based on reviewed Plant 2000 TDC documents.'),
('SYS_CRFH_2000_V1','CRFH Standard Format - Plant 2000','System-created first CRFH TDC format based on reviewed Plant 2000 TDC document.'),
('SYS_HRPO_2000_V1','HRPO Standard Format - Plant 2000','System-created first HRPO TDC format based on reviewed Plant 2000 TDC document.')
) x(template_code,template_name,description)
JOIN mes.tdc_category_master c ON c.category_code=CASE WHEN x.template_code LIKE '%BGL%' THEN 'BGL_GL' WHEN x.template_code LIKE '%CRFH%' THEN 'CRFH' ELSE 'HRPO' END
ON CONFLICT(template_code) DO UPDATE SET template_name=EXCLUDED.template_name,description=EXCLUDED.description,is_active=true,updated_at=now();

-- Helper block to map characteristic lists to the system templates.
WITH map(template_code,section_code,characteristic_code,seq,label,required) AS (VALUES
-- BGL / GL
('SYS_BGL_GL_2000_V1','GENERAL','CONFIRMING_STANDARD',10,'Confirming Standard',true),
('SYS_BGL_GL_2000_V1','GENERAL','SPEC_GRADE',20,'Spec. Grade',true),
('SYS_BGL_GL_2000_V1','GENERAL','BASE_METAL',30,'Base Metal',false),
('SYS_BGL_GL_2000_V1','GENERAL','END_USE',40,'End Use',false),
('SYS_BGL_GL_2000_V1','GENERAL','NOTE_1',50,'Note-1',false),
('SYS_BGL_GL_2000_V1','DIMENSION','THICKNESS',10,'Thickness TCT',true),
('SYS_BGL_GL_2000_V1','DIMENSION','THICKNESS_TOLERANCE',20,'Thickness Tolerance on TCT',true),
('SYS_BGL_GL_2000_V1','DIMENSION','WIDTH',30,'Width',true),
('SYS_BGL_GL_2000_V1','DIMENSION','WIDTH_TOLERANCE',40,'Width Tolerance',true),
('SYS_BGL_GL_2000_V1','DIMENSION','COIL_WEIGHT',50,'Coil Weight',true),
('SYS_BGL_GL_2000_V1','DIMENSION','ID_DIAMETER',60,'ID Dia',true),
('SYS_BGL_GL_2000_V1','DIMENSION','RMT',70,'RMT',false),
('SYS_BGL_GL_2000_V1','MECHANICAL','YIELD_STRENGTH',10,'Yield Strength',true),
('SYS_BGL_GL_2000_V1','MECHANICAL','TENSILE_STRENGTH',20,'Tensile Strength',true),
('SYS_BGL_GL_2000_V1','MECHANICAL','HARDNESS',30,'Hardness',false),
('SYS_BGL_GL_2000_V1','MECHANICAL','ELONGATION',40,'Elongation',false),
('SYS_BGL_GL_2000_V1','MECHANICAL','IMPACT_TEST',50,'Impact Test',false),
('SYS_BGL_GL_2000_V1','MECHANICAL','BEND_TEST_TOP',60,'Bend Test Top',false),
('SYS_BGL_GL_2000_V1','MECHANICAL','BEND_TEST_BOTTOM',70,'Bend Test Bottom',false),
('SYS_BGL_GL_2000_V1','SURFACE_COATING','MASS_OF_ZINC_COATING',10,'Mass of Zinc Coating',true),
('SYS_BGL_GL_2000_V1','SURFACE_COATING','PASSIVATION',20,'Passivation Type',false),
('SYS_BGL_GL_2000_V1','SURFACE_COATING','SURFACE_COATING_ACRYLIC',30,'Surface Coating (Acrylic)',false),
('SYS_BGL_GL_2000_V1','SURFACE_COATING','SURFACE_CONDITION_SPANGLE',40,'Surface Condition / Spangles Quality',false),
('SYS_BGL_GL_2000_V1','SURFACE_COATING','EDGE_CONDITION',50,'Edge Condition (Mill/Trim)',false),
('SYS_BGL_GL_2000_V1','SURFACE_COATING','OIL',60,'Oil',false),
('SYS_BGL_GL_2000_V1','SURFACE_COATING','SALT_SPRAY_TEST',70,'Salt Spray Test',false),
('SYS_BGL_GL_2000_V1','SURFACE_COATING','SHAPE_FLATNESS',80,'Shape Flatness',false),
('SYS_BGL_GL_2000_V1','DISPATCH_PACKING','PACKING',10,'Packing',true),
('SYS_BGL_GL_2000_V1','DISPATCH_PACKING','SLEEVE',20,'ID Sleeve',false),
('SYS_BGL_GL_2000_V1','DISPATCH_PACKING','PRINTING_MARKING',30,'Printing / Marking',false),
('SYS_BGL_GL_2000_V1','DISPATCH_PACKING','LOGO',40,'Logo',false),
-- CRFH
('SYS_CRFH_2000_V1','GENERAL','CONFIRMING_STANDARD',10,'Confirming Standard',true),
('SYS_CRFH_2000_V1','GENERAL','BASE_METAL_GRADE',20,'Base Metal Grade',true),
('SYS_CRFH_2000_V1','GENERAL','GRADE_DESIGNATION',30,'Grade Designation',true),
('SYS_CRFH_2000_V1','GENERAL','END_USE',40,'End Use',false),
('SYS_CRFH_2000_V1','GENERAL','TEST_CERTIFICATE',50,'Test Certificate',false),
('SYS_CRFH_2000_V1','DIMENSION','WIDTH',10,'Width',true),
('SYS_CRFH_2000_V1','DIMENSION','WIDTH_TOLERANCE',20,'Width Tolerance',true),
('SYS_CRFH_2000_V1','DIMENSION','THICKNESS',30,'Thickness',true),
('SYS_CRFH_2000_V1','DIMENSION','THICKNESS_TOLERANCE',40,'Thickness Tolerance',true),
('SYS_CRFH_2000_V1','DIMENSION','COIL_WEIGHT',50,'Coil Weight',false),
('SYS_CRFH_2000_V1','DIMENSION','ID_DIAMETER',60,'Inner Dia',false),
('SYS_CRFH_2000_V1','DIMENSION','OUTER_DIAMETER',70,'Outer Dia',false),
('SYS_CRFH_2000_V1','DIMENSION','TELESCOPE',80,'Telescope',false),
('SYS_CRFH_2000_V1','CHEMICAL','CHEMICAL_COMPOSITION_BASE_METAL',10,'Chemical Composition - Base Metal',false),
('SYS_CRFH_2000_V1','MECHANICAL','HARDNESS',10,'Hardness',true),
('SYS_CRFH_2000_V1','MECHANICAL','YIELD_STRENGTH',20,'Yield Strength',false),
('SYS_CRFH_2000_V1','MECHANICAL','TENSILE_STRENGTH',30,'Ultimate Tensile Strength',true),
('SYS_CRFH_2000_V1','MECHANICAL','ELONGATION',40,'Elongation',false),
('SYS_CRFH_2000_V1','SURFACE_COATING','EDGE_CONDITION',10,'Edge Condition (Mill/Trimmed Edge)',true),
('SYS_CRFH_2000_V1','SURFACE_COATING','OIL',20,'Oil',false),
('SYS_CRFH_2000_V1','SURFACE_COATING','SURFACE_FINISH',30,'Surface Finish',false),
('SYS_CRFH_2000_V1','SURFACE_COATING','RA_VALUE',40,'Ra Value',false),
('SYS_CRFH_2000_V1','SURFACE_COATING','CAMBER',50,'Camber',false),
('SYS_CRFH_2000_V1','SURFACE_COATING','SHAPE_FLATNESS',60,'Flatness',false),
('SYS_CRFH_2000_V1','SURFACE_COATING','FREE_FROM_DEFECTS',70,'Free From Defects',false),
('SYS_CRFH_2000_V1','DISPATCH_PACKING','PACKING',10,'Packing',true),
('SYS_CRFH_2000_V1','DISPATCH_PACKING','SLEEVE',20,'Sleeve',false),
-- HRPO
('SYS_HRPO_2000_V1','GENERAL','CONFIRMING_STANDARD',10,'Confirming Standard',true),
('SYS_HRPO_2000_V1','GENERAL','SPEC_GRADE',20,'Spec. Grade',true),
('SYS_HRPO_2000_V1','DIMENSION','THICKNESS',10,'Thickness',true),
('SYS_HRPO_2000_V1','DIMENSION','THICKNESS_TOLERANCE',20,'Thickness Tolerance',true),
('SYS_HRPO_2000_V1','DIMENSION','WIDTH',30,'Width',true),
('SYS_HRPO_2000_V1','DIMENSION','WIDTH_TOLERANCE',40,'Width Tolerance',true),
('SYS_HRPO_2000_V1','DIMENSION','ID_DIAMETER',50,'ID Dia',true),
('SYS_HRPO_2000_V1','DIMENSION','COIL_WEIGHT',60,'Coil Weight',true),
('SYS_HRPO_2000_V1','CHEMICAL','CARBON',10,'Carbon',true),
('SYS_HRPO_2000_V1','CHEMICAL','MANGANESE',20,'Manganese',true),
('SYS_HRPO_2000_V1','CHEMICAL','PHOSPHORUS',30,'Phosphorus',true),
('SYS_HRPO_2000_V1','CHEMICAL','SULFUR',40,'Sulfur',true),
('SYS_HRPO_2000_V1','MECHANICAL','YIELD_STRENGTH',10,'Yield Strength',false),
('SYS_HRPO_2000_V1','MECHANICAL','TENSILE_STRENGTH',20,'Tensile Strength',true),
('SYS_HRPO_2000_V1','MECHANICAL','ELONGATION',30,'Elongation (50 GL)',true),
('SYS_HRPO_2000_V1','SURFACE_COATING','EDGE_CONDITION',10,'Edge Condition',true),
('SYS_HRPO_2000_V1','SURFACE_COATING','OIL',20,'Oil',true),
('SYS_HRPO_2000_V1','SURFACE_COATING','SHAPE_FLATNESS',30,'Shape / Flatness',true),
('SYS_HRPO_2000_V1','SURFACE_COATING','CAMBER',40,'Camber',true),
('SYS_HRPO_2000_V1','DISPATCH_PACKING','PACKING',10,'Packing',true)
)
INSERT INTO mes.tdc_template_characteristic(template_id,characteristic_id,section_code,sequence_no,display_label,is_required,default_value_mode,default_uom,is_active)
SELECT t.template_id,c.characteristic_id,m.section_code,m.seq,m.label,m.required,c.default_value_mode,c.default_uom,true
FROM map m JOIN mes.tdc_template_header t ON t.template_code=m.template_code
JOIN mes.tdc_characteristic_master c ON c.characteristic_code=m.characteristic_code
ON CONFLICT(template_id,characteristic_id) DO UPDATE SET section_code=EXCLUDED.section_code,sequence_no=EXCLUDED.sequence_no,display_label=EXCLUDED.display_label,is_required=EXCLUDED.is_required,default_value_mode=EXCLUDED.default_value_mode,default_uom=EXCLUDED.default_uom,is_active=true,updated_at=now();

-- --------------------------------------------------------------------------
-- 12. Initial number object positions taken from reviewed Plant 2000 TDC numbers.
-- Current number is last known number; next number is generated by system.
-- --------------------------------------------------------------------------
INSERT INTO mes.tdc_number_object(plant_code,tdc_prefix,series_id,current_number,padding_length,is_active)
SELECT '2000',x.prefix,s.series_id,x.current_no,x.padding,true
FROM (VALUES ('BGL','OEM',11,4),('BGL','DOM',7,3),('CRFH','OEM',2,4),('HRPO','CIPL',1,4)) x(prefix,series_code,current_no,padding)
JOIN mes.tdc_series_master s ON s.series_code=x.series_code
ON CONFLICT(plant_code,tdc_prefix,series_id) DO UPDATE
SET current_number=GREATEST(mes.tdc_number_object.current_number,EXCLUDED.current_number),padding_length=EXCLUDED.padding_length,is_active=true,updated_at=now();

-- --------------------------------------------------------------------------
-- 13. Approval access groups - user e-mail is read from app_user at runtime.
-- --------------------------------------------------------------------------
INSERT INTO mes.app_access_group(group_code,group_name,group_type,description,allow_consolidated_view,is_system_group,is_active)
VALUES
('TDC_CREATOR_2000','TDC Creator - Plant 2000','FUNCTIONAL','Create/revise TDCs for Plant 2000.',false,true,true),
('TDC_QC_HEAD_2000','TDC QC Head - Plant 2000','HEAD','QC Head approval group for Plant 2000 TDCs.',false,true,true),
('TDC_PPC_HEAD_2000','TDC PPC Head - Plant 2000','HEAD','PPC Head approval group for Plant 2000 TDCs.',false,true,true),
('TDC_PLANT_HEAD_2000','TDC Plant Head - Plant 2000','HEAD','Plant Head final approval group for Plant 2000 TDCs.',false,true,true)
ON CONFLICT(group_code) DO UPDATE SET group_name=EXCLUDED.group_name,group_type=EXCLUDED.group_type,description=EXCLUDED.description,is_active=true,updated_at=now();

INSERT INTO mes.app_access_group_company(access_group_id,company_code)
SELECT g.access_group_id,'2000' FROM mes.app_access_group g WHERE g.group_code IN ('TDC_CREATOR_2000','TDC_QC_HEAD_2000','TDC_PPC_HEAD_2000','TDC_PLANT_HEAD_2000')
ON CONFLICT DO NOTHING;
INSERT INTO mes.app_access_group_plant(access_group_id,plant_code)
SELECT g.access_group_id,'2000' FROM mes.app_access_group g WHERE g.group_code IN ('TDC_CREATOR_2000','TDC_QC_HEAD_2000','TDC_PPC_HEAD_2000','TDC_PLANT_HEAD_2000')
ON CONFLICT DO NOTHING;

-- ADMIN receives creator access only for convenience; approval API separately allows ADMIN during UAT.
INSERT INTO mes.app_user_access_group(user_id,access_group_id,valid_from,is_active,remarks)
SELECT u.user_id,g.access_group_id,current_date,true,'v0.11.0 TDC UAT creator access for system administrator.'
FROM mes.app_user u
JOIN mes.app_user_role ur ON ur.user_id=u.user_id
JOIN mes.app_role r ON r.role_id=ur.role_id AND r.role_code='ADMIN'
JOIN mes.app_access_group g ON g.group_code='TDC_CREATOR_2000'
WHERE u.is_active=true AND NOT EXISTS(
  SELECT 1 FROM mes.app_user_access_group x WHERE x.user_id=u.user_id AND x.access_group_id=g.access_group_id AND x.is_active=true
);

-- --------------------------------------------------------------------------
-- 14. Activate only the implemented TDC screens in Quality.
-- --------------------------------------------------------------------------
INSERT INTO mes.app_screen(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,x.screen_code,x.screen_no,x.screen_no,x.screen_name,x.screen_type,x.description,x.route_path,'Phase 1','BUILT','ACTIVE',true,true,x.seq,true
FROM mes.app_module m
JOIN (VALUES
('QLT_TDC_TEMPLATE','4200','TDC Template Master','MASTER','Create/copy templates, categories, series and reusable TDC characteristics.','/quality/tdc-templates',63),
('QLT_TDC','4201','TDC Register','TRANSACTION','Version-controlled Plant 2000 Technical Delivery Conditions.','/quality/tdc',64),
('QLT_TDC_REVISION','4202','TDC Create / Revise Wizard','TRANSACTION','Template-driven TDC creation and revision wizard.','/quality/tdc/create',65),
('QLT_TDC_APPROVAL','4203','TDC Approval','APPROVAL','Creator, QC Head, PPC Head and Plant Head approval workflow.','/quality/tdc-approval',66)
) x(screen_code,screen_no,screen_name,screen_type,description,route_path,seq) ON true
WHERE m.module_code='QLT'
ON CONFLICT(screen_code) DO UPDATE SET module_id=EXCLUDED.module_id,screen_no=EXCLUDED.screen_no,proposed_screen_no=EXCLUDED.proposed_screen_no,screen_name=EXCLUDED.screen_name,screen_type=EXCLUDED.screen_type,description=EXCLUDED.description,route_path=EXCLUDED.route_path,phase=EXCLUDED.phase,implementation_status='BUILT',screen_status='ACTIVE',sequence_no=EXCLUDED.sequence_no,is_active=true,updated_at=now();

-- Keep future Quality/TDC placeholder screens hidden until developed.
UPDATE mes.app_screen SET is_active=false,screen_status='DRAFT',updated_at=now()
WHERE screen_code IN ('QLT_TDC_COMPARE','QLT_SPEC_COMPLIANCE') AND implementation_status<>'BUILT';

COMMIT;
