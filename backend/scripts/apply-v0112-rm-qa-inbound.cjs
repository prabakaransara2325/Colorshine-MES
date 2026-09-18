const fs=require('fs');
const path=require('path');
const dotenv=require('dotenv');
const {Pool}=require('pg');
dotenv.config({path:path.resolve(__dirname,'..','.env')});
if(!process.env.DATABASE_URL){console.error('[FAILED] DATABASE_URL missing in backend/.env');process.exit(1);}
const pool=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{try{
  console.log('============================================================');
  console.log('Colorshine MES v0.11.2 - SAP RM QA / Supplier TC Inbound');
  console.log('Scope: Company 2000 / Plant 2000');
  console.log('============================================================');
  console.log('Applying 43_sap_rm_qa_inbound_v0112.sql ...');
  await pool.query(fs.readFileSync(path.join(__dirname,'..','sql','43_sap_rm_qa_inbound_v0112.sql'),'utf8'));
  const c=await pool.query(`SELECT conname FROM pg_constraint WHERE conname='rm_supplier_tc_batch_id_key'`);
  console.log(c.rowCount ? '[OK] rm_supplier_tc_batch_id_key constraint present.' : '[FAILED] constraint missing after apply');
  console.log('\\n[OK] v0.11.2 SAP RM QA inbound migration applied.');
  console.log('Restart backend, then POST to /api/integration/sap/rm-qa.');
}catch(e){console.error('\\n[FAILED]',e.message);process.exitCode=1}finally{await pool.end()}})();
