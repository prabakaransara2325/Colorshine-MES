import { Router } from 'express';
import { query, tx } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { assertPlantAccess } from '../security';

export const mastersRouter=Router();
mastersRouter.use(requireAuth);

const isAdmin=(req:any)=>(req.user?.roles||[]).includes('ADMIN');

// Clean Masters Control Center summary. This endpoint deliberately returns live
// database counts so the landing page proves that the approved master data is
// present instead of showing a static/empty module shell.
mastersRouter.get('/overview',async(req,res,next)=>{
  try{
    const admin=isAdmin(req);
    const userId=req.user!.userId;
    const workCenterAuth=admin?'':` AND EXISTS (SELECT 1 FROM mes.vw_user_authorized_plants ap WHERE ap.user_id=$1 AND ap.plant_code=w.plant_code)`;
    const operationAuth=admin?'':` AND EXISTS (SELECT 1 FROM mes.vw_user_authorized_plants ap WHERE ap.user_id=$1 AND ap.plant_code=o.plant_code)`;
    const matrixAuth=admin?'':` AND EXISTS (SELECT 1 FROM mes.vw_user_authorized_plants ap WHERE ap.user_id=$1 AND ap.plant_code=t.plant_code)`;
    const routeAuth=admin?'':` AND EXISTS (SELECT 1 FROM mes.vw_user_authorized_plants ap WHERE ap.user_id=$1 AND ap.plant_code=r.plant_code)`;
    const vals=admin?[]:[userId];

    const [materials,workCenters,operations,thickness,routes,groups,plants]=await Promise.all([
      query(`SELECT count(*)::int total,count(*) FILTER (WHERE is_active)::int active,count(*) FILTER (WHERE NOT is_active)::int inactive FROM mes.material_master`),
      query(`SELECT count(*)::int total,count(*) FILTER (WHERE w.is_active)::int active,
                    count(*) FILTER (WHERE w.capacity_id IS NOT NULL)::int capacity_milestones
               FROM mes.vw_work_center_master_capacity w WHERE 1=1 ${workCenterAuth}`,vals),
      query(`SELECT count(*)::int total,count(*) FILTER (WHERE o.is_active)::int active FROM mes.operation_master o WHERE 1=1 ${operationAuth}`,vals),
      query(`SELECT count(*)::int total,
                    count(*) FILTER (WHERE t.validation_status='VALID' AND t.is_active)::int active_valid,
                    count(*) FILTER (WHERE t.validation_status='REVIEW')::int review,
                    count(*) FILTER (WHERE NOT t.is_active)::int inactive,
                    count(*) FILTER (WHERE t.source_file='Masters Creation(1).xlsx' AND (
                      abs((t.finished_thk_max_mm-t.finished_thk_target_mm)-0.005)>0.000001 OR
                      abs((t.finished_thk_target_mm-t.finished_thk_min_mm)-0.005)>0.000001 OR
                      abs((t.cr_thk_max_mm-t.cr_thk_target_mm)-0.005)>0.000001 OR
                      abs((t.cr_thk_target_mm-t.cr_thk_min_mm)-0.005)>0.000001
                    ))::int bad_tolerance_rows
               FROM mes.planning_thickness_matrix t WHERE 1=1 ${matrixAuth}`,vals),
      query(`SELECT count(*)::int total,
                    count(*) FILTER (WHERE r.validation_status='VALID' AND r.is_active)::int active_valid,
                    count(*) FILTER (WHERE r.validation_status='REVIEW')::int review,
                    count(*) FILTER (WHERE NOT r.is_active)::int inactive
               FROM mes.route_master r WHERE 1=1 ${routeAuth}`,vals),
      query(`SELECT count(*)::int total,count(*) FILTER (WHERE is_active)::int active FROM mes.group_code_master`),
      admin
        ? query(`SELECT p.company_code,p.plant_code,p.plant_name,p.is_active,
                        (SELECT count(*)::int FROM mes.work_center_master w WHERE w.plant_code=p.plant_code AND w.is_active) work_centers,
                        (SELECT count(*)::int FROM mes.operation_master o WHERE o.plant_code=p.plant_code AND o.is_active) operations
                   FROM mes.plant_master p WHERE p.is_active ORDER BY p.company_code,p.plant_code`)
        : query(`SELECT p.company_code,p.plant_code,p.plant_name,p.is_active,
                        (SELECT count(*)::int FROM mes.work_center_master w WHERE w.plant_code=p.plant_code AND w.is_active) work_centers,
                        (SELECT count(*)::int FROM mes.operation_master o WHERE o.plant_code=p.plant_code AND o.is_active) operations
                   FROM mes.vw_user_authorized_plants ap JOIN mes.plant_master p ON p.plant_code=ap.plant_code
                  WHERE ap.user_id=$1 AND p.is_active ORDER BY p.company_code,p.plant_code`,[userId])
    ]);

    res.json({
      materials:materials.rows[0],
      workCenters:workCenters.rows[0],
      operations:operations.rows[0],
      thickness:thickness.rows[0],
      routes:routes.rows[0],
      groupCodes:groups.rows[0],
      plants:plants.rows,
      toleranceRuleMm:0.005,
      generatedAt:new Date().toISOString()
    });
  }catch(e){next(e)}
});

const PLANNING_PLANT='2000';
const n=(v:any)=>v===undefined||v===null||v===''?null:Number(v);
const s=(v:any)=>v===undefined||v===null?null:String(v).trim()||null;

async function requirePlanningPlant(req:any){
  if(isAdmin(req))return;
  await assertPlantAccess(req.user!.userId,PLANNING_PLANT);
}

mastersRouter.get('/companies',async(req,res,next)=>{
  try{
    const rows=isAdmin(req)
      ? await query(`SELECT company_code,company_name,short_name,is_active FROM mes.company_master ORDER BY company_code`)
      : await query(`
          SELECT DISTINCT c.company_code,c.company_name,c.short_name,c.is_active
            FROM mes.vw_user_authorized_plants v
            JOIN mes.company_master c ON c.company_code=v.company_code
           WHERE v.user_id=$1
           ORDER BY c.company_code`,[req.user!.userId]);
    res.json({rows:rows.rows});
  }catch(e){next(e)}
});

mastersRouter.get('/plants',async(req,res,next)=>{
  try{
    const companyCode=String(req.query.companyCode||'').trim().toUpperCase();
    const rows=isAdmin(req)
      ? await query(`
          SELECT p.*,c.short_name AS company_short_name,c.company_name
            FROM mes.plant_master p
            JOIN mes.company_master c ON c.company_code=p.company_code
           WHERE ($1='' OR p.company_code=$1)
           ORDER BY p.company_code,p.plant_code`,[companyCode])
      : await query(`
          SELECT p.*,v.company_short_name,c.company_name
            FROM mes.vw_user_authorized_plants v
            JOIN mes.plant_master p ON p.plant_code=v.plant_code
            JOIN mes.company_master c ON c.company_code=p.company_code
           WHERE v.user_id=$1 AND ($2='' OR p.company_code=$2)
           ORDER BY p.company_code,p.plant_code`,[req.user!.userId,companyCode]);
    res.json({rows:rows.rows});
  }catch(e){next(e)}
});


