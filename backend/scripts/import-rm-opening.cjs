require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL in backend/.env');
  process.exit(1);
}
const pool = new Pool({
  connectionString: databaseUrl,
  max: 5,
  application_name: 'colorshine-mes-rm-opening-import'
});

function parseCsv(text){
  const rows=[]; let row=[]; let field=''; let quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'){
        if(text[i+1]==='"'){ field+='"'; i++; }
        else quoted=false;
      } else field+=ch;
    } else {
      if(ch==='"') quoted=true;
      else if(ch===','){ row.push(field); field=''; }
      else if(ch==='\n'){
        row.push(field.replace(/\r$/,'')); field='';
        if(row.some(v=>v!=='')) rows.push(row);
        row=[];
      } else field+=ch;
    }
  }
  if(field.length || row.length){ row.push(field.replace(/\r$/,'')); if(row.some(v=>v!=='')) rows.push(row); }
  if(!rows.length) return [];
  const headers=rows[0].map(h=>h.replace(/^\uFEFF/,'').trim());
  return rows.slice(1).map(vals=>Object.fromEntries(headers.map((h,i)=>[h,(vals[i]||'').trim()])));
}
function loadCsv(p){ return parseCsv(fs.readFileSync(p,'utf8')); }
function n(v){ if(v===undefined||v==='') return null; const x=Number(v); return Number.isFinite(x)?x:null; }
function d(v){
  if(!v) return null;
  const m=String(v).match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/);
  if(!m) return v;
  let y=Number(m[3]); if(y<100) y+=2000;
  return `${String(y).padStart(4,'0')}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
}
function nb(v){ return v && String(v).trim()!=='' ? String(v).trim() : null; }

async function exists(regclass){
  const r=await pool.query('SELECT to_regclass($1) AS obj',[regclass]);
  return !!r.rows[0].obj;
}
async function runSqlFile(file){
  console.log(`Applying ${path.basename(file)} ...`);
  await pool.query(fs.readFileSync(file,'utf8'));
}
async function batchInsert(table, columns, rows, batchSize=100, onConflict=''){
  for(let start=0; start<rows.length; start+=batchSize){
    const chunk=rows.slice(start,start+batchSize); const vals=[];
    const tuples=chunk.map((r,ri)=>`(${r.map((v,ci)=>{vals.push(v); return `$${ri*columns.length+ci+1}`;}).join(',')})`);
    await pool.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${tuples.join(',')} ${onConflict}`, vals);
    const done=Math.min(start+batchSize,rows.length);
    if(start===0 || done===rows.length || (start/batchSize)%10===0) console.log(`  ${done.toLocaleString()} / ${rows.length.toLocaleString()}`);
  }
}

