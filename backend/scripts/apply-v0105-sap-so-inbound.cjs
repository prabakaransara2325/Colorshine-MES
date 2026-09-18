const fs=require('fs');
const path=require('path');
const dotenv=require('dotenv');
const {Pool}=require('pg');
dotenv.config({path:path.resolve(__dirname,'..','.env')});
if(!process.env.DATABASE_URL){console.error('[FAILED] DATABASE_URL missing in backend/.env');process.exit(1);}
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const sqlDir=path.resolve(__dirname,'..','sql');
const files=[
  '33_dynamic_group_code_engine_v0102.sql',
  '34_dynamic_runtime_framework_v0103.sql',
  '37_sap_sales_order_inbound_v0105.sql',
  '35_master_creation_from_workbook_v0104.sql'
];
(async()=>{try{
  console.log('============================================================');
  console.log('Colorshine MES v0.10.5 - SAP SO Inbound + Master Fix');
  console.log('============================================================');
  console.log('Master fix: operation sequence_no is INTEGER (v0.10.4 text error corrected).');
  console.log('Thickness rule remains TARGET +/- 0.005 mm.\n');
  for(const f of files){console.log(`Applying ${f} ...`);await pool.query(fs.readFileSync(path.join(sqlDir,f),'utf8'));}
  console.log('Applying verification ...');
  const check=await pool.query(`SELECT
    (SELECT count(*)::int FROM mes.material_master) materials,
    (SELECT count(*)::int FROM mes.work_center_master) work_centers,
    (SELECT count(*)::int FROM mes.operation_master) operations,
    (SELECT count(*)::int FROM mes.planning_thickness_matrix) thickness_rows,
    (SELECT count(*)::int FROM mes.route_master) routes,
    (SELECT count(*)::int FROM mes.planning_thickness_matrix WHERE abs((finished_thk_max_mm-finished_thk_target_mm)-0.005)>0.00001 OR abs((finished_thk_target_mm-finished_thk_min_mm)-0.005)>0.00001 OR abs((cr_thk_max_mm-cr_thk_target_mm)-0.005)>0.00001 OR abs((cr_thk_target_mm-cr_thk_min_mm)-0.005)>0.00001) bad_tolerance_rows,
    to_regclass('mes.sap_sales_order_item')::text sap_so_inbound_table`);
  console.table(check.rows);
  console.log('\nv0.10.5 structure/master migration complete.');
  console.log('Next: run IMPORT_SAMPLE_SAP_SO_V0105.bat to land the supplied SAP SO sample.');
}catch(e){console.error(`\n[FAILED] ${e.message}`);process.exitCode=1;}finally{await pool.end();}})();
