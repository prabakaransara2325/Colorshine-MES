-- ============================================================================
-- COLORSHINE MES V2 v0.9.6.1
-- 25_rm_opening_import_backend_patch.sql
--
-- Hotfix: preserve the existing vw_grn_ud_queue column types while adding supplier fallback.
-- Final backend preparation for the approved Plant 2000 RM opening inventory.
-- - Ensures the two R_HR materials and RM storage locations exist.
-- - Preserves source supplier name even when legacy vendor codes are inconsistent.
-- - Keeps GRN Monitor and RM Inventory on the same canonical GRN/batch/inventory data.
-- ============================================================================

SET search_path TO mes, public;
BEGIN;

INSERT INTO mes.material_master
(sap_material_code,material_description,material_type,product_group,product_type,base_uom,material_category,is_batch_managed,is_active,source_system)
VALUES
('R_HR_CO','Hot Rolled Black Coil','HR','HR','COIL','MT','RAW_MATERIAL',true,true,'SAP'),
('R_HR>3MM_CO','Hot Rolled Black Coil 3mm & Above','HR','HR','COIL','MT','RAW_MATERIAL',true,true,'SAP')
ON CONFLICT (sap_material_code) DO UPDATE
SET material_description=EXCLUDED.material_description,
    material_type=COALESCE(mes.material_master.material_type,EXCLUDED.material_type),
    product_group=COALESCE(mes.material_master.product_group,EXCLUDED.product_group),
    product_type=COALESCE(mes.material_master.product_type,EXCLUDED.product_type),
    is_active=true,
    updated_at=now();

INSERT INTO mes.storage_location_master
(plant_code,storage_location,storage_name,inventory_category,is_active,source_system)
VALUES
('2000','2001','CIPL Raw Material Storage','RAW_MATERIAL',true,'SAP'),
('2000','RC01','CIPL RM / Rejected Coil Storage','RAW_MATERIAL',true,'SAP')
ON CONFLICT (plant_code,storage_location) DO UPDATE
SET is_active=true,
    inventory_category='RAW_MATERIAL',
    updated_at=now();

-- Preserve the exact supplier text from the approved GRN dump. This is important
-- because the historical RM_SOURCE/vendor-code data contains legacy aliases.
ALTER TABLE mes.goods_receipt_coil
  ADD COLUMN IF NOT EXISTS source_supplier_name varchar(200);

-- GRN Monitor keeps its existing column contract but falls back to source text.
CREATE OR REPLACE VIEW mes.vw_grn_ud_queue AS
SELECT
    c.grn_coil_id,
    c.batch_id,
    g.plant_code,
    g.sap_grn_no,
    g.sap_material_doc_year,
    g.posting_date AS grn_posting_date,
    c.sap_po_no,
    c.sap_po_item,
    c.storage_location,
    COALESCE(s.sap_vendor_no,c.rm_source)::varchar(20) AS sap_vendor_no,
    COALESCE(s.supplier_name,c.source_supplier_name)::varchar(200) AS supplier_name,
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
    COALESCE(inv.quality_hold_weight_mt,0) AS quality_hold_weight_mt,
    COALESCE(inv.available_weight_mt,0) AS available_weight_mt,
    COALESCE(inv.blocked_weight_mt,0) AS blocked_weight_mt
FROM mes.goods_receipt_coil c
JOIN mes.goods_receipt g ON g.grn_id = c.grn_id
JOIN mes.batch_master b ON b.batch_id = c.batch_id
JOIN mes.material_master m ON m.material_id = c.material_id
LEFT JOIN mes.supplier_master s ON s.supplier_id = c.supplier_id
LEFT JOIN mes.rm_supplier_tc tc ON tc.batch_id = c.batch_id
LEFT JOIN LATERAL (
    SELECT qi.*
    FROM mes.rm_quality_inspection qi
    WHERE qi.batch_id = c.batch_id
    ORDER BY qi.inspection_sequence DESC, qi.created_at DESC
    LIMIT 1
) q ON true
LEFT JOIN mes.rm_usage_decision u ON u.batch_id = c.batch_id AND u.is_current = true
LEFT JOIN LATERAL (
    SELECT
        sum(ib.quality_hold_weight_mt) AS quality_hold_weight_mt,
        sum(ib.available_weight_mt) AS available_weight_mt,
        sum(ib.blocked_weight_mt) AS blocked_weight_mt
    FROM mes.rm_inventory_balance ib
    WHERE ib.batch_id = c.batch_id
) inv ON true;

