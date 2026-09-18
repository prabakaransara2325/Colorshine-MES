import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, tx } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';

export const adminUsersRouter = Router();
adminUsersRouter.use(requireAuth, requireRole('ADMIN'));

adminUsersRouter.get('/access-groups', async (_req,res)=>{
  const r=await query(`SELECT * FROM mes.vw_access_group_scope WHERE is_active=true ORDER BY group_name`);
  res.json({rows:r.rows});
});

adminUsersRouter.get('/users', async (req,res)=>{
  const search=String(req.query.search??'').trim();
  const status=String(req.query.status??'ALL').toUpperCase();
  const r=await query(`
    SELECT u.user_id,u.username,u.display_name,u.employee_id,u.email,u.mobile_no,u.department,u.designation,
           u.plant_code AS home_plant,u.is_active,u.account_locked,u.must_change_password,u.valid_from,u.valid_to,u.last_login_at,
           COALESCE(string_agg(DISTINCT CASE WHEN uag.is_active THEN g.group_code END, ', ' ORDER BY CASE WHEN uag.is_active THEN g.group_code END),'') AS access_groups,
           COALESCE(string_agg(DISTINCT CASE WHEN uag.is_active THEN gp.plant_code END, ', ' ORDER BY CASE WHEN uag.is_active THEN gp.plant_code END),'') AS authorized_plants,
           COALESCE(bool_or(CASE WHEN uag.is_active THEN g.allow_consolidated_view ELSE false END),false) AS can_view_consolidated
      FROM mes.app_user u
      LEFT JOIN mes.app_user_access_group uag ON uag.user_id=u.user_id
      LEFT JOIN mes.app_access_group g ON g.access_group_id=uag.access_group_id
      LEFT JOIN mes.app_access_group_plant gp ON gp.access_group_id=g.access_group_id
     WHERE ($1='' OR u.username ILIKE '%'||$1||'%' OR u.display_name ILIKE '%'||$1||'%' OR COALESCE(u.employee_id,'') ILIKE '%'||$1||'%')
       AND ($2='ALL' OR ($2='ACTIVE' AND u.is_active=true) OR ($2='INACTIVE' AND u.is_active=false) OR ($2='LOCKED' AND u.account_locked=true))
     GROUP BY u.user_id
     ORDER BY u.is_active DESC,u.account_locked,u.display_name,u.username`,[search,status]);
  res.json({rows:r.rows});
});

adminUsersRouter.get('/users/:userId', async (req,res)=>{
  const u=await query(`SELECT user_id,username,display_name,employee_id,email,mobile_no,department,designation,plant_code AS home_plant,
                              is_active,account_locked,must_change_password,valid_from,valid_to,last_login_at
                         FROM mes.app_user WHERE user_id=$1`,[req.params.userId]);
  if(!u.rows[0]) return res.status(404).json({error:'User not found'});
  const g=await query(`SELECT g.group_code,g.group_name,uag.valid_from,uag.valid_to,uag.is_active
                         FROM mes.app_user_access_group uag JOIN mes.app_access_group g ON g.access_group_id=uag.access_group_id
                        WHERE uag.user_id=$1 ORDER BY g.group_name`,[req.params.userId]);
  res.json({user:u.rows[0],accessGroups:g.rows});
});

const userCreate=z.object({
  username:z.string().min(2).max(80), displayName:z.string().min(2).max(120),
  employeeId:z.string().max(30).optional().nullable(), email:z.string().email().max(200).optional().nullable(),
  mobileNo:z.string().max(25).optional().nullable(), department:z.string().max(80).optional().nullable(),
  designation:z.string().max(100).optional().nullable(), homePlant:z.string().max(4).optional().nullable(),
  password:z.string().min(8).max(200), accessGroupCodes:z.array(z.string().min(2).max(60)).min(1),
  mustChangePassword:z.boolean().default(true), validFrom:z.string().optional().nullable(),validTo:z.string().optional().nullable()
});

function clean(v:any){return v===undefined||v===null||String(v).trim()===''?null:String(v).trim();}
function bad(message:string,status=400){const e:any=new Error(message);e.status=status;throw e;}

type GroupRow={access_group_id:string;group_code:string;allow_consolidated_view:boolean};

