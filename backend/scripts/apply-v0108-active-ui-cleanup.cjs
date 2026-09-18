const fs=require('fs');
const path=require('path');
const dotenv=require('dotenv');
const {Pool}=require('pg');
dotenv.config({path:path.resolve(__dirname,'..','.env')});
if(!process.env.DATABASE_URL){console.error('[FAILED] DATABASE_URL missing in backend/.env');process.exit(1);}
const pool=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{try{
  console.log('============================================================');
  console.log('Colorshine MES v0.10.8 - Active UI Cleanup');
  console.log('============================================================');
  console.log('Hiding undeveloped dashboard shells. No business/master data is deleted.\n');
  const sql=fs.readFileSync(path.resolve(__dirname,'..','sql','40_active_ui_cleanup_v0108.sql'),'utf8');
  await pool.query(sql);
  const result=await pool.query(`
    SELECT m.module_code,m.module_name,m.is_active AS module_active,
           s.screen_no,s.screen_code,s.screen_name,s.screen_type,s.implementation_status,s.screen_status,s.is_active AS screen_active
      FROM mes.app_screen s
      JOIN mes.app_module m ON m.module_id=s.module_id
     WHERE s.screen_code IN (
       'RMS_DASHBOARD','RMS_GRN_MONITOR','RMS_RM_INVENTORY','PLN_SAP_SO_MONITOR',
       'QLT_RM_UD','QLT_TDC','RPT_SUPPLIER','RPT_PLANT_STOCK','MDM_DASHBOARD',
       'MDM_THICKNESS_MATRIX','MDM_WORK_CENTERS','MDM_WC_TOLERANCE','MDM_GROUP_CODES',
       'MDM_OPERATIONS','MDM_MATERIALS','MDM_ROUTES','ADM_USERS','ADM_USER_MAINTENANCE',
       'PLN_DASHBOARD','PRD_DASHBOARD','QLT_DASHBOARD','MNT_DASHBOARD','RPT_DASHBOARD','ADM_MASTER_DATA_LEGACY'
     )
     ORDER BY m.module_no,s.screen_no NULLS LAST,s.screen_code`);
  console.table(result.rows);
  console.log('\n[OK] UI register cleaned. Restart backend/frontend and press Ctrl+F5.');
}catch(e){console.error(`\n[FAILED] ${e.message}`);process.exitCode=1;}finally{await pool.end();}})();
