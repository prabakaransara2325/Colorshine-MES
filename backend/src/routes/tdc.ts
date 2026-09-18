import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db';
import { requireAuth } from '../middleware/auth';
import { approvalEmailHtml, flushTdcEmailOutbox, queueTdcEmail, resolveGroupEmails } from '../services/tdcEmail';

export const tdcRouter=Router();
tdcRouter.use(requireAuth);

const PLANT='2000';
const COMPANY='2000';
const CHAR_GROUPS=['TDC_GENERAL','TDC_DIMENSION','TDC_CHEMICAL','TDC_MECHANICAL','TDC_SURFACE','TDC_DISPATCH'];
const SECTIONS=['GENERAL','DIMENSION','CHEMICAL','MECHANICAL','SURFACE_COATING','DISPATCH_PACKING'] as const;
const VALUE_MODES=['EXACT','MIN','MAX','RANGE','PLUS_MINUS','AS_PER_SO','AS_PER_PO','AS_PER_STANDARD','TEXT','NA'] as const;

function bad(message:string,status=400){const e:any=new Error(message);e.status=status;throw e;}
const isAdmin=(req:any)=>(req.user?.roles||[]).includes('ADMIN');
const clean=(v:any)=>{const x=String(v??'').trim();return x||null};

async function hasLiveGroup(client:any,userId:string,groupCode:string){
  const r=await client.query(`SELECT 1 FROM mes.app_user_access_group uag JOIN mes.app_access_group g ON g.access_group_id=uag.access_group_id
    WHERE uag.user_id=$1 AND g.group_code=$2 AND uag.is_active=true AND g.is_active=true
      AND (uag.valid_from IS NULL OR uag.valid_from<=current_date) AND (uag.valid_to IS NULL OR uag.valid_to>=current_date) LIMIT 1`,[userId,groupCode]);
  return Boolean(r.rows[0]);
}
async function assertCreator(client:any,req:any){if(isAdmin(req))return; if(!(await hasLiveGroup(client,req.user!.userId,'TDC_CREATOR_2000')))bad('TDC Creator access for Plant 2000 is required.',403);}
async function assertApprovalGroup(client:any,req:any,groupCode:string){if(isAdmin(req))return; if(!(await hasLiveGroup(client,req.user!.userId,groupCode)))bad(`You are not assigned to approval group ${groupCode}.`,403);}
async function canTemplateMaintain(req:any){
  if(isAdmin(req) || (req.user?.roles||[]).includes('QA')) return true;
  const r=await query(`SELECT 1 FROM mes.app_user_access_group uag JOIN mes.app_access_group g ON g.access_group_id=uag.access_group_id
    WHERE uag.user_id=$1 AND g.group_code='TDC_QC_HEAD_2000' AND uag.is_active=true AND g.is_active=true
      AND (uag.valid_from IS NULL OR uag.valid_from<=current_date) AND (uag.valid_to IS NULL OR uag.valid_to>=current_date) LIMIT 1`,[req.user!.userId]);
  return Boolean(r.rows[0]);
}

function stageToStatus(stage:string){return stage==='QC_HEAD'?'PENDING_QC':stage==='PPC_HEAD'?'PENDING_PPC':stage==='PLANT_HEAD'?'PENDING_PLANT':'DRAFT';}
function stageLabel(stage:string){return ({CREATOR:'Creator',QC_HEAD:'QC Head',PPC_HEAD:'PPC Head',PLANT_HEAD:'Plant Head'} as any)[stage]||stage;}
function nextStage(stage:string){return ({CREATOR:'QC_HEAD',QC_HEAD:'PPC_HEAD',PPC_HEAD:'PLANT_HEAD',PLANT_HEAD:'COMPLETE'} as any)[stage]||'COMPLETE';}
function groupForStage(stage:string){return ({QC_HEAD:'TDC_QC_HEAD_2000',PPC_HEAD:'TDC_PPC_HEAD_2000',PLANT_HEAD:'TDC_PLANT_HEAD_2000'} as any)[stage]||null;}

// ---------------------------------------------------------------------------
// Template setup / maintenance
// ---------------------------------------------------------------------------
tdcRouter.get('/setup',async(_req,res)=>{
  const [categories,series,groups,chars,templates,numbers]=await Promise.all([
    query(`SELECT * FROM mes.tdc_category_master ORDER BY category_name`),
    query(`SELECT * FROM mes.tdc_series_master ORDER BY series_code`),
    query(`SELECT group_code_id,group_code,group_name,description FROM mes.group_code_master WHERE group_code=ANY($1::text[]) ORDER BY group_code`,[CHAR_GROUPS]),
    query(`SELECT c.*,g.group_code,g.group_name FROM mes.tdc_characteristic_master c JOIN mes.group_code_master g ON g.group_code_id=c.group_code_id ORDER BY g.group_code,c.characteristic_name`),
    query(`SELECT t.*,c.category_code,c.category_name,count(tc.template_characteristic_id)::int characteristic_count
      FROM mes.tdc_template_header t JOIN mes.tdc_category_master c ON c.category_id=t.category_id
      LEFT JOIN mes.tdc_template_characteristic tc ON tc.template_id=t.template_id AND tc.is_active=true
      GROUP BY t.template_id,c.category_code,c.category_name ORDER BY t.template_status='ACTIVE' DESC,t.template_name`),
    query(`SELECT * FROM mes.vw_tdc_number_object ORDER BY tdc_prefix,series_code`)
  ]);
  res.json({categories:categories.rows,series:series.rows,groups:groups.rows,characteristics:chars.rows,templates:templates.rows,numberObjects:numbers.rows,plant:PLANT,company:COMPANY});
});

tdcRouter.get('/templates/:templateId',async(req,res)=>{
  const h=await query(`SELECT t.*,c.category_code,c.category_name FROM mes.tdc_template_header t JOIN mes.tdc_category_master c ON c.category_id=t.category_id WHERE t.template_id=$1`,[req.params.templateId]);
  if(!h.rows[0])return res.status(404).json({error:'TDC template not found'});
  const c=await query(`SELECT tc.*,cm.characteristic_code,cm.characteristic_name,cm.data_type,cm.help_text,g.group_code,g.group_name
    FROM mes.tdc_template_characteristic tc JOIN mes.tdc_characteristic_master cm ON cm.characteristic_id=tc.characteristic_id
    JOIN mes.group_code_master g ON g.group_code_id=cm.group_code_id WHERE tc.template_id=$1 AND tc.is_active=true ORDER BY tc.section_code,tc.sequence_no,cm.characteristic_name`,[req.params.templateId]);
  res.json({template:h.rows[0],characteristics:c.rows});
});

