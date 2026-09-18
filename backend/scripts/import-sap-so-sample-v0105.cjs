const fs = require('fs');
const path = require('path');

const dataDir = path.resolve(__dirname, '..', 'data', 'sap_so_sample');
const validateOnly = process.argv.includes('--validate-only');

function decodeXml(s='') {
  return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'").trim();
}

function parseXmlRows(file) {
  const text = fs.readFileSync(file, 'latin1');
  const rows=[];
  const rowRe=/<ROW>([\s\S]*?)<\/ROW>/gi;
  let rm;
  while((rm=rowRe.exec(text))){
    const row={};
    const colRe=/<COLUMN\s+NAME="([^"]+)">(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/COLUMN>/gi;
    let cm;
    while((cm=colRe.exec(rm[1]))) row[cm[1]]=decodeXml(cm[2] ?? cm[3] ?? '');
    rows.push(row);
  }
  return rows;
}

function splitTopLevel(s){
  const out=[]; let cur=''; let quote=false; let depth=0;
  for(let i=0;i<s.length;i++){
    const ch=s[i];
    if(ch==="'"){
      cur+=ch;
      if(quote && s[i+1]==="'"){cur+=s[++i];continue;}
      quote=!quote; continue;
    }
    if(!quote){
      if(ch==='(') depth++;
      else if(ch===')') depth--;
      else if(ch===',' && depth===0){out.push(cur.trim());cur='';continue;}
    }
    cur+=ch;
  }
  if(cur.trim())out.push(cur.trim());
  return out;
}

function rrDate(ddmmyy){
  if(!ddmmyy)return null;
  const m=String(ddmmyy).match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if(!m)return ddmmyy;
  const yy=Number(m[3]);
  const year=yy<=49?2000+yy:1900+yy;
  return `${year}-${m[2]}-${m[1]}`;
}

function parseSqlValue(token){
  const t=token.trim();
  if(/^null$/i.test(t))return null;
  let m=t.match(/^to_date\('([^']*)'\s*,\s*'[^']*'\)$/i);
  if(m)return rrDate(m[1]);
  if(t.startsWith("'") && t.endsWith("'"))return t.slice(1,-1).replace(/''/g,"'");
  return t;
}

function parseChemSql(file){
  const text=fs.readFileSync(file,'latin1');
  const rows=[];
  for(const line of text.split(/\r?\n/)){
    if(!/^\s*Insert into\s+MESSAP\.IFTLI_L4L3_SO_CHEM_MECH_CHAR/i.test(line))continue;
    const m=line.match(/IFTLI_L4L3_SO_CHEM_MECH_CHAR\s*\(([^)]*)\)\s*values\s*\((.*)\);\s*$/i);
    if(!m) throw new Error(`Unable to parse chemistry SQL line: ${line.slice(0,180)}`);
    const cols=splitTopLevel(m[1]).map(x=>x.trim());
    const vals=splitTopLevel(m[2]).map(parseSqlValue);
    if(cols.length!==vals.length)throw new Error(`Column/value mismatch in chemistry SQL (${cols.length}/${vals.length})`);
    rows.push(Object.fromEntries(cols.map((c,i)=>[c,vals[i]])));
  }
  return rows;
}

function dateDMY(s){
  if(!s)return null;
  const m=String(s).match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if(!m)return s;
  return rrDate(s);
}

