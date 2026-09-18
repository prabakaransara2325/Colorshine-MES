import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db';
import { requireAuth } from '../middleware/auth';

export const userPreferencesRouter = Router();
userPreferencesRouter.use(requireAuth);

function isAdmin(req:any){
  return (req.user?.roles||[]).includes('ADMIN');
}

userPreferencesRouter.get('/favorites', async (req,res)=>{
  const r=await query(`
    SELECT favorite_id,screen_id,screen_code,display_screen_no AS screen_no,screen_name,screen_type,
           route_path,module_no,module_code,module_name,sequence_no
      FROM mes.vw_user_favorite_screens
     WHERE user_id=$1
       AND screen_active=true
       AND module_active=true
       AND screen_status='ACTIVE'
       AND implementation_status='BUILT'
       AND route_path IS NOT NULL
       AND ($2::boolean=true OR is_admin_module=false)
     ORDER BY sequence_no,created_at,screen_name`,[req.user!.userId,isAdmin(req)]);
  res.json({rows:r.rows,maxFavorites:8});
});

const favoriteSchema=z.object({screenCode:z.string().min(2).max(80)});

userPreferencesRouter.post('/favorites', async (req,res)=>{
  const p=favoriteSchema.safeParse(req.body);
  if(!p.success)return res.status(400).json({error:'Valid screenCode is required'});
  const screenCode=p.data.screenCode.trim().toUpperCase();

  const screen=await query(`
    SELECT s.screen_id,s.screen_code,s.screen_no,s.screen_name,s.route_path,s.implementation_status,s.screen_status,
           m.module_code,m.module_name,m.is_admin_module
      FROM mes.app_screen s
      JOIN mes.app_module m ON m.module_id=s.module_id
     WHERE s.screen_code=$1 AND s.is_active=true AND m.is_active=true`,[screenCode]);
  const s=screen.rows[0];
  if(!s)return res.status(404).json({error:'Screen not found in MES screen register'});
  if(s.is_admin_module&&!isAdmin(req))return res.status(403).json({error:'You are not authorized for this administration screen'});
  if(s.screen_status!=='ACTIVE'||s.implementation_status!=='BUILT'||!s.route_path){
    return res.status(409).json({error:'Only active, implemented MES screens can be added to Favorites'});
  }

  const existing=await query(`SELECT favorite_id FROM mes.app_user_favorite_screen WHERE user_id=$1 AND screen_id=$2`,[req.user!.userId,s.screen_id]);
  if(existing.rows[0])return res.json({ok:true,alreadyFavorite:true});

  const count=await query(`SELECT count(*)::int AS count FROM mes.app_user_favorite_screen WHERE user_id=$1`,[req.user!.userId]);
  if(Number(count.rows[0]?.count||0)>=8)return res.status(409).json({error:'You can keep a maximum of 8 favorite screens'});

  const pos=await query(`SELECT COALESCE(max(sequence_no),0)+10 AS sequence_no FROM mes.app_user_favorite_screen WHERE user_id=$1`,[req.user!.userId]);
  await query(`INSERT INTO mes.app_user_favorite_screen(user_id,screen_id,sequence_no) VALUES($1,$2,$3)`,[req.user!.userId,s.screen_id,pos.rows[0]?.sequence_no||10]);
  res.status(201).json({ok:true,screenCode:s.screen_code});
});

userPreferencesRouter.delete('/favorites/:screenCode', async (req,res)=>{
  const screenCode=String(req.params.screenCode||'').trim().toUpperCase();
  const r=await query(`
    DELETE FROM mes.app_user_favorite_screen f
    USING mes.app_screen s
    WHERE f.screen_id=s.screen_id
      AND f.user_id=$1
      AND s.screen_code=$2
    RETURNING f.favorite_id`,[req.user!.userId,screenCode]);
  res.json({ok:true,removed:Boolean(r.rows[0])});
});

