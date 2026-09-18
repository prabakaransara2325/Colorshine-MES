import { query } from './db';

export type AuthorizedPlant = {
  companyCode: string;
  companyShortName: string;
  plantCode: string;
  plantName: string;
};

export type AccessGroupInfo = {
  groupCode: string;
  groupName: string;
  groupType: string;
  allowConsolidatedView: boolean;
};


export async function ensureLegacyAdminSystemAccess(userId: string): Promise<boolean> {
  const legacy = await query(`
    SELECT EXISTS(
      SELECT 1
        FROM mes.app_user_role ur
        JOIN mes.app_role r ON r.role_id=ur.role_id
       WHERE ur.user_id=$1 AND r.role_code='ADMIN'
    ) AS is_admin`, [userId]);
  if (!Boolean(legacy.rows[0]?.is_admin)) return false;

  // Keep the bootstrap idempotent. This only repairs users that already carry
  // the legacy ADMIN role; normal users are never auto-promoted.
  await query(`
    INSERT INTO mes.app_access_group(
      group_code,group_name,group_type,description,
      allow_consolidated_view,is_system_group,is_active)
    VALUES(
      'SYSTEM_ADMIN','System Administrator','SYSTEM',
      'System administration group with access to both Colorshine plants and consolidated view.',
      true,true,true)
    ON CONFLICT(group_code) DO UPDATE SET
      group_name=EXCLUDED.group_name,
      group_type=EXCLUDED.group_type,
      description=EXCLUDED.description,
      allow_consolidated_view=true,
      is_system_group=true,
      is_active=true,
      updated_at=now()`);

  await query(`
    INSERT INTO mes.app_access_group_company(access_group_id,company_code)
    SELECT g.access_group_id,c.company_code
      FROM mes.app_access_group g
      JOIN mes.company_master c ON c.company_code IN ('1000','2000') AND c.is_active=true
     WHERE g.group_code='SYSTEM_ADMIN'
    ON CONFLICT(access_group_id,company_code) DO NOTHING`);

  await query(`
    INSERT INTO mes.app_access_group_plant(access_group_id,plant_code)
    SELECT g.access_group_id,p.plant_code
      FROM mes.app_access_group g
      JOIN mes.plant_master p ON p.plant_code IN ('1000','2000') AND p.is_active=true
     WHERE g.group_code='SYSTEM_ADMIN'
    ON CONFLICT(access_group_id,plant_code) DO NOTHING`);

  await query(`
    INSERT INTO mes.app_user_access_group(
      user_id,access_group_id,valid_from,is_active,assigned_by_user_id,remarks)
    SELECT $1,g.access_group_id,current_date,true,$1,
           'Automatically repaired from legacy ADMIN role during MES login.'
      FROM mes.app_access_group g
     WHERE g.group_code='SYSTEM_ADMIN' AND g.is_active=true
       AND NOT EXISTS(
         SELECT 1 FROM mes.app_user_access_group uag
          WHERE uag.user_id=$1
            AND uag.access_group_id=g.access_group_id
            AND uag.is_active=true
       )`, [userId]);

  return true;
}