async function loadGroups(client:any,codes:string[]):Promise<GroupRow[]> {
  const unique=[...new Set(codes.map(x=>x.trim().toUpperCase()).filter(Boolean))];
  const groups=await client.query(`SELECT access_group_id,group_code,allow_consolidated_view FROM mes.app_access_group WHERE group_code=ANY($1::text[]) AND is_active=true`,[unique]);
  if(groups.rows.length!==unique.length) bad('One or more access groups are invalid/inactive');
  return groups.rows;
}

async function groupPlants(client:any,groups:GroupRow[]):Promise<string[]> {
  const ids=groups.map(g=>g.access_group_id);
  const r=await client.query(`SELECT DISTINCT plant_code FROM mes.app_access_group_plant WHERE access_group_id=ANY($1::uuid[]) ORDER BY plant_code`,[ids]);
  return r.rows.map((x:any)=>String(x.plant_code));
}

function resolveHomePlant(explicitHome:any,currentHome:any,plants:string[],wasExplicit:boolean){
  const requested=clean(wasExplicit?explicitHome:currentHome);
  if(requested && plants.includes(requested)) return requested;
  if(wasExplicit && requested && !plants.includes(requested)) bad(`Home/default Plant ${requested} is outside the selected access-group scope`);
  if(plants.length===1) return plants[0];
  return null;
}

async function syncLegacyRoles(client:any,userId:string,groupCodes:string[]){
  // ADMIN and STORE are transition roles used by the current app. Keep other
  // legacy roles untouched until the screen/action permission migration.
  await client.query(`DELETE FROM mes.app_user_role ur USING mes.app_role r
                       WHERE ur.role_id=r.role_id AND ur.user_id=$1 AND r.role_code IN ('ADMIN','STORE')`,[userId]);
  const roleCodes:string[]=[];
  if(groupCodes.includes('SYSTEM_ADMIN')) roleCodes.push('ADMIN');
  if(groupCodes.some(x=>x.startsWith('RM_STORE_'))) roleCodes.push('STORE');
  for(const roleCode of [...new Set(roleCodes)]){
    await client.query(`INSERT INTO mes.app_user_role(user_id,role_id)
      SELECT $1,role_id FROM mes.app_role WHERE role_code=$2 ON CONFLICT DO NOTHING`,[userId,roleCode]);
  }
}

async function replaceAccessGroups(client:any,userId:string,groups:GroupRow[],actorId:string){
  await client.query(`UPDATE mes.app_user_access_group SET is_active=false,deactivated_by_user_id=$2 WHERE user_id=$1 AND is_active=true`,[userId,actorId]);
  for(const g of groups){
    await client.query(`INSERT INTO mes.app_user_access_group(user_id,access_group_id,valid_from,is_active,assigned_by_user_id,remarks)
      VALUES($1,$2,current_date,true,$3,'Assigned from MES User Management')`,[userId,g.access_group_id,actorId]);
  }
  await syncLegacyRoles(client,userId,groups.map(g=>g.group_code));
}

adminUsersRouter.post('/users',async(req,res)=>{
  const p=userCreate.safeParse(req.body); if(!p.success)return res.status(400).json({error:'Invalid user data',details:p.error.flatten()});
  const d=p.data; const username=d.username.trim().toUpperCase(); const codes=d.accessGroupCodes.map(x=>x.trim().toUpperCase());
  const result=await tx(async client=>{
    const groups=await loadGroups(client,codes);
    const plants=await groupPlants(client,groups);
    if(!plants.length) bad('Selected access group does not have any active plant scope');
    const homePlant=resolveHomePlant(d.homePlant,null,plants,true);
    const hash=await bcrypt.hash(d.password,12);
    let u;
    try{
      u=await client.query(`INSERT INTO mes.app_user(username,display_name,email,password_hash,plant_code,is_active,employee_id,department,designation,mobile_no,must_change_password,account_locked,valid_from,valid_to)
        VALUES($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10,false,$11,$12) RETURNING user_id,username,display_name`,[
        username,d.displayName.trim(),clean(d.email),hash,homePlant,clean(d.employeeId),clean(d.department),clean(d.designation),clean(d.mobileNo),d.mustChangePassword,clean(d.validFrom),clean(d.validTo)]);
    }catch(e:any){
      if(e?.code==='23505') bad('Username or Employee ID already exists',409);
      throw e;
    }
    await replaceAccessGroups(client,u.rows[0].user_id,groups,req.user!.userId);
    await client.query(`INSERT INTO mes.audit_log(user_name,action,entity_type,entity_id,after_value,request_id,ip_address)
      VALUES($1,'CREATE','APP_USER',$2,$3,$4,$5)`,[req.user!.username,u.rows[0].user_id,JSON.stringify({username,displayName:d.displayName,homePlant,accessGroupCodes:groups.map(g=>g.group_code)}),req.requestId,req.ip]);
    return u.rows[0];
  });
  res.status(201).json({user:result});
});

