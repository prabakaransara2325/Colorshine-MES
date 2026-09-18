const path=require('path');
const dotenv=require('dotenv');
const {Pool}=require('pg');
dotenv.config({path:path.resolve(__dirname,'..','.env')});
if(!process.env.DATABASE_URL){console.error('[FAILED] DATABASE_URL missing in backend/.env');process.exit(1);}
const pool=new Pool({connectionString:process.env.DATABASE_URL});
function fail(message){throw new Error(`Verification failed: ${message}`)}
(async()=>{try{
  console.log('============================================================');
  console.log('Colorshine MES v0.11.0 - TDC Verification');
  console.log('Scope: Company 2000 / Plant 2000');
  console.log('============================================================');

  const c=await pool.query(`SELECT
    (SELECT count(*)::int FROM mes.tdc_characteristic_master WHERE is_active) characteristics,
    (SELECT count(*)::int FROM mes.tdc_template_header WHERE plant_code='2000' AND template_status='ACTIVE' AND is_active) active_templates,
    (SELECT count(*)::int FROM mes.tdc_number_object WHERE plant_code='2000' AND is_active) number_objects,
    (SELECT count(*)::int FROM mes.app_screen WHERE screen_no IN ('4200','4201','4202','4203') AND is_active AND screen_status='ACTIVE') active_tdc_screens,
    (SELECT count(*)::int FROM mes.app_access_group WHERE group_code IN ('TDC_CREATOR_2000','TDC_QC_HEAD_2000','TDC_PPC_HEAD_2000','TDC_PLANT_HEAD_2000') AND is_active) approval_groups`);
  console.table(c.rows);
  const x=c.rows[0];
  if(Number(x.characteristics)<45) fail(`expected at least 45 active characteristics, found ${x.characteristics}`);
  if(Number(x.active_templates)<3) fail(`expected at least 3 active Plant 2000 templates, found ${x.active_templates}`);
  if(Number(x.number_objects)<4) fail(`expected at least 4 Plant 2000 Number Objects, found ${x.number_objects}`);
  if(Number(x.active_tdc_screens)!==4) fail(`expected 4 active TDC screens, found ${x.active_tdc_screens}`);
  if(Number(x.approval_groups)!==4) fail(`expected 4 TDC approval groups, found ${x.approval_groups}`);

  const t=await pool.query(`SELECT t.template_code,t.template_name,c.category_code,count(tc.*)::int characteristics
    FROM mes.tdc_template_header t
    JOIN mes.tdc_category_master c ON c.category_id=t.category_id
    LEFT JOIN mes.tdc_template_characteristic tc ON tc.template_id=t.template_id AND tc.is_active
    WHERE t.template_code IN ('SYS_BGL_GL_2000_V1','SYS_CRFH_2000_V1','SYS_HRPO_2000_V1')
    GROUP BY t.template_id,c.category_code ORDER BY t.template_code`);
  console.log('System Templates');console.table(t.rows);
  const expected={SYS_BGL_GL_2000_V1:31,SYS_CRFH_2000_V1:27,SYS_HRPO_2000_V1:20};
  for(const [code,n] of Object.entries(expected)){
    const row=t.rows.find(r=>r.template_code===code);
    if(!row) fail(`system template ${code} is missing`);
    if(Number(row.characteristics)!==n) fail(`${code} expected ${n} mapped characteristics, found ${row.characteristics}`);
  }

  const n=await pool.query(`SELECT tdc_prefix,series_code,current_number,padding_length,next_tdc_no FROM mes.vw_tdc_number_object WHERE plant_code='2000' ORDER BY tdc_prefix,series_code`);
  console.log('Number Objects');console.table(n.rows);
  const minimums={'BGL/OEM':11,'BGL/DOM':7,'CRFH/OEM':2,'HRPO/CIPL':1};
  for(const [key,min] of Object.entries(minimums)){
    const [prefix,series]=key.split('/');const row=n.rows.find(r=>r.tdc_prefix===prefix&&r.series_code===series);
    if(!row) fail(`Number Object ${key} is missing`);
    if(Number(row.current_number)<min) fail(`${key} current number is below protected source baseline ${min}`);
  }

  const g=await pool.query(`SELECT group_code,group_name FROM mes.app_access_group WHERE group_code IN ('TDC_CREATOR_2000','TDC_QC_HEAD_2000','TDC_PPC_HEAD_2000','TDC_PLANT_HEAD_2000') ORDER BY group_code`);
  console.log('Approval Groups');console.table(g.rows);
  console.log('\n[OK] v0.11.0 TDC database verification passed.');
}catch(e){console.error('\n[FAILED]',e.message);process.exitCode=1}finally{await pool.end()}})();
