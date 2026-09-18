-- Colorshine MES v0.11.3 - RM/Paints(future) GRN and QC Reversal
-- Scope: Company 2000 / Plant 2000
--
-- Part A (bug fix): nothing in the system ever created mes.rm_quality_inspection
-- rows, so Quality > RM Usage Decision could never post a decision for any
-- batch ("No inspection record is linked to this batch."), and every GRN
-- receipt was permanently stuck in QUALITY_HOLD. This adds the missing
-- trigger (mirroring trg_create_rm_inventory_from_grn) and backfills the
-- inspection rows already missing for existing GRN coils.
--
-- Part B: authorization object + reversal log + reversal-aware GRN Monitor
-- feed for the new GRN Reversal / QC Reversal capability. process_area is
-- carried on every reversal row so the same object/report can extend to
-- Paints once that module exists; only RM is wired up today.

-- ---------------------------------------------------------------------------
-- Part A: auto-create RM quality inspection on GRN receipt (bug fix)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mes.create_rm_inspection_from_grn()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
  v_seq int;
  v_no varchar(40);
BEGIN
  SELECT COALESCE(max(inspection_sequence),0)+1 INTO v_seq
    FROM mes.rm_quality_inspection WHERE batch_id=NEW.batch_id;
  v_no := 'RMQI-'||NEW.batch_no||'-'||lpad(v_seq::text,2,'0');

  INSERT INTO mes.rm_quality_inspection(
    inspection_no,batch_id,grn_coil_id,inspection_sequence,inspection_basis,inspection_status)
  VALUES(v_no,NEW.batch_id,NEW.grn_coil_id,v_seq,'BOTH','PENDING')
  ON CONFLICT(inspection_no) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_create_rm_inspection_from_grn ON mes.goods_receipt_coil;
CREATE TRIGGER trg_create_rm_inspection_from_grn
  AFTER INSERT ON mes.goods_receipt_coil
  FOR EACH ROW EXECUTE FUNCTION mes.create_rm_inspection_from_grn();

-- Backfill: any GRN coil received before this fix that has no inspection yet.
INSERT INTO mes.rm_quality_inspection(inspection_no,batch_id,grn_coil_id,inspection_sequence,inspection_basis,inspection_status)
SELECT 'RMQI-'||c.batch_no||'-01', c.batch_id, c.grn_coil_id, 1, 'BOTH', 'PENDING'
FROM mes.goods_receipt_coil c
WHERE NOT EXISTS (SELECT 1 FROM mes.rm_quality_inspection qi WHERE qi.grn_coil_id=c.grn_coil_id)
ON CONFLICT(inspection_no) DO NOTHING;

-- Backfill: link supplier TC results that arrived before the inspection existed.
UPDATE mes.rm_quality_inspection qi
   SET supplier_tc_id=tc.supplier_tc_id
  FROM mes.rm_supplier_tc tc
 WHERE qi.batch_id=tc.batch_id AND qi.supplier_tc_id IS NULL;