// ---------------------------------------------------------------------------
// Working Screens (enterprise tab bar)
// Maximum 8 persistent processing screens per user.
// Dashboards are intentionally not tracked as working screens.
// ---------------------------------------------------------------------------
async function workingScreenStorageReady(){
  const r=await query(`
    SELECT
      to_regclass('mes.app_user_working_screen') IS NOT NULL AS table_ready,
      to_regclass('mes.vw_user_working_screens') IS NOT NULL AS view_ready
  `);
  return Boolean(r.rows[0]?.table_ready)&&Boolean(r.rows[0]?.view_ready);
}

async function workingScreenRows(userId:string, admin:boolean){
  return query(`
    SELECT working_screen_id,screen_id,screen_code,screen_no,screen_name,screen_type,
           route_path,module_no,module_code,module_name,opened_at,last_active_at,sequence_no
      FROM mes.vw_user_working_screens
     WHERE user_id=$1
       AND screen_active=true
       AND module_active=true
       AND screen_status='ACTIVE'
       AND implementation_status='BUILT'
       AND route_path IS NOT NULL
       AND ($2::boolean=true OR is_admin_module=false)
     ORDER BY sequence_no,opened_at,screen_name`,[userId,admin]);
}

userPreferencesRouter.get('/working-screens', async (req,res)=>{
  if(!(await workingScreenStorageReady())){
    return res.json({rows:[],maxOpenScreens:8,storageReady:false,code:'WORKING_SCREENS_NOT_READY'});
  }
  const r=await workingScreenRows(req.user!.userId,isAdmin(req));
  res.json({rows:r.rows,maxOpenScreens:8,storageReady:true});
});

const workingScreenSchema=z.object({screenCode:z.string().min(2).max(80)});

userPreferencesRouter.post('/working-screens', async (req,res)=>{
  const p=workingScreenSchema.safeParse(req.body);
  if(!p.success)return res.status(400).json({error:'Valid screenCode is required'});
  const screenCode=p.data.screenCode.trim().toUpperCase();
  if(!(await workingScreenStorageReady())){
    return res.status(503).json({
      error:'Working-screen persistence is not initialized. Run database migration 14_working_screens_repair.sql.',
      code:'WORKING_SCREENS_NOT_READY',storageReady:false,rows:[],maxOpenScreens:8
    });
  }

  const screen=await query(`
    SELECT s.screen_id,s.screen_code,s.screen_no,s.screen_name,s.screen_type,s.route_path,
           s.implementation_status,s.screen_status,m.module_code,m.module_name,m.is_admin_module
      FROM mes.app_screen s
      JOIN mes.app_module m ON m.module_id=s.module_id
     WHERE s.screen_code=$1 AND s.is_active=true AND m.is_active=true`,[screenCode]);
  const s=screen.rows[0];
  if(!s)return res.status(404).json({error:'Screen not found in MES screen register'});
  if(s.is_admin_module&&!isAdmin(req))return res.status(403).json({error:'You are not authorized for this administration screen'});
  if(s.screen_status!=='ACTIVE'||s.implementation_status!=='BUILT'||!s.route_path){
    return res.status(409).json({error:'Only active, implemented MES screens can be opened as working screens'});
  }

  // Module/enterprise dashboards are navigation destinations, not processing tabs.
  if(String(s.screen_type).toUpperCase()==='DASHBOARD'){
    return res.json({ok:true,trackable:false,screenCode:s.screen_code});
  }

  const existing=await query(`
    SELECT working_screen_id
      FROM mes.app_user_working_screen
     WHERE user_id=$1 AND screen_id=$2`,[req.user!.userId,s.screen_id]);

  if(existing.rows[0]){
    await query(`
      UPDATE mes.app_user_working_screen
         SET last_active_at=now(),updated_at=now()
       WHERE user_id=$1 AND screen_id=$2`,[req.user!.userId,s.screen_id]);
    const rows=await workingScreenRows(req.user!.userId,isAdmin(req));
    return res.json({ok:true,alreadyOpen:true,trackable:true,rows:rows.rows,maxOpenScreens:8});
  }

  const count=await query(`SELECT count(*)::int AS count FROM mes.app_user_working_screen WHERE user_id=$1`,[req.user!.userId]);
  if(Number(count.rows[0]?.count||0)>=8){
    const rows=await workingScreenRows(req.user!.userId,isAdmin(req));
    return res.status(409).json({
      error:'Maximum 8 working screens are already open. Please close an unused screen to continue.',
      code:'MAX_WORKING_SCREENS',
      rows:rows.rows,
      maxOpenScreens:8
    });
  }

  const pos=await query(`SELECT COALESCE(max(sequence_no),0)+10 AS sequence_no FROM mes.app_user_working_screen WHERE user_id=$1`,[req.user!.userId]);
  await query(`
    INSERT INTO mes.app_user_working_screen(user_id,screen_id,sequence_no,last_active_at)
    VALUES($1,$2,$3,now())`,[req.user!.userId,s.screen_id,pos.rows[0]?.sequence_no||10]);

  const rows=await workingScreenRows(req.user!.userId,isAdmin(req));
  res.status(201).json({ok:true,trackable:true,rows:rows.rows,maxOpenScreens:8});
});

