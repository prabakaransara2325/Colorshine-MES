const path=require('path');
const dotenv=require('dotenv');
const {Pool}=require('pg');
dotenv.config({path:path.resolve(__dirname,'..','.env')});
if(!process.env.DATABASE_URL){console.error('[FAILED] DATABASE_URL missing in backend/.env');process.exit(1);}
const pool=new Pool({connectionString:process.env.DATABASE_URL});
function fail(m){throw new Error(`Verification failed: ${m}`)}
(async()=>{try{
  console.log('============================================================');
  console.log('Colorshine MES v0.11.1 - TDC Source Seed Verification');
  console.log('Scope: Company 2000 / Plant 2000');
  console.log('============================================================');

  const templates=await pool.query(`SELECT t.template_code,t.template_name,count(tc.*)::int mapped,
      count(*) FILTER (WHERE NULLIF(trim(tc.default_specification),'') IS NOT NULL)::int defaults
    FROM mes.tdc_template_header t
    LEFT JOIN mes.tdc_template_characteristic tc ON tc.template_id=t.template_id AND tc.is_active
    WHERE t.template_code IN ('SYS_BGL_GL_2000_V1','SYS_CRFH_2000_V1','SYS_HRPO_2000_V1')
    GROUP BY t.template_id ORDER BY t.template_code`);
  console.log('Templates'); console.table(templates.rows);
  const expectedTemplates={
    SYS_BGL_GL_2000_V1:{mapped:29,defaults:29},
    SYS_CRFH_2000_V1:{mapped:27,defaults:27},
    SYS_HRPO_2000_V1:{mapped:20,defaults:20}
  };
  for(const [code,e] of Object.entries(expectedTemplates)){
    const r=templates.rows.find(x=>x.template_code===code);
    if(!r) fail(`${code} missing`);
    if(Number(r.mapped)!==e.mapped) fail(`${code}: expected ${e.mapped} mapped characteristics, found ${r.mapped}`);
    if(Number(r.defaults)!==e.defaults) fail(`${code}: expected ${e.defaults} source defaults, found ${r.defaults}`);
  }

  const tdcs=await pool.query(`SELECT r.tdc_no,r.category_code,r.series_code,r.customer_name,r.version_label,
      r.overall_status,r.version_status,r.approval_stage,m.document_no,
      (SELECT count(*)::int FROM mes.tdc_characteristic_value cv WHERE cv.tdc_version_id=r.tdc_version_id AND NULLIF(trim(cv.colorshine_specification),'') IS NOT NULL) populated_values,
      (SELECT count(*)::int FROM mes.tdc_workflow_approval a WHERE a.tdc_version_id=r.tdc_version_id AND a.approval_status='APPROVED') approved_steps
    FROM mes.vw_tdc_register r
    JOIN mes.tdc_master m ON m.tdc_id=r.tdc_id
    WHERE r.tdc_no IN ('BGL/OEM/0011','CRFH/OEM/0002','HRPO/CIPL/0001')
    ORDER BY r.tdc_no`);
  console.log('Imported TDCs'); console.table(tdcs.rows);
  const expected={
    'BGL/OEM/0011':{values:29,customer:'BONDADA GREEN ENGINEERING PVT LTD',doc:'2001/QA/FM/22/R(00)'},
    'CRFH/OEM/0002':{values:27,customer:'KRISHCA STRAPPING SOLUTIONS LTD',doc:'2001/QA/FM/001/R(00)'},
    'HRPO/CIPL/0001':{values:20,customer:'JBM GROUP',doc:'2001/QA/FM/22/R(00)'}
  };
  for(const [no,e] of Object.entries(expected)){
    const r=tdcs.rows.find(x=>x.tdc_no===no);
    if(!r) fail(`${no} missing from TDC Register`);
    if(r.version_label!=='V01') fail(`${no}: expected V01`);
    if(r.overall_status!=='APPROVED'||r.version_status!=='APPROVED'||r.approval_stage!=='COMPLETE') fail(`${no}: expected APPROVED/COMPLETE`);
    if(Number(r.populated_values)!==e.values) fail(`${no}: expected ${e.values} populated source values, found ${r.populated_values}`);
    if(Number(r.approved_steps)!==4) fail(`${no}: expected four historical approval steps, found ${r.approved_steps}`);
    if(r.customer_name!==e.customer) fail(`${no}: customer name does not match source`);
    if(r.document_no!==e.doc) fail(`${no}: document number does not match source`);
  }

  const crfh=await pool.query(`SELECT cv.characteristic_code,cv.colorshine_specification,cv.customer_comment,cv.final_agreed_specification
    FROM mes.tdc_characteristic_value cv
    JOIN mes.tdc_version v ON v.tdc_version_id=cv.tdc_version_id
    JOIN mes.tdc_master m ON m.tdc_id=v.tdc_id
    WHERE m.tdc_no='CRFH/OEM/0002' AND v.version_no=1
      AND cv.characteristic_code IN ('TENSILE_STRENGTH','EDGE_CONDITION','SHAPE_FLATNESS')
    ORDER BY cv.characteristic_code`);
  console.log('CRFH customer-agreed overrides'); console.table(crfh.rows);
  const uts=crfh.rows.find(x=>x.characteristic_code==='TENSILE_STRENGTH');
  const edge=crfh.rows.find(x=>x.characteristic_code==='EDGE_CONDITION');
  const flat=crfh.rows.find(x=>x.characteristic_code==='SHAPE_FLATNESS');
  if(uts?.final_agreed_specification!=='Min 760 MPa') fail('CRFH final tensile requirement is not Min 760 MPa');
  if(edge?.final_agreed_specification!=='Trimmed Edge') fail('CRFH final edge condition is not Trimmed Edge');
  if(flat?.final_agreed_specification!=='< 20 I Units') fail('CRFH final flatness is not < 20 I Units');

  const hrpoMode=await pool.query(`SELECT tc.default_value_mode
    FROM mes.tdc_template_characteristic tc
    JOIN mes.tdc_template_header t ON t.template_id=tc.template_id
    JOIN mes.tdc_characteristic_master c ON c.characteristic_id=tc.characteristic_id
    WHERE t.template_code='SYS_HRPO_2000_V1' AND c.characteristic_code='TENSILE_STRENGTH'`);
  if(hrpoMode.rows[0]?.default_value_mode!=='MAX') fail('HRPO Tensile Strength template mode must be MAX');

  const nums=await pool.query(`SELECT tdc_prefix,series_code,current_number,next_tdc_no
    FROM mes.vw_tdc_number_object WHERE plant_code='2000'
      AND (tdc_prefix,series_code) IN (('BGL','OEM'),('CRFH','OEM'),('HRPO','CIPL'))
    ORDER BY tdc_prefix,series_code`);
  console.log('Number Objects'); console.table(nums.rows);
  for(const [key,min] of Object.entries({'BGL/OEM':11,'CRFH/OEM':2,'HRPO/CIPL':1})){
    const [p,s]=key.split('/');
    const r=nums.rows.find(x=>x.tdc_prefix===p&&x.series_code===s);
    if(!r||Number(r.current_number)<min) fail(`${key} Number Object below protected baseline ${min}`);
  }

  console.log('\\n[OK] v0.11.1 TDC source templates and initial TDCs verified.');
}catch(e){console.error('\\n[FAILED]',e.message);process.exitCode=1}finally{await pool.end()}})();
