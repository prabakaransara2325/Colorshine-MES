-- ============================================================================
-- COLORSHINE MES V2 v0.10.5
-- SAP SALES ORDER INBOUND LANDING + PLANNING MONITOR
-- ============================================================================
-- Design rule:
--   SAP interface data is RECEIVED first, exactly as sent.
--   Missing MES master mappings NEVER cause loss/rejection of the inbound row.
--   Master readiness is evaluated separately for Planning.
-- ============================================================================
SET search_path TO mes, public;
BEGIN;

CREATE TABLE IF NOT EXISTS mes.sap_so_inbound_run (
    run_id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_system           varchar(40) NOT NULL DEFAULT 'SAP_S4HANA',
    source_reference        varchar(240),
    process_status          varchar(24) NOT NULL DEFAULT 'RECEIVING',
    header_rows             integer NOT NULL DEFAULT 0,
    route_rows              integer NOT NULL DEFAULT 0,
    order_detail_rows       integer NOT NULL DEFAULT 0,
    chem_mech_rows          integer NOT NULL DEFAULT 0,
    error_message           text,
    received_at             timestamptz NOT NULL DEFAULT now(),
    completed_at            timestamptz,
    CONSTRAINT ck_sap_so_run_status CHECK (process_status IN ('RECEIVING','COMPLETED','FAILED'))
);

CREATE TABLE IF NOT EXISTS mes.sap_sales_order_item (
    so_no                   varchar(20) NOT NULL,
    so_item_no              varchar(10) NOT NULL,
    tdc_no                  varchar(40),
    material_code           varchar(60) NOT NULL,
    qty                     numeric(18,3) NOT NULL,
    uom                     varchar(10),
    required_date           date,
    sold_to_party_name      varchar(240),
    ship_to_party_name      varchar(240),
    sold_to_code            varchar(40),
    ship_to_code            varchar(40),
    sales_organization      varchar(10),
    distribution_channel    varchar(10),
    purchase_order_number   varchar(100),
    plant_code              varchar(10),
    destination_city        varchar(120),
    order_creation_date     date,
    mode_of_transport       varchar(80),
    error_description       varchar(1000),
    send_date               date,
    so_overdelivery_tol     numeric(12,3),
    so_underdelivery_tol    numeric(12,3),
    route_id                varchar(60),
    route_description       varchar(240),
    unloading_point         varchar(80),
    receiving_point         varchar(80),
    material_tree           text,
    process_path            text,
    proposed_delivery_date  date,
    committed_date          date,
    division                varchar(10),
    sales_doc_type          varchar(20),
    manufacturing_plant     varchar(10),
    uname                   varchar(80),
    yield_stng              varchar(500),
    release_date            date,
    region_code             varchar(20),
    region_desc             varchar(120),
    so_item_desc            varchar(240),
    status_flag             varchar(20),
    created_by              varchar(80),
    source_created_date     date,
    modified_by             varchar(80),
    source_modified_date    date,
    sch_line_cat            varchar(20),
    source_read_flag        varchar(20),
    source_payload          jsonb,
    first_received_at       timestamptz NOT NULL DEFAULT now(),
    last_received_at        timestamptz NOT NULL DEFAULT now(),
    last_run_id             uuid REFERENCES mes.sap_so_inbound_run(run_id) ON DELETE SET NULL,
    PRIMARY KEY (so_no,so_item_no)
);

CREATE TABLE IF NOT EXISTS mes.sap_sales_order_route (
    so_route_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    so_no                   varchar(20) NOT NULL,
    so_item_no              varchar(10) NOT NULL,
    route_ind               varchar(20) NOT NULL,
    process_path            text NOT NULL,
    material_tree           text NOT NULL,
    sent_date               date,
    source_read_flag        varchar(20),
    created_by              varchar(80),
    source_created_date     date,
    modified_by             varchar(80),
    source_modified_date    date,
    source_payload          jsonb,
    first_received_at       timestamptz NOT NULL DEFAULT now(),
    last_received_at        timestamptz NOT NULL DEFAULT now(),
    last_run_id             uuid REFERENCES mes.sap_so_inbound_run(run_id) ON DELETE SET NULL,
    CONSTRAINT ux_sap_so_route UNIQUE(so_no,so_item_no,route_ind)
);