-- Rebuild the RM Stores canonical view with source supplier-name fallback.
DROP VIEW IF EXISTS mes.vw_plant_stock_report;
DROP VIEW IF EXISTS mes.vw_rm_store_inventory;

CREATE OR REPLACE VIEW mes.vw_rm_store_inventory AS
SELECT
    ('LIVE:'||ib.inventory_balance_id::text) AS row_id,
    'LIVE_MES'::varchar(30) AS source_system,
    NULL::integer AS source_row_no,
    'CANONICAL_RM'::varchar(120) AS source_file,
    COALESCE(m.material_type,'HR')::varchar(20) AS material_type,
    'RM'::varchar(10) AS stock_stage,
    ib.plant_code,
    ib.storage_location,
    m.sap_material_code AS material_code,
    m.material_description,
    COALESCE(c.product_group,m.product_group) AS product_group,
    COALESCE(c.product_type,m.product_type,'COIL') AS product_type,
    b.batch_no,
    ib.on_hand_weight_mt::numeric(14,4) AS batch_qty_mt,
    COALESCE(NULLIF(tc.quality_level,''),
             CASE b.quality_status WHEN 'ACCEPTED' THEN 'PRIME' WHEN 'REJECTED' THEN 'REJECT' ELSE 'PENDING_QA' END) AS qa_grade,
    ib.stock_status,
    c.batch_thickness_mm::numeric(12,4) AS thickness_mm,
    c.batch_width_mm::numeric(12,3) AS width_mm,
    tc.batch_length_m AS length_value,
    NULL::varchar(40) AS temper,
    NULL::varchar(40) AS coating,
    NULL::varchar(80) AS jet_printing,
    g.posting_date AS stock_generated_date,
    CASE WHEN g.posting_date IS NULL THEN NULL ELSE CURRENT_DATE-g.posting_date END AS stock_age_days,
    c.rm_source,
    g.sap_grn_no,
    c.sap_po_no,
    c.sap_po_item,
    c.po_delivery_date,
    c.movement_type,
    c.equivalent_spec AS eq_spec,
    c.eq_spec_group,
    c.eq_sub_spec,
    c.chapter_id,
    c.chapter_type,
    c.crown,
    b.batch_no AS mother_rm_batch,
    c.vendor_batch_no AS supplier_batch,
    tc.heat_no,
    g.posting_date AS mother_stock_grn_date,
    CASE WHEN g.posting_date IS NULL THEN NULL ELSE CURRENT_DATE-g.posting_date END AS mother_stock_grn_age_days,
    tc.hr_grade AS rm_steel_grade,
    qa.carbon,qa.manganese,qa.sulphur,qa.phosphorus,qa.silicon,qa.aluminium,
    qa.carbon_equivalent,qa.nitrogen,qa.copper,NULL::text AS molybdenum,qa.chromium,qa.nickel,
    COALESCE(s.supplier_name,c.source_supplier_name) AS rm_supplier,
    b.created_at AS imported_at,
    GREATEST(ib.updated_at,b.updated_at,COALESCE(tc.updated_at,'1900-01-01'::timestamptz)) AS updated_at