-- Expose inspection_id (already computed internally, just not projected) so
-- the GRN Monitor / batch detail screens can call the QC reversal endpoint
-- without a second lookup.
CREATE OR REPLACE VIEW mes.vw_grn_ud_queue AS
 SELECT c.grn_coil_id,
    c.batch_id,
    g.plant_code,
    g.sap_grn_no,
    g.sap_material_doc_year,
    g.posting_date AS grn_posting_date,
    c.sap_po_no,
    c.sap_po_item,
    c.storage_location,
    COALESCE(s.sap_vendor_no, c.rm_source)::character varying(20) AS sap_vendor_no,
    COALESCE(s.supplier_name, c.source_supplier_name) AS supplier_name,
    m.sap_material_code,
    m.material_description,
    c.batch_no,
    c.vendor_batch_no,
    c.batch_thickness_mm,
    c.batch_width_mm,
    c.batch_weight_mt,
    tc.supplier_tc_no,
    tc.heat_no,
    tc.hr_grade,
    tc.quality_level,
    b.quality_status,
    q.inspection_no,
    q.inspection_status,
    q.overall_result,
    u.ud_no,
    u.decision AS current_ud,
    u.decided_by,
    u.decided_at,
    COALESCE(inv.quality_hold_weight_mt, 0::numeric) AS quality_hold_weight_mt,
    COALESCE(inv.available_weight_mt, 0::numeric) AS available_weight_mt,
    COALESCE(inv.blocked_weight_mt, 0::numeric) AS blocked_weight_mt,
    q.inspection_id
   FROM mes.goods_receipt_coil c
     JOIN mes.goods_receipt g ON g.grn_id = c.grn_id
     JOIN mes.batch_master b ON b.batch_id = c.batch_id
     JOIN mes.material_master m ON m.material_id = c.material_id
     LEFT JOIN mes.supplier_master s ON s.supplier_id = c.supplier_id
     LEFT JOIN mes.rm_supplier_tc tc ON tc.batch_id = c.batch_id
     LEFT JOIN LATERAL ( SELECT qi.inspection_id,
            qi.inspection_no,
            qi.batch_id,
            qi.grn_coil_id,
            qi.supplier_tc_id,
            qi.inspection_sequence,
            qi.inspection_basis,
            qi.inspection_status,
            qi.overall_result,
            qi.inspected_by,
            qi.inspection_started_at,
            qi.inspection_completed_at,
            qi.remarks,
            qi.created_at,
            qi.updated_at
           FROM mes.rm_quality_inspection qi
          WHERE qi.batch_id = c.batch_id
          ORDER BY qi.inspection_sequence DESC, qi.created_at DESC
         LIMIT 1) q ON true
     LEFT JOIN mes.rm_usage_decision u ON u.batch_id = c.batch_id AND u.is_current = true
     LEFT JOIN LATERAL ( SELECT sum(ib.quality_hold_weight_mt) AS quality_hold_weight_mt,
            sum(ib.available_weight_mt) AS available_weight_mt,
            sum(ib.blocked_weight_mt) AS blocked_weight_mt
           FROM mes.rm_inventory_balance ib
          WHERE ib.batch_id = c.batch_id) inv ON true;

-- ---------------------------------------------------------------------------
-- Part B: authorization object for GRN/QC reversal
-- ---------------------------------------------------------------------------
INSERT INTO mes.app_access_group(group_code,group_name,group_type,description,allow_consolidated_view,is_system_group,is_active)
VALUES(
  'RM_GRN_QC_REVERSAL_2000','RM GRN/QC Reversal - Plant 2000','FUNCTIONAL',
  'Authorized to reverse a posted RM GRN receipt or RM Usage Decision (QC) for Plant 2000. QC must be reversed before GRN for the same batch.',
  false,false,true)
