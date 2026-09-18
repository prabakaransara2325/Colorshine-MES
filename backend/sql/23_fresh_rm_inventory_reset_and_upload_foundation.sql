-- ============================================================================
-- COLORSHINE MES V2 v0.9.5
-- 23_fresh_rm_inventory_reset_and_upload_foundation.sql
--
-- Purpose
--   1. Remove the single pilot/test RM batch 26HW0466R0 from operational screens.
--   2. Clear the earlier inventory_master snapshot so the next upload starts clean.
--   3. Create a controlled one-time RM opening-inventory staging/posting framework.
--   4. Make GRN Monitor and Screen 1102 RM Inventory read the SAME canonical data.
--   5. Restrict RM Stores inventory to Plant 2000 R_HR* raw materials.
--
-- IMPORTANT
--   - This script DOES NOT load the new opening inventory yet.
--   - The fresh inventory file will be loaded into rm_opening_inventory_upload.
--   - Posting that upload inserts canonical GRN/batch/inventory records, therefore the
--     same coil appears automatically in GRN Monitor and RM Inventory.
-- ============================================================================

ROLLBACK;
SET search_path TO mes, public;
BEGIN;

-- --------------------------------------------------------------------------
-- A. Clean the previous snapshot/test inventory area.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_batch_id uuid;
    v_grn_id uuid;
BEGIN
    SELECT b.batch_id
      INTO v_batch_id
      FROM mes.batch_master b
     WHERE b.batch_no = '26HW0466R0'
     ORDER BY b.created_at DESC
     LIMIT 1;

    IF v_batch_id IS NOT NULL THEN
        -- Remove dependent operational data in FK-safe order.
        DELETE FROM mes.rm_usage_decision
         WHERE batch_id = v_batch_id;

        DELETE FROM mes.rm_quality_inspection
         WHERE batch_id = v_batch_id;
        -- rm_quality_result is ON DELETE CASCADE from rm_quality_inspection.

        DELETE FROM mes.rm_supplier_tc
         WHERE batch_id = v_batch_id;
        -- rm_supplier_tc_result is ON DELETE CASCADE from rm_supplier_tc.

        DELETE FROM mes.rm_inventory_movement
         WHERE batch_id = v_batch_id;

        DELETE FROM mes.rm_inventory_balance
         WHERE batch_id = v_batch_id;

        SELECT c.grn_id
          INTO v_grn_id
          FROM mes.goods_receipt_coil c
         WHERE c.batch_id = v_batch_id
         ORDER BY c.created_at DESC
         LIMIT 1;

        DELETE FROM mes.goods_receipt_coil
         WHERE batch_id = v_batch_id;

        IF v_grn_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM mes.goods_receipt_coil WHERE grn_id = v_grn_id) THEN
            DELETE FROM mes.goods_receipt WHERE grn_id = v_grn_id;
        END IF;

        DELETE FROM mes.batch_master
         WHERE batch_id = v_batch_id;
    END IF;
END $$;

-- Remove the earlier spreadsheet/opening snapshot. WIP/FG can be reloaded later
-- into Reports -> Plant Stock Report, but RM Stores no longer depends on this table.
DELETE FROM mes.inventory_master;

-- --------------------------------------------------------------------------
-- B. Upload-run control table.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.rm_opening_inventory_upload_run (
    upload_run_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_name         varchar(150) NOT NULL,
    plant_code          varchar(4) NOT NULL REFERENCES mes.plant_master(plant_code),
    source_file_name    varchar(255),
    upload_status       varchar(20) NOT NULL DEFAULT 'DRAFT',
    total_rows          integer NOT NULL DEFAULT 0,
    ready_rows          integer NOT NULL DEFAULT 0,
    error_rows          integer NOT NULL DEFAULT 0,
    posted_rows         integer NOT NULL DEFAULT 0,
    uploaded_by         varchar(80) NOT NULL DEFAULT 'ADMIN',
    uploaded_at         timestamptz NOT NULL DEFAULT now(),
    validated_at        timestamptz,
    posted_at           timestamptz,
    notes               text,
    CONSTRAINT ck_rm_opening_upload_status CHECK
      (upload_status IN ('DRAFT','VALIDATED','POSTING','POSTED','FAILED'))
);

