-- ============================================================================
-- COLORSHINE MES V2
-- 10_user_access_group_foundation.sql
--
-- Purpose
--   Step 1 of the new authorization architecture:
--     USER -> ACCESS GROUP -> COMPANY -> PLANT
--
-- This migration intentionally does NOT create Screen/Action permissions yet.
-- Those will be added in the next authorization migration and will attach to
-- app_access_group.
--
-- Business rule implemented now
--   RM_STORE_1000_TEAM -> Plant 1000 only
--   RM_STORE_2000_TEAM -> Plant 2000 only
--   RM_STORE_HEAD      -> Plant 1000 + 2000 + consolidated view
--   SYSTEM_ADMIN       -> Plant 1000 + 2000 + consolidated view
--
-- Compatibility
--   Existing mes.app_user / mes.app_role / mes.app_user_role are retained so
--   the current login/backend continues to work.
--   app_user.plant_code remains the user's HOME/DEFAULT plant only; it is NOT
--   an authorization field from this migration onward.
--
-- PostgreSQL 14+
-- ============================================================================

SET search_path TO mes, public;

BEGIN;

-- --------------------------------------------------------------------------
-- 0. SCHEMA VERSION
-- --------------------------------------------------------------------------
INSERT INTO mes.schema_version(version_no, description)
VALUES (
    '1.2.0',
    'Authorization foundation: company master, user enhancements, access groups and plant scope'
)
ON CONFLICT (version_no) DO NOTHING;

-- ============================================================================
-- 1. COMPANY MASTER
-- ============================================================================

CREATE TABLE IF NOT EXISTS mes.company_master (
    company_code        varchar(4) PRIMARY KEY,
    company_name        varchar(160) NOT NULL,
    short_name          varchar(40) NOT NULL,
    is_active           boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO mes.company_master(company_code, company_name, short_name)
VALUES
    ('1000', 'COLORSHINE COATED PRIVATE LIMITED', 'CCPL'),
    ('2000', 'COLORSHINE INDIA PRIVATE LIMITED',  'CIPL')
ON CONFLICT (company_code) DO UPDATE
SET company_name = EXCLUDED.company_name,
    short_name   = EXCLUDED.short_name,
    updated_at   = now();

-- Make plant_master.company_code a real FK now that COMPANY_MASTER exists.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_plant_company'
          AND conrelid = 'mes.plant_master'::regclass
    ) THEN
        ALTER TABLE mes.plant_master
            ADD CONSTRAINT fk_plant_company
            FOREIGN KEY (company_code)
            REFERENCES mes.company_master(company_code);
    END IF;
END $$;

COMMENT ON TABLE mes.company_master IS
'Legal company entities used for company-wise MES authorization.';

-- ============================================================================
-- 2. ENHANCE EXISTING USER MASTER
-- ============================================================================

ALTER TABLE mes.app_user
    ADD COLUMN IF NOT EXISTS employee_id          varchar(30),
    ADD COLUMN IF NOT EXISTS department           varchar(80),
    ADD COLUMN IF NOT EXISTS designation          varchar(100),
    ADD COLUMN IF NOT EXISTS mobile_no            varchar(25),
    ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS account_locked       boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS valid_from           date,
    ADD COLUMN IF NOT EXISTS valid_to             date;

CREATE UNIQUE INDEX IF NOT EXISTS ux_app_user_employee_id
    ON mes.app_user(employee_id)
    WHERE employee_id IS NOT NULL;

COMMENT ON COLUMN mes.app_user.plant_code IS
'Home/default plant for UI convenience only. Authorization is controlled by app_user_access_group -> app_access_group_plant.';

COMMENT ON COLUMN mes.app_user.employee_id IS
'Employee number / personnel identifier. Nullable for system/bootstrap users.';

