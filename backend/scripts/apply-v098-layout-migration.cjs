const fs=require('fs');
const path=require('path');
const {Pool}=require('pg');
require('dotenv').config({path:path.resolve(__dirname,'..','.env')});

async function main(){
  const file=path.resolve(__dirname,'..','sql','29_user_report_layouts.sql');
  const sql=fs.readFileSync(file,'utf8');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,application_name:'colorshine-mes-v098-layout-migration'});
  try{
    console.log('Applying 29_user_report_layouts.sql ...');
    await pool.query(sql);
    const r=await pool.query("SELECT to_regclass('mes.app_user_report_layout') AS table_name");
    console.log('Report layout table:',r.rows[0]?.table_name||'NOT CREATED');
    console.log('v0.9.8 layout migration complete.');
  }finally{await pool.end();}
}
main().catch(e=>{console.error('\n[FAILED]',e.message);process.exit(1);});