-- --------------------------------------------------------------------------
-- C. One row per CURRENT RM coil to be migrated into MES.
--    Only the actual current stock file should be inserted here.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.rm_opening_inventory_upload (
    upload_row_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_run_id       uuid NOT NULL REFERENCES mes.rm_opening_inventory_upload_run(upload_run_id) ON DELETE CASCADE,
    source_row_no       integer NOT NULL,

    plant_code          varchar(4) NOT NULL,
    material_code       varchar(40) NOT NULL,
    material_description varchar(200),
    batch_no            varchar(40) NOT NULL,
    batch_qty_mt        numeric(14,4) NOT NULL,
    storage_location    varchar(4) NOT NULL,
    thickness_mm        numeric(12,4),
    width_mm            numeric(12,3),

    rm_source           varchar(40),
    supplier_name       varchar(200),
    supplier_batch      varchar(100),

    sap_grn_no          varchar(20) NOT NULL,
    grn_date            date,
    sap_po_no           varchar(20),
    sap_po_item         varchar(10),
    po_delivery_date    date,
    movement_type       varchar(4) DEFAULT '101',

    product_group       varchar(40),
    product_type        varchar(40) DEFAULT 'COIL',
    eq_spec             varchar(100),
    eq_spec_group       varchar(60),
    eq_sub_spec         varchar(60),
    chapter_id          varchar(40),
    chapter_type        varchar(20),
    crown               numeric(12,4),

    -- Optional values from current inventory file; RM_QA staging can enrich them.
    heat_no             varchar(100),
    steel_grade         varchar(60),
    qa_grade            varchar(60),

    validation_status   varchar(20) NOT NULL DEFAULT 'PENDING',
    validation_notes    text,
    process_status      varchar(20) NOT NULL DEFAULT 'PENDING',
    processed_at        timestamptz,
    linked_batch_id     uuid,
    linked_grn_coil_id  uuid,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_rm_opening_qty CHECK (batch_qty_mt > 0),
    CONSTRAINT ck_rm_opening_validation CHECK (validation_status IN ('PENDING','READY','ERROR')),
    CONSTRAINT ck_rm_opening_process CHECK (process_status IN ('PENDING','POSTED','ERROR')),
    UNIQUE (upload_run_id, plant_code, batch_no)
);

CREATE INDEX IF NOT EXISTS ix_rm_opening_upload_run_status
  ON mes.rm_opening_inventory_upload(upload_run_id, validation_status, process_status);
CREATE INDEX IF NOT EXISTS ix_rm_opening_upload_batch
  ON mes.rm_opening_inventory_upload(plant_code, batch_no);

-- --------------------------------------------------------------------------
-- D. RM_QA reference staging.
--    The companion SQL 24 loads the historical RM_QA XML here. It is reference
--    data only; it does NOT create stock. During the fresh current inventory post,
--    only matching current batches are applied to live supplier-TC/QA records.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes.rm_qa_reference_stage (
    plant_code          varchar(4) NOT NULL,
    batch_no            varchar(40) NOT NULL,
    batch_thick         numeric(12,4),
    batch_width         numeric(12,3),
    batch_weight        numeric(14,4),
    heat_no             varchar(100),
    hr_grade            varchar(60),
    quality_level       varchar(60),
    sent_date           date,
    chem_treatment      varchar(100),
    surface_condition   varchar(120),
    batch_length        numeric(16,3),
    supplier_tc_no      varchar(100),
    gsm_coating         numeric(14,3),
    remark              text,
    carbon_pct          numeric(18,6),
    carbon_eq           numeric(18,6),
    manganese_pct       numeric(18,6),
    phosphorus_pct      numeric(18,6),
    sulphur_pct         numeric(18,6),
    silicon_pct         numeric(18,6),
    aluminium_pct       numeric(18,6),
    nitrogen_pct        numeric(18,6),
    nitrogen_ppm        numeric(18,6),
    boron_pct           numeric(18,6),
    copper_pct          numeric(18,6),
    chromium_pct        numeric(18,6),
    nickel_pct          numeric(18,6),
    tin_pct             numeric(18,6),
    ympa                numeric(18,6),
    tmpa                numeric(18,6),
    el_pct              numeric(18,6),
    el_gl_type          varchar(80),
    hardness            numeric(18,6),
    uts                 numeric(18,6),
    ys                  numeric(18,6),
    inner_dia           numeric(12,3),
    outer_dia           numeric(12,3),
    vendor_grade        varchar(60),
    source_file         varchar(120) NOT NULL DEFAULT 'RM_QA.xml',
    loaded_at           timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (plant_code, batch_no)
);

