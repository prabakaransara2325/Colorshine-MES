-- ============================================================================
-- COLORSHINE MES V2
-- 14_working_screens_repair.sql
--
-- Purpose
--   Idempotent repair/verification migration for the Working Screens feature.
--   Safe to run even if 13_user_working_screens.sql was already executed.
--
-- Prerequisite
--   11_module_screen_master.sql must already be applied.
-- ============================================================================

SET search_path TO mes, public;
BEGIN;

DO $$
BEGIN
  IF to_regclass('mes.app_screen') IS NULL THEN
    RAISE EXCEPTION 'mes.app_screen does not exist. Run 11_module_screen_master.sql first.';
  END IF;
END $$;

INSERT INTO mes.schema_version(version_no, description)
VALUES ('1.5.0','Working screens persistence repair and runtime readiness hardening')
ON CONFLICT (version_no) DO NOTHING;

CREATE TABLE IF NOT EXISTS mes.app_user_working_screen (
    working_screen_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES mes.app_user(user_id) ON DELETE CASCADE,
    screen_id          uuid NOT NULL REFERENCES mes.app_screen(screen_id) ON DELETE CASCADE,
    opened_at          timestamptz NOT NULL DEFAULT now(),
    last_active_at     timestamptz NOT NULL DEFAULT now(),
    sequence_no        integer NOT NULL DEFAULT 10,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_user_working_screen UNIQUE(user_id, screen_id)
);

CREATE INDEX IF NOT EXISTS ix_user_working_screen_user_order
    ON mes.app_user_working_screen(user_id, sequence_no, last_active_at DESC);

CREATE OR REPLACE FUNCTION mes.guard_max_working_screens()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_count integer;
BEGIN
    IF EXISTS (
        SELECT 1 FROM mes.app_user_working_screen
         WHERE user_id=NEW.user_id AND screen_id=NEW.screen_id
    ) THEN
        RETURN NEW;
    END IF;

    SELECT count(*) INTO v_count
      FROM mes.app_user_working_screen
     WHERE user_id=NEW.user_id;

    IF v_count >= 8 THEN
        RAISE EXCEPTION USING
            ERRCODE='P0001',
            MESSAGE='Maximum 8 working screens are already open. Please close an unused screen to continue.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_max_working_screens ON mes.app_user_working_screen;
CREATE TRIGGER trg_guard_max_working_screens
BEFORE INSERT ON mes.app_user_working_screen
FOR EACH ROW EXECUTE FUNCTION mes.guard_max_working_screens();

CREATE OR REPLACE FUNCTION mes.touch_working_screen_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_working_screen_row ON mes.app_user_working_screen;
CREATE TRIGGER trg_touch_working_screen_row
BEFORE UPDATE ON mes.app_user_working_screen
FOR EACH ROW EXECUTE FUNCTION mes.touch_working_screen_row();

CREATE OR REPLACE VIEW mes.vw_user_working_screens AS
SELECT
    ws.working_screen_id,
    ws.user_id,
    ws.screen_id,
    s.screen_code,
    COALESCE(s.screen_no,s.proposed_screen_no) AS screen_no,
    s.screen_name,
    s.screen_type,
    s.route_path,
    m.module_no,
    m.module_code,
    m.module_name,
    m.is_admin_module,
    ws.opened_at,
    ws.last_active_at,
    ws.sequence_no,
    s.screen_status,
    s.implementation_status,
    s.is_active AS screen_active,
    m.is_active AS module_active
FROM mes.app_user_working_screen ws
JOIN mes.app_screen s ON s.screen_id=ws.screen_id
JOIN mes.app_module m ON m.module_id=s.module_id;

COMMIT;

-- Verification: both must return non-null relation names.
SELECT
  to_regclass('mes.app_user_working_screen') AS working_screen_table,
  to_regclass('mes.vw_user_working_screens') AS working_screen_view;
