const fs=require('fs');
const path=require('path');
const dotenv=require('dotenv');
const {Pool}=require('pg');
dotenv.config({path:path.resolve(__dirname,'..','.env')});
if(!process.env.DATABASE_URL){console.error('[FAILED] DATABASE_URL missing in backend/.env');process.exit(1);}
const pool=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{try{
  console.log('============================================================');
  console.log('Colorshine MES v0.11.7 - fix screen registry gaps');
  console.log('============================================================');
  await pool.query(fs.readFileSync(path.join(__dirname,'..','sql','46_screen_registry_gaps_v0117.sql'),'utf8'));
  const r=await pool.query(`SELECT screen_code,screen_no,screen_name FROM mes.app_screen WHERE screen_code IN ('RPT_PLANT_STOCK','RMS_REVERSAL_REPORT','RMS_GRN_QC_REVERSAL') ORDER BY screen_no`);
  console.table(r.rows);
  console.log(r.rowCount===3?'[OK] All 3 screens registered.':'[FAILED] Not all screens present');
}catch(e){console.error('\\n[FAILED]',e.message);process.exitCode=1}finally{await pool.end()}})();