-- --------------------------------------------------------------------------
-- E. Validation view for the fresh opening inventory.
--    A row is READY only when it is a Plant 2000 R_HR material and all required
--    masters are resolvable. Existing live batches are rejected to prevent doubles.
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW mes.vw_rm_opening_inventory_upload_validation AS
SELECT
    u.*,
    m.material_id AS resolved_material_id,
    sl.storage_location AS resolved_storage_location,
    sup.supplier_id AS resolved_supplier_id,
    q.batch_no AS qa_batch_match,
    q.heat_no AS qa_heat_no,
    q.hr_grade AS qa_steel_grade,
    q.quality_level AS qa_grade_from_source,
    CASE
      WHEN u.plant_code <> '2000' THEN 'ERROR'
      WHEN u.material_code NOT LIKE 'R_HR%' THEN 'ERROR'
      WHEN m.material_id IS NULL THEN 'ERROR'
      WHEN sl.storage_location IS NULL THEN 'ERROR'
      WHEN NULLIF(BTRIM(u.batch_no),'') IS NULL THEN 'ERROR'
      WHEN u.batch_qty_mt <= 0 THEN 'ERROR'
      WHEN NULLIF(BTRIM(u.sap_grn_no),'') IS NULL THEN 'ERROR'
      WHEN EXISTS (
          SELECT 1
          FROM mes.batch_master bx
          JOIN mes.material_master mx ON mx.material_id=bx.material_id
          WHERE bx.batch_no=u.batch_no AND mx.sap_material_code=u.material_code
      ) THEN 'ERROR'
      ELSE 'READY'
    END AS derived_validation_status,
    concat_ws('; ',
      CASE WHEN u.plant_code <> '2000' THEN 'Only Plant 2000 is allowed for this opening RM upload' END,
      CASE WHEN u.material_code NOT LIKE 'R_HR%' THEN 'Only R_HR* materials are allowed' END,
      CASE WHEN m.material_id IS NULL THEN 'Material not found in Material Master' END,
      CASE WHEN sl.storage_location IS NULL THEN 'Storage Location not found for Plant' END,
      CASE WHEN NULLIF(BTRIM(u.sap_grn_no),'') IS NULL THEN 'GRN is required so the batch can appear in GRN Monitor' END,
      CASE WHEN EXISTS (
          SELECT 1
          FROM mes.batch_master bx
          JOIN mes.material_master mx ON mx.material_id=bx.material_id
          WHERE bx.batch_no=u.batch_no AND mx.sap_material_code=u.material_code
      ) THEN 'Batch already exists in live MES; duplicate stock blocked' END,
      CASE WHEN q.batch_no IS NULL THEN 'RM_QA match not found; stock will remain QUALITY_HOLD until QA is available' END,
      CASE WHEN sup.supplier_id IS NULL AND (NULLIF(BTRIM(u.rm_source),'') IS NOT NULL OR NULLIF(BTRIM(u.supplier_name),'') IS NOT NULL)
           THEN 'Supplier master not resolved; GRN can still load with blank supplier link' END
    ) AS derived_validation_notes
FROM mes.rm_opening_inventory_upload u
LEFT JOIN mes.material_master m
  ON m.sap_material_code=u.material_code
LEFT JOIN mes.storage_location_master sl
  ON sl.plant_code=u.plant_code AND sl.storage_location=u.storage_location
LEFT JOIN LATERAL (
    SELECT s.supplier_id
    FROM mes.supplier_master s
    WHERE (NULLIF(BTRIM(u.rm_source),'') IS NOT NULL AND s.sap_vendor_no=u.rm_source)
       OR (NULLIF(BTRIM(u.supplier_name),'') IS NOT NULL AND UPPER(BTRIM(s.supplier_name))=UPPER(BTRIM(u.supplier_name)))
    ORDER BY CASE WHEN s.sap_vendor_no=u.rm_source THEN 1 ELSE 2 END
    LIMIT 1
) sup ON true
LEFT JOIN mes.rm_qa_reference_stage q
  ON q.plant_code=u.plant_code AND q.batch_no=u.batch_no;

