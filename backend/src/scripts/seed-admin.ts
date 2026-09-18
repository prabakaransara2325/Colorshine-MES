import bcrypt from 'bcryptjs';
import { pool } from '../db';

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const username = (arg('user', 'ADMIN') || 'ADMIN').toUpperCase();
  const password = arg('password');
  const displayName = arg('name', 'MES Administrator') || 'MES Administrator';

  if (!password) {
    console.error('Usage: npm run seed:admin -- --user ADMIN --password <strong-password>');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await client.query(
      `INSERT INTO mes.app_user(username,display_name,password_hash,is_active)
       VALUES($1,$2,$3,true)
       ON CONFLICT(username) DO UPDATE
       SET display_name=EXCLUDED.display_name,password_hash=EXCLUDED.password_hash,is_active=true
       RETURNING user_id`,
      [username, displayName, hash]
    );
    const r = await client.query(`SELECT role_id FROM mes.app_role WHERE role_code='ADMIN'`);
    await client.query(
      `INSERT INTO mes.app_user_role(user_id,role_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
      [u.rows[0].user_id, r.rows[0].role_id]
    );

    // Ensure the bootstrap ADMIN is also represented in the current
    // company/plant access-group authorization model.
    await client.query(`
      INSERT INTO mes.app_access_group(
        group_code,group_name,group_type,description,
        allow_consolidated_view,is_system_group,is_active)
      VALUES('SYSTEM_ADMIN','System Administrator','SYSTEM',
        'System administration group with access to both Colorshine plants and consolidated view.',
        true,true,true)
      ON CONFLICT(group_code) DO UPDATE SET
        allow_consolidated_view=true,is_system_group=true,is_active=true,updated_at=now()`);
    await client.query(`
      INSERT INTO mes.app_access_group_company(access_group_id,company_code)
      SELECT g.access_group_id,c.company_code
        FROM mes.app_access_group g
        JOIN mes.company_master c ON c.company_code IN ('1000','2000') AND c.is_active=true
       WHERE g.group_code='SYSTEM_ADMIN'
      ON CONFLICT(access_group_id,company_code) DO NOTHING`);
    await client.query(`
      INSERT INTO mes.app_access_group_plant(access_group_id,plant_code)
      SELECT g.access_group_id,p.plant_code
        FROM mes.app_access_group g
        JOIN mes.plant_master p ON p.plant_code IN ('1000','2000') AND p.is_active=true
       WHERE g.group_code='SYSTEM_ADMIN'
      ON CONFLICT(access_group_id,plant_code) DO NOTHING`);
    await client.query(`
      INSERT INTO mes.app_user_access_group(
        user_id,access_group_id,valid_from,is_active,assigned_by_user_id,remarks)
      SELECT $1,g.access_group_id,current_date,true,$1,'Assigned by ADMIN bootstrap script.'
        FROM mes.app_access_group g
       WHERE g.group_code='SYSTEM_ADMIN'
         AND NOT EXISTS(
           SELECT 1 FROM mes.app_user_access_group uag
            WHERE uag.user_id=$1 AND uag.access_group_id=g.access_group_id AND uag.is_active=true
         )`,[u.rows[0].user_id]);
    await client.query('COMMIT');
    console.log(`Admin user ${username} created/updated.`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
