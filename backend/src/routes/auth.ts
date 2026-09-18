import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { z } from 'zod';
import { query } from '../db';
import { config } from '../config';
import { requireAuth } from '../middleware/auth';
import { ensureLegacyAdminSystemAccess, loadUserSecurityContext } from '../security';

export const authRouter = Router();
const loginSchema = z.object({ username: z.string().min(2).max(80), password: z.string().min(4).max(200) });

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid login request' });
  const username = parsed.data.username.trim().toUpperCase();
  const result = await query(`SELECT user_id,password_hash,is_active,account_locked,valid_from,valid_to FROM mes.app_user WHERE username=$1`, [username]);
  const row=result.rows[0];
  const today=new Date().toISOString().slice(0,10);
  if (!row || !row.is_active || row.account_locked || (row.valid_from && String(row.valid_from).slice(0,10)>today) || (row.valid_to && String(row.valid_to).slice(0,10)<today) || !(await bcrypt.compare(parsed.data.password,row.password_hash))) {
    return res.status(401).json({ error: 'Invalid username/password or inactive account' });
  }
  let context=await loadUserSecurityContext(row.user_id);
  if(!context)return res.status(401).json({error:'User security context unavailable'});

  // v0.10.7 compatibility repair: older ADMIN users may have the ADMIN role
  // but no row in the newer access-group model. Repair only that legacy case,
  // reload the context, and continue. Business users still require explicit
  // company/plant access-group assignment from User Management.
  if(!(context.authorizedPlants?.length) && context.roles?.includes('ADMIN')) {
    try {
      const repaired=await ensureLegacyAdminSystemAccess(row.user_id);
      if(repaired) context=await loadUserSecurityContext(row.user_id);
    } catch (repairError) {
      console.error('Legacy ADMIN access repair failed',repairError);
    }
  }

  if(!context || !(context.authorizedPlants?.length)) return res.status(403).json({error:'No active company/plant access group is assigned to this user'});
  const token=jwt.sign(context,config.jwtSecret,{expiresIn:config.jwtExpiresIn} as SignOptions);
  await query(`UPDATE mes.app_user SET last_login_at=now() WHERE user_id=$1`,[row.user_id]);
  res.json({token,user:context});
});

authRouter.get('/me', requireAuth, async (req,res)=>{
  const context=await loadUserSecurityContext(req.user!.userId);
  if(!context)return res.status(404).json({error:'User not found'});
  res.json({user:context});
});

const changePasswordSchema=z.object({
  currentPassword:z.string().min(4).max(200),
  newPassword:z.string().min(8).max(200)
});

authRouter.post('/change-password', requireAuth, async (req,res)=>{
  const parsed=changePasswordSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'New password must contain at least 8 characters'});
  const u=await query(`SELECT password_hash FROM mes.app_user WHERE user_id=$1`,[req.user!.userId]);
  if(!u.rows[0] || !(await bcrypt.compare(parsed.data.currentPassword,u.rows[0].password_hash))) {
    return res.status(400).json({error:'Current password is incorrect'});
  }
  if(await bcrypt.compare(parsed.data.newPassword,u.rows[0].password_hash)) {
    return res.status(400).json({error:'New password must be different from the current password'});
  }
  const hash=await bcrypt.hash(parsed.data.newPassword,12);
  await query(`UPDATE mes.app_user SET password_hash=$2,must_change_password=false,updated_at=now() WHERE user_id=$1`,[req.user!.userId,hash]);
  await query(`INSERT INTO mes.audit_log(user_name,action,entity_type,entity_id,after_value,request_id,ip_address)
    VALUES($1,'UPDATE','APP_USER_PASSWORD',$2,$3,$4,$5)`,[req.user!.username,req.user!.userId,JSON.stringify({passwordChanged:true}),req.requestId,req.ip]);
  const context=await loadUserSecurityContext(req.user!.userId);
  const token=jwt.sign(context!,config.jwtSecret,{expiresIn:config.jwtExpiresIn} as SignOptions);
  res.json({ok:true,token,user:context});
});