-- --------------------------------------------------------------------------
-- F. Validation helper.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mes.validate_rm_opening_inventory_run(p_upload_run_id uuid)
RETURNS TABLE(total_rows integer, ready_rows integer, error_rows integer)
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE mes.rm_opening_inventory_upload u
       SET validation_status = v.derived_validation_status,
           validation_notes = NULLIF(v.derived_validation_notes,''),
           updated_at = now()
      FROM mes.vw_rm_opening_inventory_upload_validation v
     WHERE u.upload_row_id=v.upload_row_id
       AND u.upload_run_id=p_upload_run_id;

    UPDATE mes.rm_opening_inventory_upload_run r
       SET total_rows = x.total_rows,
           ready_rows = x.ready_rows,
           error_rows = x.error_rows,
           upload_status = CASE WHEN x.error_rows=0 AND x.total_rows>0 THEN 'VALIDATED' ELSE 'DRAFT' END,
           validated_at = now()
      FROM (
        SELECT count(*)::int AS total_rows,
               count(*) FILTER (WHERE validation_status='READY')::int AS ready_rows,
               count(*) FILTER (WHERE validation_status='ERROR')::int AS error_rows
          FROM mes.rm_opening_inventory_upload
         WHERE upload_run_id=p_upload_run_id
      ) x
     WHERE r.upload_run_id=p_upload_run_id;

    RETURN QUERY
    SELECT r.total_rows,r.ready_rows,r.error_rows
      FROM mes.rm_opening_inventory_upload_run r
     WHERE r.upload_run_id=p_upload_run_id;
END;
$$;

-- --------------------------------------------------------------------------
-- G. Canonical post function.
--    This is the important part: posting creates real goods_receipt + coil + batch
--    records. The existing GRN trigger creates rm_inventory_balance automatically.
--    Therefore GRN Monitor and RM Inventory remain synchronized by design.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mes.post_rm_opening_inventory_run(p_upload_run_id uuid, p_posted_by varchar DEFAULT 'OPENING_MIGRATION')
RETURNS TABLE(posted_rows integer, held_rows integer, available_rows integer, blocked_rows integer)
LANGUAGE plpgsql
AS $$
DECLARE
    r record;
    q record;
    v_material_id uuid;
    v_supplier_id uuid;
    v_batch_id uuid;
    v_grn_id uuid;
    v_grn_coil_id uuid;
    v_tc_id uuid;
    v_doc_year varchar(4);
    v_quality varchar(60);
    v_count integer := 0;
    v_hold integer := 0;
    v_avail integer := 0;
    v_block integer := 0;