FROM mes.rm_inventory_balance ib
JOIN mes.batch_master b ON b.batch_id=ib.batch_id
JOIN mes.material_master m ON m.material_id=b.material_id
LEFT JOIN mes.goods_receipt_coil c ON c.batch_id=b.batch_id AND c.plant_code=ib.plant_code
LEFT JOIN mes.goods_receipt g ON g.grn_id=c.grn_id
LEFT JOIN mes.supplier_master s ON s.supplier_id=c.supplier_id
LEFT JOIN mes.rm_supplier_tc tc ON tc.batch_id=b.batch_id
LEFT JOIN LATERAL (
    SELECT
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='CARBON_PCT'))::text AS carbon,
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='MANGANESE_PCT'))::text AS manganese,
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='SULPHUR_PCT'))::text AS sulphur,
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='PHOSPHORUS_PCT'))::text AS phosphorus,
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='SILICON_PCT'))::text AS silicon,
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='ALUMINIUM_PCT'))::text AS aluminium,
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='CARBON_EQ'))::text AS carbon_equivalent,
      COALESCE(
        (max(r.numeric_value) FILTER (WHERE p.parameter_code='NITROGEN_PPM'))::text,
        (max(r.numeric_value) FILTER (WHERE p.parameter_code='NITROGEN_PCT'))::text
      ) AS nitrogen,
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='COPPER_PCT'))::text AS copper,
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='CHROMIUM_PCT'))::text AS chromium,
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='NICKEL_PCT'))::text AS nickel
    FROM mes.rm_supplier_tc_result r
    JOIN mes.quality_parameter_master p ON p.parameter_id=r.parameter_id
    WHERE r.supplier_tc_id=tc.supplier_tc_id
) qa ON true
WHERE m.sap_material_code LIKE 'R_HR%';

-- Plant stock report keeps RM from canonical RM and WIP/FG from snapshot table.
CREATE OR REPLACE VIEW mes.vw_plant_stock_report AS
SELECT
  row_id AS inventory_id,source_row_no,source_file,material_type,stock_stage,plant_code,storage_location,
  material_code,batch_no,batch_qty_mt,qa_grade,thickness_mm,width_mm,length_value,
  temper,coating,jet_printing,stock_generated_date,stock_age_days,
  NULL::varchar(40) AS mes_po,NULL::varchar(20) AS so_no,NULL::varchar(10) AS so_line_item,
  NULL::numeric(10,4) AS so_thickness_mm,NULL::numeric(12,3) AS so_width_mm,NULL::varchar(40) AS so_temper,
  NULL::varchar(40) AS so_quality,NULL::varchar(40) AS so_coating,NULL::numeric(14,4) AS so_min_wt_mt,
  NULL::numeric(14,4) AS so_max_wt_mt,NULL::varchar(100) AS so_logo,NULL::varchar(100) AS so_spangle,
  NULL::varchar(100) AS so_jet_printing,NULL::varchar(100) AS so_tll,
  mother_rm_batch,supplier_batch,heat_no,mother_stock_grn_date,mother_stock_grn_age_days,
  rm_steel_grade,carbon,manganese,sulphur,phosphorus,silicon,aluminium,carbon_equivalent,
  nitrogen,copper,molybdenum,chromium,nickel,rm_supplier,imported_at,updated_at
FROM mes.vw_rm_store_inventory
UNION ALL
SELECT
  inventory_id::text,source_row_no,source_file,material_type,stock_stage,plant_code,storage_location,
  material_code,batch_no,batch_qty_mt,qa_grade,thickness_mm,width_mm,length_value,
  temper,coating,jet_printing,stock_generated_date,stock_age_days,
  mes_po,so_no,so_line_item,so_thickness_mm,so_width_mm,so_temper,so_quality,
  so_coating,so_min_wt_mt,so_max_wt_mt,so_logo,so_spangle,so_jet_printing,so_tll,
  mother_rm_batch,supplier_batch,heat_no,mother_stock_grn_date,mother_stock_grn_age_days,
  rm_steel_grade,carbon,manganese,sulphur,phosphorus,silicon,aluminium,carbon_equivalent,
  nitrogen,copper,molybdenum,chromium,nickel,rm_supplier,imported_at,updated_at
FROM mes.inventory_master
WHERE UPPER(COALESCE(stock_stage,'')) IN ('WIP','FG');

COMMIT;