mastersRouter.post('/companies',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const r=await query(`INSERT INTO mes.company_master(company_code,company_name,short_name,is_active)
      VALUES(upper(trim($1)),trim($2),upper(trim($3)),$4) RETURNING *`,[
      String(b.company_code||b.companyCode||''),String(b.company_name||b.companyName||''),String(b.short_name||b.shortName||''),b.is_active!==false&&b.isActive!==false
    ]);
    res.status(201).json({row:r.rows[0]});
  }catch(e){next(e)}
});
mastersRouter.put('/companies/:code',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const r=await query(`UPDATE mes.company_master SET company_name=trim($2),short_name=upper(trim($3)),is_active=$4,updated_at=now() WHERE company_code=$1 RETURNING *`,[
      req.params.code,String(b.company_name||b.companyName||''),String(b.short_name||b.shortName||''),b.is_active!==false&&b.isActive!==false
    ]);
    if(!r.rows[0])return res.status(404).json({error:'Company not found'});res.json({row:r.rows[0]});
  }catch(e){next(e)}
});
mastersRouter.get('/companies/:code/deactivation-check',requireRole('ADMIN'),async(req,res,next)=>{
  try{const x=await query(`SELECT count(*)::int AS cnt FROM mes.plant_master WHERE company_code=$1 AND is_active`,[req.params.code]);const n=x.rows[0].cnt;res.json({allowed:n===0,blockers:n?[{code:'ACTIVE_PLANTS',label:'Active Plants',count:n,detail:'Deactivate plants before deactivating the company.'}]:[]})}catch(e){next(e)}
});
mastersRouter.post('/companies/:code/deactivate',requireRole('ADMIN'),async(req,res,next)=>{
  try{const x=await query(`SELECT count(*)::int cnt FROM mes.plant_master WHERE company_code=$1 AND is_active`,[req.params.code]);if(x.rows[0].cnt)return res.status(409).json({error:'Company has active Plants'});await query(`UPDATE mes.company_master SET is_active=false,updated_at=now() WHERE company_code=$1`,[req.params.code]);res.json({ok:true})}catch(e){next(e)}
});
mastersRouter.post('/companies/:code/activate',requireRole('ADMIN'),async(req,res,next)=>{try{await query(`UPDATE mes.company_master SET is_active=true,updated_at=now() WHERE company_code=$1`,[req.params.code]);res.json({ok:true})}catch(e){next(e)}});

mastersRouter.post('/plants',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const r=await query(`INSERT INTO mes.plant_master(plant_code,company_code,plant_name,timezone_name,is_active,source_system)
      VALUES(upper(trim($1)),upper(trim($2)),trim($3),$4,$5,'MES') RETURNING *`,[
      String(b.plant_code||b.plantCode||''),String(b.company_code||b.companyCode||''),String(b.plant_name||b.plantName||''),s(b.timezone_name||b.timezoneName)||'Asia/Kolkata',b.is_active!==false&&b.isActive!==false
    ]);
    res.status(201).json({row:r.rows[0]});
  }catch(e){next(e)}
});
mastersRouter.put('/plants/:code',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const r=await query(`UPDATE mes.plant_master SET company_code=upper(trim($2)),plant_name=trim($3),timezone_name=$4,is_active=$5,updated_at=now() WHERE plant_code=$1 RETURNING *`,[
      req.params.code,String(b.company_code||b.companyCode||''),String(b.plant_name||b.plantName||''),s(b.timezone_name||b.timezoneName)||'Asia/Kolkata',b.is_active!==false&&b.isActive!==false
    ]);
    if(!r.rows[0])return res.status(404).json({error:'Plant not found'});res.json({row:r.rows[0]});
  }catch(e){next(e)}
});
mastersRouter.get('/plants/:code/deactivation-check',requireRole('ADMIN'),async(req,res,next)=>{
  try{const x=await query(`SELECT count(*)::int AS cnt FROM mes.work_center_master WHERE plant_code=$1 AND is_active`,[req.params.code]);const n=x.rows[0].cnt;res.json({allowed:n===0,blockers:n?[{code:'ACTIVE_WORK_CENTERS',label:'Active Work Centers',count:n,detail:'Deactivate Work Centers before deactivating the Plant.'}]:[]})}catch(e){next(e)}
});
mastersRouter.post('/plants/:code/deactivate',requireRole('ADMIN'),async(req,res,next)=>{
  try{const x=await query(`SELECT count(*)::int cnt FROM mes.work_center_master WHERE plant_code=$1 AND is_active`,[req.params.code]);if(x.rows[0].cnt)return res.status(409).json({error:'Plant has active Work Centers'});await query(`UPDATE mes.plant_master SET is_active=false,updated_at=now() WHERE plant_code=$1`,[req.params.code]);res.json({ok:true})}catch(e){next(e)}
});
mastersRouter.post('/plants/:code/activate',requireRole('ADMIN'),async(req,res,next)=>{try{await query(`UPDATE mes.plant_master SET is_active=true,updated_at=now() WHERE plant_code=$1`,[req.params.code]);res.json({ok:true})}catch(e){next(e)}});
mastersRouter.get('/suppliers',async(req,res,next)=>{
  try{const active=String(req.query.active||'active').toLowerCase();const rows=await query(`SELECT * FROM mes.supplier_master WHERE ($1='all' OR is_active) ORDER BY supplier_name`,[active]);res.json({rows:rows.rows})}catch(e){next(e)}
});
mastersRouter.get('/storage-locations',async(req,res,next)=>{
  try{const active=String(req.query.active||'active').toLowerCase();const rows=await query(`SELECT plant_code,storage_location,storage_name,inventory_category,is_active,source_system FROM mes.storage_location_master WHERE ($1='all' OR is_active) ORDER BY plant_code,storage_location`,[active]);res.json({rows:rows.rows})}catch(e){next(e)}
});
mastersRouter.get('/customers',async(req,res,next)=>{
  try{const active=String(req.query.active||'active').toLowerCase();const rows=await query(`SELECT customer_id,sap_customer_no,customer_name,is_active,source_system FROM mes.customer_master WHERE ($1='all' OR is_active) ORDER BY customer_name`,[active]);res.json({rows:rows.rows})}catch(e){next(e)}
});
mastersRouter.get('/brands',async(req,res,next)=>{
  try{const active=String(req.query.active||'active').toLowerCase();const rows=await query(`SELECT brand_id,brand_code,brand_name,brand_sequence_no,is_active FROM mes.brand_master WHERE ($1='all' OR is_active) ORDER BY brand_sequence_no NULLS LAST,brand_name`,[active]);res.json({rows:rows.rows})}catch(e){next(e)}
});
mastersRouter.get('/materials',async(req,res,next)=>{
  try{
    const active=String(req.query.active||'active').trim().toLowerCase();
    const q=String(req.query.q||'').trim();
    const rows=await query(`
      SELECT *
        FROM mes.material_master
       WHERE ($1='all' OR is_active=true)
         AND ($2='' OR sap_material_code ILIKE '%'||$2||'%' OR material_description ILIKE '%'||$2||'%' OR COALESCE(product_group,'') ILIKE '%'||$2||'%')
       ORDER BY sap_material_code`,[active,q]);
    res.json({rows:rows.rows});
  }catch(e){next(e)}
});

mastersRouter.post('/materials',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const code=String(b.sapMaterialCode||b.sap_material_code||'').trim().toUpperCase();
    const description=String(b.materialDescription||b.material_description||'').trim();
    if(!code||!description)return res.status(400).json({error:'Material Code and Description are mandatory'});
    const r=await query(`
      INSERT INTO mes.material_master
      (sap_material_code,material_description,material_type,material_group,product_group,product_type,base_uom,material_category,is_batch_managed,is_active,source_system)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'MES')
      RETURNING *`,[
        code,description,s(b.materialType||b.material_type),s(b.materialGroup||b.material_group),
        s(b.productGroup||b.product_group),s(b.productType||b.product_type),s(b.baseUom||b.base_uom)||'MT',
        String(b.materialCategory||b.material_category||'RAW_MATERIAL').toUpperCase(),
        b.isBatchManaged!==false&&b.is_batch_managed!==false,b.isActive!==false&&b.is_active!==false
      ]);
    res.status(201).json({row:r.rows[0]});
  }catch(e){next(e)}
});