BEGIN
    PERFORM mes.validate_rm_opening_inventory_run(p_upload_run_id);

    IF NOT EXISTS (
        SELECT 1 FROM mes.rm_opening_inventory_upload_run
         WHERE upload_run_id=p_upload_run_id
           AND upload_status='VALIDATED'
           AND error_rows=0
           AND total_rows>0
    ) THEN
        RAISE EXCEPTION 'Opening inventory run % is not fully validated. Correct ERROR rows before posting.', p_upload_run_id;
    END IF;

    UPDATE mes.rm_opening_inventory_upload_run
       SET upload_status='POSTING'
     WHERE upload_run_id=p_upload_run_id;

    FOR r IN
        SELECT v.*
          FROM mes.vw_rm_opening_inventory_upload_validation v
         WHERE v.upload_run_id=p_upload_run_id
           AND v.derived_validation_status='READY'
         ORDER BY v.source_row_no
    LOOP
        v_material_id := r.resolved_material_id;
        v_supplier_id := r.resolved_supplier_id;
        v_doc_year := EXTRACT(YEAR FROM COALESCE(r.grn_date, CURRENT_DATE))::int::text;

        INSERT INTO mes.goods_receipt (
            plant_code,sap_grn_no,sap_material_doc_year,posting_date,document_date,received_at,status
        ) VALUES (
            r.plant_code,r.sap_grn_no,v_doc_year,r.grn_date,r.grn_date,COALESCE(r.grn_date,CURRENT_DATE)::timestamptz,'POSTED'
        )
        ON CONFLICT (plant_code,sap_grn_no,sap_material_doc_year)
        DO UPDATE SET
            posting_date=COALESCE(mes.goods_receipt.posting_date,EXCLUDED.posting_date),
            document_date=COALESCE(mes.goods_receipt.document_date,EXCLUDED.document_date),
            status='POSTED',updated_at=now()
        RETURNING grn_id INTO v_grn_id;

        INSERT INTO mes.batch_master (
            batch_no,material_id,mother_lot_no,stage_letter,sequence_no,batch_origin,
            original_weight_mt,quality_status,lifecycle_status
        ) VALUES (
            r.batch_no,v_material_id,r.batch_no,'R',0,'GRN',r.batch_qty_mt,'PENDING_UD','ACTIVE'
        )
        RETURNING batch_id INTO v_batch_id;

        INSERT INTO mes.goods_receipt_coil (
            grn_id,sap_item_no,source_row_key,plant_code,storage_location,material_id,batch_id,supplier_id,
            batch_no,vendor_batch_no,sap_po_no,sap_po_item,movement_type,rm_source,
            batch_thickness_mm,batch_width_mm,batch_weight_mt,batch_length_m,
            product_group,product_type,equivalent_spec,eq_spec_group,eq_sub_spec,chapter_id,chapter_type,crown,
            po_delivery_date,source_created_by,source_created_at
        ) VALUES (
            v_grn_id,r.sap_po_item,'OPENING:'||p_upload_run_id::text||':'||r.source_row_no::text,
            r.plant_code,r.storage_location,v_material_id,v_batch_id,v_supplier_id,
            r.batch_no,r.supplier_batch,r.sap_po_no,r.sap_po_item,COALESCE(NULLIF(r.movement_type,''),'101'),r.rm_source,
            r.thickness_mm,r.width_mm,r.batch_qty_mt,NULL,
            r.product_group,COALESCE(NULLIF(r.product_type,''),'COIL'),r.eq_spec,r.eq_spec_group,r.eq_sub_spec,
            r.chapter_id,r.chapter_type,r.crown,r.po_delivery_date,p_posted_by,now()
        )
        RETURNING grn_coil_id INTO v_grn_coil_id;
        -- trg_create_rm_inventory_from_grn creates QUALITY_HOLD balance/movement here.

        SELECT * INTO q
          FROM mes.rm_qa_reference_stage
         WHERE plant_code=r.plant_code AND batch_no=r.batch_no;

        v_quality := UPPER(COALESCE(NULLIF(BTRIM(r.qa_grade),''), NULLIF(BTRIM(q.quality_level),''), 'PENDING_QA'));

        -- Create/update RM supplier TC header from QA staging and/or explicit upload fields.
        SELECT supplier_tc_id INTO v_tc_id
          FROM mes.rm_supplier_tc
         WHERE plant_code=r.plant_code AND batch_no=r.batch_no
         LIMIT 1;

        IF v_tc_id IS NULL THEN
            INSERT INTO mes.rm_supplier_tc (
                batch_id,plant_code,material_id,supplier_id,batch_no,supplier_tc_no,heat_no,hr_grade,vendor_grade,
                quality_level,chemical_treatment,surface_condition,elongation_gl_type,inner_dia_mm,outer_dia_mm,
                gsm_coating,batch_length_m,sent_at,remarks,source_created_by,source_created_at
            ) VALUES (
                v_batch_id,r.plant_code,v_material_id,v_supplier_id,r.batch_no,
                q.supplier_tc_no,COALESCE(NULLIF(r.heat_no,''),q.heat_no),
                COALESCE(NULLIF(r.steel_grade,''),q.hr_grade),q.vendor_grade,v_quality,
                q.chem_treatment,q.surface_condition,q.el_gl_type,q.inner_dia,q.outer_dia,q.gsm_coating,q.batch_length,
                q.sent_date::timestamptz,q.remark,p_posted_by,now()
            ) RETURNING supplier_tc_id INTO v_tc_id;
        ELSE
            UPDATE mes.rm_supplier_tc SET
                batch_id=v_batch_id,material_id=v_material_id,supplier_id=v_supplier_id,
                supplier_tc_no=COALESCE(q.supplier_tc_no,supplier_tc_no),
                heat_no=COALESCE(NULLIF(r.heat_no,''),q.heat_no,heat_no),
                hr_grade=COALESCE(NULLIF(r.steel_grade,''),q.hr_grade,hr_grade),
                vendor_grade=COALESCE(q.vendor_grade,vendor_grade),
                quality_level=v_quality,
                chemical_treatment=COALESCE(q.chem_treatment,chemical_treatment),
                surface_condition=COALESCE(q.surface_condition,surface_condition),
                elongation_gl_type=COALESCE(q.el_gl_type,elongation_gl_type),
                inner_dia_mm=COALESCE(q.inner_dia,inner_dia_mm),
                outer_dia_mm=COALESCE(q.outer_dia,outer_dia_mm),
                gsm_coating=COALESCE(q.gsm_coating,gsm_coating),
                batch_length_m=COALESCE(q.batch_length,batch_length_m),
                sent_at=COALESCE(q.sent_date::timestamptz,sent_at),
                remarks=COALESCE(q.remark,remarks),
                updated_at=now()
             WHERE supplier_tc_id=v_tc_id;
        END IF;

        -- Normalize QA numeric parameters for detailed analysis screens/downloads.
        IF q.batch_no IS NOT NULL THEN
            INSERT INTO mes.rm_supplier_tc_result (
                supplier_tc_id,parameter_id,numeric_value,uom,source_field_name,source_raw_value
            )
            SELECT v_tc_id,p.parameter_id,x.val,x.uom,x.code,
                   CASE WHEN x.val IS NULL THEN NULL ELSE x.val::text END
              FROM (VALUES
                ('CARBON_PCT',q.carbon_pct,'%'),
                ('CARBON_EQ',q.carbon_eq,'%'),
                ('MANGANESE_PCT',q.manganese_pct,'%'),
                ('PHOSPHORUS_PCT',q.phosphorus_pct,'%'),
                ('SULPHUR_PCT',q.sulphur_pct,'%'),
                ('SILICON_PCT',q.silicon_pct,'%'),
                ('ALUMINIUM_PCT',q.aluminium_pct,'%'),
                ('NITROGEN_PCT',q.nitrogen_pct,'%'),
                ('NITROGEN_PPM',q.nitrogen_ppm,'PPM'),
                ('BORON_PCT',q.boron_pct,'%'),
                ('COPPER_PCT',q.copper_pct,'%'),
                ('CHROMIUM_PCT',q.chromium_pct,'%'),
                ('NICKEL_PCT',q.nickel_pct,'%'),
                ('TIN_PCT',q.tin_pct,'%'),
                ('YMPA',q.ympa,'MPa'),
                ('TMPA',q.tmpa,'MPa'),
                ('EL_PCT',q.el_pct,'%'),
                ('HARDNESS',q.hardness,'HRB'),
                ('UTS',q.uts,'MPa'),
                ('YS',q.ys,'MPa'),
                ('INNER_DIA',q.inner_dia,'mm'),
                ('OUTER_DIA',q.outer_dia,'mm')
              ) AS x(code,val,uom)
              JOIN mes.quality_parameter_master p ON p.parameter_code=x.code
             WHERE x.val IS NOT NULL
            ON CONFLICT (supplier_tc_id,parameter_id,source_field_name)
            DO UPDATE SET numeric_value=EXCLUDED.numeric_value,uom=EXCLUDED.uom,source_raw_value=EXCLUDED.source_raw_value;
        END IF;

        -- Opening-stock migration maps source QA to the correct inventory bucket.
        IF v_quality = 'PRIME' THEN
            UPDATE mes.rm_inventory_balance
               SET available_weight_mt=on_hand_weight_mt,
                   quality_hold_weight_mt=0,
                   blocked_weight_mt=0,
                   stock_status='AVAILABLE',
                   last_movement_at=now(),updated_at=now()
             WHERE batch_id=v_batch_id AND plant_code=r.plant_code AND storage_location=r.storage_location;

            UPDATE mes.batch_master SET quality_status='ACCEPTED',updated_at=now() WHERE batch_id=v_batch_id;

            INSERT INTO mes.rm_inventory_movement (
                batch_id,movement_type,quantity_mt,from_plant_code,from_storage_location,from_bucket,
                to_plant_code,to_storage_location,to_bucket,reference_type,reference_id,reference_no,remarks,posted_by
            ) VALUES (
                v_batch_id,'ADJUSTMENT',r.batch_qty_mt,r.plant_code,r.storage_location,'QUALITY_HOLD',
                r.plant_code,r.storage_location,'AVAILABLE','OPENING_QA_MIGRATION',r.upload_row_id,r.batch_no,
                'Opening stock QA grade PRIME migrated as available stock',p_posted_by
            );
            v_avail := v_avail + 1;

        ELSIF v_quality IN ('REJECT','REJECTED') THEN
            UPDATE mes.rm_inventory_balance
               SET available_weight_mt=0,
                   quality_hold_weight_mt=0,
                   blocked_weight_mt=on_hand_weight_mt,
                   stock_status='BLOCKED',
                   last_movement_at=now(),updated_at=now()
             WHERE batch_id=v_batch_id AND plant_code=r.plant_code AND storage_location=r.storage_location;

            UPDATE mes.batch_master SET quality_status='REJECTED',updated_at=now() WHERE batch_id=v_batch_id;

            INSERT INTO mes.rm_inventory_movement (
                batch_id,movement_type,quantity_mt,from_plant_code,from_storage_location,from_bucket,
                to_plant_code,to_storage_location,to_bucket,reference_type,reference_id,reference_no,remarks,posted_by
            ) VALUES (
                v_batch_id,'ADJUSTMENT',r.batch_qty_mt,r.plant_code,r.storage_location,'QUALITY_HOLD',
                r.plant_code,r.storage_location,'BLOCKED','OPENING_QA_MIGRATION',r.upload_row_id,r.batch_no,
                'Opening stock QA grade REJECT migrated as blocked stock',p_posted_by
            );
            v_block := v_block + 1;
        ELSE
            v_hold := v_hold + 1;
        END IF;

        UPDATE mes.rm_opening_inventory_upload
           SET process_status='POSTED',processed_at=now(),linked_batch_id=v_batch_id,
               linked_grn_coil_id=v_grn_coil_id,updated_at=now()
         WHERE upload_row_id=r.upload_row_id;

        v_count := v_count + 1;
    END LOOP;

    UPDATE mes.rm_opening_inventory_upload_run
       SET upload_status='POSTED',posted_rows=v_count,posted_at=now()
     WHERE upload_run_id=p_upload_run_id;

    RETURN QUERY SELECT v_count,v_hold,v_avail,v_block;