export async function loadUserSecurityContext(userId: string) {
  const userResult = await query(`
    SELECT u.user_id,u.username,u.display_name,u.email,u.employee_id,u.department,u.designation,
           u.mobile_no,u.plant_code,u.is_active,u.account_locked,u.must_change_password,u.valid_from,u.valid_to,
           array_remove(array_agg(DISTINCT r.role_code),NULL) AS roles
      FROM mes.app_user u
      LEFT JOIN mes.app_user_role ur ON ur.user_id=u.user_id
      LEFT JOIN mes.app_role r ON r.role_id=ur.role_id
     WHERE u.user_id=$1
     GROUP BY u.user_id`, [userId]);
  const u = userResult.rows[0];
  if (!u) return null;

  const plantsResult = await query(`
    SELECT company_code,company_short_name,plant_code,plant_name
      FROM mes.vw_user_authorized_plants
     WHERE user_id=$1
     ORDER BY plant_code`, [userId]);

  const groupsResult = await query(`
    SELECT g.group_code,g.group_name,g.group_type,g.allow_consolidated_view
      FROM mes.app_user_access_group uag
      JOIN mes.app_access_group g ON g.access_group_id=uag.access_group_id
     WHERE uag.user_id=$1
       AND uag.is_active=true
       AND current_date>=uag.valid_from
       AND (uag.valid_to IS NULL OR current_date<=uag.valid_to)
       AND g.is_active=true
     ORDER BY g.group_name`, [userId]);

  const canResult = await query(`SELECT mes.user_can_view_consolidated($1::uuid) AS allowed`, [userId]);

  return {
    userId: u.user_id,
    username: u.username,
    displayName: u.display_name,
    email: u.email,
    employeeId: u.employee_id,
    department: u.department,
    designation: u.designation,
    mobileNo: u.mobile_no,
    plantCode: u.plant_code,
    roles: u.roles ?? [],
    authorizedPlants: plantsResult.rows.map((p:any)=>({
      companyCode: p.company_code,
      companyShortName: p.company_short_name,
      plantCode: p.plant_code,
      plantName: p.plant_name
    })) as AuthorizedPlant[],
    accessGroups: groupsResult.rows.map((g:any)=>({
      groupCode: g.group_code,
      groupName: g.group_name,
      groupType: g.group_type,
      allowConsolidatedView: g.allow_consolidated_view
    })) as AccessGroupInfo[],
    canViewConsolidated: Boolean(canResult.rows[0]?.allowed),
    mustChangePassword: Boolean(u.must_change_password),
    accountLocked: Boolean(u.account_locked)
  };
}

export async function resolvePlantScope(userId: string, requestedPlant?: string | null): Promise<string | null> {
  const requested = String(requestedPlant ?? '').trim().toUpperCase();
  const rows = await query(`SELECT plant_code FROM mes.vw_user_authorized_plants WHERE user_id=$1 ORDER BY plant_code`, [userId]);
  const plants = rows.rows.map((r:any)=>String(r.plant_code));
  if (!plants.length) {
    const e:any = new Error('No active plant authorization assigned to this user');
    e.status=403; throw e;
  }

  if (requested && requested !== 'ALL') {
    if (!plants.includes(requested)) {
      const e:any = new Error(`You are not authorized for Plant ${requested}`);
      e.status=403; throw e;
    }
    return requested;
  }

  const c = await query(`SELECT mes.user_can_view_consolidated($1::uuid) allowed`, [userId]);
  if (Boolean(c.rows[0]?.allowed)) return null;
  if (plants.length === 1) return plants[0];

  const e:any = new Error('Select one of your authorized plants');
  e.status=400; throw e;
}

export async function assertPlantAccess(userId: string, plantCode: string) {
  const r = await query(`SELECT mes.user_has_plant_access($1::uuid,$2) allowed`, [userId, plantCode]);
  if (!r.rows[0]?.allowed) {
    const e:any = new Error(`You are not authorized for Plant ${plantCode}`);
    e.status=403; throw e;
  }
}

// Authorization object for RM (and future Paints) GRN/QC reversal. A single
// object covers both reversal actions; the QC-before-GRN sequencing is
// enforced separately by the reversal endpoints themselves.
export const REVERSAL_AUTH_GROUP = 'RM_GRN_QC_REVERSAL_2000';

export async function assertReversalAuthority(userId: string, roles: string[], client?: { query: (sql: string, params?: any[]) => Promise<any> }) {
  if (roles.includes('ADMIN')) return;
  const runner = client ?? { query };
  const r = await runner.query(`
    SELECT 1 FROM mes.app_user_access_group uag
    JOIN mes.app_access_group g ON g.access_group_id=uag.access_group_id
    WHERE uag.user_id=$1 AND g.group_code=$2 AND uag.is_active=true AND g.is_active=true
      AND (uag.valid_from IS NULL OR uag.valid_from<=current_date)
      AND (uag.valid_to IS NULL OR uag.valid_to>=current_date)
    LIMIT 1`, [userId, REVERSAL_AUTH_GROUP]);
  if (!r.rows?.[0]) {
    const e:any = new Error('You are not authorized to reverse GRN or QC entries (RM GRN/QC Reversal access required).');
    e.status = 403; throw e;
  }
}
