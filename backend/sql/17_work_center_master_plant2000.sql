-- ============================================================================
-- COLORSHINE MES V2
-- 17_work_center_master_plant2000.sql
--
-- Plant 2000 / CIPL work centers supplied by business.
-- IMPORTANT: display_sequence is NOT a product route.
-- Actual product/TDC/process routing will be maintained separately.
-- ============================================================================

SET search_path TO mes, public;
BEGIN;

CREATE TABLE IF NOT EXISTS mes.work_center_master (
    work_center_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_code           varchar(4) NOT NULL REFERENCES mes.plant_master(plant_code),
    work_center_code     varchar(20) NOT NULL,
    work_center_name     varchar(160) NOT NULL,
    process_area         varchar(80),
    display_sequence     integer,
    capacity_uom         varchar(10) NOT NULL DEFAULT 'MT',
    is_active            boolean NOT NULL DEFAULT true,
    source_system        varchar(20) NOT NULL DEFAULT 'MES',
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_work_center_plant_code UNIQUE (plant_code, work_center_code)
);

CREATE INDEX IF NOT EXISTS ix_work_center_plant_active
ON mes.work_center_master(plant_code, is_active, display_sequence);

INSERT INTO mes.work_center_master
(plant_code, work_center_code, work_center_name, process_area, display_sequence, capacity_uom, is_active, source_system)
VALUES
('2000','HRS01','HR Slitter Line','HR SLITTING',10,'MT',true,'MES'),
('2000','PPL01','Push Pull Pickling Line','PICKLING',20,'MT',true,'MES'),
('2000','CRM01','6Hi CR Mill','COLD ROLLING',30,'MT',true,'MES'),
('2000','CRS01','CR Rewinding & Trimming Line','CR REWINDING / TRIMMING',40,'MT',true,'MES'),
('2000','CGL01','Continuous Galvalume Line','GALVALUME COATING',50,'MT',true,'MES'),
('2000','PACK2','CIPL Packing Line','PACKING',60,'MT',true,'MES')
ON CONFLICT (plant_code, work_center_code) DO UPDATE
SET work_center_name = EXCLUDED.work_center_name,
    process_area = EXCLUDED.process_area,
    display_sequence = EXCLUDED.display_sequence,
    capacity_uom = EXCLUDED.capacity_uom,
    is_active = EXCLUDED.is_active,
    updated_at = now();

COMMIT;

SELECT
    plant_code,
    work_center_code,
    work_center_name,
    process_area,
    display_sequence,
    is_active
FROM mes.work_center_master
WHERE plant_code='2000'
ORDER BY display_sequence, work_center_code;