function numberOrNull(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function payload(row){return row;}

function normHeader(r){return {
  so_no:r.SO_NO, so_item_no:r.SO_ITEM_NO, tdc_no:r.TDC_NO||null, material_code:r.MATERIAL_CODE,
  qty:numberOrNull(r.QTY), uom:r.UOM||null, required_date:dateDMY(r.REQUIRED_DATE), sold_to_party_name:r.SOLD_TO_PARTY_NAME||null,
  ship_to_party_name:r.SHIP_TO_PARTY_NAME||null, sold_to_code:r.SOLD_TO_CODE||null, ship_to_code:r.SHIP_TO_CODE||null,
  sales_organization:r.SALES_ORGANIZATION||null, distribution_channel:r.DISTRIBUTION_CHANNEL||null,
  purchase_order_number:r.PURCHASE_ORDER_NUMBER||null, plant_code:r.PLANT_CODE||null, destination_city:r.DESTINATION_CITY||null,
  order_creation_date:dateDMY(r.ORDER_CREATION_DATE), mode_of_transport:r.MODE_OF_TRANSPORT||null, error_description:r.ERROR_DESCRIPTION||null,
  send_date:dateDMY(r.SEND_DATE), so_overdelivery_tol:numberOrNull(r.SO_OVERDELIVERY_TOL), so_underdelivery_tol:numberOrNull(r.SO_UNDERDELIVERY_TOL),
  route_id:r.ROUTE_ID||null, route_description:r.ROUTE_DESCRIPTION||null, unloading_point:r.UNLOADING_POINT||null, receiving_point:r.RECEIVING_POINT||null,
  material_tree:r.MATERIAL_TREE||null, process_path:r.PROCESS_PATH||null, proposed_delivery_date:dateDMY(r.PROPOSED_DELIVERY_DATE), committed_date:dateDMY(r.COMMITTED_DATE),
  division:r.DIVISION||null, sales_doc_type:r.SALES_DOC_TYPE||null, manufacturing_plant:r.MANUFACTURING_PLANT||null, uname:r.UNAME||null,
  yield_stng:r.YIELD_STNG||null, release_date:dateDMY(r.RELEASE_DATE), region_code:r.REGION_CODE||null, region_desc:r.REGION_DESC||null,
  so_item_desc:r.SO_ITEM_DESC||null, status_flag:r.STATUS_FLAG||null, created_by:r.CREATED_BY||null, source_created_date:dateDMY(r.CREATED_DATE),
  modified_by:r.MODIFIED_BY||null, source_modified_date:dateDMY(r.MODIFIED_DATE), sch_line_cat:r.SCH_LINE_CAT||null,
  source_read_flag:r.READ_FLAG||null, source_payload:payload(r)
};}
function normRoute(r){return {so_no:r.SO_NO,so_item_no:r.SO_ITEM_NO,route_ind:r.ROUTE_IND,process_path:r.PROCESS_PATH||'',material_tree:r.MATERIAL_TREE||'',sent_date:dateDMY(r.SENT_DATE),source_read_flag:r.READ_FLAG||null,created_by:r.CREATED_BY||null,source_created_date:dateDMY(r.CREATED_DATE),modified_by:r.MODIFIED_BY||null,source_modified_date:dateDMY(r.MODIFIED_DATE),source_payload:payload(r)};}
function normChar(r,category){return {source_category:category,so_no:r.SO_NO,so_item_no:r.SO_ITEM_NO,material_code:r.MATERIAL_CODE,route_ind:r.ROUTE_IND,characteristic_name:r.CHARACTERISTIC_NAME,characteristic_value:r.CHARACTERISTIC_VALUE??null,characteristic_uom:r.CHARACTERISTIC_UOM||null,sent_date:dateDMY(r.SENT_DATE),source_read_flag:r.READ_FLAG==null?null:String(r.READ_FLAG),created_by:r.CREATED_BY||null,source_created_date:dateDMY(r.CREATED_DATE),modified_by:r.MODIFIED_BY||null,source_modified_date:dateDMY(r.MODIFIED_DATE),source_payload:payload(r)};}

function assertUnique(rows,keyFn,label){const s=new Set();for(const r of rows){const k=keyFn(r);if(s.has(k))throw new Error(`Duplicate ${label} key: ${k}`);s.add(k);}return s.size;}

const files={
  header:path.join(dataDir,'so_header.xml'),
  details:path.join(dataDir,'so_order_details.xml'),
  routes:path.join(dataDir,'so_process_path.xml'),
  chem:path.join(dataDir,'so_chem_mech_char.xml')
};
for(const [k,f] of Object.entries(files)) if(!fs.existsSync(f)) throw new Error(`Missing sample ${k} file: ${f}`);

const header=parseXmlRows(files.header).map(normHeader);
const routes=parseXmlRows(files.routes).map(normRoute);
const details=parseXmlRows(files.details).map(r=>normChar(r,'ORDER_DETAIL'));
const chem=parseChemSql(files.chem).map(r=>normChar(r,'CHEM_MECH'));

if(header.length!==5||routes.length!==26||details.length!==7636||chem.length!==776)
  throw new Error(`Unexpected sample counts. header=${header.length}, routes=${routes.length}, details=${details.length}, chem=${chem.length}`);
assertUnique(header,r=>`${r.so_no}|${r.so_item_no}`,'SO header/item');
assertUnique(routes,r=>`${r.so_no}|${r.so_item_no}|${r.route_ind}`,'SO route');
assertUnique(details,r=>`${r.source_category}|${r.so_no}|${r.so_item_no}|${r.material_code}|${r.route_ind}|${r.characteristic_name}`,'order characteristic');
assertUnique(chem,r=>`${r.source_category}|${r.so_no}|${r.so_item_no}|${r.material_code}|${r.route_ind}|${r.characteristic_name}`,'chem/mech characteristic');
const totalQty=header.reduce((a,r)=>a+Number(r.qty||0),0);

console.log('============================================================');
console.log('Colorshine MES v0.10.5 - SAP Sales Order Sample Import');
console.log('============================================================');
console.log(`SO items              : ${header.length}`);
console.log(`Process-path variants : ${routes.length}`);
console.log(`Order characteristics : ${details.length}`);
console.log(`Chem/Mech parameters  : ${chem.length}`);
console.log(`SO quantity total     : ${totalQty.toFixed(3)} MT`);
console.log(`Sales Order           : ${[...new Set(header.map(x=>x.so_no))].join(', ')}`);

if(validateOnly){console.log('\nValidation only: source files parsed successfully; database was not changed.');process.exit(0);}
const dotenv = require('dotenv');
const { Pool } = require('pg');
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing in backend/.env');
const pool=new Pool({connectionString:process.env.DATABASE_URL});

async function main(){
  const check=await pool.query(`SELECT to_regclass('mes.sap_sales_order_item') AS table_name`);
  if(!check.rows[0]?.table_name) throw new Error('v0.10.5 SAP SO inbound foundation is not installed. Run APPLY_V0105_SAP_SO_INBOUND.bat first.');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const run=await client.query(`INSERT INTO mes.sap_so_inbound_run(source_system,source_reference,process_status) VALUES('SAP_S4HANA','v0.10.5 supplied sample files','RECEIVING') RETURNING run_id`);
    const runId=run.rows[0].run_id;

    await client.query(`
      INSERT INTO mes.sap_sales_order_item(
        so_no,so_item_no,tdc_no,material_code,qty,uom,required_date,sold_to_party_name,ship_to_party_name,sold_to_code,ship_to_code,
        sales_organization,distribution_channel,purchase_order_number,plant_code,destination_city,order_creation_date,mode_of_transport,error_description,
        send_date,so_overdelivery_tol,so_underdelivery_tol,route_id,route_description,unloading_point,receiving_point,material_tree,process_path,
        proposed_delivery_date,committed_date,division,sales_doc_type,manufacturing_plant,uname,yield_stng,release_date,region_code,region_desc,so_item_desc,
        status_flag,created_by,source_created_date,modified_by,source_modified_date,sch_line_cat,source_read_flag,source_payload,last_run_id,last_received_at)
      SELECT x.so_no,x.so_item_no,x.tdc_no,x.material_code,x.qty,x.uom,x.required_date,x.sold_to_party_name,x.ship_to_party_name,x.sold_to_code,x.ship_to_code,
        x.sales_organization,x.distribution_channel,x.purchase_order_number,x.plant_code,x.destination_city,x.order_creation_date,x.mode_of_transport,x.error_description,
        x.send_date,x.so_overdelivery_tol,x.so_underdelivery_tol,x.route_id,x.route_description,x.unloading_point,x.receiving_point,x.material_tree,x.process_path,
        x.proposed_delivery_date,x.committed_date,x.division,x.sales_doc_type,x.manufacturing_plant,x.uname,x.yield_stng,x.release_date,x.region_code,x.region_desc,x.so_item_desc,
        x.status_flag,x.created_by,x.source_created_date,x.modified_by,x.source_modified_date,x.sch_line_cat,x.source_read_flag,x.source_payload,$2,now()
      FROM jsonb_to_recordset($1::jsonb) AS x(
        so_no text,so_item_no text,tdc_no text,material_code text,qty numeric,uom text,required_date date,sold_to_party_name text,ship_to_party_name text,sold_to_code text,ship_to_code text,
        sales_organization text,distribution_channel text,purchase_order_number text,plant_code text,destination_city text,order_creation_date date,mode_of_transport text,error_description text,
        send_date date,so_overdelivery_tol numeric,so_underdelivery_tol numeric,route_id text,route_description text,unloading_point text,receiving_point text,material_tree text,process_path text,
        proposed_delivery_date date,committed_date date,division text,sales_doc_type text,manufacturing_plant text,uname text,yield_stng text,release_date date,region_code text,region_desc text,so_item_desc text,
        status_flag text,created_by text,source_created_date date,modified_by text,source_modified_date date,sch_line_cat text,source_read_flag text,source_payload jsonb)
      ON CONFLICT(so_no,so_item_no) DO UPDATE SET
        tdc_no=EXCLUDED.tdc_no,material_code=EXCLUDED.material_code,qty=EXCLUDED.qty,uom=EXCLUDED.uom,required_date=EXCLUDED.required_date,
        sold_to_party_name=EXCLUDED.sold_to_party_name,ship_to_party_name=EXCLUDED.ship_to_party_name,sold_to_code=EXCLUDED.sold_to_code,ship_to_code=EXCLUDED.ship_to_code,
        sales_organization=EXCLUDED.sales_organization,distribution_channel=EXCLUDED.distribution_channel,purchase_order_number=EXCLUDED.purchase_order_number,
        plant_code=EXCLUDED.plant_code,destination_city=EXCLUDED.destination_city,order_creation_date=EXCLUDED.order_creation_date,mode_of_transport=EXCLUDED.mode_of_transport,
        error_description=EXCLUDED.error_description,send_date=EXCLUDED.send_date,so_overdelivery_tol=EXCLUDED.so_overdelivery_tol,so_underdelivery_tol=EXCLUDED.so_underdelivery_tol,
        route_id=EXCLUDED.route_id,route_description=EXCLUDED.route_description,unloading_point=EXCLUDED.unloading_point,receiving_point=EXCLUDED.receiving_point,
        material_tree=EXCLUDED.material_tree,process_path=EXCLUDED.process_path,proposed_delivery_date=EXCLUDED.proposed_delivery_date,committed_date=EXCLUDED.committed_date,
        division=EXCLUDED.division,sales_doc_type=EXCLUDED.sales_doc_type,manufacturing_plant=EXCLUDED.manufacturing_plant,uname=EXCLUDED.uname,yield_stng=EXCLUDED.yield_stng,
        release_date=EXCLUDED.release_date,region_code=EXCLUDED.region_code,region_desc=EXCLUDED.region_desc,so_item_desc=EXCLUDED.so_item_desc,status_flag=EXCLUDED.status_flag,
        created_by=EXCLUDED.created_by,source_created_date=EXCLUDED.source_created_date,modified_by=EXCLUDED.modified_by,source_modified_date=EXCLUDED.source_modified_date,
        sch_line_cat=EXCLUDED.sch_line_cat,source_read_flag=EXCLUDED.source_read_flag,source_payload=EXCLUDED.source_payload,last_run_id=EXCLUDED.last_run_id,last_received_at=now()`,
      [JSON.stringify(header),runId]);

    await client.query(`
      INSERT INTO mes.sap_sales_order_route(so_no,so_item_no,route_ind,process_path,material_tree,sent_date,source_read_flag,created_by,source_created_date,modified_by,source_modified_date,source_payload,last_run_id,last_received_at)
      SELECT x.so_no,x.so_item_no,x.route_ind,x.process_path,x.material_tree,x.sent_date,x.source_read_flag,x.created_by,x.source_created_date,x.modified_by,x.source_modified_date,x.source_payload,$2,now()
      FROM jsonb_to_recordset($1::jsonb) AS x(so_no text,so_item_no text,route_ind text,process_path text,material_tree text,sent_date date,source_read_flag text,created_by text,source_created_date date,modified_by text,source_modified_date date,source_payload jsonb)
      ON CONFLICT(so_no,so_item_no,route_ind) DO UPDATE SET process_path=EXCLUDED.process_path,material_tree=EXCLUDED.material_tree,sent_date=EXCLUDED.sent_date,
        source_read_flag=EXCLUDED.source_read_flag,created_by=EXCLUDED.created_by,source_created_date=EXCLUDED.source_created_date,modified_by=EXCLUDED.modified_by,
        source_modified_date=EXCLUDED.source_modified_date,source_payload=EXCLUDED.source_payload,last_run_id=EXCLUDED.last_run_id,last_received_at=now()`,[JSON.stringify(routes),runId]);

    async function upsertChars(rows){
      await client.query(`
        INSERT INTO mes.sap_sales_order_characteristic(source_category,so_no,so_item_no,material_code,route_ind,characteristic_name,characteristic_value,characteristic_uom,
          sent_date,source_read_flag,created_by,source_created_date,modified_by,source_modified_date,source_payload,last_run_id,last_received_at)
        SELECT x.source_category,x.so_no,x.so_item_no,x.material_code,x.route_ind,x.characteristic_name,x.characteristic_value,x.characteristic_uom,
          x.sent_date,x.source_read_flag,x.created_by,x.source_created_date,x.modified_by,x.source_modified_date,x.source_payload,$2,now()
        FROM jsonb_to_recordset($1::jsonb) AS x(source_category text,so_no text,so_item_no text,material_code text,route_ind text,characteristic_name text,characteristic_value text,characteristic_uom text,
          sent_date date,source_read_flag text,created_by text,source_created_date date,modified_by text,source_modified_date date,source_payload jsonb)
        ON CONFLICT(source_category,so_no,so_item_no,material_code,route_ind,characteristic_name) DO UPDATE SET
          characteristic_value=EXCLUDED.characteristic_value,characteristic_uom=EXCLUDED.characteristic_uom,sent_date=EXCLUDED.sent_date,source_read_flag=EXCLUDED.source_read_flag,
          created_by=EXCLUDED.created_by,source_created_date=EXCLUDED.source_created_date,modified_by=EXCLUDED.modified_by,source_modified_date=EXCLUDED.source_modified_date,
          source_payload=EXCLUDED.source_payload,last_run_id=EXCLUDED.last_run_id,last_received_at=now()`,[JSON.stringify(rows),runId]);
    }
    await upsertChars(details);
    await upsertChars(chem);

    await client.query(`UPDATE mes.sap_so_inbound_run SET process_status='COMPLETED',header_rows=$2,route_rows=$3,order_detail_rows=$4,chem_mech_rows=$5,completed_at=now() WHERE run_id=$1`,[runId,header.length,routes.length,details.length,chem.length]);
    await client.query('COMMIT');

    const monitor=await client.query(`SELECT so_no,count(*)::int item_count,sum(qty)::numeric(18,3) total_qty_mt,
      count(*) FILTER(WHERE planning_status='READY_FOR_PLANNING')::int ready_items,
      count(*) FILTER(WHERE planning_status='MASTER_PENDING')::int master_pending_items
      FROM mes.vw_sap_sales_order_monitor WHERE so_no=$1 GROUP BY so_no`,[header[0].so_no]);
    const issues=await client.query(`SELECT so_no,so_item_no,material_code,planning_status,validation_message FROM mes.vw_sap_sales_order_monitor WHERE so_no=$1 ORDER BY so_item_no::int`,[header[0].so_no]);
    console.log('\n================== IMPORT COMPLETE ==================');
    console.table(monitor.rows);
    console.table(issues.rows);
    console.log('Raw SAP SO data is safely landed even when MES masters are pending.');
  }catch(e){
    try{await client.query('ROLLBACK');}catch{}
    throw e;
  }finally{client.release();await pool.end();}
}

main().catch(e=>{console.error(`\n[FAILED] ${e.message}`);process.exit(1);});