const userUpdate=userCreate.omit({password:true,accessGroupCodes:true,mustChangePassword:true}).partial().extend({accessGroupCodes:z.array(z.string()).min(1).optional()});
adminUsersRouter.put('/users/:userId',async(req,res)=>{
  const p=userUpdate.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid user data',details:p.error.flatten()});
  const d=p.data as any;
  if(req.params.userId===req.user!.userId && d.accessGroupCodes) return res.status(409).json({error:'You cannot change your own access-group assignment while signed in'});
  await tx(async client=>{
    const before=await client.query(`SELECT * FROM mes.app_user WHERE user_id=$1 FOR UPDATE`,[req.params.userId]);
    if(!before.rows[0]) bad('User not found',404);
    let groups:GroupRow[];
    if(d.accessGroupCodes){ groups=await loadGroups(client,d.accessGroupCodes.map((x:string)=>x.trim().toUpperCase())); }
    else {
      const g=await client.query(`SELECT g.access_group_id,g.group_code,g.allow_consolidated_view
        FROM mes.app_user_access_group uag JOIN mes.app_access_group g ON g.access_group_id=uag.access_group_id
        WHERE uag.user_id=$1 AND uag.is_active=true AND g.is_active=true`,[req.params.userId]);
      groups=g.rows;
    }
    if(!groups.length) bad('User must have at least one active access group');
    const plants=await groupPlants(client,groups);
    const homePlant=resolveHomePlant(d.homePlant,before.rows[0].plant_code,plants,d.homePlant!==undefined);
    await client.query(`UPDATE mes.app_user SET
      display_name=COALESCE($2,display_name),employee_id=CASE WHEN $3::text='__KEEP__' THEN employee_id ELSE NULLIF($3,'') END,
      email=CASE WHEN $4::text='__KEEP__' THEN email ELSE NULLIF($4,'') END,mobile_no=CASE WHEN $5::text='__KEEP__' THEN mobile_no ELSE NULLIF($5,'') END,
      department=CASE WHEN $6::text='__KEEP__' THEN department ELSE NULLIF($6,'') END,designation=CASE WHEN $7::text='__KEEP__' THEN designation ELSE NULLIF($7,'') END,
      plant_code=$8,valid_from=CASE WHEN $9::text='__KEEP__' THEN valid_from ELSE NULLIF($9,'')::date END,
      valid_to=CASE WHEN $10::text='__KEEP__' THEN valid_to ELSE NULLIF($10,'')::date END,updated_at=now() WHERE user_id=$1`,[
      req.params.userId,d.displayName??null,d.employeeId===undefined?'__KEEP__':String(d.employeeId??''),d.email===undefined?'__KEEP__':String(d.email??''),
      d.mobileNo===undefined?'__KEEP__':String(d.mobileNo??''),d.department===undefined?'__KEEP__':String(d.department??''),d.designation===undefined?'__KEEP__':String(d.designation??''),
      homePlant,d.validFrom===undefined?'__KEEP__':String(d.validFrom??''),d.validTo===undefined?'__KEEP__':String(d.validTo??'')]);
    if(d.accessGroupCodes) await replaceAccessGroups(client,req.params.userId,groups,req.user!.userId);
    await client.query(`INSERT INTO mes.audit_log(user_name,action,entity_type,entity_id,before_value,after_value,request_id,ip_address)
      VALUES($1,'UPDATE','APP_USER',$2,$3,$4,$5,$6)`,[req.user!.username,req.params.userId,JSON.stringify(before.rows[0]),JSON.stringify({...d,homePlant}),req.requestId,req.ip]);
  });
  res.json({ok:true});
});

