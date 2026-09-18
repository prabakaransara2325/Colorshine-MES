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
    // Cumulative foundation. SQL 33/34 are idempotent.
    await apply(client,'33_dynamic_group_code_engine_v0102.sql');
    await apply(client,'34_dynamic_runtime_framework_v0103.sql');
    await apply(client,'35_master_creation_from_workbook_v0104.sql');

    const counts=await client.query(`
      select
        (select count(*) from mes.company_master) as companies,
        (select count(*) from mes.plant_master) as plants,
        (select count(*) from mes.material_master where source_system='MES_XLSX') as materials,
        (select count(*) from mes.work_center_master where source_system='MES_XLSX') as work_centers,
        (select count(*) from mes.operation_master) as operations,
        (select count(*) from mes.planning_thickness_matrix where source_file='Masters Creation(1).xlsx') as thickness_rows,
        (select count(*) from mes.planning_thickness_matrix where source_file='Masters Creation(1).xlsx' and validation_status='VALID' and is_active) as thickness_valid_active,
        (select count(*) from mes.planning_thickness_matrix where source_file='Masters Creation(1).xlsx' and validation_status='REVIEW') as thickness_review,
        (select count(*) from mes.route_master where source_file='Masters Creation(1).xlsx') as routes,
        (select count(*) from mes.route_master where source_file='Masters Creation(1).xlsx' and validation_status='VALID' and is_active) as routes_valid_active,
        (select count(*) from mes.route_master where source_file='Masters Creation(1).xlsx' and validation_status='REVIEW') as routes_review
    `);
    console.table(counts.rows);

    const tol=await client.query(`
      select min(finished_tolerance_mm)::text min_gl_tol,max(finished_tolerance_mm)::text max_gl_tol,
             min(cr_tolerance_mm)::text min_cr_tol,max(cr_tolerance_mm)::text max_cr_tol
      from mes.planning_thickness_matrix where source_file='Masters Creation(1).xlsx'`);
    console.table(tol.rows);

    const badTol=await client.query(`
      select count(*)::int as bad_tolerance_rows
      from mes.planning_thickness_matrix
      where source_file='Masters Creation(1).xlsx'
        and (
          abs((finished_thk_target_mm-finished_thk_min_mm)-0.005) > 0.000001
          or abs((finished_thk_max_mm-finished_thk_target_mm)-0.005) > 0.000001
          or abs((cr_thk_target_mm-cr_thk_min_mm)-0.005) > 0.000001
          or abs((cr_thk_max_mm-cr_thk_target_mm)-0.005) > 0.000001
        )`);
    console.table(badTol.rows);
    if(Number(badTol.rows[0].bad_tolerance_rows)!==0){
      throw new Error('Thickness tolerance verification failed. Expected every GL/CR row to use ±0.005 mm.');
    }

    console.log('v0.10.4 master creation completed successfully.');
    console.log('Expected: 12 materials, 12 work centers, 12 operations, 94 thickness rows (92 active + 2 review), 33 routes (32 active + 1 review).');
    console.log('Capacity milestones remain blank because the workbook did not contain capacity values.');
  }finally{
    await client.end();
  }
}

main().catch(e=>{console.error('\n[FAILED]',e.message);process.exit(1)});