EXCEPTION WHEN OTHERS THEN
    UPDATE mes.rm_opening_inventory_upload_run
       SET upload_status='FAILED',notes=SQLERRM
     WHERE upload_run_id=p_upload_run_id;
    RAISE;
END;
$$;

-- --------------------------------------------------------------------------
-- H. Unified Screen 1102 source = canonical live RM inventory only.
-- Existing dependent views are dropped first because v0.9.5 intentionally
-- removes the old snapshot/SO columns from the RM Stores source.
-- --------------------------------------------------------------------------
DROP VIEW IF EXISTS mes.vw_plant_stock_report;
DROP VIEW IF EXISTS mes.vw_rm_store_inventory;

--    No inventory_master union, no WIP/FG, no SO fields.
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW mes.vw_rm_store_inventory AS
SELECT
    ('LIVE:'||ib.inventory_balance_id::text) AS row_id,
    'LIVE_MES'::varchar(30) AS source_system,
    NULL::integer AS source_row_no,
    'CANONICAL_RM'::varchar(120) AS source_file,
    COALESCE(m.material_type,'HR')::varchar(20) AS material_type,
    'RM'::varchar(10) AS stock_stage,
    ib.plant_code,
    ib.storage_location,
    m.sap_material_code AS material_code,
    m.material_description,
    COALESCE(c.product_group,m.product_group) AS product_group,
    COALESCE(c.product_type,m.product_type,'COIL') AS product_type,
    b.batch_no,
    ib.on_hand_weight_mt::numeric(14,4) AS batch_qty_mt,
    COALESCE(NULLIF(tc.quality_level,''),
             CASE b.quality_status WHEN 'ACCEPTED' THEN 'PRIME' WHEN 'REJECTED' THEN 'REJECT' ELSE 'PENDING_QA' END) AS qa_grade,
    ib.stock_status,
    c.batch_thickness_mm::numeric(12,4) AS thickness_mm,
    c.batch_width_mm::numeric(12,3) AS width_mm,
    tc.batch_length_m AS length_value,
    NULL::varchar(40) AS temper,
    NULL::varchar(40) AS coating,
    NULL::varchar(80) AS jet_printing,
    g.posting_date AS stock_generated_date,
    CASE WHEN g.posting_date IS NULL THEN NULL ELSE CURRENT_DATE-g.posting_date END AS stock_age_days,
    c.rm_source,
    g.sap_grn_no,
    c.sap_po_no,
    c.sap_po_item,
    c.po_delivery_date,
    c.movement_type,
    c.equivalent_spec AS eq_spec,
    c.eq_spec_group,
    c.eq_sub_spec,
    c.chapter_id,
    c.chapter_type,
    c.crown,
    b.batch_no AS mother_rm_batch,
    c.vendor_batch_no AS supplier_batch,
    tc.heat_no,
    g.posting_date AS mother_stock_grn_date,
    CASE WHEN g.posting_date IS NULL THEN NULL ELSE CURRENT_DATE-g.posting_date END AS mother_stock_grn_age_days,
    tc.hr_grade AS rm_steel_grade,
    qa.carbon,qa.manganese,qa.sulphur,qa.phosphorus,qa.silicon,qa.aluminium,
    qa.carbon_equivalent,qa.nitrogen,qa.copper,NULL::text AS molybdenum,qa.chromium,qa.nickel,
    s.supplier_name AS rm_supplier,
    b.created_at AS imported_at,
    GREATEST(ib.updated_at,b.updated_at,COALESCE(tc.updated_at,'1900-01-01'::timestamptz)) AS updated_at