userPreferencesRouter.delete('/working-screens/:screenCode', async (req,res)=>{
  const screenCode=String(req.params.screenCode||'').trim().toUpperCase();
  if(!(await workingScreenStorageReady()))return res.json({ok:true,removed:false,rows:[],maxOpenScreens:8,storageReady:false});
  const r=await query(`
    DELETE FROM mes.app_user_working_screen ws
    USING mes.app_screen s
    WHERE ws.screen_id=s.screen_id
      AND ws.user_id=$1
      AND s.screen_code=$2
    RETURNING ws.working_screen_id`,[req.user!.userId,screenCode]);
  const rows=await workingScreenRows(req.user!.userId,isAdmin(req));
  res.json({ok:true,removed:Boolean(r.rows[0]),rows:rows.rows,maxOpenScreens:8});
});

userPreferencesRouter.delete('/working-screens', async (req,res)=>{
  if(!(await workingScreenStorageReady()))return res.json({ok:true,rows:[],maxOpenScreens:8,storageReady:false});
  await query(`DELETE FROM mes.app_user_working_screen WHERE user_id=$1`,[req.user!.userId]);
  res.json({ok:true,rows:[],maxOpenScreens:8,storageReady:true});
});

userPreferencesRouter.post('/working-screens/close-others', async (req,res)=>{
  const p=workingScreenSchema.safeParse(req.body);
  if(!p.success)return res.status(400).json({error:'Valid screenCode is required'});
  if(!(await workingScreenStorageReady()))return res.json({ok:true,rows:[],maxOpenScreens:8,storageReady:false});
  const screenCode=p.data.screenCode.trim().toUpperCase();
  await query(`
    DELETE FROM mes.app_user_working_screen ws
    WHERE ws.user_id=$1
      AND ws.screen_id NOT IN (
        SELECT s.screen_id FROM mes.app_screen s WHERE s.screen_code=$2
      )`,[req.user!.userId,screenCode]);
  const rows=await workingScreenRows(req.user!.userId,isAdmin(req));
  res.json({ok:true,rows:rows.rows,maxOpenScreens:8});
});


// ---------------------------------------------------------------------------
// User-wise Report Layouts (SAP ALV-style)
// Generic persistence by screenCode. Screen 1102 RM Inventory is the first
// consumer; other MES reports can reuse the same storage and API later.
// ---------------------------------------------------------------------------
async function reportLayoutStorageReady(){
  const r=await query(`SELECT to_regclass('mes.app_user_report_layout') IS NOT NULL AS ready`);
  return Boolean(r.rows[0]?.ready);
}

const reportLayoutConfigSchema=z.object({
  columnOrder:z.array(z.string().min(1).max(80)).max(120),
  hiddenColumns:z.array(z.string().min(1).max(80)).max(120),
  pageSize:z.number().int().min(50).max(500).optional()
});