CREATE TABLE IF NOT EXISTS mes.sap_sales_order_characteristic (
    so_characteristic_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_category         varchar(20) NOT NULL,
    so_no                   varchar(20) NOT NULL,
    so_item_no              varchar(10) NOT NULL,
    material_code           varchar(60) NOT NULL,
    route_ind               varchar(20) NOT NULL,
    characteristic_name     varchar(120) NOT NULL,
    characteristic_value    text,
    characteristic_uom      varchar(40),
    sent_date               date,
    source_read_flag        varchar(20),
    created_by              varchar(80),
    source_created_date     date,
    modified_by             varchar(80),
    source_modified_date    date,
    source_payload          jsonb,
    first_received_at       timestamptz NOT NULL DEFAULT now(),
    last_received_at        timestamptz NOT NULL DEFAULT now(),
    last_run_id             uuid REFERENCES mes.sap_so_inbound_run(run_id) ON DELETE SET NULL,
    CONSTRAINT ck_sap_so_char_source CHECK (source_category IN ('ORDER_DETAIL','CHEM_MECH')),
    CONSTRAINT ux_sap_so_characteristic UNIQUE
      (source_category,so_no,so_item_no,material_code,route_ind,characteristic_name)
);

CREATE INDEX IF NOT EXISTS ix_sap_so_item_plant ON mes.sap_sales_order_item(plant_code,so_no,so_item_no);
CREATE INDEX IF NOT EXISTS ix_sap_so_item_material ON mes.sap_sales_order_item(material_code);
CREATE INDEX IF NOT EXISTS ix_sap_so_item_customer ON mes.sap_sales_order_item(sold_to_code,sold_to_party_name);
CREATE INDEX IF NOT EXISTS ix_sap_so_item_dates ON mes.sap_sales_order_item(required_date,release_date,send_date);
CREATE INDEX IF NOT EXISTS ix_sap_so_route_item ON mes.sap_sales_order_route(so_no,so_item_no,route_ind);
CREATE INDEX IF NOT EXISTS ix_sap_so_char_item ON mes.sap_sales_order_characteristic(so_no,so_item_no,source_category);
CREATE INDEX IF NOT EXISTS ix_sap_so_char_lookup ON mes.sap_sales_order_characteristic(so_no,so_item_no,material_code,route_ind,characteristic_name);
CREATE INDEX IF NOT EXISTS ix_sap_so_char_name ON mes.sap_sales_order_characteristic(characteristic_name,source_category);

-- Key SAP order specifications for quick planning display. The source rows are
-- retained in full in sap_sales_order_characteristic; this view only pivots the
-- most frequently used planning / production / quality values.
CREATE OR REPLACE VIEW mes.vw_sap_so_item_key_specs AS
WITH c AS (
  SELECT i.so_no,i.so_item_no,
    COALESCE(
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.route_ind='P1' AND ch.characteristic_name='ORD_THICK_MM'),
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.characteristic_name='ORD_THICK_MM')
    ) AS order_thickness_mm,
    COALESCE(
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.route_ind='P1' AND ch.characteristic_name='WIDTH_MM'),
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.characteristic_name='WIDTH_MM')
    ) AS order_width_mm,
    COALESCE(
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.route_ind='P1' AND ch.characteristic_name='GI_GL_THICK_MM_AIM'),
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.characteristic_name='GI_GL_THICK_MM_AIM')
    ) AS gl_thickness_aim_mm,
    COALESCE(
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.route_ind='P1' AND ch.characteristic_name='GI_GL_THICK_MM_MIN'),
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.characteristic_name='GI_GL_THICK_MM_MIN')
    ) AS gl_thickness_min_mm,
    COALESCE(
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.route_ind='P1' AND ch.characteristic_name='GI_GL_THICK_MM_MAX'),
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.characteristic_name='GI_GL_THICK_MM_MAX')
    ) AS gl_thickness_max_mm,
    COALESCE(
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.route_ind='P1' AND ch.characteristic_name='CR_THICK_MM_AIM'),
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.characteristic_name='CR_THICK_MM_AIM')
    ) AS cr_thickness_aim_mm,
    COALESCE(
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.route_ind='P1' AND ch.characteristic_name='CR_THICK_MM_MIN'),
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.characteristic_name='CR_THICK_MM_MIN')
    ) AS cr_thickness_min_mm,
    COALESCE(
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.route_ind='P1' AND ch.characteristic_name='CR_THICK_MM_MAX'),
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.characteristic_name='CR_THICK_MM_MAX')
    ) AS cr_thickness_max_mm,
    COALESCE(
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.route_ind='P1' AND ch.characteristic_name='AL_ZN_COATING_GSM_AIM'),
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.characteristic_name='AL_ZN_COATING_GSM_AIM')
    ) AS coating_gsm_aim,
    COALESCE(
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.route_ind='P1' AND ch.characteristic_name='PROC_TIME_MIN_PER_TON'),
      max(NULLIF(ch.characteristic_value,'')::numeric) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.characteristic_name='PROC_TIME_MIN_PER_TON')
    ) AS process_time_min_per_ton,
    COALESCE(
      max(ch.characteristic_value) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.route_ind='P1' AND ch.characteristic_name='Q_LEVEL'),
      max(ch.characteristic_value) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.characteristic_name='Q_LEVEL')
    ) AS quality_level,
    COALESCE(
      max(ch.characteristic_value) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.route_ind='P1' AND ch.characteristic_name='STEEL_GRADE'),
      max(ch.characteristic_value) FILTER (WHERE ch.source_category='ORDER_DETAIL' AND ch.material_code=i.material_code AND ch.characteristic_name='STEEL_GRADE')
    ) AS steel_grade
  FROM mes.sap_sales_order_item i
  LEFT JOIN mes.sap_sales_order_characteristic ch
    ON ch.so_no=i.so_no AND ch.so_item_no=i.so_item_no
  GROUP BY i.so_no,i.so_item_no
)
SELECT * FROM c;

