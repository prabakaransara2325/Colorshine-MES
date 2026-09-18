const fs=require('fs');
const path=require('path');
const dotenv=require('dotenv');
const {Pool}=require('pg');
dotenv.config({path:path.resolve(__dirname,'..','.env')});
if(!process.env.DATABASE_URL){console.error('[FAILED] DATABASE_URL missing in backend/.env');process.exit(1);}
const pool=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{try{
  console.log('============================================================');
  console.log('Colorshine MES v0.11.3 - RM GRN/QC Reversal + inspection fix');
  console.log('Scope: Company 2000 / Plant 2000');
  console.log('============================================================');
  console.log('Applying 44_rm_grn_qc_reversal_v0113.sql ...');
  await pool.query(fs.readFileSync(path.join(__dirname,'..','sql','44_rm_grn_qc_reversal_v0113.sql'),'utf8'));
  const created=await pool.query(`SELECT count(*) n FROM mes.rm_quality_inspection`);
  console.log(`[OK] rm_quality_inspection rows now present: ${created.rows[0].n}`);
  const grp=await pool.query(`SELECT group_code FROM mes.app_access_group WHERE group_code='RM_GRN_QC_REVERSAL_2000'`);
  console.log(grp.rowCount?'[OK] RM_GRN_QC_REVERSAL_2000 authorization object present.':'[FAILED] authorization object missing after apply');
  console.log('\\n[OK] v0.11.3 applied. Restart backend, then assign RM_GRN_QC_REVERSAL_2000 to authorized users via Admin > User Management.');
}catch(e){console.error('\\n[FAILED]',e.message);process.exitCode=1}finally{await pool.end()}})();
