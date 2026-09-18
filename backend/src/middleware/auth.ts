import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { query } from '../db';
import { JwtUser } from '../types';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  try {
    const tokenUser = jwt.verify(header.slice(7), config.jwtSecret) as JwtUser;
    const state = await query(`
      SELECT u.user_id,u.username,u.display_name,u.email,u.employee_id,u.department,u.designation,u.mobile_no,
             u.plant_code,u.is_active,u.account_locked,u.must_change_password,u.valid_from,u.valid_to,
             array_remove(array_agg(DISTINCT r.role_code),NULL) AS roles
        FROM mes.app_user u
        LEFT JOIN mes.app_user_role ur ON ur.user_id=u.user_id
        LEFT JOIN mes.app_role r ON r.role_id=ur.role_id
       WHERE u.user_id=$1
       GROUP BY u.user_id`, [tokenUser.userId]);
    const u = state.rows[0];
    const today = new Date().toISOString().slice(0,10);
    if (!u || !u.is_active || u.account_locked || (u.valid_from && String(u.valid_from).slice(0,10)>today) || (u.valid_to && String(u.valid_to).slice(0,10)<today)) {
      return res.status(401).json({ error: 'MES account is inactive, locked or outside its validity period' });
    }
    req.user = {
      ...tokenUser,
      username: u.username,
      displayName: u.display_name,
      email: u.email,
      employeeId: u.employee_id,
      department: u.department,
      designation: u.designation,
      mobileNo: u.mobile_no,
      plantCode: u.plant_code,
      roles: u.roles ?? [],
      mustChangePassword: Boolean(u.must_change_password),
      accountLocked: Boolean(u.account_locked)
    };
    const allowPasswordPath = req.originalUrl.startsWith('/api/auth/change-password') || req.originalUrl.startsWith('/api/auth/me');
    if (req.user.mustChangePassword && !allowPasswordPath) {
      return res.status(428).json({ error: 'Password change required before continuing' });
    }
    return next();
  } catch (error: any) {
    if (error?.status) return next(error);
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export function requireRole(...allowed: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const roles = req.user?.roles ?? [];
    if (!allowed.some((r) => roles.includes(r))) return res.status(403).json({ error: 'Insufficient permission' });
    return next();
  };
}
