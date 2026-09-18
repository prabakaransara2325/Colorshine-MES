const fs=require('fs');
const path=require('path');
const dotenv=require('dotenv');
const {Pool}=require('pg');
dotenv.config({path:path.resolve(__dirname,'..','.env')});
if(!process.env.DATABASE_URL){console.error('[FAILED] DATABASE_URL missing in backend/.env');process.exit(1);}
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const sqlDir=path.resolve(__dirname,'..','sql');
(async()=>{try{
  console.log('============================================================');
  console.log('Colorshine MES v0.11.0 - TDC Template + Workflow');
  console.log('Scope: Company 2000 / Plant 2000');
  console.log('============================================================');
  for(const f of ['33_dynamic_group_code_engine_v0102.sql','41_tdc_template_workflow_v0110.sql']){
    console.log(`Applying ${f} ...`);await pool.query(fs.readFileSync(path.join(sqlDir,f),'utf8'));
  }
  const check=await pool.query(`SELECT
    (SELECT count(*)::int FROM mes.tdc_characteristic_master WHERE is_active) AS characteristics,
    (SELECT count(*)::int FROM mes.tdc_template_header WHERE plant_code='2000' AND template_status='ACTIVE') AS active_templates,
    (SELECT count(*)::int FROM mes.tdc_category_master WHERE is_active) AS categories,
    (SELECT count(*)::int FROM mes.tdc_series_master WHERE is_active) AS series,
    (SELECT count(*)::int FROM mes.tdc_number_object WHERE plant_code='2000' AND is_active) AS number_objects,
    (SELECT count(*)::int FROM mes.app_access_group WHERE group_code LIKE 'TDC_%_2000' AND is_active) AS tdc_access_groups`);
  console.table(check.rows);
  const next=await pool.query(`SELECT tdc_prefix,series_code,current_number,next_tdc_no FROM mes.vw_tdc_number_object ORDER BY tdc_prefix,series_code`);
  console.log('TDC Number Objects / Next Numbers:');console.table(next.rows);
  console.log('\nv0.11.0 TDC implementation migration complete.');
  console.log('Restart backend/frontend, press Ctrl+F5, then open Quality -> TDC Template Master (4200).');
}catch(e){console.error(`\n[FAILED] ${e.message}`);process.exitCode=1;}finally{await pool.end();}})();