ON CONFLICT(group_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Part B: reversal audit log (who/when/workstation, GRN or QC, RM or Paints)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.rm_reversal_log(
  reversal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reversal_type varchar(10) NOT NULL,
  process_area varchar(20) NOT NULL DEFAULT 'RM',
  batch_id uuid NOT NULL REFERENCES mes.batch_master(batch_id),
  grn_coil_id uuid REFERENCES mes.goods_receipt_coil(grn_coil_id),
  inspection_id uuid REFERENCES mes.rm_quality_inspection(inspection_id),
  ud_id uuid REFERENCES mes.rm_usage_decision(ud_id),
  movement_id uuid REFERENCES mes.rm_inventory_movement(movement_id),
  reversed_qty_mt numeric(14,4) NOT NULL,
  reason text NOT NULL,
  reversed_by varchar(80) NOT NULL,
  reversed_at timestamptz NOT NULL DEFAULT now(),
  client_host varchar(120),
  client_ip varchar(60),
  request_id varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_rm_reversal_type CHECK (reversal_type IN ('QC','GRN')),
  CONSTRAINT ck_rm_reversal_area CHECK (process_area IN ('RM','PAINTS')),
  CONSTRAINT ck_rm_reversal_qty CHECK (reversed_qty_mt > 0)
);
CREATE INDEX IF NOT EXISTS ix_rm_reversal_log_batch ON mes.rm_reversal_log(batch_id);
CREATE INDEX IF NOT EXISTS ix_rm_reversal_log_reversed_at ON mes.rm_reversal_log(reversed_at DESC);

-- ---------------------------------------------------------------------------
-- Part B: GRN Monitor feed = original GRN lines + reversal lines (negative qty)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW mes.vw_grn_monitor_feed AS
SELECT
  q.grn_coil_id, q.batch_id, q.plant_code, q.sap_grn_no, q.sap_material_doc_year, q.grn_posting_date,
  q.sap_po_no, q.sap_po_item, q.storage_location, q.sap_vendor_no, q.supplier_name,
  q.sap_material_code, q.material_description, q.batch_no, q.vendor_batch_no,
  q.batch_thickness_mm, q.batch_width_mm, q.batch_weight_mt,
  q.supplier_tc_no, q.heat_no, q.hr_grade, q.quality_level,
  q.quality_status, q.inspection_no, q.inspection_status, q.overall_result,
  q.ud_no, q.current_ud, q.decided_by, q.decided_at,
  q.quality_hold_weight_mt, q.available_weight_mt, q.blocked_weight_mt,
  'GRN'::varchar(14) AS entry_type,
  NULL::timestamptz AS reversed_at, NULL::varchar(80) AS reversed_by, NULL::text AS reversal_reason,
  q.inspection_id
FROM mes.vw_grn_ud_queue q
UNION ALL
SELECT
  rl.grn_coil_id, rl.batch_id, g.plant_code, g.sap_grn_no, g.sap_material_doc_year, g.posting_date,
  c.sap_po_no, c.sap_po_item, c.storage_location,
  COALESCE(s.sap_vendor_no,c.rm_source), COALESCE(s.supplier_name,c.source_supplier_name),
  m.sap_material_code, m.material_description, b.batch_no, c.vendor_batch_no,
  c.batch_thickness_mm, c.batch_width_mm, -rl.reversed_qty_mt,
  tc.supplier_tc_no, tc.heat_no, tc.hr_grade, tc.quality_level,
  b.quality_status, NULL::varchar(40), NULL::varchar(30), NULL::varchar(20),
  NULL::varchar(40), NULL::varchar(30), NULL::varchar(80), NULL::timestamptz,
  0::numeric, 0::numeric, 0::numeric,
  'GRN_REVERSAL'::varchar(14),
  rl.reversed_at, rl.reversed_by, rl.reason,
  NULL::uuid
FROM mes.rm_reversal_log rl
JOIN mes.batch_master b ON b.batch_id=rl.batch_id
LEFT JOIN mes.goods_receipt_coil c ON c.grn_coil_id=rl.grn_coil_id
LEFT JOIN mes.goods_receipt g ON g.grn_id=c.grn_id
LEFT JOIN mes.material_master m ON m.material_id=c.material_id
LEFT JOIN mes.supplier_master s ON s.supplier_id=c.supplier_id
LEFT JOIN mes.rm_supplier_tc tc ON tc.batch_id=rl.batch_id
WHERE rl.reversal_type='GRN' AND rl.process_area='RM';

-- Reversal report (both GRN and QC, all process areas - RM today, Paints later)
CREATE OR REPLACE VIEW mes.vw_rm_reversal_report AS
SELECT
  rl.reversal_id, rl.reversal_type, rl.process_area, rl.batch_id, b.batch_no,
  m.sap_material_code, m.material_description,
  g.sap_grn_no, g.plant_code,
  COALESCE(s.sap_vendor_no,c.rm_source) AS sap_vendor_no, COALESCE(s.supplier_name,c.source_supplier_name) AS supplier_name,
  rl.ud_id, u.ud_no, u.decision AS reversed_ud_decision,
  rl.reversed_qty_mt, rl.reason, rl.reversed_by, rl.reversed_at, rl.client_host, rl.client_ip
FROM mes.rm_reversal_log rl
JOIN mes.batch_master b ON b.batch_id=rl.batch_id
LEFT JOIN mes.material_master m ON m.material_id=b.material_id
LEFT JOIN mes.goods_receipt_coil c ON c.grn_coil_id=rl.grn_coil_id
LEFT JOIN mes.goods_receipt g ON g.grn_id=c.grn_id
LEFT JOIN mes.supplier_master s ON s.supplier_id=c.supplier_id
LEFT JOIN mes.rm_usage_decision u ON u.ud_id=rl.ud_id
ORDER BY rl.reversed_at DESC;