FROM mes.rm_inventory_balance ib
JOIN mes.batch_master b ON b.batch_id=ib.batch_id
JOIN mes.material_master m ON m.material_id=b.material_id
LEFT JOIN mes.goods_receipt_coil c ON c.batch_id=b.batch_id AND c.plant_code=ib.plant_code
LEFT JOIN mes.goods_receipt g ON g.grn_id=c.grn_id
LEFT JOIN mes.supplier_master s ON s.supplier_id=c.supplier_id
LEFT JOIN mes.rm_supplier_tc tc ON tc.batch_id=b.batch_id
LEFT JOIN LATERAL (
    SELECT
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='CARBON_PCT'))::text AS carbon,
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='MANGANESE_PCT'))::text AS manganese,
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='SULPHUR_PCT'))::text AS sulphur,
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='PHOSPHORUS_PCT'))::text AS phosphorus,
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='SILICON_PCT'))::text AS silicon,
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='ALUMINIUM_PCT'))::text AS aluminium,
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='CARBON_EQ'))::text AS carbon_equivalent,
      COALESCE(
        (max(r.numeric_value) FILTER (WHERE p.parameter_code='NITROGEN_PPM'))::text,
        (max(r.numeric_value) FILTER (WHERE p.parameter_code='NITROGEN_PCT'))::text
      ) AS nitrogen,
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='COPPER_PCT'))::text AS copper,
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='CHROMIUM_PCT'))::text AS chromium,
      (max(r.numeric_value) FILTER (WHERE p.parameter_code='NICKEL_PCT'))::text AS nickel
    FROM mes.rm_supplier_tc_result r
    JOIN mes.quality_parameter_master p ON p.parameter_id=r.parameter_id
    WHERE r.supplier_tc_id=tc.supplier_tc_id
) qa ON true
WHERE m.sap_material_code LIKE 'R_HR%';