const categorySchema=z.object({categoryCode:z.string().min(2).max(40),categoryName:z.string().min(2).max(140),tdcPrefix:z.string().min(2).max(20),description:z.string().max(500).optional()});
tdcRouter.post('/categories',async(req,res)=>{
  if(!(await canTemplateMaintain(req))) return res.status(403).json({error:'ADMIN, QA or TDC QC Head permission required'});
  const p=categorySchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid category',details:p.error.flatten()});
  const d=p.data;const categoryCode=d.categoryCode.trim().toUpperCase();const tdcPrefix=d.tdcPrefix.trim().toUpperCase();const r=await query(`INSERT INTO mes.tdc_category_master(category_code,category_name,tdc_prefix,description,created_by_user_id)
    VALUES($1,$2,$3,$4,$5) RETURNING *`,[categoryCode,d.categoryName,tdcPrefix,d.description??null,req.user!.userId]);
  await query(`INSERT INTO mes.group_code_detail(group_code_id,detail_code,short_description,description,is_active,created_by_user_id)
    SELECT group_code_id,$1,$2,$3,true,$4 FROM mes.group_code_master WHERE group_code='TDC_CATEGORY' ON CONFLICT(group_code_id,detail_code) DO UPDATE SET short_description=EXCLUDED.short_description,description=EXCLUDED.description,is_active=true,updated_at=now()`,[categoryCode,d.categoryName,d.description??null,req.user!.userId]);
  res.status(201).json({category:r.rows[0]});
});

const seriesSchema=z.object({seriesCode:z.string().min(2).max(20),seriesName:z.string().min(2).max(120),description:z.string().max(500).optional()});
tdcRouter.post('/series',async(req,res)=>{
  if(!(await canTemplateMaintain(req))) return res.status(403).json({error:'ADMIN, QA or TDC QC Head permission required'});
  const p=seriesSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid series',details:p.error.flatten()});
  const d=p.data;const seriesCode=d.seriesCode.trim().toUpperCase();const r=await query(`INSERT INTO mes.tdc_series_master(series_code,series_name,description,created_by_user_id) VALUES($1,$2,$3,$4) RETURNING *`,[seriesCode,d.seriesName,d.description??null,req.user!.userId]);
  await query(`INSERT INTO mes.group_code_detail(group_code_id,detail_code,short_description,description,is_active,created_by_user_id)
    SELECT group_code_id,$1,$2,$3,true,$4 FROM mes.group_code_master WHERE group_code='TDC_SERIES' ON CONFLICT(group_code_id,detail_code) DO UPDATE SET short_description=EXCLUDED.short_description,description=EXCLUDED.description,is_active=true,updated_at=now()`,[seriesCode,d.seriesName,d.description??null,req.user!.userId]);
  res.status(201).json({series:r.rows[0]});
});