const reportLayoutSchema=z.object({
  screenCode:z.string().min(2).max(80),
  layoutName:z.string().trim().min(1).max(80),
  isDefault:z.boolean().optional().default(false),
  config:reportLayoutConfigSchema
});

userPreferencesRouter.get('/report-layouts', async (req,res)=>{
  const screenCode=String(req.query.screenCode||'').trim().toUpperCase();
  if(!screenCode)return res.status(400).json({error:'screenCode is required'});
  if(!(await reportLayoutStorageReady())){
    return res.json({rows:[],storageReady:false,code:'REPORT_LAYOUTS_NOT_READY'});
  }
  const r=await query(`
    SELECT layout_id,screen_code,layout_name,is_default,layout_config,created_at,updated_at
      FROM mes.app_user_report_layout
     WHERE user_id=$1 AND upper(screen_code)=upper($2)
     ORDER BY is_default DESC, upper(layout_name), updated_at DESC`,[req.user!.userId,screenCode]);
  res.json({rows:r.rows,storageReady:true});
});

userPreferencesRouter.post('/report-layouts', async (req,res)=>{
  const p=reportLayoutSchema.safeParse(req.body);
  if(!p.success)return res.status(400).json({error:'Valid screenCode, layoutName and layout configuration are required'});
  if(!(await reportLayoutStorageReady())){
    return res.status(503).json({error:'Report-layout persistence is not initialized. Run database migration 29_user_report_layouts.sql.',code:'REPORT_LAYOUTS_NOT_READY'});
  }
  const screenCode=p.data.screenCode.trim().toUpperCase();
  const layoutName=p.data.layoutName.trim();
  const config=p.data.config;
  const makeDefault=Boolean(p.data.isDefault);

  const row=await tx(async client=>{
    if(makeDefault){
      await client.query(`UPDATE mes.app_user_report_layout SET is_default=false,updated_at=now() WHERE user_id=$1 AND upper(screen_code)=upper($2)`,[req.user!.userId,screenCode]);
    }
    const existing=await client.query(`
      SELECT layout_id
        FROM mes.app_user_report_layout
       WHERE user_id=$1 AND upper(screen_code)=upper($2) AND upper(layout_name)=upper($3)
       LIMIT 1`,[req.user!.userId,screenCode,layoutName]);
    if(existing.rows[0]){
      const r=await client.query(`
        UPDATE mes.app_user_report_layout
           SET layout_name=$3,is_default=$4,layout_config=$5::jsonb,updated_at=now()
         WHERE layout_id=$1 AND user_id=$2
         RETURNING layout_id,screen_code,layout_name,is_default,layout_config,created_at,updated_at`,
        [existing.rows[0].layout_id,req.user!.userId,layoutName,makeDefault,JSON.stringify(config)]);
      return r.rows[0];
    }
    const r=await client.query(`
      INSERT INTO mes.app_user_report_layout(user_id,screen_code,layout_name,is_default,layout_config)
      VALUES($1,$2,$3,$4,$5::jsonb)
      RETURNING layout_id,screen_code,layout_name,is_default,layout_config,created_at,updated_at`,
      [req.user!.userId,screenCode,layoutName,makeDefault,JSON.stringify(config)]);
    return r.rows[0];
  });
  res.status(201).json({ok:true,row});
});

userPreferencesRouter.delete('/report-layouts/:layoutId', async (req,res)=>{
  if(!(await reportLayoutStorageReady()))return res.json({ok:true,removed:false,storageReady:false});
  const layoutId=String(req.params.layoutId||'').trim();
  const r=await query(`
    DELETE FROM mes.app_user_report_layout
     WHERE layout_id=$1::uuid AND user_id=$2
     RETURNING layout_id`,[layoutId,req.user!.userId]);
  res.json({ok:true,removed:Boolean(r.rows[0]),storageReady:true});
});