mastersRouter.put('/materials/:id',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const r=await query(`
      UPDATE mes.material_master SET
        material_description=$2,material_type=$3,material_group=$4,product_group=$5,product_type=$6,
        base_uom=$7,material_category=$8,is_batch_managed=$9,is_active=$10,updated_at=now()
      WHERE material_id=$1 RETURNING *`,[
        req.params.id,String(b.materialDescription||b.material_description||'').trim(),
        s(b.materialType||b.material_type),s(b.materialGroup||b.material_group),s(b.productGroup||b.product_group),
        s(b.productType||b.product_type),s(b.baseUom||b.base_uom)||'MT',
        String(b.materialCategory||b.material_category||'RAW_MATERIAL').toUpperCase(),
        b.isBatchManaged!==false&&b.is_batch_managed!==false,b.isActive!==false&&b.is_active!==false
      ]);
    if(!r.rows[0])return res.status(404).json({error:'Material not found'});
    res.json({row:r.rows[0]});
  }catch(e){next(e)}
});

mastersRouter.get('/materials/:id/deactivation-check',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const m=await query(`SELECT sap_material_code FROM mes.material_master WHERE material_id=$1`,[req.params.id]);
    if(!m.rows[0])return res.status(404).json({error:'Material not found'});
    const code=m.rows[0].sap_material_code;
    const blockers:any[]=[];
    const inv=await query(`SELECT count(*)::int cnt FROM mes.rm_inventory_balance i JOIN mes.batch_master b ON b.batch_id=i.batch_id JOIN mes.material_master m ON m.material_id=b.material_id WHERE m.sap_material_code=$1 AND i.on_hand_weight_mt<>0`,[code]).catch(()=>({rows:[{cnt:0}]} as any));
    const routes=await query(`SELECT count(*)::int cnt FROM mes.route_master WHERE is_active AND (finished_material_code=$1 OR material_tree LIKE '%'||$1||'%')`,[code]).catch(()=>({rows:[{cnt:0}]} as any));
    if(inv.rows[0].cnt)blockers.push({code:'INVENTORY',label:'Current Inventory',count:inv.rows[0].cnt,detail:'Material has current inventory.'});
    if(routes.rows[0].cnt)blockers.push({code:'ACTIVE_ROUTES',label:'Active Routes',count:routes.rows[0].cnt,detail:'Material is used by active Route Master records.'});
    res.json({allowed:blockers.length===0,blockers});
  }catch(e){next(e)}
});
mastersRouter.post('/materials/:id/deactivate',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const m=await query(`SELECT sap_material_code FROM mes.material_master WHERE material_id=$1`,[req.params.id]);
    if(!m.rows[0])return res.status(404).json({error:'Material not found'});
    const code=m.rows[0].sap_material_code;
    const routes=await query(`SELECT count(*)::int cnt FROM mes.route_master WHERE is_active AND (finished_material_code=$1 OR material_tree LIKE '%'||$1||'%')`,[code]).catch(()=>({rows:[{cnt:0}]} as any));
    if(routes.rows[0].cnt)return res.status(409).json({error:'Material is used by an active Route Master'});
    await query(`UPDATE mes.material_master SET is_active=false,updated_at=now() WHERE material_id=$1`,[req.params.id]);
    res.json({ok:true});
  }catch(e){next(e)}
});
mastersRouter.post('/materials/:id/activate',requireRole('ADMIN'),async(req,res,next)=>{
  try{await query(`UPDATE mes.material_master SET is_active=true,updated_at=now() WHERE material_id=$1`,[req.params.id]);res.json({ok:true})}catch(e){next(e)}
});
mastersRouter.get('/quality-parameters',async(req,res,next)=>{
  try{const active=String(req.query.active||'active').toLowerCase();const rows=await query(`SELECT * FROM mes.quality_parameter_master WHERE ($1='all' OR is_active) ORDER BY parameter_category,parameter_name`,[active]);res.json({rows:rows.rows})}catch(e){next(e)}
});

// ---------------------------------------------------------------------------
// Dedicated Masters Module - Plant 2000
// ---------------------------------------------------------------------------
mastersRouter.get('/thickness-matrix',async(req,res,next)=>{
  try{
    await requirePlanningPlant(req);
    const q=String(req.query.q||'').trim();
    const status=String(req.query.status||'ALL').trim().toUpperCase();
    const productGroup=String(req.query.productGroup||'ALL').trim().toUpperCase();
    const rows=await query(`
      SELECT matrix_id,plant_code,source_uuid,source_row_no,source_file,material_code,product_group,coating_gsm,matrix_variant_no,
             finished_thk_target_mm,finished_tolerance_mm,finished_thk_min_mm,finished_thk_max_mm,
             cr_thk_target_mm,cr_tolerance_mm,cr_thk_min_mm,cr_thk_max_mm,
             hr_thk_target_mm,hr_thk_min_mm,hr_thk_max_mm,
             validation_status,validation_notes,is_active,effective_from,effective_to,updated_at
        FROM mes.planning_thickness_matrix
       WHERE plant_code='2000'
         AND ($1='' OR COALESCE(material_code,'') ILIKE '%'||$1||'%' OR COALESCE(product_group,'') ILIKE '%'||$1||'%' OR COALESCE(source_uuid,'') ILIKE '%'||$1||'%')
         AND ($2='ALL' OR validation_status=$2)
         AND ($3='ALL' OR product_group=$3)
       ORDER BY product_group NULLS LAST, material_code NULLS LAST, coating_gsm NULLS LAST,
                COALESCE(finished_thk_target_mm,cr_thk_target_mm,hr_thk_target_mm), source_row_no`,[q,status,productGroup]);
    const summary=await query(`
      SELECT count(*)::int total,
             count(*) FILTER (WHERE validation_status='VALID' AND is_active)::int active_valid,
             count(*) FILTER (WHERE validation_status='REVIEW')::int review,
             count(*) FILTER (WHERE NOT is_active)::int inactive
        FROM mes.planning_thickness_matrix WHERE plant_code='2000'`);
    res.json({plantCode:'2000',rows:rows.rows,summary:summary.rows[0]});
  }catch(e){next(e)}
});

mastersRouter.post('/thickness-matrix',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    await requirePlanningPlant(req);
    const b=req.body||{};
    const r=await query(`
      INSERT INTO mes.planning_thickness_matrix
      (plant_code,source_uuid,material_code,product_group,coating_gsm,matrix_variant_no,
       finished_thk_target_mm,finished_tolerance_mm,
       cr_thk_target_mm,cr_tolerance_mm,
       hr_thk_target_mm,hr_thk_min_mm,hr_thk_max_mm,
       validation_status,validation_notes,is_active,effective_from,effective_to,source_file)
      VALUES ('2000',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'MES MANUAL')
      RETURNING *`,[
        s(b.sourceUuid)||`MES-${Date.now()}`,s(b.materialCode),s(b.productGroup),n(b.coatingGsm),n(b.variantNo)||1,
        n(b.finishedTarget),n(b.finishedTolerance)||0.005,n(b.crTarget),n(b.crTolerance)||0.005,
        n(b.hrTarget),n(b.hrMin),n(b.hrMax),String(b.validationStatus||'REVIEW').toUpperCase(),s(b.validationNotes),
        Boolean(b.isActive),s(b.effectiveFrom),s(b.effectiveTo)
      ]);
    res.status(201).json({row:r.rows[0]});
  }catch(e){next(e)}
});

