const fs=require('fs');
const path=require('path');
const {Client}=require('pg');
require('dotenv').config({path:path.resolve(__dirname,'..','.env')});

async function apply(client,name){
  const file=path.resolve(__dirname,'..','sql',name);
  if(!fs.existsSync(file)) throw new Error(`Missing SQL file: ${name}`);
  console.log(`Applying ${name} ...`);
  await client.query(fs.readFileSync(file,'utf8'));
}

async function main(){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing in backend .env');
  const client=new Client({connectionString:process.env.DATABASE_URL});
  await client.connect();
  try{
    // v0.10.3 is cumulative over the fresh-start database. SQL 33 is idempotent,
    // so running it here makes this patch safe even if v0.10.2 was not applied yet.
    await apply(client,'33_dynamic_group_code_engine_v0102.sql');
    await apply(client,'34_dynamic_runtime_framework_v0103.sql');

    const check=await client.query(`
      select
        (select count(*) from information_schema.tables where table_schema='mes' and table_name='work_center_capacity_milestone') as work_center_capacity,
        (select count(*) from information_schema.tables where table_schema='mes' and table_name='group_code_master') as group_code_master,
        (select count(*) from information_schema.tables where table_schema='mes' and table_name='operation_master') as operation_master,
        (select count(*) from information_schema.tables where table_schema='mes' and table_name='screen_group_control_binding') as screen_bindings,
        (select count(*) from mes.app_screen where screen_code='MDM_GROUP_CODES' and is_active=true) as screen_7104,
        (select count(*) from mes.app_screen where screen_code='MDM_OPERATIONS' and is_active=true) as screen_7105`);
    console.table(check.rows);
    console.log('v0.10.3 dynamic runtime framework migration complete.');
    console.log('No Company, Plant, Work Center, Operation, Group Code or business values were seeded.');
  }finally{await client.end();}
}

main().catch(e=>{console.error('\n[FAILED]',e.message);process.exit(1)});