-- Plant Stock Report remains the complete reporting source. RM comes from the
-- canonical RM view; WIP/FG remain in inventory_master when those are reloaded.
CREATE OR REPLACE VIEW mes.vw_plant_stock_report AS
SELECT
  row_id AS inventory_id,source_row_no,source_file,material_type,stock_stage,plant_code,storage_location,
  material_code,batch_no,batch_qty_mt,qa_grade,thickness_mm,width_mm,length_value,
  temper,coating,jet_printing,stock_generated_date,stock_age_days,
  NULL::varchar(40) AS mes_po,NULL::varchar(20) AS so_no,NULL::varchar(10) AS so_line_item,
  NULL::numeric(10,4) AS so_thickness_mm,NULL::numeric(12,3) AS so_width_mm,NULL::varchar(40) AS so_temper,
  NULL::varchar(40) AS so_quality,NULL::varchar(40) AS so_coating,NULL::numeric(14,4) AS so_min_wt_mt,
  NULL::numeric(14,4) AS so_max_wt_mt,NULL::varchar(100) AS so_logo,NULL::varchar(100) AS so_spangle,
  NULL::varchar(100) AS so_jet_printing,NULL::varchar(100) AS so_tll,
  mother_rm_batch,supplier_batch,heat_no,mother_stock_grn_date,mother_stock_grn_age_days,
  rm_steel_grade,carbon,manganese,sulphur,phosphorus,silicon,aluminium,carbon_equivalent,
  nitrogen,copper,molybdenum,chromium,nickel,rm_supplier,imported_at,updated_at
FROM mes.vw_rm_store_inventory
UNION ALL
SELECT
  inventory_id::text,source_row_no,source_file,material_type,stock_stage,plant_code,storage_location,
  material_code,batch_no,batch_qty_mt,qa_grade,thickness_mm,width_mm,length_value,
  temper,coating,jet_printing,stock_generated_date,stock_age_days,
  mes_po,so_no,so_line_item,so_thickness_mm,so_width_mm,so_temper,so_quality,
  so_coating,so_min_wt_mt,so_max_wt_mt,so_logo,so_spangle,so_jet_printing,so_tll,
  mother_rm_batch,supplier_batch,heat_no,mother_stock_grn_date,mother_stock_grn_age_days,
  rm_steel_grade,carbon,manganese,sulphur,phosphorus,silicon,aluminium,carbon_equivalent,
  nitrogen,copper,molybdenum,chromium,nickel,rm_supplier,imported_at,updated_at
FROM mes.inventory_master
WHERE UPPER(COALESCE(stock_stage,'')) IN ('WIP','FG');

COMMIT;

-- --------------------------------------------------------------------------
-- Verification: after this reset and BEFORE the fresh inventory upload,
-- both GRN Monitor and Screen 1102 should have zero rows in the current test DB.
-- --------------------------------------------------------------------------
SELECT count(*) AS current_rm_inventory_rows
FROM mes.vw_rm_store_inventory;

SELECT count(*) AS current_grn_monitor_rows
FROM mes.vw_grn_ud_queue;

SELECT count(*) AS old_snapshot_rows
FROM mes.inventory_master;