mastersRouter.put('/thickness-matrix/:id',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    await requirePlanningPlant(req);
    const b=req.body||{};
    const r=await query(`
      UPDATE mes.planning_thickness_matrix SET
        material_code=$2,product_group=$3,coating_gsm=$4,matrix_variant_no=$5,
        finished_thk_target_mm=$6,finished_tolerance_mm=$7,
        cr_thk_target_mm=$8,cr_tolerance_mm=$9,
        hr_thk_target_mm=$10,hr_thk_min_mm=$11,hr_thk_max_mm=$12,
        validation_status=$13,validation_notes=$14,is_active=$15,effective_from=$16,effective_to=$17,updated_at=now()
      WHERE matrix_id=$1 AND plant_code='2000'
      RETURNING *`,[
        req.params.id,s(b.materialCode),s(b.productGroup),n(b.coatingGsm),n(b.variantNo)||1,
        n(b.finishedTarget),n(b.finishedTolerance)||0.005,n(b.crTarget),n(b.crTolerance)||0.005,
        n(b.hrTarget),n(b.hrMin),n(b.hrMax),String(b.validationStatus||'REVIEW').toUpperCase(),s(b.validationNotes),
        Boolean(b.isActive),s(b.effectiveFrom),s(b.effectiveTo)
      ]);
    if(!r.rows[0])return res.status(404).json({error:'Thickness matrix row not found'});
    res.json({row:r.rows[0]});
  }catch(e){next(e)}
});

mastersRouter.get('/work-centers',async(req,res,next)=>{
  try{
    const companyCode=String(req.query.companyCode||'').trim().toUpperCase();
    const plant=String(req.query.plant||'').trim().toUpperCase();
    const q=String(req.query.q||'').trim();
    const values:any[]=[];
    let authSql='';
    if(!isAdmin(req)){
      values.push(req.user!.userId);
      authSql=` AND EXISTS (SELECT 1 FROM mes.vw_user_authorized_plants ap WHERE ap.user_id=$${values.length} AND ap.plant_code=w.plant_code)`;
    }
    values.push(companyCode); const cIx=values.length;
    values.push(plant); const pIx=values.length;
    values.push(q); const qIx=values.length;
    const rows=await query(`
      SELECT w.*,
             count(t.tolerance_id) FILTER (WHERE t.is_active)::int AS active_tolerances
        FROM mes.vw_work_center_master_capacity w
        LEFT JOIN mes.work_center_tolerance_matrix t ON t.work_center_id=w.work_center_id
       WHERE ($${cIx}='' OR w.company_code=$${cIx})
         AND ($${pIx}='' OR w.plant_code=$${pIx})
         AND ($${qIx}='' OR w.work_center_code ILIKE '%'||$${qIx}||'%' OR w.work_center_name ILIKE '%'||$${qIx}||'%' OR COALESCE(w.process_area,'') ILIKE '%'||$${qIx}||'%')
         ${authSql}
       GROUP BY w.work_center_id,w.company_code,w.company_name,w.company_short_name,w.plant_code,w.plant_name,
                w.work_center_code,w.work_center_name,w.process_area,w.display_sequence,w.capacity_uom,w.is_active,w.source_system,
                w.created_at,w.updated_at,w.capacity_id,w.capacity_year,w.year_capacity,w.month_capacity,w.day_capacity,w.milestone_uom,w.capacity_remarks
       ORDER BY w.company_code,w.plant_code,w.display_sequence NULLS LAST,w.work_center_code`,values);
    res.json({rows:rows.rows});
  }catch(e){next(e)}
});

mastersRouter.post('/work-centers',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const companyCode=String(b.companyCode||'').trim().toUpperCase();
    const plantCode=String(b.plantCode||'').trim().toUpperCase();
    if(!companyCode||!plantCode)return res.status(400).json({error:'Company Code and Plant Code are mandatory'});
    const row=await tx(async(client)=>{
      const r=await client.query(`
        INSERT INTO mes.work_center_master
        (company_code,plant_code,work_center_code,work_center_name,process_area,display_sequence,capacity_uom,is_active,source_system)
        VALUES ($1,$2,upper(trim($3)),trim($4),$5,$6,$7,$8,'MES') RETURNING *`,[
          companyCode,plantCode,String(b.workCenterCode||''),String(b.workCenterName||''),s(b.processArea),n(b.displaySequence),s(b.capacityUom)||'MT',b.isActive!==false
        ]);
      if(b.capacityYear){
        await client.query(`
          INSERT INTO mes.work_center_capacity_milestone
          (work_center_id,capacity_year,year_capacity,month_capacity,day_capacity,capacity_uom,remarks,is_active,created_by_user_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)
          ON CONFLICT (work_center_id,capacity_year) DO UPDATE SET
            year_capacity=EXCLUDED.year_capacity,month_capacity=EXCLUDED.month_capacity,day_capacity=EXCLUDED.day_capacity,
            capacity_uom=EXCLUDED.capacity_uom,remarks=EXCLUDED.remarks,is_active=true,updated_at=now()`,[
              r.rows[0].work_center_id,n(b.capacityYear),n(b.yearCapacity),n(b.monthCapacity),n(b.dayCapacity),s(b.capacityUom)||'MT',s(b.capacityRemarks),req.user!.userId
            ]);
      }
      return r.rows[0];
    });
    res.status(201).json({row});
  }catch(e){next(e)}
});

mastersRouter.put('/work-centers/:id',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const companyCode=String(b.companyCode||'').trim().toUpperCase();
    const plantCode=String(b.plantCode||'').trim().toUpperCase();
    if(!companyCode||!plantCode)return res.status(400).json({error:'Company Code and Plant Code are mandatory'});
    const row=await tx(async(client)=>{
      const r=await client.query(`
        UPDATE mes.work_center_master SET
          company_code=$2,plant_code=$3,work_center_name=trim($4),process_area=$5,display_sequence=$6,capacity_uom=$7,is_active=$8,updated_at=now()
        WHERE work_center_id=$1 RETURNING *`,[
          req.params.id,companyCode,plantCode,String(b.workCenterName||''),s(b.processArea),n(b.displaySequence),s(b.capacityUom)||'MT',b.isActive!==false
        ]);
      if(!r.rows[0]){const e:any=new Error('Work center not found');e.status=404;throw e;}
      if(b.capacityYear){
        await client.query(`
          INSERT INTO mes.work_center_capacity_milestone
          (work_center_id,capacity_year,year_capacity,month_capacity,day_capacity,capacity_uom,remarks,is_active,created_by_user_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)
          ON CONFLICT (work_center_id,capacity_year) DO UPDATE SET
            year_capacity=EXCLUDED.year_capacity,month_capacity=EXCLUDED.month_capacity,day_capacity=EXCLUDED.day_capacity,
            capacity_uom=EXCLUDED.capacity_uom,remarks=EXCLUDED.remarks,is_active=true,updated_at=now()`,[
              req.params.id,n(b.capacityYear),n(b.yearCapacity),n(b.monthCapacity),n(b.dayCapacity),s(b.capacityUom)||'MT',s(b.capacityRemarks),req.user!.userId
            ]);
      }
      return r.rows[0];
    });
    res.json({row});
  }catch(e){next(e)}
});