CREATE OR REPLACE VIEW mes.vw_sap_sales_order_monitor AS
WITH route_counts AS (
  SELECT so_no,so_item_no,count(*)::int AS route_count
  FROM mes.sap_sales_order_route GROUP BY so_no,so_item_no
), char_counts AS (
  SELECT so_no,so_item_no,
         count(*) FILTER (WHERE source_category='ORDER_DETAIL')::int AS order_spec_count,
         count(*) FILTER (WHERE source_category='CHEM_MECH')::int AS chem_mech_count
  FROM mes.sap_sales_order_characteristic GROUP BY so_no,so_item_no
)
SELECT i.*,
       ks.order_thickness_mm,ks.order_width_mm,
       ks.gl_thickness_aim_mm,ks.gl_thickness_min_mm,ks.gl_thickness_max_mm,
       ks.cr_thickness_aim_mm,ks.cr_thickness_min_mm,ks.cr_thickness_max_mm,
       ks.coating_gsm_aim,ks.process_time_min_per_ton,ks.quality_level,ks.steel_grade,
       COALESCE(rc.route_count,0) AS route_count,
       COALESCE(cc.order_spec_count,0) AS order_spec_count,
       COALESCE(cc.chem_mech_count,0) AS chem_mech_count,
       CASE
         WHEN p.plant_code IS NULL OR m.material_id IS NULL THEN 'MASTER_PENDING'
         WHEN COALESCE(rc.route_count,0)=0 THEN 'ROUTE_PENDING'
         ELSE 'READY_FOR_PLANNING'
       END AS planning_status,
       concat_ws(' | ',
         CASE WHEN p.plant_code IS NULL THEN 'Plant master missing: '||COALESCE(i.plant_code,'') END,
         CASE WHEN m.material_id IS NULL THEN 'Material master missing: '||i.material_code END,
         CASE WHEN COALESCE(rc.route_count,0)=0 THEN 'SAP process path not received' END
       ) AS validation_message
FROM mes.sap_sales_order_item i
LEFT JOIN mes.vw_sap_so_item_key_specs ks ON ks.so_no=i.so_no AND ks.so_item_no=i.so_item_no
LEFT JOIN route_counts rc ON rc.so_no=i.so_no AND rc.so_item_no=i.so_item_no
LEFT JOIN char_counts cc ON cc.so_no=i.so_no AND cc.so_item_no=i.so_item_no
LEFT JOIN mes.plant_master p ON p.plant_code=i.plant_code AND p.is_active=true
LEFT JOIN mes.material_master m ON m.sap_material_code=i.material_code AND m.is_active=true;

-- Planning Screen 2101: SAP SO landing/monitor.
INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'PLN_SAP_SO_MONITOR','2101','2101','SAP Sales Order Monitor','TRANSACTION',
       'SAP sales-order inbound landing, route/spec visibility and master-readiness monitor',
       '/planning/sales-orders','Phase 1','BUILT','ACTIVE',true,true,2101,true
FROM mes.app_module m WHERE m.module_code='PLN'
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,screen_no=EXCLUDED.screen_no,proposed_screen_no=EXCLUDED.proposed_screen_no,
 screen_name=EXCLUDED.screen_name,screen_type=EXCLUDED.screen_type,description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,phase=EXCLUDED.phase,implementation_status=EXCLUDED.implementation_status,
 screen_status=EXCLUDED.screen_status,direct_call_enabled=EXCLUDED.direct_call_enabled,
 is_authorizable=EXCLUDED.is_authorizable,sequence_no=EXCLUDED.sequence_no,is_active=true,updated_at=now();

COMMIT;
