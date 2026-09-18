SET search_path TO mes, public;

-- ============================================================================
-- Colorshine MES V2 v0.9.8
-- User-wise report layouts (SAP ALV-style foundation)
-- Generic by screen_code so other reports can reuse the same storage.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mes.app_user_report_layout (
    layout_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES mes.app_user(user_id) ON DELETE CASCADE,
    screen_code    varchar(80) NOT NULL,
    layout_name    varchar(80) NOT NULL,
    is_default     boolean NOT NULL DEFAULT false,
    layout_config  jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_app_user_report_layout_name
    ON mes.app_user_report_layout(user_id, upper(screen_code), upper(layout_name));

CREATE INDEX IF NOT EXISTS ix_app_user_report_layout_user_screen
    ON mes.app_user_report_layout(user_id, upper(screen_code), is_default DESC, updated_at DESC);

-- A user can have at most one default layout per screen.
CREATE UNIQUE INDEX IF NOT EXISTS ux_app_user_report_layout_default
    ON mes.app_user_report_layout(user_id, upper(screen_code))
    WHERE is_default = true;

COMMENT ON TABLE mes.app_user_report_layout IS
'User-specific saved report layouts. Stores column order/visibility and screen display settings in JSONB. Comparable to an SAP ALV user layout and reusable for MES report screens.';

COMMENT ON COLUMN mes.app_user_report_layout.layout_config IS
'JSON configuration. v0.9.8 RM Inventory stores columnOrder, hiddenColumns and pageSize.';

SELECT to_regclass('mes.app_user_report_layout') AS report_layout_table;