mastersRouter.get('/work-centers/:id/capacities',async(req,res,next)=>{
  try{
    const rows=await query(`SELECT * FROM mes.work_center_capacity_milestone WHERE work_center_id=$1 ORDER BY capacity_year DESC`,[req.params.id]);
    res.json({rows:rows.rows});
  }catch(e){next(e)}
});

mastersRouter.get('/work-center-tolerances',async(req,res,next)=>{
  try{
    await requirePlanningPlant(req);
    const q=String(req.query.q||'').trim();
    const wc=String(req.query.workCenter||'ALL').trim().toUpperCase();
    const status=String(req.query.status||'ALL').trim().toUpperCase();
    const rows=await query(`
      SELECT * FROM mes.vw_work_center_tolerance_matrix
       WHERE plant_code='2000'
         AND ($1='' OR work_center_code ILIKE '%'||$1||'%' OR work_center_name ILIKE '%'||$1||'%' OR parameter_code ILIKE '%'||$1||'%' OR parameter_name ILIKE '%'||$1||'%' OR COALESCE(product_group,'') ILIKE '%'||$1||'%')
         AND ($2='ALL' OR work_center_code=$2)
         AND ($3='ALL' OR validation_status=$3)
       ORDER BY work_center_code,priority_no,parameter_group,parameter_name,product_group NULLS FIRST,material_code NULLS FIRST`,[q,wc,status]);
    res.json({plantCode:'2000',rows:rows.rows});
  }catch(e){next(e)}
});

mastersRouter.post('/work-center-tolerances',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    await requirePlanningPlant(req);
    const b=req.body||{};
    const wc=await query(`SELECT work_center_id FROM mes.work_center_master WHERE plant_code='2000' AND work_center_code=upper(trim($1))`,[String(b.workCenterCode||'')]);
    if(!wc.rows[0])return res.status(400).json({error:'Invalid Plant 2000 work center'});
    const r=await query(`
      INSERT INTO mes.work_center_tolerance_matrix
      (plant_code,work_center_id,parameter_code,parameter_name,parameter_group,product_group,material_code,
       input_min_value,input_max_value,output_target_value,output_min_value,output_max_value,tolerance_minus,tolerance_plus,uom,
       priority_no,validation_status,remarks,effective_from,effective_to,is_active,created_by_user_id)
      VALUES ('2000',$1,upper(trim($2)),trim($3),upper(trim($4)),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      RETURNING *`,[
        wc.rows[0].work_center_id,String(b.parameterCode||''),String(b.parameterName||''),String(b.parameterGroup||'DIMENSION'),
        s(b.productGroup),s(b.materialCode),n(b.inputMin),n(b.inputMax),n(b.outputTarget),n(b.outputMin),n(b.outputMax),
        n(b.toleranceMinus),n(b.tolerancePlus),s(b.uom),n(b.priorityNo)||100,String(b.validationStatus||'DRAFT').toUpperCase(),
        s(b.remarks),s(b.effectiveFrom),s(b.effectiveTo),b.isActive!==false,req.user!.userId
      ]);
    res.status(201).json({row:r.rows[0]});
  }catch(e){next(e)}
});

mastersRouter.put('/work-center-tolerances/:id',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    await requirePlanningPlant(req);
    const b=req.body||{};
    const wc=await query(`SELECT work_center_id FROM mes.work_center_master WHERE plant_code='2000' AND work_center_code=upper(trim($1))`,[String(b.workCenterCode||'')]);
    if(!wc.rows[0])return res.status(400).json({error:'Invalid Plant 2000 work center'});
    const r=await query(`
      UPDATE mes.work_center_tolerance_matrix SET
        work_center_id=$2,parameter_code=upper(trim($3)),parameter_name=trim($4),parameter_group=upper(trim($5)),
        product_group=$6,material_code=$7,input_min_value=$8,input_max_value=$9,output_target_value=$10,
        output_min_value=$11,output_max_value=$12,tolerance_minus=$13,tolerance_plus=$14,uom=$15,
        priority_no=$16,validation_status=$17,remarks=$18,effective_from=$19,effective_to=$20,is_active=$21,updated_at=now()
      WHERE tolerance_id=$1 AND plant_code='2000' RETURNING *`,[
        req.params.id,wc.rows[0].work_center_id,String(b.parameterCode||''),String(b.parameterName||''),String(b.parameterGroup||'DIMENSION'),
        s(b.productGroup),s(b.materialCode),n(b.inputMin),n(b.inputMax),n(b.outputTarget),n(b.outputMin),n(b.outputMax),
        n(b.toleranceMinus),n(b.tolerancePlus),s(b.uom),n(b.priorityNo)||100,String(b.validationStatus||'DRAFT').toUpperCase(),
        s(b.remarks),s(b.effectiveFrom),s(b.effectiveTo),b.isActive!==false
      ]);
    if(!r.rows[0])return res.status(404).json({error:'Tolerance row not found'});
    res.json({row:r.rows[0]});
  }catch(e){next(e)}
});


// ---------------------------------------------------------------------------
// Route Master - Screen 7107
// ---------------------------------------------------------------------------
async function rebuildRouteSteps(client:any,routeId:string,companyCode:string,plantCode:string,processPath:string,materialTree:string){
  const wcCodes=String(processPath||'').split('-').map(x=>x.trim().toUpperCase()).filter(Boolean);
  const materials=String(materialTree||'').split('-').map(x=>x.trim().toUpperCase()).filter(Boolean);
  if(materials.length!==wcCodes.length+1){
    const e:any=new Error(`Route needs ${wcCodes.length+1} material nodes for ${wcCodes.length} work-center steps; received ${materials.length}.`);
    e.status=400;throw e;
  }
  await client.query(`DELETE FROM mes.route_step WHERE route_id=$1`,[routeId]);
  for(let i=0;i<wcCodes.length;i++){
    const wc=await client.query(`
      SELECT w.work_center_id,o.operation_id
        FROM mes.work_center_master w
        LEFT JOIN LATERAL (
          SELECT operation_id FROM mes.operation_master o
           WHERE o.work_center_id=w.work_center_id AND o.is_active
           ORDER BY o.sequence_no,o.operation_code LIMIT 1
        ) o ON true
       WHERE w.company_code=$1 AND w.plant_code=$2 AND w.work_center_code=$3 AND w.is_active`,[companyCode,plantCode,wcCodes[i]]);
    if(!wc.rows[0]){const e:any=new Error(`Work Center ${wcCodes[i]} is not active for ${companyCode}/${plantCode}.`);e.status=400;throw e;}
    const mat=await client.query(`SELECT sap_material_code FROM mes.material_master WHERE sap_material_code=ANY($1::varchar[]) AND is_active`,[[materials[i],materials[i+1]]]);
    if(mat.rows.length!==2){const e:any=new Error(`Route material ${materials[i]} or ${materials[i+1]} is not active in Material Master.`);e.status=400;throw e;}
    await client.query(`
      INSERT INTO mes.route_step(route_id,step_no,work_center_id,operation_id,input_material_code,output_material_code,is_active)
      VALUES ($1,$2,$3,$4,$5,$6,true)`,[
        routeId,i+1,wc.rows[0].work_center_id,wc.rows[0].operation_id,materials[i],materials[i+1]
      ]);
  }
}