adminUsersRouter.post('/users/:userId/deactivate',async(req,res)=>{
  if(req.params.userId===req.user!.userId)return res.status(409).json({error:'You cannot deactivate your own logged-in account'});
  const r=await query(`UPDATE mes.app_user SET is_active=false,updated_at=now() WHERE user_id=$1 AND is_active=true RETURNING user_id,username`,[req.params.userId]);
  if(!r.rows[0])return res.status(404).json({error:'Active user not found'});
  await query(`INSERT INTO mes.audit_log(user_name,action,entity_type,entity_id,after_value,request_id,ip_address) VALUES($1,'UPDATE','APP_USER',$2,$3,$4,$5)`,
    [req.user!.username,req.params.userId,JSON.stringify({isActive:false}),req.requestId,req.ip]);
  res.json({ok:true});
});

adminUsersRouter.post('/users/:userId/reactivate',async(req,res)=>{
  const r=await query(`UPDATE mes.app_user SET is_active=true,account_locked=false,updated_at=now() WHERE user_id=$1 RETURNING user_id,username`,[req.params.userId]);
  if(!r.rows[0])return res.status(404).json({error:'User not found'});
  await query(`INSERT INTO mes.audit_log(user_name,action,entity_type,entity_id,after_value,request_id,ip_address) VALUES($1,'UPDATE','APP_USER',$2,$3,$4,$5)`,
    [req.user!.username,req.params.userId,JSON.stringify({isActive:true,accountLocked:false}),req.requestId,req.ip]);
  res.json({ok:true});
});

adminUsersRouter.post('/users/:userId/lock',async(req,res)=>{
  if(req.params.userId===req.user!.userId)return res.status(409).json({error:'You cannot lock your own logged-in account'});
  const r=await query(`UPDATE mes.app_user SET account_locked=true,updated_at=now() WHERE user_id=$1 AND is_active=true RETURNING user_id`,[req.params.userId]);
  if(!r.rows[0])return res.status(404).json({error:'Active user not found'});
  await query(`INSERT INTO mes.audit_log(user_name,action,entity_type,entity_id,after_value,request_id,ip_address) VALUES($1,'UPDATE','APP_USER',$2,$3,$4,$5)`,
    [req.user!.username,req.params.userId,JSON.stringify({accountLocked:true}),req.requestId,req.ip]);
  res.json({ok:true});
});

adminUsersRouter.post('/users/:userId/unlock',async(req,res)=>{
  const r=await query(`UPDATE mes.app_user SET account_locked=false,updated_at=now() WHERE user_id=$1 RETURNING user_id`,[req.params.userId]);
  if(!r.rows[0])return res.status(404).json({error:'User not found'});
  await query(`INSERT INTO mes.audit_log(user_name,action,entity_type,entity_id,after_value,request_id,ip_address) VALUES($1,'UPDATE','APP_USER',$2,$3,$4,$5)`,
    [req.user!.username,req.params.userId,JSON.stringify({accountLocked:false}),req.requestId,req.ip]);
  res.json({ok:true});
});

const reset=z.object({password:z.string().min(8).max(200),mustChangePassword:z.boolean().default(true)});
adminUsersRouter.post('/users/:userId/reset-password',async(req,res)=>{
  const p=reset.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Password must be at least 8 characters'});
  const hash=await bcrypt.hash(p.data.password,12);
  const r=await query(`UPDATE mes.app_user SET password_hash=$2,must_change_password=$3,account_locked=false,updated_at=now() WHERE user_id=$1 RETURNING user_id`,[req.params.userId,hash,p.data.mustChangePassword]);
  if(!r.rows[0])return res.status(404).json({error:'User not found'});
  await query(`INSERT INTO mes.audit_log(user_name,action,entity_type,entity_id,after_value,request_id,ip_address) VALUES($1,'UPDATE','APP_USER_PASSWORD',$2,$3,$4,$5)`,
    [req.user!.username,req.params.userId,JSON.stringify({passwordReset:true,mustChangePassword:p.data.mustChangePassword}),req.requestId,req.ip]);
  res.json({ok:true});
});