async function main(){
  const root=path.resolve(__dirname,'..');
  const sqlDir=path.join(root,'sql');
  const dataDir=path.join(root,'data','rm_opening');
  const grnFile=path.join(dataDir,'Colorshine_MES_RM_GRN_Dump_For_Upload.csv');
  const qaFile=path.join(dataDir,'Colorshine_MES_RM_QA_Dump_For_Upload.csv');

  if(!fs.existsSync(grnFile)||!fs.existsSync(qaFile)) throw new Error('Approved GRN/QA CSV files are missing from backend/data/rm_opening.');

  // Install the fresh opening framework once. SQL 23 also removes the old pilot/test row.
  if(!(await exists('mes.rm_opening_inventory_upload'))){
    await runSqlFile(path.join(sqlDir,'23_fresh_rm_inventory_reset_and_upload_foundation.sql'));
  }
  await runSqlFile(path.join(sqlDir,'25_rm_opening_import_backend_patch.sql'));

  const grn=loadCsv(grnFile), qa=loadCsv(qaFile);
  console.log(`Approved GRN rows: ${grn.length.toLocaleString()}`);
  console.log(`Approved QA rows : ${qa.length.toLocaleString()}`);
  if(grn.length!==8692) throw new Error(`GRN row-count mismatch. Expected 8692, found ${grn.length}.`);
  if(qa.length!==8689) throw new Error(`QA row-count mismatch. Expected 8689, found ${qa.length}.`);

  const qaCols=['plant_code','batch_no','heat_no','hr_grade','quality_level','vendor_grade','batch_thick','batch_width','batch_weight','sent_date','supplier_tc_no','chem_treatment','surface_condition','remark','carbon_pct','carbon_eq','manganese_pct','phosphorus_pct','sulphur_pct','silicon_pct','aluminium_pct','nitrogen_pct','nitrogen_ppm','boron_pct','copper_pct','chromium_pct','nickel_pct','tin_pct','ympa','tmpa','el_pct','hardness','uts','ys','inner_dia','outer_dia','source_file'];
  const qaRows=qa.map(r=>[
    r.PLANT_CODE,r.BATCH_NO,nb(r.SIMULATED_HEAT_NO),nb(r.HR_GRADE),nb(r.QUALITY_LEVEL),nb(r.VENDOR_GRADE),
    n(r.BATCH_THICK),n(r.BATCH_WIDTH),n(r.BATCH_WEIGHT),d(r.SENT_DATE),nb(r.SUPPLIER_TC_NO),nb(r.CHEM_TREATMENT),nb(r.SURFACE),nb(r.REMARK),
    n(r.CARBON_PCT),n(r.CARBON_EQ),n(r.MANGANESE_PCT),n(r.PHOSPHORUS_PCT),n(r.SULPHUR_PCT),n(r.SILICON_PCT),n(r.ALUMINIUM_PCT),n(r.NITROGEN_PCT),n(r.NITROGEN_PPM),n(r.BORON_PCT),n(r.COPPER_PCT),n(r.CHROMIUM_PCT),n(r.NICKEL_PCT),n(r.TIN_PCT),n(r.YMPA),n(r.TMPA),n(r.EL_PCT),n(r.HARDNESS),n(r.UTS),n(r.YS),n(r.INNER_DIA),n(r.OUTER_DIA),'Colorshine_MES_RM_QA_Dump_For_Upload.csv'
  ]);
  console.log('Loading QA / chemistry / mechanical reference ...');
  await batchInsert('mes.rm_qa_reference_stage',qaCols,qaRows,100,`ON CONFLICT (plant_code,batch_no) DO UPDATE SET
    heat_no=EXCLUDED.heat_no,hr_grade=EXCLUDED.hr_grade,quality_level=EXCLUDED.quality_level,vendor_grade=EXCLUDED.vendor_grade,
    batch_thick=EXCLUDED.batch_thick,batch_width=EXCLUDED.batch_width,batch_weight=EXCLUDED.batch_weight,sent_date=EXCLUDED.sent_date,
    supplier_tc_no=EXCLUDED.supplier_tc_no,chem_treatment=EXCLUDED.chem_treatment,surface_condition=EXCLUDED.surface_condition,
    remark=EXCLUDED.remark,carbon_pct=EXCLUDED.carbon_pct,carbon_eq=EXCLUDED.carbon_eq,manganese_pct=EXCLUDED.manganese_pct,
    phosphorus_pct=EXCLUDED.phosphorus_pct,sulphur_pct=EXCLUDED.sulphur_pct,silicon_pct=EXCLUDED.silicon_pct,
    aluminium_pct=EXCLUDED.aluminium_pct,nitrogen_pct=EXCLUDED.nitrogen_pct,nitrogen_ppm=EXCLUDED.nitrogen_ppm,
    boron_pct=EXCLUDED.boron_pct,copper_pct=EXCLUDED.copper_pct,chromium_pct=EXCLUDED.chromium_pct,nickel_pct=EXCLUDED.nickel_pct,
    tin_pct=EXCLUDED.tin_pct,ympa=EXCLUDED.ympa,tmpa=EXCLUDED.tmpa,el_pct=EXCLUDED.el_pct,hardness=EXCLUDED.hardness,
    uts=EXCLUDED.uts,ys=EXCLUDED.ys,inner_dia=EXCLUDED.inner_dia,outer_dia=EXCLUDED.outer_dia,source_file=EXCLUDED.source_file,loaded_at=now()`);

  const uploadName='APPROVED_RM_OPENING_2026_09_08';
  const prev=await pool.query('SELECT upload_run_id,upload_status FROM mes.rm_opening_inventory_upload_run WHERE upload_name=$1 ORDER BY uploaded_at DESC LIMIT 1',[uploadName]);
  if(prev.rows[0] && prev.rows[0].upload_status==='POSTED') throw new Error(`${uploadName} is already POSTED. Duplicate import was blocked.`);
  if(prev.rows[0]) await pool.query('DELETE FROM mes.rm_opening_inventory_upload_run WHERE upload_run_id=$1',[prev.rows[0].upload_run_id]);

  const run=await pool.query(`INSERT INTO mes.rm_opening_inventory_upload_run
    (upload_name,plant_code,source_file_name,upload_status,uploaded_by,notes)
    VALUES($1,'2000',$2,'DRAFT','ADMIN',$3) RETURNING upload_run_id`,
    [uploadName,path.basename(grnFile),'Approved Plant 2000 R_HR opening inventory. Heat numbers are simulated migration/test values.']);
  const runId=run.rows[0].upload_run_id;

  const grnCols=['upload_run_id','source_row_no','plant_code','material_code','material_description','batch_no','batch_qty_mt','storage_location','thickness_mm','width_mm','rm_source','supplier_name','supplier_batch','sap_grn_no','grn_date','sap_po_no','sap_po_item','po_delivery_date','movement_type','product_group','product_type','eq_spec','eq_spec_group','eq_sub_spec','chapter_id','chapter_type','crown','heat_no','steel_grade','qa_grade'];
  const grnRows=grn.map((r,i)=>[
    runId,i+1,r.PLANT_CODE,r.MATERIAL_CODE,nb(r.MATERIAL_DESC),r.BATCH_NO,n(r.BATCH_WEIGHT),r.STORAGE_LOC,n(r.BATCH_THICK),n(r.BATCH_WIDTH),
    nb(r.RM_SOURCE),nb(r.VENDOR),nb(r.VENDOR_BATCH),r.GRN,null,nb(r.PO_NO),nb(r.PO_LINE_NO),d(r.PO_DELIVERY_DATE),nb(r.MOVEMENT_TYPE)||'101',
    nb(r.PRODUCT_GROUP),nb(r.PRODUCT_TYPE)||'COIL',nb(r.EQ_SPEC),nb(r.EQ_SPEC_GROUP),nb(r.EQ_SUB_SPEC),nb(r.CHAPTER_ID),nb(r.CHAPTER_TYPE),n(r.CROWN),
    nb(r.SIMULATED_HEAT_NO),null,null
  ]);
  console.log('Loading approved GRN/opening inventory staging ...');
  await batchInsert('mes.rm_opening_inventory_upload',grnCols,grnRows,100);

  console.log('Validating ...');
  const vr=await pool.query('SELECT * FROM mes.validate_rm_opening_inventory_run($1)',[runId]);
  const v=vr.rows[0];
  console.log(`Validation total=${v.total_rows} ready=${v.ready_rows} errors=${v.error_rows}`);
  if(Number(v.error_rows)>0){
    const er=await pool.query(`SELECT source_row_no,batch_no,material_code,storage_location,validation_notes
      FROM mes.rm_opening_inventory_upload WHERE upload_run_id=$1 AND validation_status='ERROR' ORDER BY source_row_no LIMIT 50`,[runId]);
    console.table(er.rows);
    throw new Error('Validation failed. Nothing was posted to live GRN/RM inventory.');
  }

  console.log('Posting GRN + Batch + RM Inventory + QA analysis ...');
  const post=await pool.query("SELECT * FROM mes.post_rm_opening_inventory_run($1,'OPENING_MIGRATION')",[runId]);

  await pool.query(`UPDATE mes.goods_receipt_coil c SET source_supplier_name=u.supplier_name
    FROM mes.rm_opening_inventory_upload u WHERE u.upload_run_id=$1 AND u.linked_grn_coil_id=c.grn_coil_id`,[runId]);

  const inv=await pool.query(`SELECT count(*)::int AS coils,round(coalesce(sum(batch_qty_mt),0),3) AS total_qty_mt,
    count(*) FILTER (WHERE stock_status='AVAILABLE')::int AS available_coils,
    count(*) FILTER (WHERE stock_status='QUALITY_HOLD')::int AS hold_coils,
    round(coalesce(sum(batch_qty_mt) FILTER (WHERE stock_status='AVAILABLE'),0),3) AS available_qty_mt,
    round(coalesce(sum(batch_qty_mt) FILTER (WHERE stock_status='QUALITY_HOLD'),0),3) AS hold_qty_mt
    FROM mes.vw_rm_store_inventory WHERE plant_code='2000'`);
  const grnCount=await pool.query("SELECT count(*)::int AS grn_monitor_rows FROM mes.vw_grn_ud_queue WHERE plant_code='2000' AND sap_material_code LIKE 'R_HR%'");
  const qaCount=await pool.query(`SELECT count(DISTINCT tc.batch_id)::int AS qa_batches,count(r.tc_result_id)::int AS qa_parameter_results
    FROM mes.rm_supplier_tc tc LEFT JOIN mes.rm_supplier_tc_result r ON r.supplier_tc_id=tc.supplier_tc_id WHERE tc.plant_code='2000'`);

  console.log('\n========== IMPORT COMPLETE ==========');
  console.table(post.rows); console.table(inv.rows); console.table(grnCount.rows); console.table(qaCount.rows);
  console.log(`Upload Run ID: ${runId}`);
  console.log('Target expectation: 8,692 RM coils; 8,689 QA-matched PRIME available; 3 QA-pending on quality hold.');
}

main().catch(e=>{ console.error('\n[FAILED]',e.message||e); process.exitCode=1; }).finally(async()=>{ await pool.end(); });