mastersRouter.get('/routes',async(req,res,next)=>{
  try{
    const q=String(req.query.q||'').trim();
    const material=String(req.query.material||'ALL').trim().toUpperCase();
    const status=String(req.query.status||'ALL').trim().toUpperCase();
    const rows=await query(`
      SELECT *
        FROM mes.vw_route_master
       WHERE ($1='' OR finished_material_code ILIKE '%'||$1||'%' OR route_indicator ILIKE '%'||$1||'%' OR process_path ILIKE '%'||$1||'%' OR material_tree ILIKE '%'||$1||'%')
         AND ($2='ALL' OR finished_material_code=$2)
         AND ($3='ALL' OR validation_status=$3)
       ORDER BY finished_material_code,route_indicator`,[q,material,status]);
    const summary=await query(`
      SELECT count(*)::int total,
             count(*) FILTER (WHERE validation_status='VALID' AND is_active)::int active_valid,
             count(*) FILTER (WHERE validation_status='REVIEW')::int review,
             count(*) FILTER (WHERE NOT is_active)::int inactive
        FROM mes.route_master`);
    res.json({rows:rows.rows,summary:summary.rows[0]});
  }catch(e){next(e)}
});

mastersRouter.get('/routes/:id/steps',async(req,res,next)=>{
  try{
    const rows=await query(`SELECT * FROM mes.vw_route_step WHERE route_id=$1 ORDER BY step_no`,[req.params.id]);
    res.json({rows:rows.rows});
  }catch(e){next(e)}
});

mastersRouter.post('/routes',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const companyCode=String(b.companyCode||'2000').trim().toUpperCase();
    const plantCode=String(b.plantCode||'2000').trim().toUpperCase();
    const finished=String(b.finishedMaterialCode||'').trim().toUpperCase();
    const indicator=String(b.routeIndicator||'').trim().toUpperCase();
    const processPath=String(b.processPath||'').trim().toUpperCase();
    const materialTree=String(b.materialTree||'').trim().toUpperCase();
    const validationStatus=String(b.validationStatus||'REVIEW').trim().toUpperCase();
    const isActive=b.isActive===true;
    if(!finished||!indicator||!processPath||!materialTree)return res.status(400).json({error:'Finished Material, Route Indicator, Process Path and Material Tree are mandatory'});
    const row=await tx(async(client)=>{
      const r=await client.query(`
        INSERT INTO mes.route_master
        (company_code,plant_code,finished_material_code,route_indicator,process_path,material_tree,validation_status,validation_notes,is_active,source_file)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'MES MANUAL') RETURNING *`,[
          companyCode,plantCode,finished,indicator,processPath,materialTree,validationStatus,s(b.validationNotes),isActive
        ]);
      if(validationStatus==='VALID'&&isActive)await rebuildRouteSteps(client,r.rows[0].route_id,companyCode,plantCode,processPath,materialTree);
      return r.rows[0];
    });
    res.status(201).json({row});
  }catch(e){next(e)}
});

mastersRouter.put('/routes/:id',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const companyCode=String(b.companyCode||'2000').trim().toUpperCase();
    const plantCode=String(b.plantCode||'2000').trim().toUpperCase();
    const finished=String(b.finishedMaterialCode||'').trim().toUpperCase();
    const indicator=String(b.routeIndicator||'').trim().toUpperCase();
    const processPath=String(b.processPath||'').trim().toUpperCase();
    const materialTree=String(b.materialTree||'').trim().toUpperCase();
    const validationStatus=String(b.validationStatus||'REVIEW').trim().toUpperCase();
    const isActive=b.isActive===true;
    const row=await tx(async(client)=>{
      const r=await client.query(`
        UPDATE mes.route_master SET
          company_code=$2,plant_code=$3,finished_material_code=$4,route_indicator=$5,process_path=$6,material_tree=$7,
          validation_status=$8,validation_notes=$9,is_active=$10,updated_at=now()
        WHERE route_id=$1 RETURNING *`,[
          req.params.id,companyCode,plantCode,finished,indicator,processPath,materialTree,validationStatus,s(b.validationNotes),isActive
        ]);
      if(!r.rows[0]){const e:any=new Error('Route not found');e.status=404;throw e;}
      if(validationStatus==='VALID'&&isActive)await rebuildRouteSteps(client,req.params.id,companyCode,plantCode,processPath,materialTree);
      else await client.query(`DELETE FROM mes.route_step WHERE route_id=$1`,[req.params.id]);
      return r.rows[0];
    });
    res.json({row});
  }catch(e){next(e)}
});

mastersRouter.post('/routes/:id/deactivate',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    await tx(async(client)=>{
      await client.query(`UPDATE mes.route_master SET is_active=false,updated_at=now() WHERE route_id=$1`,[req.params.id]);
      await client.query(`UPDATE mes.route_step SET is_active=false,updated_at=now() WHERE route_id=$1`,[req.params.id]);
    });
    res.json({ok:true});
  }catch(e){next(e)}
});

mastersRouter.post('/routes/:id/activate',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const r=await query(`SELECT * FROM mes.route_master WHERE route_id=$1`,[req.params.id]);
    if(!r.rows[0])return res.status(404).json({error:'Route not found'});
    if(r.rows[0].validation_status!=='VALID')return res.status(409).json({error:'Only VALID routes can be activated'});
    await tx(async(client)=>{
      await rebuildRouteSteps(client,req.params.id,r.rows[0].company_code,r.rows[0].plant_code,r.rows[0].process_path,r.rows[0].material_tree);
      await client.query(`UPDATE mes.route_master SET is_active=true,updated_at=now() WHERE route_id=$1`,[req.params.id]);
    });
    res.json({ok:true});
  }catch(e){next(e)}
});

// ---------------------------------------------------------------------------
// Group Code & Dynamic Control Engine - Screen 7104
// ---------------------------------------------------------------------------
mastersRouter.get('/group-codes',async(req,res,next)=>{
  try{
    const q=String(req.query.q||'').trim();
    const rows=await query(`
      SELECT g.*,
             count(DISTINCT d.detail_id) FILTER (WHERE d.is_active)::int AS active_details,
             count(DISTINCT r.rule_id) FILTER (WHERE r.is_active)::int AS active_rules
        FROM mes.group_code_master g
        LEFT JOIN mes.group_code_detail d ON d.group_code_id=g.group_code_id
        LEFT JOIN mes.group_code_rule r ON r.group_code_id=g.group_code_id
       WHERE ($1='' OR g.group_code ILIKE '%'||$1||'%' OR g.group_name ILIKE '%'||$1||'%' OR COALESCE(g.description,'') ILIKE '%'||$1||'%')
       GROUP BY g.group_code_id
       ORDER BY g.group_code`,[q]);
    res.json({rows:rows.rows});
  }catch(e){next(e)}
});

mastersRouter.post('/group-codes',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const r=await query(`
      INSERT INTO mes.group_code_master
      (group_code,group_name,description,control_mode,value_type,default_uom,use_in_planning,use_in_production,use_in_quality,missing_rule_action,missing_rule_message,is_active,created_by_user_id)
      VALUES (upper(trim($1)),trim($2),$3,upper($4),upper($5),$6,$7,$8,$9,upper($10),$11,$12,$13)
      RETURNING *`,[
        String(b.groupCode||''),String(b.groupName||''),s(b.description),String(b.controlMode||'LOOKUP'),String(b.valueType||'CODE'),s(b.defaultUom),
        Boolean(b.useInPlanning),Boolean(b.useInProduction),Boolean(b.useInQuality),String(b.missingRuleAction||'ERROR'),s(b.missingRuleMessage),b.isActive!==false,req.user!.userId
      ]);
    res.status(201).json({row:r.rows[0]});
  }catch(e){next(e)}
});

