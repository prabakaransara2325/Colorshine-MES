-- ============================================================================
-- COLORSHINE MES V2
-- 12_user_screen_favorites.sql
--
-- Purpose:
--   Per-user favorite screen shortcuts for the MES Overview dashboard.
--
-- Design:
--   Favorites reference app_screen.screen_id, NOT screen_no.
--   Therefore screen numbers may be changed later without losing favorites.
--
-- Prerequisite:
--   Run 11_module_screen_master.sql first.
-- ============================================================================

SET search_path TO mes, public;
BEGIN;

DO $$
BEGIN
    IF to_regclass('mes.app_screen') IS NULL THEN
        RAISE EXCEPTION 'mes.app_screen does not exist. Run 11_module_screen_master.sql before this migration.';
    END IF;
END $$;

INSERT INTO mes.schema_version(version_no, description)
VALUES ('1.4.0', 'Per-user screen favorites for dashboard quick access')
ON CONFLICT (version_no) DO NOTHING;

-- User Maintenance is already a working application route in v0.8.x.
-- Register it as a built screen so it can participate in favorites.
-- Screen numbering remains provisional until the approved screen register is loaded.
INSERT INTO mes.app_screen
(module_id,screen_code,screen_no,proposed_screen_no,screen_name,screen_type,description,route_path,phase,implementation_status,screen_status,direct_call_enabled,is_authorizable,sequence_no,is_active)
SELECT m.module_id,'ADM_USER_MAINTENANCE','9003','9003','User Maintenance','ADMIN',
       'Create and edit MES users and their access-group assignment.',
       '/admin/users/manage','Phase 1','BUILT','ACTIVE',true,true,125,true
FROM mes.app_module m
WHERE m.module_code='ADM'
  AND NOT EXISTS (SELECT 1 FROM mes.app_screen s WHERE s.screen_no='9003')
ON CONFLICT (screen_code) DO UPDATE SET
 module_id=EXCLUDED.module_id,
 screen_name=EXCLUDED.screen_name,
 screen_type=EXCLUDED.screen_type,
 description=EXCLUDED.description,
 route_path=EXCLUDED.route_path,
 phase=EXCLUDED.phase,
 implementation_status=EXCLUDED.implementation_status,
 screen_status=EXCLUDED.screen_status,
 direct_call_enabled=EXCLUDED.direct_call_enabled,
 is_authorizable=EXCLUDED.is_authorizable,
 sequence_no=EXCLUDED.sequence_no,
 is_active=EXCLUDED.is_active,
 updated_at=now();

CREATE TABLE IF NOT EXISTS mes.app_user_favorite_screen (
    favorite_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES mes.app_user(user_id) ON DELETE CASCADE,
    screen_id        uuid NOT NULL REFERENCES mes.app_screen(screen_id) ON DELETE CASCADE,
    sequence_no      integer NOT NULL DEFAULT 10,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_app_user_favorite_screen UNIQUE (user_id, screen_id),
    CONSTRAINT ck_app_user_favorite_sequence CHECK (sequence_no BETWEEN 1 AND 9999)
);

CREATE INDEX IF NOT EXISTS ix_app_user_favorite_screen_user
    ON mes.app_user_favorite_screen(user_id, sequence_no, created_at);

COMMENT ON TABLE mes.app_user_favorite_screen IS
'Per-user quick-access screen favorites shown on MES Overview. References screen_id so screen-number changes do not break favorites.';

CREATE OR REPLACE FUNCTION mes.touch_user_favorite_screen()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_user_favorite_screen ON mes.app_user_favorite_screen;
CREATE TRIGGER trg_touch_user_favorite_screen
BEFORE UPDATE ON mes.app_user_favorite_screen
FOR EACH ROW EXECUTE FUNCTION mes.touch_user_favorite_screen();

-- Protect the dashboard from becoming a wall of shortcuts.
-- The user can maintain a maximum of 8 favorite screens.
CREATE OR REPLACE FUNCTION mes.enforce_favorite_screen_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_count integer;
BEGIN
    IF TG_OP='INSERT' THEN
        SELECT count(*) INTO v_count
        FROM mes.app_user_favorite_screen
        WHERE user_id=NEW.user_id;

        IF v_count >= 8 THEN
            RAISE EXCEPTION 'A user can maintain a maximum of 8 favorite screens.'
                USING ERRCODE='P0001';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_favorite_screen_limit ON mes.app_user_favorite_screen;
CREATE TRIGGER trg_enforce_favorite_screen_limit
BEFORE INSERT ON mes.app_user_favorite_screen
FOR EACH ROW EXECUTE FUNCTION mes.enforce_favorite_screen_limit();

CREATE OR REPLACE VIEW mes.vw_user_favorite_screens AS
SELECT
    f.favorite_id,
    f.user_id,
    f.sequence_no,
    f.created_at,
    s.screen_id,
    s.screen_code,
    s.screen_no,
    s.proposed_screen_no,
    COALESCE(s.screen_no,s.proposed_screen_no) AS display_screen_no,
    s.screen_name,
    s.screen_type,
    s.route_path,
    s.implementation_status,
    s.screen_status,
    s.is_active AS screen_active,
    m.module_id,
    m.module_no,
    m.module_code,
    m.module_name,
    m.is_admin_module,
    m.is_active AS module_active
FROM mes.app_user_favorite_screen f
JOIN mes.app_screen s ON s.screen_id=f.screen_id
JOIN mes.app_module m ON m.module_id=s.module_id;

COMMIT;

-- Verification
SELECT version_no,description,applied_at
FROM mes.schema_version
WHERE version_no='1.4.0';

SELECT column_name,data_type
FROM information_schema.columns
WHERE table_schema='mes'
  AND table_name='app_user_favorite_screen'
ORDER BY ordinal_position;