-- Guard against an invalid user validity range.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_app_user_validity'
          AND conrelid = 'mes.app_user'::regclass
    ) THEN
        ALTER TABLE mes.app_user
            ADD CONSTRAINT ck_app_user_validity
            CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from);
    END IF;
END $$;

-- ============================================================================
-- 3. ACCESS GROUP MASTER
-- ============================================================================

CREATE TABLE IF NOT EXISTS mes.app_access_group (
    access_group_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_code              varchar(60) NOT NULL UNIQUE,
    group_name              varchar(140) NOT NULL,
    group_type              varchar(40) NOT NULL DEFAULT 'FUNCTIONAL',
    description             varchar(500),
    allow_consolidated_view boolean NOT NULL DEFAULT false,
    is_system_group         boolean NOT NULL DEFAULT false,
    is_active               boolean NOT NULL DEFAULT true,
    created_by_user_id      uuid REFERENCES mes.app_user(user_id),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mes.app_access_group IS
'Business authorization groups. Screen/action permissions will be attached to this table in the next migration.';

COMMENT ON COLUMN mes.app_access_group.allow_consolidated_view IS
'Allows ALL/consolidated selection when the user also has access to multiple plants.';

-- Keep group codes clean and stable.
CREATE OR REPLACE FUNCTION mes.upper_access_group_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.group_code := upper(trim(NEW.group_code));
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_upper_access_group_code ON mes.app_access_group;

CREATE TRIGGER trg_upper_access_group_code
BEFORE INSERT OR UPDATE ON mes.app_access_group
FOR EACH ROW
EXECUTE FUNCTION mes.upper_access_group_code();

-- ============================================================================
-- 4. ACCESS GROUP -> COMPANY SCOPE
-- ============================================================================

CREATE TABLE IF NOT EXISTS mes.app_access_group_company (
    access_group_id     uuid NOT NULL
                        REFERENCES mes.app_access_group(access_group_id)
                        ON DELETE CASCADE,
    company_code        varchar(4) NOT NULL
                        REFERENCES mes.company_master(company_code),
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (access_group_id, company_code)
);

CREATE INDEX IF NOT EXISTS ix_access_group_company_company
    ON mes.app_access_group_company(company_code);

-- ============================================================================
-- 5. ACCESS GROUP -> PLANT SCOPE
-- ============================================================================

CREATE TABLE IF NOT EXISTS mes.app_access_group_plant (
    access_group_id     uuid NOT NULL
                        REFERENCES mes.app_access_group(access_group_id)
                        ON DELETE CASCADE,
    plant_code          varchar(4) NOT NULL
                        REFERENCES mes.plant_master(plant_code),
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (access_group_id, plant_code)
);

CREATE INDEX IF NOT EXISTS ix_access_group_plant_plant
    ON mes.app_access_group_plant(plant_code);

-- Validate that a group's plant belongs to one of the group's authorized companies.
CREATE OR REPLACE FUNCTION mes.validate_access_group_plant_company()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_company_code varchar(4);
BEGIN
    SELECT company_code
      INTO v_company_code
      FROM mes.plant_master
     WHERE plant_code = NEW.plant_code;

    IF v_company_code IS NULL THEN
        RAISE EXCEPTION 'Plant % does not exist.', NEW.plant_code;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM mes.app_access_group_company gc
         WHERE gc.access_group_id = NEW.access_group_id
           AND gc.company_code = v_company_code
    ) THEN
        RAISE EXCEPTION
            'Plant % belongs to company %, but that company is not assigned to this access group.',
            NEW.plant_code, v_company_code;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_access_group_plant_company
    ON mes.app_access_group_plant;

CREATE TRIGGER trg_validate_access_group_plant_company
BEFORE INSERT OR UPDATE ON mes.app_access_group_plant
FOR EACH ROW
EXECUTE FUNCTION mes.validate_access_group_plant_company();

