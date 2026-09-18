const fs=require('fs');
const path=require('path');
const dotenv=require('dotenv');
const {Pool}=require('pg');
dotenv.config({path:path.resolve(__dirname,'..','.env')});
if(!process.env.DATABASE_URL){console.error('[FAILED] DATABASE_URL missing in backend/.env');process.exit(1);}
const pool=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{try{
  console.log('============================================================');
  console.log('Colorshine MES v0.11.1 - TDC Source Templates + Initial TDCs');
  console.log('Scope: Company 2000 / Plant 2000');
  console.log('============================================================');
  for(const f of ['33_dynamic_group_code_engine_v0102.sql','41_tdc_template_workflow_v0110.sql','42_tdc_source_templates_seed_v0111.sql']){
    console.log(`Applying ${f} ...`);
    await pool.query(fs.readFileSync(path.join(__dirname,'..','sql',f),'utf8'));
  }
  const r=await pool.query(`SELECT tdc_no,category_name,series_code,version_label,overall_status,customer_name
    FROM mes.vw_tdc_register
    WHERE tdc_no IN ('BGL/OEM/0011','CRFH/OEM/0002','HRPO/CIPL/0001')
    ORDER BY tdc_no`);
  console.log('\\nInitial source TDCs:');
  console.table(r.rows);
  const n=await pool.query(`SELECT tdc_prefix,series_code,current_number,next_tdc_no
    FROM mes.vw_tdc_number_object
    WHERE plant_code='2000' AND (tdc_prefix,series_code) IN (('BGL','OEM'),('CRFH','OEM'),('HRPO','CIPL'))
    ORDER BY tdc_prefix,series_code`);
  console.log('Number objects:');
  console.table(n.rows);
  console.log('\\n[OK] v0.11.1 source template/TDC seed applied.');
  console.log('Restart backend/frontend, Ctrl+F5, then open Quality -> TDC Register (4201).');
}catch(e){console.error('\\n[FAILED]',e.message);process.exitCode=1}finally{await pool.end()}})();