mastersRouter.put('/group-codes/:id',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const r=await query(`
      UPDATE mes.group_code_master SET
        group_name=trim($2),description=$3,control_mode=upper($4),value_type=upper($5),default_uom=$6,
        use_in_planning=$7,use_in_production=$8,use_in_quality=$9,missing_rule_action=upper($10),missing_rule_message=$11,is_active=$12,updated_at=now()
      WHERE group_code_id=$1 RETURNING *`,[
        req.params.id,String(b.groupName||''),s(b.description),String(b.controlMode||'LOOKUP'),String(b.valueType||'CODE'),s(b.defaultUom),
        Boolean(b.useInPlanning),Boolean(b.useInProduction),Boolean(b.useInQuality),String(b.missingRuleAction||'ERROR'),s(b.missingRuleMessage),b.isActive!==false
      ]);
    if(!r.rows[0])return res.status(404).json({error:'Group Code not found'});
    res.json({row:r.rows[0]});
  }catch(e){next(e)}
});

mastersRouter.get('/group-code-values/:groupCode',async(req,res,next)=>{
  try{
    const rows=await query(`
      SELECT d.detail_id,g.group_code,d.detail_code,d.short_description,d.description,d.numeric_value,d.text_value,
             COALESCE(d.uom,g.default_uom) AS uom,d.sequence_no
        FROM mes.group_code_master g
        JOIN mes.group_code_detail d ON d.group_code_id=g.group_code_id
       WHERE g.group_code=upper(trim($1)) AND g.is_active=true AND d.is_active=true
       ORDER BY d.sequence_no,d.detail_code`,[req.params.groupCode]);
    res.json({groupCode:String(req.params.groupCode).toUpperCase(),rows:rows.rows});
  }catch(e){next(e)}
});

mastersRouter.get('/group-codes/:id/details',async(req,res,next)=>{
  try{
    const rows=await query(`SELECT * FROM mes.group_code_detail WHERE group_code_id=$1 ORDER BY sequence_no,detail_code`,[req.params.id]);
    res.json({rows:rows.rows});
  }catch(e){next(e)}
});

mastersRouter.post('/group-codes/:id/details',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const r=await query(`
      INSERT INTO mes.group_code_detail
      (group_code_id,detail_code,short_description,description,numeric_value,text_value,uom,sequence_no,is_active,created_by_user_id)
      VALUES ($1,upper(trim($2)),trim($3),$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[
        req.params.id,String(b.detailCode||''),String(b.shortDescription||''),s(b.description),n(b.numericValue),s(b.textValue),s(b.uom),n(b.sequenceNo)||100,b.isActive!==false,req.user!.userId
      ]);
    res.status(201).json({row:r.rows[0]});
  }catch(e){next(e)}
});

mastersRouter.put('/group-code-details/:id',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const r=await query(`
      UPDATE mes.group_code_detail SET
        detail_code=upper(trim($2)),short_description=trim($3),description=$4,numeric_value=$5,text_value=$6,uom=$7,sequence_no=$8,is_active=$9,updated_at=now()
      WHERE detail_id=$1 RETURNING *`,[
        req.params.id,String(b.detailCode||''),String(b.shortDescription||''),s(b.description),n(b.numericValue),s(b.textValue),s(b.uom),n(b.sequenceNo)||100,b.isActive!==false
      ]);
    if(!r.rows[0])return res.status(404).json({error:'Code Detail not found'});
    res.json({row:r.rows[0]});
  }catch(e){next(e)}
});

mastersRouter.get('/group-code-rules',async(req,res,next)=>{
  try{
    const groupCodeId=String(req.query.groupCodeId||'').trim();
    const rows=await query(`
      SELECT * FROM mes.vw_group_code_rule
       WHERE ($1='' OR group_code_id=$1::uuid)
       ORDER BY group_code,priority_no,company_code NULLS FIRST,plant_code NULLS FIRST,work_center_code NULLS FIRST,operation_code NULLS FIRST`,[groupCodeId]);
    res.json({rows:rows.rows});
  }catch(e){next(e)}
});

mastersRouter.post('/group-code-rules',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const r=await query(`
      INSERT INTO mes.group_code_rule
      (group_code_id,rule_name,company_code,plant_code,work_center_id,operation_code,material_code,product_group,usage_context,
       detail_id,min_value,max_value,target_value,text_value,boolean_value,uom,validation_action,validation_message,priority_no,
       effective_from,effective_to,is_active,created_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,upper($9),$10,$11,$12,$13,$14,$15,$16,upper($17),$18,$19,$20,$21,$22,$23)
      RETURNING *`,[
        b.groupCodeId,String(b.ruleName||''),s(b.companyCode),s(b.plantCode),s(b.workCenterId),s(b.operationCode),s(b.materialCode),s(b.productGroup),String(b.usageContext||'ANY'),
        s(b.detailId),n(b.minValue),n(b.maxValue),n(b.targetValue),s(b.textValue),b.booleanValue===null||b.booleanValue===undefined?null:Boolean(b.booleanValue),s(b.uom),
        String(b.validationAction||'ERROR'),s(b.validationMessage),n(b.priorityNo)||100,s(b.effectiveFrom),s(b.effectiveTo),b.isActive!==false,req.user!.userId
      ]);
    res.status(201).json({row:r.rows[0]});
  }catch(e){next(e)}
});

mastersRouter.put('/group-code-rules/:id',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const r=await query(`
      UPDATE mes.group_code_rule SET
        rule_name=$2,company_code=$3,plant_code=$4,work_center_id=$5,operation_code=$6,material_code=$7,product_group=$8,usage_context=upper($9),
        detail_id=$10,min_value=$11,max_value=$12,target_value=$13,text_value=$14,boolean_value=$15,uom=$16,
        validation_action=upper($17),validation_message=$18,priority_no=$19,effective_from=$20,effective_to=$21,is_active=$22,updated_at=now()
      WHERE rule_id=$1 RETURNING *`,[
        req.params.id,String(b.ruleName||''),s(b.companyCode),s(b.plantCode),s(b.workCenterId),s(b.operationCode),s(b.materialCode),s(b.productGroup),String(b.usageContext||'ANY'),
        s(b.detailId),n(b.minValue),n(b.maxValue),n(b.targetValue),s(b.textValue),b.booleanValue===null||b.booleanValue===undefined?null:Boolean(b.booleanValue),s(b.uom),
        String(b.validationAction||'ERROR'),s(b.validationMessage),n(b.priorityNo)||100,s(b.effectiveFrom),s(b.effectiveTo),b.isActive!==false
      ]);
    if(!r.rows[0])return res.status(404).json({error:'Group Code rule not found'});
    res.json({row:r.rows[0]});
  }catch(e){next(e)}
});

mastersRouter.get('/resolve-group-code',async(req,res,next)=>{
  try{
    const q=req.query;
    const r=await query(`SELECT * FROM mes.resolve_group_control($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[
      String(q.groupCode||''),s(q.companyCode),s(q.plantCode),s(q.workCenterCode),s(q.operationCode),s(q.materialCode),s(q.productGroup),
      String(q.usageContext||'ANY'),s(q.onDate)
    ]);
    if(!r.rows[0])return res.status(404).json({error:'No active Group Code configuration found for the requested context'});
    res.json({control:r.rows[0]});
  }catch(e){next(e)}
});

