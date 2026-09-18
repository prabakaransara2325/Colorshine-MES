const path=require('path');
require('dotenv').config({path:path.resolve(__dirname,'..','.env')});
const {Client}=require('pg');
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});try{await c.connect();const r=await c.query(`SELECT
 (SELECT count(*)::int FROM mes.material_master WHERE source_system='MES_XLSX') materials,
 (SELECT count(*)::int FROM mes.work_center_master WHERE source_system='MES_XLSX') work_centers,
 (SELECT count(*)::int FROM mes.operation_master) operations,
 (SELECT count(*)::int FROM mes.planning_thickness_matrix WHERE source_file='Masters Creation(1).xlsx') thickness_rows,
 (SELECT count(*)::int FROM mes.planning_thickness_matrix WHERE source_file='Masters Creation(1).xlsx' AND validation_status='VALID' AND is_active) thickness_valid_active,
 (SELECT count(*)::int FROM mes.route_master WHERE source_file='Masters Creation(1).xlsx') routes,
 (SELECT count(*)::int FROM mes.route_master WHERE source_file='Masters Creation(1).xlsx' AND validation_status='VALID' AND is_active) routes_valid_active,
 (SELECT count(*)::int FROM mes.planning_thickness_matrix WHERE source_file='Masters Creation(1).xlsx' AND (
   abs((finished_thk_max_mm-finished_thk_target_mm)-0.005)>0.000001 OR
   abs((finished_thk_target_mm-finished_thk_min_mm)-0.005)>0.000001 OR
   abs((cr_thk_max_mm-cr_thk_target_mm)-0.005)>0.000001 OR
   abs((cr_thk_target_mm-cr_thk_min_mm)-0.005)>0.000001)) bad_tolerance_rows`);console.table(r.rows);if(Number(r.rows[0].bad_tolerance_rows)!==0)process.exitCode=2;}catch(e){console.error('[FAILED]',e.message);process.exitCode=1;}finally{await c.end();}})();
