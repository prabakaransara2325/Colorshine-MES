-- ============================================================================
-- Colorshine MES V2 v0.10.7
-- Repair legacy ADMIN -> SYSTEM_ADMIN access-group assignment
-- Idempotent and deliberately limited to existing users with legacy ADMIN role.
-- ============================================================================

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
    updated_at=now();

INSERT INTO mes.app_access_group_company(access_group_id,company_code)
SELECT g.access_group_id,c.company_code
FROM mes.app_access_group g
JOIN mes.company_master c
  ON c.company_code IN ('1000','2000')
 AND c.is_active=true
WHERE g.group_code='SYSTEM_ADMIN'
ON CONFLICT(access_group_id,company_code) DO NOTHING;

INSERT INTO mes.app_access_group_plant(access_group_id,plant_code)
SELECT g.access_group_id,p.plant_code
FROM mes.app_access_group g
JOIN mes.plant_master p
  ON p.plant_code IN ('1000','2000')
 AND p.is_active=true
WHERE g.group_code='SYSTEM_ADMIN'
ON CONFLICT(access_group_id,plant_code) DO NOTHING;

INSERT INTO mes.app_user_access_group(
    user_id,access_group_id,valid_from,is_active,assigned_by_user_id,remarks)
SELECT
    u.user_id,g.access_group_id,current_date,true,u.user_id,
    'v0.10.7 repair: mapped legacy ADMIN role to SYSTEM_ADMIN access group.'
FROM mes.app_user u
JOIN mes.app_user_role ur ON ur.user_id=u.user_id
JOIN mes.app_role r ON r.role_id=ur.role_id AND r.role_code='ADMIN'
JOIN mes.app_access_group g ON g.group_code='SYSTEM_ADMIN' AND g.is_active=true
WHERE u.is_active=true
  AND NOT EXISTS(
      SELECT 1
      FROM mes.app_user_access_group uag
      WHERE uag.user_id=u.user_id
        AND uag.access_group_id=g.access_group_id
        AND uag.is_active=true
  );

-- Verification result: every active ADMIN should show plants 1000 and 2000.
SELECT
    u.username,
    COALESCE(string_agg(DISTINCT v.plant_code, ', ' ORDER BY v.plant_code),'') AS authorized_plants,
    CASE WHEN count(DISTINCT v.plant_code) FILTER (WHERE v.plant_code IN ('1000','2000')) = 2
         THEN 'OK' ELSE 'CHECK' END AS status
FROM mes.app_user u
JOIN mes.app_user_role ur ON ur.user_id=u.user_id
JOIN mes.app_role r ON r.role_id=ur.role_id AND r.role_code='ADMIN'
LEFT JOIN mes.vw_user_authorized_plants v ON v.user_id=u.user_id
WHERE u.is_active=true
GROUP BY u.user_id,u.username
ORDER BY u.username;
