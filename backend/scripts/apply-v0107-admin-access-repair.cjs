const fs=require('fs');
const path=require('path');
const dotenv=require('dotenv');
const {Pool}=require('pg');
dotenv.config({path:path.resolve(__dirname,'..','.env')});
if(!process.env.DATABASE_URL){console.error('[FAILED] DATABASE_URL missing in backend/.env');process.exit(1);}
const pool=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{try{
  console.log('============================================================');
  console.log('Colorshine MES v0.10.7 - ADMIN Access Repair');
  console.log('============================================================');
  console.log('Repairing legacy ADMIN -> SYSTEM_ADMIN company/plant access...\n');
  const sql=fs.readFileSync(path.resolve(__dirname,'..','sql','39_repair_system_admin_access_v0107.sql'),'utf8');
  await pool.query(sql);
  const check=await pool.query(`
    SELECT u.username,
           COALESCE(string_agg(DISTINCT v.plant_code, ', ' ORDER BY v.plant_code),'') authorized_plants,
           array_remove(array_agg(DISTINCT g.group_code),NULL) access_groups
      FROM mes.app_user u
      JOIN mes.app_user_role ur ON ur.user_id=u.user_id
      JOIN mes.app_role r ON r.role_id=ur.role_id AND r.role_code='ADMIN'
      LEFT JOIN mes.vw_user_authorized_plants v ON v.user_id=u.user_id
      LEFT JOIN mes.app_user_access_group uag ON uag.user_id=u.user_id AND uag.is_active=true
      LEFT JOIN mes.app_access_group g ON g.access_group_id=uag.access_group_id AND g.is_active=true
     WHERE u.is_active=true
     GROUP BY u.user_id,u.username
     ORDER BY u.username`);
  console.table(check.rows);
  const failed=check.rows.filter(r=>!String(r.authorized_plants||'').includes('1000')||!String(r.authorized_plants||'').includes('2000'));
  if(failed.length){throw new Error('One or more active ADMIN users still do not have both Plant 1000 and 2000. Check company/plant masters.');}
  console.log('\n[OK] ADMIN access repaired. Restart backend, refresh browser, and sign in again.');
}catch(e){console.error(`\n[FAILED] ${e.message}`);process.exitCode=1;}finally{await pool.end();}})();