-- ============================================================================
-- 6. USER -> ACCESS GROUP ASSIGNMENT
--
-- Assignment rows are kept historically. Deactivate an assignment instead of
-- deleting it. A partial unique index permits only one active assignment of the
-- same group to the same user at a time.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mes.app_user_access_group (
    user_access_group_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              uuid NOT NULL
                         REFERENCES mes.app_user(user_id)
                         ON DELETE CASCADE,
    access_group_id      uuid NOT NULL
                         REFERENCES mes.app_access_group(access_group_id),
    valid_from           date NOT NULL DEFAULT current_date,
    valid_to             date,
    is_active            boolean NOT NULL DEFAULT true,
    assigned_by_user_id  uuid REFERENCES mes.app_user(user_id),
    assigned_at          timestamptz NOT NULL DEFAULT now(),
    deactivated_by_user_id uuid REFERENCES mes.app_user(user_id),
    deactivated_at       timestamptz,
    remarks              varchar(500),
    CONSTRAINT ck_user_access_group_validity
        CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_access_group_active
    ON mes.app_user_access_group(user_id, access_group_id)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS ix_user_access_group_user
    ON mes.app_user_access_group(user_id, is_active);

CREATE INDEX IF NOT EXISTS ix_user_access_group_group
    ON mes.app_user_access_group(access_group_id, is_active);

-- Keep deactivation metadata consistent.
CREATE OR REPLACE FUNCTION mes.sync_user_access_group_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.is_active = false AND OLD.is_active = true THEN
        NEW.deactivated_at := COALESCE(NEW.deactivated_at, now());
        NEW.valid_to := COALESCE(NEW.valid_to, current_date);
    ELSIF NEW.is_active = true THEN
        NEW.deactivated_at := NULL;
        NEW.deactivated_by_user_id := NULL;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_user_access_group_status
    ON mes.app_user_access_group;

CREATE TRIGGER trg_sync_user_access_group_status
BEFORE UPDATE ON mes.app_user_access_group
FOR EACH ROW
EXECUTE FUNCTION mes.sync_user_access_group_status();

-- ============================================================================
-- 7. SEED INITIAL ACCESS GROUPS
-- ============================================================================

INSERT INTO mes.app_access_group (
    group_code,
    group_name,
    group_type,
    description,
    allow_consolidated_view,
    is_system_group,
    is_active
)
VALUES
(
    'RM_STORE_1000_TEAM',
    'RM Stores - Plant 1000 Team',
    'FUNCTIONAL',
    'RM Stores operational team restricted to Plant 1000 / CCPL.',
    false,
    true,
    true
),
(
    'RM_STORE_2000_TEAM',
    'RM Stores - Plant 2000 Team',
    'FUNCTIONAL',
    'RM Stores operational team restricted to Plant 2000 / CIPL.',
    false,
    true,
    true
),
(
    'RM_STORE_HEAD',
    'RM Stores Head',
    'HEAD',
    'RM Stores Head with access to Plants 1000 and 2000 and consolidated ALL view.',
    true,
    true,
    true
),
(
    'SYSTEM_ADMIN',
    'System Administrator',
    'SYSTEM',
    'System administration group with access to both plants and consolidated view.',
    true,
    true,
    true
)
ON CONFLICT (group_code) DO UPDATE
SET group_name              = EXCLUDED.group_name,
    group_type              = EXCLUDED.group_type,
    description             = EXCLUDED.description,
    allow_consolidated_view = EXCLUDED.allow_consolidated_view,
    is_system_group         = EXCLUDED.is_system_group,
    is_active               = EXCLUDED.is_active,
    updated_at              = now();

-- --------------------------------------------------------------------------
-- Company mapping
-- --------------------------------------------------------------------------

INSERT INTO mes.app_access_group_company(access_group_id, company_code)
SELECT g.access_group_id, x.company_code
FROM mes.app_access_group g
JOIN (
    VALUES
        ('RM_STORE_1000_TEAM', '1000'),
        ('RM_STORE_2000_TEAM', '2000'),
        ('RM_STORE_HEAD',      '1000'),
        ('RM_STORE_HEAD',      '2000'),
        ('SYSTEM_ADMIN',       '1000'),
        ('SYSTEM_ADMIN',       '2000')
) AS x(group_code, company_code)
  ON x.group_code = g.group_code
ON CONFLICT (access_group_id, company_code) DO NOTHING;

-- --------------------------------------------------------------------------
-- Plant mapping
-- --------------------------------------------------------------------------

INSERT INTO mes.app_access_group_plant(access_group_id, plant_code)
SELECT g.access_group_id, x.plant_code
FROM mes.app_access_group g
JOIN (
    VALUES
        ('RM_STORE_1000_TEAM', '1000'),
        ('RM_STORE_2000_TEAM', '2000'),
        ('RM_STORE_HEAD',      '1000'),
        ('RM_STORE_HEAD',      '2000'),
        ('SYSTEM_ADMIN',       '1000'),
        ('SYSTEM_ADMIN',       '2000')
) AS x(group_code, plant_code)
  ON x.group_code = g.group_code
ON CONFLICT (access_group_id, plant_code) DO NOTHING;

-- ============================================================================
-- 8. PRESERVE CURRENT ADMIN ACCESS
--
-- Any existing user carrying the old ADMIN role is automatically placed into
-- SYSTEM_ADMIN. Other business users are deliberately NOT auto-mapped because
-- that could accidentally grant the wrong plant.
-- ============================================================================

INSERT INTO mes.app_user_access_group (
    user_id,
    access_group_id,
    valid_from,
    is_active,
    remarks
)
SELECT
    u.user_id,
    g.access_group_id,
    current_date,
    true,
    'Automatically assigned during authorization migration from legacy ADMIN role.'
FROM mes.app_user u
JOIN mes.app_user_role ur ON ur.user_id = u.user_id
JOIN mes.app_role r ON r.role_id = ur.role_id
JOIN mes.app_access_group g ON g.group_code = 'SYSTEM_ADMIN'
WHERE r.role_code = 'ADMIN'
  AND u.is_active = true
  AND NOT EXISTS (
      SELECT 1
      FROM mes.app_user_access_group uag
      WHERE uag.user_id = u.user_id
        AND uag.access_group_id = g.access_group_id
        AND uag.is_active = true
  );

-- ============================================================================
-- 9. AUTHORIZATION HELPER VIEWS
-- ============================================================================

CREATE OR REPLACE VIEW mes.vw_access_group_scope AS
SELECT
    g.access_group_id,
    g.group_code,
    g.group_name,
    g.group_type,
    g.allow_consolidated_view,
    g.is_active,
    COALESCE(
        string_agg(DISTINCT gc.company_code, ', ' ORDER BY gc.company_code),
        ''
    ) AS company_codes,
    COALESCE(
        string_agg(DISTINCT gp.plant_code, ', ' ORDER BY gp.plant_code),
        ''
    ) AS plant_codes
FROM mes.app_access_group g
LEFT JOIN mes.app_access_group_company gc
       ON gc.access_group_id = g.access_group_id
LEFT JOIN mes.app_access_group_plant gp
       ON gp.access_group_id = g.access_group_id
GROUP BY
    g.access_group_id,
    g.group_code,
    g.group_name,
    g.group_type,
    g.allow_consolidated_view,
    g.is_active;

CREATE OR REPLACE VIEW mes.vw_user_authorized_plants AS
SELECT DISTINCT
    u.user_id,
    u.username,
    u.display_name,
    p.company_code,
    c.short_name AS company_short_name,
    p.plant_code,
    p.plant_name
FROM mes.app_user u
JOIN mes.app_user_access_group uag
  ON uag.user_id = u.user_id
 AND uag.is_active = true
 AND current_date >= uag.valid_from
 AND (uag.valid_to IS NULL OR current_date <= uag.valid_to)
JOIN mes.app_access_group g
  ON g.access_group_id = uag.access_group_id
 AND g.is_active = true
JOIN mes.app_access_group_plant gp
  ON gp.access_group_id = g.access_group_id
JOIN mes.plant_master p
  ON p.plant_code = gp.plant_code
 AND p.is_active = true
JOIN mes.company_master c
  ON c.company_code = p.company_code
 AND c.is_active = true
WHERE u.is_active = true
  AND u.account_locked = false
  AND (u.valid_from IS NULL OR current_date >= u.valid_from)
  AND (u.valid_to IS NULL OR current_date <= u.valid_to);

CREATE OR REPLACE VIEW mes.vw_user_access_group_summary AS
SELECT
    u.user_id,
    u.username,
    u.display_name,
    u.employee_id,
    u.department,
    u.designation,
    u.is_active AS user_active,
    g.group_code,
    g.group_name,
    g.group_type,
    g.allow_consolidated_view,
    uag.valid_from,
    uag.valid_to,
    uag.is_active AS assignment_active,
    COALESCE(
        string_agg(DISTINCT gp.plant_code, ', ' ORDER BY gp.plant_code),
        ''
    ) AS plant_codes
FROM mes.app_user_access_group uag
JOIN mes.app_user u
  ON u.user_id = uag.user_id
JOIN mes.app_access_group g
  ON g.access_group_id = uag.access_group_id
LEFT JOIN mes.app_access_group_plant gp
  ON gp.access_group_id = g.access_group_id
GROUP BY
    u.user_id,
    u.username,
    u.display_name,
    u.employee_id,
    u.department,
    u.designation,
    u.is_active,
    g.group_code,
    g.group_name,
    g.group_type,
    g.allow_consolidated_view,
    uag.valid_from,
    uag.valid_to,
    uag.is_active;

-- ============================================================================
-- 10. AUTHORIZATION HELPER FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION mes.user_has_plant_access(
    p_user_id uuid,
    p_plant_code varchar
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM mes.vw_user_authorized_plants v
        WHERE v.user_id = p_user_id
          AND v.plant_code = p_plant_code
    );
$$;

CREATE OR REPLACE FUNCTION mes.user_can_view_consolidated(
    p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM mes.app_user_access_group uag
        JOIN mes.app_access_group g
          ON g.access_group_id = uag.access_group_id
        WHERE uag.user_id = p_user_id
          AND uag.is_active = true
          AND current_date >= uag.valid_from
          AND (uag.valid_to IS NULL OR current_date <= uag.valid_to)
          AND g.is_active = true
          AND g.allow_consolidated_view = true
    );
$$;

-- ============================================================================
-- 11. VERIFICATION
-- ============================================================================

COMMIT;

-- A. Access groups and scope.
SELECT
    group_code,
    group_name,
    group_type,
    company_codes,
    plant_codes,
    allow_consolidated_view,
    is_active
FROM mes.vw_access_group_scope
ORDER BY group_code;

-- Expected key rows:
-- RM_STORE_1000_TEAM -> company 1000 -> plant 1000 -> consolidated false
-- RM_STORE_2000_TEAM -> company 2000 -> plant 2000 -> consolidated false
-- RM_STORE_HEAD      -> companies 1000,2000 -> plants 1000,2000 -> true
-- SYSTEM_ADMIN       -> companies 1000,2000 -> plants 1000,2000 -> true

-- B. Existing users with current access-group assignment.
SELECT
    username,
    display_name,
    group_code,
    group_name,
    plant_codes,
    allow_consolidated_view,
    assignment_active
FROM mes.vw_user_access_group_summary
ORDER BY username, group_code;

-- C. Authorized plants for each user.
SELECT
    username,
    display_name,
    company_code,
    company_short_name,
    plant_code,
    plant_name
FROM mes.vw_user_authorized_plants
ORDER BY username, plant_code;
