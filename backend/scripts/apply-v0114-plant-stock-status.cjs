const fs=require('fs');
const path=require('path');
const dotenv=require('dotenv');
const {Pool}=require('pg');
dotenv.config({path:path.resolve(__dirname,'..','.env')});
if(!process.env.DATABASE_URL){console.error('[FAILED] DATABASE_URL missing in backend/.env');process.exit(1);}
const pool=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{try{
  console.log('============================================================');
  console.log('Colorshine MES v0.11.4 - Plant Stock batch status + auto-UD');
  console.log('Scope: Company 2000 / Plant 2000');
  console.log('============================================================');
  console.log('Applying 45_plant_stock_batch_status_v0114.sql ...');
  await pool.query(fs.readFileSync(path.join(__dirname,'..','sql','45_plant_stock_batch_status_v0114.sql'),'utf8'));
  const c=await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='mes' AND table_name='vw_plant_stock_report' AND column_name='stock_status'`);
  console.log(c.rowCount?'[OK] vw_plant_stock_report.stock_status present.':'[FAILED] stock_status column missing after apply');
  console.log('\\n[OK] v0.11.4 applied. Restart backend/frontend.');
}catch(e){console.error('\\n[FAILED]',e.message);process.exitCode=1}finally{await pool.end()}})();