const characteristicSchema=z.object({
  characteristicCode:z.string().min(2).max(80),characteristicName:z.string().min(2).max(180),groupCode:z.enum(CHAR_GROUPS as [string,...string[]]),
  dataType:z.enum(['TEXT','NUMBER','BOOLEAN','DATE']).default('TEXT'),defaultUom:z.string().max(20).optional(),defaultValueMode:z.enum(VALUE_MODES).default('TEXT'),helpText:z.string().max(1000).optional()
});
tdcRouter.post('/characteristics',async(req,res)=>{
  if(!(await canTemplateMaintain(req))) return res.status(403).json({error:'ADMIN, QA or TDC QC Head permission required'});
  const p=characteristicSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid characteristic',details:p.error.flatten()});
  const d=p.data;const characteristicCode=d.characteristicCode.trim().toUpperCase();const result=await tx(async client=>{
    const g=await client.query(`SELECT group_code_id FROM mes.group_code_master WHERE group_code=$1 AND is_active=true`,[d.groupCode]);if(!g.rows[0])bad('Characteristic Group Code not found');
    const detail=await client.query(`INSERT INTO mes.group_code_detail(group_code_id,detail_code,short_description,description,uom,is_active,created_by_user_id)
      VALUES($1,$2,$3,$4,$5,true,$6) RETURNING detail_id`,[g.rows[0].group_code_id,characteristicCode,d.characteristicName,d.helpText??null,d.defaultUom??null,req.user!.userId]);
    const c=await client.query(`INSERT INTO mes.tdc_characteristic_master(characteristic_code,characteristic_name,group_code_id,group_detail_id,data_type,default_uom,default_value_mode,help_text,created_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[characteristicCode,d.characteristicName,g.rows[0].group_code_id,detail.rows[0].detail_id,d.dataType,d.defaultUom??null,d.defaultValueMode,d.helpText??null,req.user!.userId]);
    return c.rows[0];
  });
  res.status(201).json({characteristic:result});
});

const templateSchema=z.object({templateCode:z.string().min(3).max(80),templateName:z.string().min(3).max(180),categoryCode:z.string().min(2).max(40),description:z.string().max(1000).optional()});
tdcRouter.post('/templates',async(req,res)=>{
  if(!(await canTemplateMaintain(req))) return res.status(403).json({error:'ADMIN, QA or TDC QC Head permission required'});
  const p=templateSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid template',details:p.error.flatten()});const d=p.data;const templateCode=d.templateCode.trim().toUpperCase();const categoryCode=d.categoryCode.trim().toUpperCase();
  const r=await query(`INSERT INTO mes.tdc_template_header(template_code,template_name,company_code,plant_code,category_id,tdc_prefix,template_status,is_system_template,description,created_by_user_id)
    SELECT $1,$2,$3,$4,c.category_id,c.tdc_prefix,'DRAFT',false,$6,$7 FROM mes.tdc_category_master c WHERE c.category_code=$5 AND c.is_active=true RETURNING *`,[templateCode,d.templateName,COMPANY,PLANT,categoryCode,d.description??null,req.user!.userId]);
  if(!r.rows[0])return res.status(400).json({error:'Active TDC category not found'});res.status(201).json({template:r.rows[0]});
});

tdcRouter.post('/templates/:templateId/copy',async(req,res)=>{
  if(!(await canTemplateMaintain(req))) return res.status(403).json({error:'ADMIN, QA or TDC QC Head permission required'});
  const p=templateSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'New Template Code, Name and Category are required',details:p.error.flatten()});const d=p.data;const templateCode=d.templateCode.trim().toUpperCase();const categoryCode=d.categoryCode.trim().toUpperCase();
  const result=await tx(async client=>{
    const src=await client.query(`SELECT * FROM mes.tdc_template_header WHERE template_id=$1`,[req.params.templateId]);if(!src.rows[0])bad('Source template not found',404);
    const cat=await client.query(`SELECT * FROM mes.tdc_category_master WHERE category_code=$1 AND is_active=true`,[categoryCode]);if(!cat.rows[0])bad('Active TDC category not found');
    const h=await client.query(`INSERT INTO mes.tdc_template_header(template_code,template_name,company_code,plant_code,category_id,tdc_prefix,template_status,is_system_template,source_template_id,description,created_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6,'DRAFT',false,$7,$8,$9) RETURNING *`,[templateCode,d.templateName,COMPANY,PLANT,cat.rows[0].category_id,cat.rows[0].tdc_prefix,req.params.templateId,d.description??src.rows[0].description,req.user!.userId]);
    await client.query(`INSERT INTO mes.tdc_template_characteristic(template_id,characteristic_id,section_code,sequence_no,display_label,is_required,default_value_mode,default_uom,default_specification,is_active)
      SELECT $1,characteristic_id,section_code,sequence_no,display_label,is_required,default_value_mode,default_uom,default_specification,true FROM mes.tdc_template_characteristic WHERE template_id=$2 AND is_active=true`,[h.rows[0].template_id,req.params.templateId]);
    return h.rows[0];
  });
  res.status(201).json({template:result});
});

const mapSchema=z.object({characteristicCode:z.string().min(2),sectionCode:z.enum(SECTIONS),sequenceNo:z.number().int().min(1).max(9999).default(100),displayLabel:z.string().max(180).optional(),isRequired:z.boolean().default(false),defaultValueMode:z.enum(VALUE_MODES).optional(),defaultUom:z.string().max(20).optional(),defaultSpecification:z.string().max(2000).optional()});
tdcRouter.post('/templates/:templateId/characteristics',async(req,res)=>{
  if(!(await canTemplateMaintain(req))) return res.status(403).json({error:'ADMIN, QA or TDC QC Head permission required'});
  const p=mapSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid template characteristic',details:p.error.flatten()});const d=p.data;
  const r=await query(`INSERT INTO mes.tdc_template_characteristic(template_id,characteristic_id,section_code,sequence_no,display_label,is_required,default_value_mode,default_uom,default_specification,is_active)
    SELECT t.template_id,c.characteristic_id,$3,$4,COALESCE($5,c.characteristic_name),$6,COALESCE($7,c.default_value_mode),COALESCE($8,c.default_uom),$9,true
    FROM mes.tdc_template_header t CROSS JOIN mes.tdc_characteristic_master c WHERE t.template_id=$1 AND t.template_status='DRAFT' AND c.characteristic_code=$2 AND c.is_active=true RETURNING *`,
    [req.params.templateId,d.characteristicCode,d.sectionCode,d.sequenceNo,d.displayLabel??null,d.isRequired,d.defaultValueMode??null,d.defaultUom??null,d.defaultSpecification??null]);
  if(!r.rows[0])return res.status(409).json({error:'Characteristics can be changed only on a DRAFT template. Copy the active template as a new template first.'});res.status(201).json({row:r.rows[0]});
});

tdcRouter.put('/templates/:templateId/characteristics/:mapId',async(req,res)=>{
  if(!(await canTemplateMaintain(req))) return res.status(403).json({error:'ADMIN, QA or TDC QC Head permission required'});
  const p=mapSchema.omit({characteristicCode:true}).partial().safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid template characteristic',details:p.error.flatten()});const d:any=p.data;
  const r=await query(`UPDATE mes.tdc_template_characteristic tc SET section_code=COALESCE($3,section_code),sequence_no=COALESCE($4,sequence_no),display_label=COALESCE($5,display_label),is_required=COALESCE($6,is_required),default_value_mode=COALESCE($7,default_value_mode),default_uom=COALESCE($8,default_uom),default_specification=COALESCE($9,default_specification),updated_at=now()
    FROM mes.tdc_template_header t WHERE tc.template_id=t.template_id AND tc.template_id=$1 AND tc.template_characteristic_id=$2 AND t.template_status='DRAFT' RETURNING tc.*`,
    [req.params.templateId,req.params.mapId,d.sectionCode??null,d.sequenceNo??null,d.displayLabel??null,d.isRequired??null,d.defaultValueMode??null,d.defaultUom??null,d.defaultSpecification??null]);
  if(!r.rows[0])return res.status(409).json({error:'Only DRAFT template characteristics can be edited.'});res.json({row:r.rows[0]});
});

tdcRouter.delete('/templates/:templateId/characteristics/:mapId',async(req,res)=>{
  if(!(await canTemplateMaintain(req))) return res.status(403).json({error:'ADMIN, QA or TDC QC Head permission required'});
  const r=await query(`DELETE FROM mes.tdc_template_characteristic tc USING mes.tdc_template_header t WHERE tc.template_id=t.template_id AND tc.template_id=$1 AND tc.template_characteristic_id=$2 AND t.template_status='DRAFT' RETURNING tc.template_characteristic_id`,[req.params.templateId,req.params.mapId]);
  if(!r.rows[0])return res.status(409).json({error:'Only DRAFT template characteristics can be removed.'});res.json({ok:true});
});

tdcRouter.post('/templates/:templateId/activate',async(req,res)=>{
  if(!(await canTemplateMaintain(req))) return res.status(403).json({error:'ADMIN, QA or TDC QC Head permission required'});
  const count=await query(`SELECT count(*)::int n FROM mes.tdc_template_characteristic WHERE template_id=$1 AND is_active=true`,[req.params.templateId]);if(!count.rows[0]?.n)return res.status(409).json({error:'Template must contain at least one characteristic before activation.'});
  const r=await query(`UPDATE mes.tdc_template_header SET template_status='ACTIVE',is_active=true,activated_at=now(),updated_at=now() WHERE template_id=$1 AND template_status='DRAFT' RETURNING *`,[req.params.templateId]);
  if(!r.rows[0])return res.status(409).json({error:'Only DRAFT templates can be activated.'});res.json({template:r.rows[0]});
});

tdcRouter.post('/templates/:templateId/deactivate',async(req,res)=>{
  if(!(await canTemplateMaintain(req))) return res.status(403).json({error:'ADMIN, QA or TDC QC Head permission required'});
  const r=await query(`UPDATE mes.tdc_template_header SET template_status='INACTIVE',is_active=false,deactivated_at=now(),updated_at=now() WHERE template_id=$1 RETURNING *`,[req.params.templateId]);
  if(!r.rows[0])return res.status(404).json({error:'Template not found'});res.json({template:r.rows[0]});
});

tdcRouter.get('/number-objects',async(_req,res)=>{const r=await query(`SELECT * FROM mes.vw_tdc_number_object ORDER BY tdc_prefix,series_code`);res.json({rows:r.rows});});

tdcRouter.get('/number-preview',async(req,res)=>{
  const templateId=String(req.query.templateId||'');const seriesCode=String(req.query.seriesCode||'').toUpperCase();
  const t=await query(`SELECT t.tdc_prefix FROM mes.tdc_template_header t WHERE t.template_id=$1 AND t.template_status='ACTIVE'`,[templateId]);if(!t.rows[0])return res.status(404).json({error:'Active template not found'});
  const n=await query(`SELECT v.next_tdc_no FROM mes.vw_tdc_number_object v WHERE v.plant_code=$1 AND v.tdc_prefix=$2 AND v.series_code=$3`,[PLANT,t.rows[0].tdc_prefix,seriesCode]);
  res.json({nextTdcNo:n.rows[0]?.next_tdc_no||`${t.rows[0].tdc_prefix}/${seriesCode}/0001`});
});

// ---------------------------------------------------------------------------
// Approval inbox and e-mail outbox - define before /:tdcId routes.
// ---------------------------------------------------------------------------
tdcRouter.get('/approvals/inbox',async(req,res)=>{
  const admin=isAdmin(req);
  const r=await query(`SELECT a.*,m.tdc_id,m.tdc_no,m.customer_name,m.plant_code,v.version_no,v.version_label,v.status,v.approval_stage,c.category_name,t.template_name
    FROM mes.tdc_workflow_approval a JOIN mes.tdc_version v ON v.tdc_version_id=a.tdc_version_id JOIN mes.tdc_master m ON m.tdc_id=v.tdc_id
    JOIN mes.tdc_category_master c ON c.category_id=m.category_id JOIN mes.tdc_template_header t ON t.template_id=v.template_id
    WHERE a.approval_status='PENDING' AND m.is_active=true AND ($1::boolean=true OR EXISTS(
      SELECT 1 FROM mes.app_user_access_group uag JOIN mes.app_access_group g ON g.access_group_id=uag.access_group_id
      WHERE uag.user_id=$2 AND g.group_code=a.approver_group_code AND uag.is_active=true AND g.is_active=true
      AND (uag.valid_from IS NULL OR uag.valid_from<=current_date) AND (uag.valid_to IS NULL OR uag.valid_to>=current_date)))
    ORDER BY a.created_at,m.tdc_no`,[admin,req.user!.userId]);
  res.json({rows:r.rows});
});

const approvalAction=z.object({action:z.enum(['APPROVE','RETURN']),remarks:z.string().max(2000).optional()});
tdcRouter.post('/approvals/:approvalId/action',async(req,res)=>{
  const p=approvalAction.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid approval action',details:p.error.flatten()});if(p.data.action==='RETURN'&&!clean(p.data.remarks))return res.status(400).json({error:'Return remarks are mandatory.'});
  const result=await tx(async client=>{
    const q=await client.query(`SELECT a.*,v.tdc_id,v.version_no,v.version_label,v.status AS version_status,v.approval_stage,m.tdc_no,m.customer_name,m.plant_code,m.approved_version_no
      FROM mes.tdc_workflow_approval a JOIN mes.tdc_version v ON v.tdc_version_id=a.tdc_version_id JOIN mes.tdc_master m ON m.tdc_id=v.tdc_id
      WHERE a.approval_id=$1 FOR UPDATE`,[req.params.approvalId]);const a=q.rows[0];if(!a)bad('Approval item not found',404);if(a.approval_status!=='PENDING')bad('This approval item is no longer pending.',409);
    if(a.approver_group_code)await assertApprovalGroup(client,req,a.approver_group_code);
    if(p.data.action==='RETURN'){
      await client.query(`UPDATE mes.tdc_workflow_approval SET approval_status='RETURNED',action_by_user_id=$2,action_by_username=$3,action_at=now(),remarks=$4,updated_at=now() WHERE approval_id=$1`,[a.approval_id,req.user!.userId,req.user!.username,p.data.remarks]);
      await client.query(`UPDATE mes.tdc_version SET status='RETURNED',approval_stage='RETURNED',updated_at=now() WHERE tdc_version_id=$1`,[a.tdc_version_id]);
      await client.query(`UPDATE mes.tdc_master SET overall_status='RETURNED',updated_at=now() WHERE tdc_id=$1`,[a.tdc_id]);
      const creator=await client.query(`SELECT lower(trim(u.email)) email FROM mes.tdc_version v JOIN mes.app_user u ON u.user_id=v.created_by_user_id WHERE v.tdc_version_id=$1 AND u.email IS NOT NULL`,[a.tdc_version_id]);
      await queueTdcEmail(client,{tdcVersionId:a.tdc_version_id,approvalId:a.approval_id,eventCode:`${a.approval_stage}_RETURNED`,intendedEmails:creator.rows.map((x:any)=>x.email),subject:`TDC ${a.tdc_no} ${a.version_label} returned by ${stageLabel(a.approval_stage)}`,htmlBody:approvalEmailHtml({tdcNo:a.tdc_no,versionLabel:a.version_label,customerName:a.customer_name,stage:stageLabel(a.approval_stage),actor:req.user!.displayName,remarks:p.data.remarks,action:'RETURNED - create a new version to correct'})});
      return {tdcId:a.tdc_id,versionNo:a.version_no,status:'RETURNED'};
    }
    await client.query(`UPDATE mes.tdc_workflow_approval SET approval_status='APPROVED',action_by_user_id=$2,action_by_username=$3,action_at=now(),remarks=$4,updated_at=now() WHERE approval_id=$1`,[a.approval_id,req.user!.userId,req.user!.username,p.data.remarks??null]);
    const next=nextStage(a.approval_stage);
    if(next==='COMPLETE'){
      if(a.approved_version_no){await client.query(`UPDATE mes.tdc_version SET status='SUPERSEDED',approval_stage='COMPLETE',superseded_at=now(),updated_at=now() WHERE tdc_id=$1 AND version_no=$2 AND status='APPROVED'`,[a.tdc_id,a.approved_version_no]);}
      await client.query(`UPDATE mes.tdc_version SET status='APPROVED',approval_stage='COMPLETE',approved_at=now(),updated_at=now() WHERE tdc_version_id=$1`,[a.tdc_version_id]);
      await client.query(`UPDATE mes.tdc_master SET approved_version_no=$2,overall_status='APPROVED',updated_at=now() WHERE tdc_id=$1`,[a.tdc_id,a.version_no]);
      const creator=await client.query(`SELECT lower(trim(u.email)) email FROM mes.tdc_version v JOIN mes.app_user u ON u.user_id=v.created_by_user_id WHERE v.tdc_version_id=$1 AND u.email IS NOT NULL`,[a.tdc_version_id]);
      await queueTdcEmail(client,{tdcVersionId:a.tdc_version_id,approvalId:a.approval_id,eventCode:'TDC_FINAL_APPROVED',intendedEmails:creator.rows.map((x:any)=>x.email),subject:`TDC ${a.tdc_no} ${a.version_label} fully approved`,htmlBody:approvalEmailHtml({tdcNo:a.tdc_no,versionLabel:a.version_label,customerName:a.customer_name,stage:'Final Approval Complete',actor:req.user!.displayName,remarks:p.data.remarks,action:'APPROVED'})});
      return {tdcId:a.tdc_id,versionNo:a.version_no,status:'APPROVED'};
    }
    const nextGroup=groupForStage(next);const nextApproval=await client.query(`UPDATE mes.tdc_workflow_approval SET approval_status='PENDING',updated_at=now() WHERE tdc_version_id=$1 AND approval_stage=$2 RETURNING approval_id`,[a.tdc_version_id,next]);
    const newStatus=stageToStatus(next);await client.query(`UPDATE mes.tdc_version SET status=$2,approval_stage=$3,updated_at=now() WHERE tdc_version_id=$1`,[a.tdc_version_id,newStatus,next]);await client.query(`UPDATE mes.tdc_master SET overall_status=$2,updated_at=now() WHERE tdc_id=$1`,[a.tdc_id,newStatus]);
    const emails=await resolveGroupEmails(client,nextGroup,a.plant_code);
    await queueTdcEmail(client,{tdcVersionId:a.tdc_version_id,approvalId:nextApproval.rows[0]?.approval_id,eventCode:`APPROVAL_REQUEST_${next}`,intendedEmails:emails,subject:`Approval required: TDC ${a.tdc_no} ${a.version_label} - ${stageLabel(next)}`,htmlBody:approvalEmailHtml({tdcNo:a.tdc_no,versionLabel:a.version_label,customerName:a.customer_name,stage:stageLabel(next),actor:req.user!.displayName,remarks:p.data.remarks,action:`Previous stage approved; ${stageLabel(next)} approval required`})});
    if(nextApproval.rows[0]) await client.query(`UPDATE mes.tdc_workflow_approval SET intended_email=$2,email_status='QUEUED',updated_at=now() WHERE approval_id=$1`,[nextApproval.rows[0].approval_id,emails.join(',')||null]);
    return {tdcId:a.tdc_id,versionNo:a.version_no,status:newStatus};
  });
  void flushTdcEmailOutbox().catch(()=>{});res.json(result);
});

tdcRouter.get('/email-outbox',async(req,res)=>{
  if(!isAdmin(req))return res.status(403).json({error:'ADMIN permission required'});
  const r=await query(`SELECT email_id,event_code,intended_to_email,to_email,subject,email_status,attempt_count,last_error,queued_at,sent_at FROM mes.tdc_email_outbox ORDER BY queued_at DESC LIMIT 100`);res.json({rows:r.rows});
});
tdcRouter.post('/email-outbox/send',async(req,res)=>{if(!isAdmin(req))return res.status(403).json({error:'ADMIN permission required'});res.json(await flushTdcEmailOutbox());});

// ---------------------------------------------------------------------------
// TDC Register / Create / Save / Version / Submit / Deactivate
// ---------------------------------------------------------------------------
tdcRouter.get('/',async(req,res)=>{
  const q=String(req.query.q??'').trim();const status=String(req.query.status??'ALL').toUpperCase();const category=String(req.query.category??'ALL').toUpperCase();
  const r=await query(`SELECT * FROM mes.vw_tdc_register WHERE plant_code=$1
    AND ($2='' OR tdc_no ILIKE '%'||$2||'%' OR customer_name ILIKE '%'||$2||'%' OR COALESCE(customer_code,'') ILIKE '%'||$2||'%')
    AND ($3='ALL' OR overall_status=$3) AND ($4='ALL' OR category_code=$4) ORDER BY updated_at DESC,tdc_no`,[PLANT,q,status,category]);res.json({rows:r.rows});
});

const createTdc=z.object({templateId:z.string().uuid(),seriesCode:z.string().min(2).max(20),customerCode:z.string().max(40).optional(),customerName:z.string().min(2).max(220),documentNo:z.string().max(120).optional(),documentTitle:z.string().max(300).optional(),customerReference:z.string().max(120).optional(),salesOrderReference:z.string().max(120).optional(),tdcDate:z.string().optional(),generalRemarks:z.string().max(2000).optional()});
tdcRouter.post('/',async(req,res)=>{
  const p=createTdc.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid TDC creation data',details:p.error.flatten()});const d=p.data;
  const result=await tx(async client=>{
    await assertCreator(client,req);
    const t=await client.query(`SELECT t.*,c.category_code FROM mes.tdc_template_header t JOIN mes.tdc_category_master c ON c.category_id=t.category_id WHERE t.template_id=$1 AND t.template_status='ACTIVE' AND t.is_active=true AND t.plant_code=$2 FOR SHARE`,[d.templateId,PLANT]);if(!t.rows[0])bad('Active Plant 2000 TDC template not found.');
    const s=await client.query(`SELECT * FROM mes.tdc_series_master WHERE series_code=$1 AND is_active=true`,[d.seriesCode.toUpperCase()]);if(!s.rows[0])bad('Active TDC Series not found.');
    const n=await client.query(`SELECT mes.next_tdc_number($1,$2,$3) AS tdc_no`,[PLANT,t.rows[0].tdc_prefix,s.rows[0].series_code]);const tdcNo=n.rows[0].tdc_no;
    const m=await client.query(`INSERT INTO mes.tdc_master(tdc_no,company_code,plant_code,category_id,series_id,template_id,customer_code,customer_name,document_no,document_title,customer_reference,sales_order_reference,current_version_no,overall_status,created_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,'DRAFT',$13) RETURNING *`,[tdcNo,COMPANY,PLANT,t.rows[0].category_id,s.rows[0].series_id,d.templateId,clean(d.customerCode),d.customerName,clean(d.documentNo),clean(d.documentTitle),clean(d.customerReference),clean(d.salesOrderReference),req.user!.userId]);
    const v=await client.query(`INSERT INTO mes.tdc_version(tdc_id,version_no,version_label,template_id,tdc_date,customer_code,customer_name,document_no,document_title,customer_reference,sales_order_reference,status,approval_stage,general_remarks,created_by_user_id)
      VALUES($1,1,'V01',$2,COALESCE($3::date,current_date),$4,$5,$6,$7,$8,$9,'DRAFT','CREATOR',$10,$11) RETURNING *`,[m.rows[0].tdc_id,d.templateId,d.tdcDate??null,clean(d.customerCode),d.customerName,clean(d.documentNo),clean(d.documentTitle),clean(d.customerReference),clean(d.salesOrderReference),clean(d.generalRemarks),req.user!.userId]);
    await client.query(`INSERT INTO mes.tdc_characteristic_value(tdc_version_id,characteristic_id,characteristic_code,characteristic_name,section_code,sequence_no,display_label,is_required,uom,value_mode,colorshine_specification,final_agreed_specification)
      SELECT $1,c.characteristic_id,c.characteristic_code,c.characteristic_name,tc.section_code,tc.sequence_no,COALESCE(tc.display_label,c.characteristic_name),tc.is_required,COALESCE(tc.default_uom,c.default_uom),COALESCE(tc.default_value_mode,c.default_value_mode),tc.default_specification,tc.default_specification
      FROM mes.tdc_template_characteristic tc JOIN mes.tdc_characteristic_master c ON c.characteristic_id=tc.characteristic_id WHERE tc.template_id=$2 AND tc.is_active=true AND c.is_active=true`,[v.rows[0].tdc_version_id,d.templateId]);
    await client.query(`INSERT INTO mes.tdc_workflow_approval(tdc_version_id,approval_sequence,approval_stage,approver_group_code,approval_status)
      VALUES($1,1,'CREATOR',NULL,'PENDING'),($1,2,'QC_HEAD','TDC_QC_HEAD_2000','WAITING'),($1,3,'PPC_HEAD','TDC_PPC_HEAD_2000','WAITING'),($1,4,'PLANT_HEAD','TDC_PLANT_HEAD_2000','WAITING')`,[v.rows[0].tdc_version_id]);
    return {tdcId:m.rows[0].tdc_id,tdcNo,versionNo:1,versionLabel:'V01'};
  });
  res.status(201).json(result);
});

tdcRouter.get('/:tdcId',async(req,res)=>{
  const requested=Number(req.query.version||0);
  const m=await query(`SELECT m.*,c.category_code,c.category_name,s.series_code,t.template_code,t.template_name FROM mes.tdc_master m JOIN mes.tdc_category_master c ON c.category_id=m.category_id JOIN mes.tdc_series_master s ON s.series_id=m.series_id JOIN mes.tdc_template_header t ON t.template_id=m.template_id WHERE m.tdc_id=$1`,[req.params.tdcId]);if(!m.rows[0])return res.status(404).json({error:'TDC not found'});
  const versions=await query(`SELECT v.*,u.username created_by_username,u.display_name created_by_name FROM mes.tdc_version v LEFT JOIN mes.app_user u ON u.user_id=v.created_by_user_id WHERE v.tdc_id=$1 ORDER BY v.version_no DESC`,[req.params.tdcId]);
  const versionNo=requested||m.rows[0].current_version_no;const current=versions.rows.find((x:any)=>Number(x.version_no)===versionNo);if(!current)return res.status(404).json({error:'TDC version not found'});
  const values=await query(`SELECT * FROM mes.tdc_characteristic_value WHERE tdc_version_id=$1 ORDER BY CASE section_code WHEN 'GENERAL' THEN 1 WHEN 'DIMENSION' THEN 2 WHEN 'CHEMICAL' THEN 3 WHEN 'MECHANICAL' THEN 4 WHEN 'SURFACE_COATING' THEN 5 ELSE 6 END,sequence_no,display_label`,[current.tdc_version_id]);
  const approvals=await query(`SELECT a.*,u.display_name action_by_name FROM mes.tdc_workflow_approval a LEFT JOIN mes.app_user u ON u.user_id=a.action_by_user_id WHERE a.tdc_version_id=$1 ORDER BY approval_sequence`,[current.tdc_version_id]);
  res.json({master:m.rows[0],versions:versions.rows,version:current,values:values.rows,approvals:approvals.rows});
});

const valueSchema=z.object({valueId:z.string().uuid(),uom:z.string().max(20).nullable().optional(),valueMode:z.enum(VALUE_MODES).optional(),colorshineSpecification:z.string().max(2000).nullable().optional(),customerComment:z.string().max(2000).nullable().optional(),finalAgreedSpecification:z.string().max(2000).nullable().optional(),minValue:z.number().nullable().optional(),maxValue:z.number().nullable().optional(),targetValue:z.number().nullable().optional(),toleranceMinus:z.number().nullable().optional(),tolerancePlus:z.number().nullable().optional()});
const saveSchema=z.object({tdcDate:z.string().optional(),customerCode:z.string().max(40).nullable().optional(),customerName:z.string().min(2).max(220).optional(),documentNo:z.string().max(120).nullable().optional(),documentTitle:z.string().max(300).nullable().optional(),customerReference:z.string().max(120).nullable().optional(),salesOrderReference:z.string().max(120).nullable().optional(),generalRemarks:z.string().max(2000).nullable().optional(),values:z.array(valueSchema).default([])});
tdcRouter.put('/:tdcId/versions/:versionNo',async(req,res)=>{
  const p=saveSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid TDC data',details:p.error.flatten()});const d=p.data;const versionNo=Number(req.params.versionNo);
  await tx(async client=>{
    await assertCreator(client,req);
    const v=await client.query(`SELECT v.*,m.current_version_no FROM mes.tdc_version v JOIN mes.tdc_master m ON m.tdc_id=v.tdc_id WHERE v.tdc_id=$1 AND v.version_no=$2 FOR UPDATE`,[req.params.tdcId,versionNo]);if(!v.rows[0])bad('TDC version not found',404);if(v.rows[0].status!=='DRAFT')bad('Submitted/approved TDC versions are immutable. Create a new version to make changes.',409);if(Number(v.rows[0].current_version_no)!==versionNo)bad('Only the current DRAFT version can be changed.',409);
    const row=v.rows[0];const customerName=d.customerName??row.customer_name;
    await client.query(`UPDATE mes.tdc_version SET tdc_date=COALESCE($3::date,tdc_date),customer_code=CASE WHEN $4::text='__KEEP__' THEN customer_code ELSE NULLIF($4,'') END,customer_name=$5,document_no=CASE WHEN $6::text='__KEEP__' THEN document_no ELSE NULLIF($6,'') END,document_title=CASE WHEN $7::text='__KEEP__' THEN document_title ELSE NULLIF($7,'') END,customer_reference=CASE WHEN $8::text='__KEEP__' THEN customer_reference ELSE NULLIF($8,'') END,sales_order_reference=CASE WHEN $9::text='__KEEP__' THEN sales_order_reference ELSE NULLIF($9,'') END,general_remarks=CASE WHEN $10::text='__KEEP__' THEN general_remarks ELSE NULLIF($10,'') END,updated_at=now() WHERE tdc_id=$1 AND version_no=$2`,
      [req.params.tdcId,versionNo,d.tdcDate??null,d.customerCode===undefined?'__KEEP__':String(d.customerCode??''),customerName,d.documentNo===undefined?'__KEEP__':String(d.documentNo??''),d.documentTitle===undefined?'__KEEP__':String(d.documentTitle??''),d.customerReference===undefined?'__KEEP__':String(d.customerReference??''),d.salesOrderReference===undefined?'__KEEP__':String(d.salesOrderReference??''),d.generalRemarks===undefined?'__KEEP__':String(d.generalRemarks??'')]);
    await client.query(`UPDATE mes.tdc_master SET customer_code=CASE WHEN $2::text='__KEEP__' THEN customer_code ELSE NULLIF($2,'') END,customer_name=$3,document_no=CASE WHEN $4::text='__KEEP__' THEN document_no ELSE NULLIF($4,'') END,document_title=CASE WHEN $5::text='__KEEP__' THEN document_title ELSE NULLIF($5,'') END,customer_reference=CASE WHEN $6::text='__KEEP__' THEN customer_reference ELSE NULLIF($6,'') END,sales_order_reference=CASE WHEN $7::text='__KEEP__' THEN sales_order_reference ELSE NULLIF($7,'') END,updated_at=now() WHERE tdc_id=$1`,
      [req.params.tdcId,d.customerCode===undefined?'__KEEP__':String(d.customerCode??''),customerName,d.documentNo===undefined?'__KEEP__':String(d.documentNo??''),d.documentTitle===undefined?'__KEEP__':String(d.documentTitle??''),d.customerReference===undefined?'__KEEP__':String(d.customerReference??''),d.salesOrderReference===undefined?'__KEEP__':String(d.salesOrderReference??'')]);
    for(const x of d.values){await client.query(`UPDATE mes.tdc_characteristic_value SET uom=COALESCE($3,uom),value_mode=COALESCE($4,value_mode),colorshine_specification=$5,customer_comment=$6,final_agreed_specification=$7,min_value=$8,max_value=$9,target_value=$10,tolerance_minus=$11,tolerance_plus=$12,updated_at=now() WHERE tdc_version_id=$1 AND value_id=$2`,[row.tdc_version_id,x.valueId,x.uom??null,x.valueMode??null,clean(x.colorshineSpecification),clean(x.customerComment),clean(x.finalAgreedSpecification),x.minValue??null,x.maxValue??null,x.targetValue??null,x.toleranceMinus??null,x.tolerancePlus??null]);}
  });
  res.json({ok:true});
});

tdcRouter.post('/:tdcId/versions/:versionNo/submit',async(req,res)=>{
  const remarks=clean(req.body?.remarks);const versionNo=Number(req.params.versionNo);
  const result=await tx(async client=>{
    await assertCreator(client,req);
    const q=await client.query(`SELECT v.*,m.tdc_no,m.customer_name,m.plant_code,m.current_version_no FROM mes.tdc_version v JOIN mes.tdc_master m ON m.tdc_id=v.tdc_id WHERE v.tdc_id=$1 AND v.version_no=$2 FOR UPDATE`,[req.params.tdcId,versionNo]);const v=q.rows[0];if(!v)bad('TDC version not found',404);if(v.status!=='DRAFT')bad('Only DRAFT versions can be submitted.',409);if(Number(v.current_version_no)!==versionNo)bad('Only the current version can be submitted.',409);
    const missing=await client.query(`SELECT display_label FROM mes.tdc_characteristic_value WHERE tdc_version_id=$1 AND is_required=true AND COALESCE(NULLIF(trim(final_agreed_specification),''),NULLIF(trim(colorshine_specification),'')) IS NULL ORDER BY section_code,sequence_no`,[v.tdc_version_id]);if(missing.rows.length)bad(`Complete required specifications before submit: ${missing.rows.slice(0,8).map((x:any)=>x.display_label).join(', ')}${missing.rows.length>8?'…':''}`,409);
    const a=await client.query(`UPDATE mes.tdc_workflow_approval SET approval_status='APPROVED',action_by_user_id=$2,action_by_username=$3,action_at=now(),remarks=$4,updated_at=now() WHERE tdc_version_id=$1 AND approval_stage='CREATOR' AND approval_status='PENDING' RETURNING approval_id`,[v.tdc_version_id,req.user!.userId,req.user!.username,remarks]);if(!a.rows[0])bad('Creator approval is not pending.',409);
    const nextApproval=await client.query(`UPDATE mes.tdc_workflow_approval SET approval_status='PENDING',updated_at=now() WHERE tdc_version_id=$1 AND approval_stage='QC_HEAD' RETURNING approval_id`,[v.tdc_version_id]);
    await client.query(`UPDATE mes.tdc_version SET status='PENDING_QC',approval_stage='QC_HEAD',submitted_at=now(),updated_at=now() WHERE tdc_version_id=$1`,[v.tdc_version_id]);await client.query(`UPDATE mes.tdc_master SET overall_status='PENDING_QC',updated_at=now() WHERE tdc_id=$1`,[v.tdc_id]);
    const emails=await resolveGroupEmails(client,'TDC_QC_HEAD_2000',v.plant_code);await queueTdcEmail(client,{tdcVersionId:v.tdc_version_id,approvalId:nextApproval.rows[0]?.approval_id,eventCode:'APPROVAL_REQUEST_QC_HEAD',intendedEmails:emails,subject:`Approval required: TDC ${v.tdc_no} ${v.version_label} - QC Head`,htmlBody:approvalEmailHtml({tdcNo:v.tdc_no,versionLabel:v.version_label,customerName:v.customer_name,stage:'QC Head',actor:req.user!.displayName,remarks:remarks||undefined,action:'Creator approved; QC Head approval required'})});if(nextApproval.rows[0])await client.query(`UPDATE mes.tdc_workflow_approval SET intended_email=$2,email_status='QUEUED',updated_at=now() WHERE approval_id=$1`,[nextApproval.rows[0].approval_id,emails.join(',')||null]);
    return {status:'PENDING_QC'};
  });
  void flushTdcEmailOutbox().catch(()=>{});res.json(result);
});

const newVersionSchema=z.object({revisionReason:z.string().min(3).max(1000),templateId:z.string().uuid().optional()});
tdcRouter.post('/:tdcId/new-version',async(req,res)=>{
  const p=newVersionSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Revision reason is required',details:p.error.flatten()});const d=p.data;
  const result=await tx(async client=>{
    await assertCreator(client,req);
    const m=await client.query(`SELECT * FROM mes.tdc_master WHERE tdc_id=$1 AND is_active=true FOR UPDATE`,[req.params.tdcId]);if(!m.rows[0])bad('Active TDC not found',404);
    const source=await client.query(`SELECT * FROM mes.tdc_version WHERE tdc_id=$1 AND version_no=$2`,[req.params.tdcId,m.rows[0].current_version_no]);if(!source.rows[0])bad('Current TDC version not found',404);if(source.rows[0].status==='DRAFT')bad('Current version is already DRAFT; revise that draft instead.',409);
    const templateId=d.templateId??source.rows[0].template_id;const t=await client.query(`SELECT * FROM mes.tdc_template_header WHERE template_id=$1 AND template_status='ACTIVE' AND is_active=true AND plant_code=$2 AND category_id=$3`,[templateId,PLANT,m.rows[0].category_id]);if(!t.rows[0])bad('Selected revision template must be ACTIVE for Plant 2000 and match the existing TDC category.');
    const n=Number(m.rows[0].current_version_no)+1;const label=`V${String(n).padStart(2,'0')}`;
    const v=await client.query(`INSERT INTO mes.tdc_version(tdc_id,version_no,version_label,template_id,tdc_date,customer_code,customer_name,document_no,document_title,customer_reference,sales_order_reference,status,approval_stage,revision_reason,general_remarks,source_version_id,created_by_user_id)
      VALUES($1,$2,$3,$4,current_date,$5,$6,$7,$8,$9,$10,'DRAFT','CREATOR',$11,$12,$13,$14) RETURNING *`,[req.params.tdcId,n,label,templateId,source.rows[0].customer_code,source.rows[0].customer_name,source.rows[0].document_no,source.rows[0].document_title,source.rows[0].customer_reference,source.rows[0].sales_order_reference,d.revisionReason,source.rows[0].general_remarks,source.rows[0].tdc_version_id,req.user!.userId]);
    await client.query(`INSERT INTO mes.tdc_characteristic_value(tdc_version_id,characteristic_id,characteristic_code,characteristic_name,section_code,sequence_no,display_label,is_required,uom,value_mode,colorshine_specification,customer_comment,final_agreed_specification,min_value,max_value,target_value,tolerance_minus,tolerance_plus)
      SELECT $1,c.characteristic_id,c.characteristic_code,c.characteristic_name,tc.section_code,tc.sequence_no,COALESCE(tc.display_label,c.characteristic_name),tc.is_required,COALESCE(src.uom,tc.default_uom,c.default_uom),COALESCE(src.value_mode,tc.default_value_mode,c.default_value_mode),COALESCE(src.colorshine_specification,tc.default_specification),src.customer_comment,COALESCE(src.final_agreed_specification,tc.default_specification),src.min_value,src.max_value,src.target_value,src.tolerance_minus,src.tolerance_plus
      FROM mes.tdc_template_characteristic tc JOIN mes.tdc_characteristic_master c ON c.characteristic_id=tc.characteristic_id
      LEFT JOIN mes.tdc_characteristic_value src ON src.tdc_version_id=$2 AND src.characteristic_code=c.characteristic_code
      WHERE tc.template_id=$3 AND tc.is_active=true AND c.is_active=true`,[v.rows[0].tdc_version_id,source.rows[0].tdc_version_id,templateId]);
    await client.query(`INSERT INTO mes.tdc_workflow_approval(tdc_version_id,approval_sequence,approval_stage,approver_group_code,approval_status) VALUES($1,1,'CREATOR',NULL,'PENDING'),($1,2,'QC_HEAD','TDC_QC_HEAD_2000','WAITING'),($1,3,'PPC_HEAD','TDC_PPC_HEAD_2000','WAITING'),($1,4,'PLANT_HEAD','TDC_PLANT_HEAD_2000','WAITING')`,[v.rows[0].tdc_version_id]);
    await client.query(`UPDATE mes.tdc_master SET current_version_no=$2,template_id=$3,overall_status='DRAFT',customer_code=$4,customer_name=$5,document_no=$6,document_title=$7,customer_reference=$8,sales_order_reference=$9,updated_at=now() WHERE tdc_id=$1`,[req.params.tdcId,n,templateId,source.rows[0].customer_code,source.rows[0].customer_name,source.rows[0].document_no,source.rows[0].document_title,source.rows[0].customer_reference,source.rows[0].sales_order_reference]);
    return {tdcId:req.params.tdcId,versionNo:n,versionLabel:label};
  });
  res.status(201).json(result);
});

tdcRouter.post('/:tdcId/deactivate',async(req,res)=>{
  const reason=clean(req.body?.reason);if(!reason)return res.status(400).json({error:'Deactivation reason is mandatory.'});
  const result=await tx(async client=>{await assertCreator(client,req);const r=await client.query(`UPDATE mes.tdc_master SET is_active=false,overall_status='INACTIVE',deactivation_reason=$2,deactivated_by_user_id=$3,deactivated_at=now(),updated_at=now() WHERE tdc_id=$1 AND is_active=true RETURNING current_version_no`,[req.params.tdcId,reason,req.user!.userId]);if(!r.rows[0])bad('Active TDC not found',404);return {ok:true,currentVersionNo:r.rows[0].current_version_no};});res.json(result);
});
