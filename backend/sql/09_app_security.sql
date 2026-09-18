SET search_path TO mes, public;

CREATE TABLE IF NOT EXISTS app_user (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(80) NOT NULL UNIQUE,
  display_name varchar(120) NOT NULL,
  email varchar(200),
  password_hash varchar(200) NOT NULL,
  plant_code varchar(4) REFERENCES plant_master(plant_code),
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_role (
  role_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_code varchar(40) NOT NULL UNIQUE,
  role_name varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_user_role (
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES app_role(role_id) ON DELETE CASCADE,
  PRIMARY KEY(user_id,role_id)
);

INSERT INTO app_role(role_code,role_name) VALUES
('ADMIN','System Administrator'),('QC','Raw Material Quality'),('STORE','Stores / GRN'),
('PPC','Production Planning & Control'),('QA','Quality Assurance / TDC'),
('MANAGEMENT','Management'),('VIEWER','Read Only')
ON CONFLICT(role_code) DO UPDATE SET role_name=EXCLUDED.role_name;

CREATE OR REPLACE FUNCTION mes.upper_app_username() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.username=upper(trim(NEW.username)); NEW.updated_at=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_upper_app_username ON mes.app_user;
CREATE TRIGGER trg_upper_app_username BEFORE INSERT OR UPDATE ON mes.app_user
FOR EACH ROW EXECUTE FUNCTION mes.upper_app_username();
