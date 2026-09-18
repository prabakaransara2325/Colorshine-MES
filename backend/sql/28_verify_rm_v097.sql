-- Colorshine MES v0.9.7 - RM opening inventory verification
SET search_path TO mes, public;

SELECT
  count(*)::int AS coils,
  round(coalesce(sum(batch_qty_mt),0),3) AS total_qty_mt,
  min(stock_generated_date) AS oldest_stock_date,
  max(stock_generated_date) AS newest_stock_date,
  min(stock_age_days) AS minimum_age_days,
  max(stock_age_days) AS maximum_age_days,
  count(*) FILTER (WHERE stock_status='AVAILABLE')::int AS available_coils,
  count(*) FILTER (WHERE stock_status='QUALITY_HOLD')::int AS hold_coils
FROM mes.vw_rm_store_inventory
WHERE plant_code='2000' AND material_code LIKE 'R_HR%';

SELECT
  count(*)::int AS grn_monitor_rows
FROM mes.vw_grn_ud_queue
WHERE plant_code='2000' AND sap_material_code LIKE 'R_HR%';

SELECT
  count(DISTINCT tc.batch_id)::int AS qa_batches,
  count(r.tc_result_id)::int AS qa_parameter_results
FROM mes.rm_supplier_tc tc
LEFT JOIN mes.rm_supplier_tc_result r ON r.supplier_tc_id=tc.supplier_tc_id
WHERE tc.plant_code='2000';

-- Display-format check: thickness 3 decimals, width no decimals, chemistry 3 decimals,
-- RM source without leading zeroes.
SELECT
  material_code,batch_no,
  to_char(thickness_mm,'FM999990.000') AS thickness_3dp,
  to_char(width_mm,'FM999999990') AS width_whole_mm,
  rm_source,
  stock_generated_date,stock_age_days,
  to_char(NULLIF(carbon,'')::numeric,'FM999990.000') AS carbon_3dp,
  to_char(NULLIF(manganese,'')::numeric,'FM999990.000') AS manganese_3dp,
  to_char(NULLIF(carbon_equivalent,'')::numeric,'FM999990.000') AS ce_3dp
FROM mes.vw_rm_store_inventory
WHERE plant_code='2000'
ORDER BY stock_generated_date DESC,batch_no
LIMIT 20;
