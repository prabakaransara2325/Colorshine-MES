SET search_path TO mes, public;

SELECT 'COMPANIES' item,count(*)::int rows FROM mes.company_master
UNION ALL SELECT 'PLANTS',count(*)::int FROM mes.plant_master
UNION ALL SELECT 'MATERIALS',count(*)::int FROM mes.material_master WHERE source_system='MES_XLSX'
UNION ALL SELECT 'WORK_CENTERS',count(*)::int FROM mes.work_center_master WHERE source_system='MES_XLSX'
UNION ALL SELECT 'OPERATIONS',count(*)::int FROM mes.operation_master
UNION ALL SELECT 'THICKNESS',count(*)::int FROM mes.planning_thickness_matrix WHERE source_file='Masters Creation(1).xlsx'
UNION ALL SELECT 'ROUTES',count(*)::int FROM mes.route_master WHERE source_file='Masters Creation(1).xlsx'
UNION ALL SELECT 'ROUTE_STEPS',count(*)::int FROM mes.route_step
ORDER BY item;

SELECT
 count(*) FILTER (WHERE validation_status='VALID' AND is_active)::int AS thickness_valid_active,
 count(*) FILTER (WHERE validation_status='REVIEW')::int AS thickness_review,
 count(*) FILTER (WHERE NOT is_active)::int AS thickness_inactive,
 min(finished_tolerance_mm) AS min_finished_tolerance,
 max(finished_tolerance_mm) AS max_finished_tolerance,
 min(cr_tolerance_mm) AS min_cr_tolerance,
 max(cr_tolerance_mm) AS max_cr_tolerance
FROM mes.planning_thickness_matrix
WHERE source_file='Masters Creation(1).xlsx';

SELECT count(*)::int AS bad_tolerance_rows
FROM mes.planning_thickness_matrix
WHERE source_file='Masters Creation(1).xlsx'
  AND (
    abs((finished_thk_target_mm-finished_thk_min_mm)-0.005) > 0.000001
    OR abs((finished_thk_max_mm-finished_thk_target_mm)-0.005) > 0.000001
    OR abs((cr_thk_target_mm-cr_thk_min_mm)-0.005) > 0.000001
    OR abs((cr_thk_max_mm-cr_thk_target_mm)-0.005) > 0.000001
  );

SELECT source_uuid,material_code,finished_thk_target_mm,
       finished_thk_min_mm,finished_thk_max_mm,
       cr_thk_target_mm,cr_thk_min_mm,cr_thk_max_mm,
       hr_thk_target_mm,hr_thk_min_mm,hr_thk_max_mm,
       validation_status,is_active,validation_notes
FROM mes.planning_thickness_matrix
WHERE validation_status='REVIEW'
ORDER BY source_uuid;

SELECT finished_material_code,route_indicator,process_path,material_tree,
       validation_status,is_active,validation_notes
FROM mes.route_master
WHERE validation_status='REVIEW'
ORDER BY finished_material_code,route_indicator;

SELECT material_code,coating_gsm,finished_thk_target_mm,count(*)::int variants,
       string_agg(source_uuid,', ' ORDER BY source_row_no) source_uuids
FROM mes.planning_thickness_matrix
WHERE source_file='Masters Creation(1).xlsx'
GROUP BY material_code,coating_gsm,finished_thk_target_mm
HAVING count(*)>1
ORDER BY material_code,finished_thk_target_mm;
