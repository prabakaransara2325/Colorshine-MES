SET search_path TO mes, public;

SELECT
  count(*) AS rm_inventory_coils,
  round(coalesce(sum(batch_qty_mt),0),3) AS total_qty_mt,
  count(*) FILTER (WHERE stock_status='AVAILABLE') AS available_coils,
  count(*) FILTER (WHERE stock_status='QUALITY_HOLD') AS quality_hold_coils,
  count(*) FILTER (WHERE qa_grade='PRIME') AS prime_coils
FROM mes.vw_rm_store_inventory
WHERE plant_code='2000';

SELECT count(*) AS grn_monitor_rows
FROM mes.vw_grn_ud_queue
WHERE plant_code='2000'
  AND sap_material_code LIKE 'R_HR%';

SELECT
  count(DISTINCT tc.batch_id) AS qa_batches,
  count(r.tc_result_id) AS qa_parameter_results
FROM mes.rm_supplier_tc tc
LEFT JOIN mes.rm_supplier_tc_result r ON r.supplier_tc_id=tc.supplier_tc_id
WHERE tc.plant_code='2000';

SELECT batch_no,material_code,storage_location,batch_qty_mt,qa_grade,stock_status,heat_no,rm_steel_grade,rm_supplier,sap_grn_no
FROM mes.vw_rm_store_inventory
WHERE plant_code='2000'
ORDER BY imported_at DESC,batch_no
LIMIT 50;