// ---------------------------------------------------------------------------
// Operation Master - Screen 7105
// ---------------------------------------------------------------------------
mastersRouter.get('/operations',async(req,res,next)=>{
  try{
    const companyCode=String(req.query.companyCode||'').trim().toUpperCase();
    const plantCode=String(req.query.plantCode||'').trim().toUpperCase();
    const workCenterId=String(req.query.workCenterId||'').trim();
    const q=String(req.query.q||'').trim();
    const values:any[]=[];
    let authSql='';
    if(!isAdmin(req)){
      values.push(req.user!.userId);
      authSql=` AND EXISTS (SELECT 1 FROM mes.vw_user_authorized_plants ap WHERE ap.user_id=$${values.length} AND ap.plant_code=o.plant_code)`;
    }
    values.push(companyCode);const cIx=values.length;
    values.push(plantCode);const pIx=values.length;
    values.push(workCenterId);const wIx=values.length;
    values.push(q);const qIx=values.length;
    const rows=await query(`
      SELECT o.* FROM mes.vw_operation_master o
       WHERE ($${cIx}='' OR o.company_code=$${cIx})
         AND ($${pIx}='' OR o.plant_code=$${pIx})
         AND ($${wIx}='' OR o.work_center_id=NULLIF($${wIx},'')::uuid)
         AND ($${qIx}='' OR o.operation_code ILIKE '%'||$${qIx}||'%' OR o.operation_name ILIKE '%'||$${qIx}||'%' OR o.work_center_code ILIKE '%'||$${qIx}||'%')
         ${authSql}
       ORDER BY o.company_code,o.plant_code,o.work_center_code,o.sequence_no,o.operation_code`,values);
    res.json({rows:rows.rows});
  }catch(e){next(e)}
});

mastersRouter.post('/operations',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const r=await query(`
      INSERT INTO mes.operation_master
      (company_code,plant_code,work_center_id,operation_code,operation_name,description,sequence_no,planning_relevant,confirmation_required,quality_relevant,is_active,created_by_user_id)
      VALUES (upper(trim($1)),upper(trim($2)),$3,upper(trim($4)),trim($5),$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,[
        String(b.companyCode||''),String(b.plantCode||''),String(b.workCenterId||''),String(b.operationCode||''),String(b.operationName||''),s(b.description),n(b.sequenceNo)||100,
        b.planningRelevant!==false,b.confirmationRequired!==false,Boolean(b.qualityRelevant),b.isActive!==false,req.user!.userId
      ]);
    res.status(201).json({row:r.rows[0]});
  }catch(e){next(e)}
});

mastersRouter.put('/operations/:id',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const r=await query(`
      UPDATE mes.operation_master SET
        company_code=upper(trim($2)),plant_code=upper(trim($3)),work_center_id=$4,operation_name=trim($5),description=$6,sequence_no=$7,
        planning_relevant=$8,confirmation_required=$9,quality_relevant=$10,is_active=$11,updated_at=now()
      WHERE operation_id=$1 RETURNING *`,[
        req.params.id,String(b.companyCode||''),String(b.plantCode||''),String(b.workCenterId||''),String(b.operationName||''),s(b.description),n(b.sequenceNo)||100,
        b.planningRelevant!==false,b.confirmationRequired!==false,Boolean(b.qualityRelevant),b.isActive!==false
      ]);
    if(!r.rows[0])return res.status(404).json({error:'Operation not found'});
    res.json({row:r.rows[0]});
  }catch(e){next(e)}
});

// ---------------------------------------------------------------------------
// Screen bindings: declare which Group Codes a screen consumes.
// ---------------------------------------------------------------------------
mastersRouter.get('/runtime-control-screens',async(req,res,next)=>{
  try{
    const rows=await query(`
      SELECT s.screen_id,s.screen_no,s.screen_code,s.screen_name,m.module_code,m.module_name
        FROM mes.app_screen s JOIN mes.app_module m ON m.module_id=s.module_id
       WHERE s.is_active=true
         AND m.is_active=true
         AND s.screen_status='ACTIVE'
         AND s.implementation_status='BUILT'
         AND s.screen_type<>'DASHBOARD'
         AND m.module_code IN ('PLN','PRD','QLT')
       ORDER BY m.module_code,s.sequence_no,s.screen_no`);
    res.json({rows:rows.rows});
  }catch(e){next(e)}
});

mastersRouter.get('/screen-control-bindings',async(req,res,next)=>{
  try{
    const groupCodeId=String(req.query.groupCodeId||'').trim();
    const screenId=String(req.query.screenId||'').trim();
    const rows=await query(`
      SELECT * FROM mes.vw_screen_group_control_binding
       WHERE ($1='' OR group_code_id=NULLIF($1,'')::uuid)
         AND ($2='' OR screen_id=NULLIF($2,'')::uuid)
       ORDER BY module_code,screen_no,sequence_no,control_key`,[groupCodeId,screenId]);
    res.json({rows:rows.rows});
  }catch(e){next(e)}
});

mastersRouter.post('/screen-control-bindings',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const r=await query(`
      INSERT INTO mes.screen_group_control_binding
      (screen_id,control_key,group_code_id,usage_context,validation_timing,input_mode,is_required,sequence_no,is_active,created_by_user_id)
      VALUES ($1,upper(trim($2)),$3,upper($4),upper($5),upper($6),$7,$8,$9,$10)
      RETURNING *`,[
        String(b.screenId||''),String(b.controlKey||''),String(b.groupCodeId||''),String(b.usageContext||'ANY'),String(b.validationTiming||'ON_SAVE'),String(b.inputMode||'AUTO'),
        Boolean(b.isRequired),n(b.sequenceNo)||100,b.isActive!==false,req.user!.userId
      ]);
    res.status(201).json({row:r.rows[0]});
  }catch(e){next(e)}
});

mastersRouter.put('/screen-control-bindings/:id',requireRole('ADMIN'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    const r=await query(`
      UPDATE mes.screen_group_control_binding SET
        screen_id=$2,control_key=upper(trim($3)),usage_context=upper($4),validation_timing=upper($5),input_mode=upper($6),
        is_required=$7,sequence_no=$8,is_active=$9,updated_at=now()
      WHERE binding_id=$1 RETURNING *`,[
        req.params.id,String(b.screenId||''),String(b.controlKey||''),String(b.usageContext||'ANY'),String(b.validationTiming||'ON_SAVE'),String(b.inputMode||'AUTO'),
        Boolean(b.isRequired),n(b.sequenceNo)||100,b.isActive!==false
      ]);
    if(!r.rows[0])return res.status(404).json({error:'Screen control binding not found'});
    res.json({row:r.rows[0]});
  }catch(e){next(e)}
});

// ---------------------------------------------------------------------------
// Runtime APIs used by Planning / Production / Quality transactions.
// ---------------------------------------------------------------------------
mastersRouter.get('/runtime-controls/screen/:screenCode',async(req,res,next)=>{
  try{
    const q=req.query;
    const rows=await query(`SELECT * FROM mes.resolve_screen_controls($1,$2,$3,$4,$5,$6,$7,$8)`,[
      String(req.params.screenCode||''),s(q.companyCode),s(q.plantCode),s(q.workCenterCode),s(q.operationCode),s(q.materialCode),s(q.productGroup),s(q.onDate)
    ]);
    res.json({screenCode:String(req.params.screenCode).toUpperCase(),rows:rows.rows});
  }catch(e){next(e)}
});

mastersRouter.post('/runtime-controls/validate',async(req,res,next)=>{
  try{
    const b=req.body||{};
    const r=await query(`SELECT * FROM mes.validate_group_control($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[
      String(b.groupCode||''),s(b.companyCode),s(b.plantCode),s(b.workCenterCode),s(b.operationCode),s(b.materialCode),s(b.productGroup),String(b.usageContext||'ANY'),s(b.onDate),
      n(b.actualNumber),s(b.actualCode),s(b.actualText),b.actualBoolean===null||b.actualBoolean===undefined?null:Boolean(b.actualBoolean)
    ]);
    res.json({validation:r.rows[0]||null});
  }catch(e){next(e)}
});

