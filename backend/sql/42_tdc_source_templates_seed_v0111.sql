-- ============================================================================
-- COLORSHINE MES V2 v0.11.1
-- SOURCE TDC TEMPLATE DEFAULTS + INITIAL APPROVED TDC IMPORT
-- Scope: Company 2000 / Plant 2000 only.
--
-- This migration:
--   1) Keeps the three system-created category templates (BGL/GL, CRFH, HRPO).
--   2) Loads source-format default specifications into those templates.
--   3) Imports three existing approved source TDCs as immutable V01 records.
--   4) Preserves Number Object baselines; no system number is consumed.
--   5) Does not delete or overwrite user-created TDCs.
-- ============================================================================
SET search_path TO mes, public;
BEGIN;

-- v0.11.1 adds the Colorshine controlled document number separately from
-- Customer Reference so source TDC headers are represented correctly.
ALTER TABLE mes.tdc_master ADD COLUMN IF NOT EXISTS document_no varchar(120);
ALTER TABLE mes.tdc_version ADD COLUMN IF NOT EXISTS document_no varchar(120);

-- --------------------------------------------------------------------------
-- 1. Ensure template names/status remain clear and active.
-- --------------------------------------------------------------------------
UPDATE mes.tdc_template_header
SET template_name = CASE template_code
    WHEN 'SYS_BGL_GL_2000_V1' THEN 'BGL / GL TDC - Plant 2000 - Base Template V1'
    WHEN 'SYS_CRFH_2000_V1' THEN 'CRFH TDC - Plant 2000 - Base Template V1'
    WHEN 'SYS_HRPO_2000_V1' THEN 'HRPO TDC - Plant 2000 - Base Template V1'
    ELSE template_name END,
    description = CASE template_code
      WHEN 'SYS_BGL_GL_2000_V1' THEN 'System-created first Plant 2000 BGL/GL template based on source TDC BGL/OEM/0011 (Bondada Green Engineering Pvt Ltd).'
      WHEN 'SYS_CRFH_2000_V1' THEN 'System-created first Plant 2000 CRFH template based on source TDC CRFH/OEM/0002 (Krishca Strapping Solutions Ltd).'
      WHEN 'SYS_HRPO_2000_V1' THEN 'System-created first Plant 2000 HRPO template based on source TDC HRPO/CIPL/0001 (JBM Group).'
      ELSE description END,
    template_status='ACTIVE',
    is_active=true,
    activated_at=COALESCE(activated_at,now()),
    updated_at=now()
WHERE template_code IN ('SYS_BGL_GL_2000_V1','SYS_CRFH_2000_V1','SYS_HRPO_2000_V1');

-- The first BGL/GL system template is kept exact to the selected Bondada
-- source format. Shekhat-only additions remain in the central characteristic
-- master and can be introduced later through Copy as New Template.
UPDATE mes.tdc_template_characteristic tc
SET is_active=false, updated_at=now()
FROM mes.tdc_template_header t, mes.tdc_characteristic_master c
WHERE tc.template_id=t.template_id
  AND tc.characteristic_id=c.characteristic_id
  AND t.template_code='SYS_BGL_GL_2000_V1'
  AND c.characteristic_code IN ('BASE_METAL','SURFACE_COATING_ACRYLIC');

-- HRPO source document defines Tensile Strength as a MAX value.
UPDATE mes.tdc_template_characteristic tc
SET default_value_mode='MAX', updated_at=now()
FROM mes.tdc_template_header t, mes.tdc_characteristic_master c
WHERE tc.template_id=t.template_id
  AND tc.characteristic_id=c.characteristic_id
  AND t.template_code='SYS_HRPO_2000_V1'
  AND c.characteristic_code='TENSILE_STRENGTH';

-- --------------------------------------------------------------------------
-- 2. Load template defaults from the three approved source formats.
--    These values prefill future TDCs created from the template; users can
--    change the DRAFT TDC before submission.
-- --------------------------------------------------------------------------
WITH src(template_code,characteristic_code,default_specification,default_value_mode,default_uom) AS (
VALUES
('SYS_BGL_GL_2000_V1','CONFIRMING_STANDARD','IS 15961:2012','AS_PER_STANDARD','NA'),
('SYS_BGL_GL_2000_V1','SPEC_GRADE','550 MPa','EXACT','NA'),
('SYS_BGL_GL_2000_V1','END_USE','Solar MMS','TEXT','NA'),
('SYS_BGL_GL_2000_V1','NOTE_1','As per Std IS 15961, clause 11.2 Coils, however, may contain some abnormal imperfections which render a portion of the coil unusable since the imperfections in the coil cannot be removed unlike in the case of cut length.','TEXT','NA'),
('SYS_BGL_GL_2000_V1','THICKNESS','0.80 mm to 1.60 mm / as per Sales Order','RANGE','MM'),
('SYS_BGL_GL_2000_V1','THICKNESS_TOLERANCE','+/- 0.040 mm','PLUS_MINUS','MM'),
('SYS_BGL_GL_2000_V1','WIDTH','1060 / 1160 / 1180 / 1220 / 1250 / As per Sales Order','TEXT','MM'),
('SYS_BGL_GL_2000_V1','WIDTH_TOLERANCE','Mill edge: +20 / -0 and Trimmed edge: +5 / -0','TEXT','MM'),
('SYS_BGL_GL_2000_V1','COIL_WEIGHT','10.0 MT to 18.0 MT','RANGE','MT'),
('SYS_BGL_GL_2000_V1','ID_DIAMETER','508 mm','EXACT','MM'),
('SYS_BGL_GL_2000_V1','RMT','As per Colorshine (CIPL) standard RMT Chart','TEXT','MTR'),
('SYS_BGL_GL_2000_V1','YIELD_STRENGTH','YS 550 MPa Minimum','MIN','MPA'),
('SYS_BGL_GL_2000_V1','TENSILE_STRENGTH','TS 550 MPa Minimum','MIN','MPA'),
('SYS_BGL_GL_2000_V1','HARDNESS','85 Min','MIN','HRB'),
('SYS_BGL_GL_2000_V1','ELONGATION','NA','NA','%'),
('SYS_BGL_GL_2000_V1','IMPACT_TEST','Top: 7 J no tape loss, Back: 7 J no tape loss','TEXT','JOULES'),
('SYS_BGL_GL_2000_V1','BEND_TEST_TOP','4T Pass','TEXT','NA'),
('SYS_BGL_GL_2000_V1','BEND_TEST_BOTTOM','4T Pass','TEXT','NA'),
('SYS_BGL_GL_2000_V1','MASS_OF_ZINC_COATING','AZ 150','EXACT','GSM'),
('SYS_BGL_GL_2000_V1','PASSIVATION','3 Grms min (Acrylic (Cr6) (Anti Fingerprint))','TEXT','GSM'),
('SYS_BGL_GL_2000_V1','SURFACE_CONDITION_SPANGLE','Surface Non Skinpass, Regular Spangles','TEXT','NA'),
('SYS_BGL_GL_2000_V1','EDGE_CONDITION','Trimmed Edge / Milled Edge (as per Sales Order)','TEXT','NA'),
('SYS_BGL_GL_2000_V1','OIL','NA','NA','GSM'),
('SYS_BGL_GL_2000_V1','SALT_SPRAY_TEST','750 hours','MIN','HOURS'),
('SYS_BGL_GL_2000_V1','SHAPE_FLATNESS','30 I value Max or 4 mm height, 3 waves in a meter','TEXT','NA'),
('SYS_BGL_GL_2000_V1','PACKING','ID & OD metal side ring, ID paper sleeve, ID & OD cover with HDPE paper 100 GSM, OD outer side metal wrap, Metwrap side disc 300 GSM with Colorshine brand name. (CIPL Standard Packing)','TEXT','NA'),
('SYS_BGL_GL_2000_V1','SLEEVE','CIPL Standard','TEXT','NA'),
('SYS_BGL_GL_2000_V1','PRINTING_MARKING','NA','NA','NA'),
('SYS_BGL_GL_2000_V1','LOGO','NA','NA','NA'),
('SYS_CRFH_2000_V1','CONFIRMING_STANDARD','IS 513 (Part 1)','AS_PER_STANDARD','NA'),
('SYS_CRFH_2000_V1','BASE_METAL_GRADE','As Per IS 11513','AS_PER_STANDARD','NA'),
('SYS_CRFH_2000_V1','GRADE_DESIGNATION','TS 650','TEXT','MPA'),
('SYS_CRFH_2000_V1','END_USE','HTSS (Apex Quality)','TEXT','NA'),
('SYS_CRFH_2000_V1','TEST_CERTIFICATE','Shall Confirm the above-mentioned standard','TEXT','NA'),
('SYS_CRFH_2000_V1','WIDTH','As Per PO (HR Coil will be directly rolled in Mill, may have +0 to +200 mm Width)','AS_PER_PO','MM'),
('SYS_CRFH_2000_V1','WIDTH_TOLERANCE','As Per PO','AS_PER_PO','MM'),
('SYS_CRFH_2000_V1','THICKNESS','As Per PO','AS_PER_PO','MM'),
('SYS_CRFH_2000_V1','THICKNESS_TOLERANCE','+/- 0.03 mm','PLUS_MINUS','MM'),
('SYS_CRFH_2000_V1','COIL_WEIGHT','20 - 30 MT','RANGE','MT'),
('SYS_CRFH_2000_V1','ID_DIAMETER','508 mm +/- 10 mm','PLUS_MINUS','MM'),
('SYS_CRFH_2000_V1','OUTER_DIAMETER','2200 mm (Max.)','MAX','MM'),
('SYS_CRFH_2000_V1','TELESCOPE','20 mm (Max.)','MAX','MM'),
('SYS_CRFH_2000_V1','CHEMICAL_COMPOSITION_BASE_METAL','As Per IS 11513','AS_PER_STANDARD','NA'),
('SYS_CRFH_2000_V1','HARDNESS','90 (Min)','MIN','HRB'),
('SYS_CRFH_2000_V1','YIELD_STRENGTH','NA','NA','MPA'),
('SYS_CRFH_2000_V1','TENSILE_STRENGTH','Min 650 MPa','MIN','MPA'),
('SYS_CRFH_2000_V1','ELONGATION','NA','NA','%'),
('SYS_CRFH_2000_V1','EDGE_CONDITION','Mill Edge','TEXT','NA'),
('SYS_CRFH_2000_V1','OIL','Slightly Oiled Surface from Mill','TEXT','NA'),
('SYS_CRFH_2000_V1','SURFACE_FINISH','Bright','EXACT','NA'),
('SYS_CRFH_2000_V1','RA_VALUE','0.40 (Max.)','MAX','MICRON'),
('SYS_CRFH_2000_V1','CAMBER','+/- 5 mm per 2000 mm length','TEXT','MM'),
('SYS_CRFH_2000_V1','SHAPE_FLATNESS','< 30 I Units','TEXT','NA'),
('SYS_CRFH_2000_V1','FREE_FROM_DEFECTS','Free from defects like lamination, slivers or any other surface flaw.','TEXT','NA'),
('SYS_CRFH_2000_V1','PACKING','As Per CIPL Norms','TEXT','NA'),
('SYS_CRFH_2000_V1','SLEEVE','As Per CIPL Norms','TEXT','NA'),
('SYS_HRPO_2000_V1','CONFIRMING_STANDARD','IS 1079 : 2017','AS_PER_STANDARD','NA'),
('SYS_HRPO_2000_V1','SPEC_GRADE','HR 2','EXACT','NA'),
('SYS_HRPO_2000_V1','THICKNESS','1.60 mm to 4.00 mm / as per Sales Order','RANGE','MM'),
('SYS_HRPO_2000_V1','THICKNESS_TOLERANCE','+/- 0.20 mm','PLUS_MINUS','MM'),
('SYS_HRPO_2000_V1','WIDTH','1250 mm / As per Sales Order','TEXT','MM'),
('SYS_HRPO_2000_V1','WIDTH_TOLERANCE','Mill Edge: +20 / -0','TEXT','MM'),
('SYS_HRPO_2000_V1','ID_DIAMETER','610 mm','EXACT','MM'),
('SYS_HRPO_2000_V1','COIL_WEIGHT','13.0 MT to 25.0 MT','RANGE','MT'),
('SYS_HRPO_2000_V1','CARBON','0.100 Max','MAX','%'),
('SYS_HRPO_2000_V1','MANGANESE','0.450 Max','MAX','%'),
('SYS_HRPO_2000_V1','PHOSPHORUS','0.040 Max','MAX','%'),
('SYS_HRPO_2000_V1','SULFUR','0.035 Max','MAX','%'),
('SYS_HRPO_2000_V1','YIELD_STRENGTH','---','NA','MPA'),
('SYS_HRPO_2000_V1','TENSILE_STRENGTH','TS 420 MPa Max','MAX','MPA'),
('SYS_HRPO_2000_V1','ELONGATION','26 Min','MIN','%'),
('SYS_HRPO_2000_V1','EDGE_CONDITION','Mill Edge','TEXT','NA'),
('SYS_HRPO_2000_V1','OIL','YES','EXACT','NA'),
('SYS_HRPO_2000_V1','SHAPE_FLATNESS','T<=2.0 mm : 40 mm Max; T>2.0 mm as per EN 10051','TEXT','NA'),
('SYS_HRPO_2000_V1','CAMBER','20 mm Max in 5-meter length except ID/OD','TEXT','NA'),
('SYS_HRPO_2000_V1','PACKING','OD cover with HDPE paper 100 GSM, OD outer side metal wrap, Metwrap side disc 300 GSM with Colorshine brand name. (CIPL Standard Packing)','TEXT','NA')
)
UPDATE mes.tdc_template_characteristic tc
SET default_specification=s.default_specification,
    default_value_mode=s.default_value_mode,
    default_uom=s.default_uom,
    updated_at=now()
FROM src s
JOIN mes.tdc_template_header t ON t.template_code=s.template_code
JOIN mes.tdc_characteristic_master c ON c.characteristic_code=s.characteristic_code
WHERE tc.template_id=t.template_id
  AND tc.characteristic_id=c.characteristic_id;

-- --------------------------------------------------------------------------
-- 3. Import source TDC headers only when that TDC number does not exist.
--    These are historical approved documents; their approval happened outside
--    MES. They are imported as immutable V01 APPROVED records.
-- --------------------------------------------------------------------------
WITH actor AS (
    SELECT u.user_id
    FROM mes.app_user u
    WHERE u.is_active=true
    ORDER BY CASE WHEN u.username='ADMIN' THEN 0 ELSE 1 END, u.created_at
    LIMIT 1
),
docs(tdc_no,template_code,category_code,series_code,customer_name,document_title,document_no,tdc_date,source_name) AS (
VALUES
('BGL/OEM/0011','SYS_BGL_GL_2000_V1','BGL_GL','OEM','BONDADA GREEN ENGINEERING PVT LTD','Technical Delivery Condition for Bare Galvalume (AZ 150) Coils','2001/QA/FM/22/R(00)','2025-12-08'::date,'2000-Bondada TDC-0011'),
('CRFH/OEM/0002','SYS_CRFH_2000_V1','CRFH','OEM','KRISHCA STRAPPING SOLUTIONS LTD','Technical Delivery Condition for CRFH Coils','2001/QA/FM/001/R(00)','2025-06-13'::date,'CRFH COIL COLORSHINE TDC'),
('HRPO/CIPL/0001','SYS_HRPO_2000_V1','HRPO','CIPL','JBM GROUP','Technical Delivery Condition for Hot Rolled Pickled and Oiled Coils','2001/QA/FM/22/R(00)','2026-02-19'::date,'HRPO TDC - 0021')
)
INSERT INTO mes.tdc_master(
    tdc_no,company_code,plant_code,category_id,series_id,template_id,
    customer_code,customer_name,document_no,document_title,customer_reference,
    sales_order_reference,current_version_no,approved_version_no,
    overall_status,is_active,created_by_user_id,created_at,updated_at)
SELECT d.tdc_no,'2000','2000',c.category_id,s.series_id,t.template_id,
       NULL,d.customer_name,d.document_no,d.document_title,NULL,
       NULL,1,1,'APPROVED',true,a.user_id,
       d.tdc_date::timestamptz,now()
FROM docs d
CROSS JOIN actor a
JOIN mes.tdc_category_master c ON c.category_code=d.category_code
JOIN mes.tdc_series_master s ON s.series_code=d.series_code
JOIN mes.tdc_template_header t ON t.template_code=d.template_code
WHERE NOT EXISTS (SELECT 1 FROM mes.tdc_master x WHERE x.tdc_no=d.tdc_no);

-- --------------------------------------------------------------------------
-- 4. Create V01 for the imported headers. Marker in general_remarks makes the
--    source imports identifiable and keeps later reruns idempotent.
-- --------------------------------------------------------------------------
WITH actor AS (
    SELECT u.user_id
    FROM mes.app_user u
    WHERE u.is_active=true
    ORDER BY CASE WHEN u.username='ADMIN' THEN 0 ELSE 1 END, u.created_at
    LIMIT 1
),
docs(tdc_no,template_code,customer_name,document_title,document_no,tdc_date,source_name) AS (
VALUES
('BGL/OEM/0011','SYS_BGL_GL_2000_V1','BONDADA GREEN ENGINEERING PVT LTD','Technical Delivery Condition for Bare Galvalume (AZ 150) Coils','2001/QA/FM/22/R(00)','2025-12-08'::date,'2000-Bondada TDC-0011'),
('CRFH/OEM/0002','SYS_CRFH_2000_V1','KRISHCA STRAPPING SOLUTIONS LTD','Technical Delivery Condition for CRFH Coils','2001/QA/FM/001/R(00)','2025-06-13'::date,'CRFH COIL COLORSHINE TDC'),
('HRPO/CIPL/0001','SYS_HRPO_2000_V1','JBM GROUP','Technical Delivery Condition for Hot Rolled Pickled and Oiled Coils','2001/QA/FM/22/R(00)','2026-02-19'::date,'HRPO TDC - 0021')
)
INSERT INTO mes.tdc_version(
    tdc_id,version_no,version_label,template_id,tdc_date,customer_code,
    customer_name,document_no,document_title,customer_reference,sales_order_reference,
    status,approval_stage,revision_reason,general_remarks,source_version_id,
    created_by_user_id,submitted_at,approved_at,created_at,updated_at)
SELECT m.tdc_id,1,'V01',t.template_id,d.tdc_date,NULL,
       d.customer_name,d.document_no,d.document_title,NULL,NULL,
       'APPROVED','COMPLETE',NULL,
       'SOURCE_IMPORT_V0111: Imported from approved legacy TDC PDF - '||d.source_name||
       '. Approval history predates MES; source document retained as audit reference.',
       NULL,a.user_id,
       d.tdc_date::timestamptz + interval '1 hour',
       d.tdc_date::timestamptz + interval '4 hours',
       d.tdc_date::timestamptz,now()
FROM docs d
CROSS JOIN actor a
JOIN mes.tdc_master m ON m.tdc_no=d.tdc_no
JOIN mes.tdc_template_header t ON t.template_code=d.template_code
WHERE NOT EXISTS (
    SELECT 1 FROM mes.tdc_version v WHERE v.tdc_id=m.tdc_id AND v.version_no=1
);

-- --------------------------------------------------------------------------
-- 5. Seed all mapped fields for source-imported versions, then apply exact
--    specifications/comments/final-agreed values from the source documents.
-- --------------------------------------------------------------------------
INSERT INTO mes.tdc_characteristic_value(
    tdc_version_id,characteristic_id,characteristic_code,characteristic_name,
    section_code,sequence_no,display_label,is_required,uom,value_mode,
    colorshine_specification,customer_comment,final_agreed_specification)
SELECT v.tdc_version_id,c.characteristic_id,c.characteristic_code,c.characteristic_name,
       tc.section_code,tc.sequence_no,COALESCE(tc.display_label,c.characteristic_name),
       tc.is_required,COALESCE(tc.default_uom,c.default_uom),
       COALESCE(tc.default_value_mode,c.default_value_mode),
       NULL,NULL,NULL
FROM mes.tdc_version v
JOIN mes.tdc_master m ON m.tdc_id=v.tdc_id
JOIN mes.tdc_template_characteristic tc ON tc.template_id=v.template_id AND tc.is_active=true
JOIN mes.tdc_characteristic_master c ON c.characteristic_id=tc.characteristic_id AND c.is_active=true
WHERE v.version_no=1
  AND v.general_remarks LIKE 'SOURCE_IMPORT_V0111:%'
ON CONFLICT(tdc_version_id,characteristic_id) DO NOTHING;

WITH src(
    tdc_no,characteristic_code,uom,value_mode,
    colorshine_specification,customer_comment,final_agreed_specification,
    min_value,max_value,target_value,tolerance_minus,tolerance_plus
) AS (
VALUES
('BGL/OEM/0011','CONFIRMING_STANDARD','NA','AS_PER_STANDARD','IS 15961:2012',NULL,'IS 15961:2012',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','SPEC_GRADE','NA','EXACT','550 MPa',NULL,'550 MPa',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','END_USE','NA','TEXT','Solar MMS',NULL,'Solar MMS',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','NOTE_1','NA','TEXT','As per Std IS 15961, clause 11.2 Coils, however, may contain some abnormal imperfections which render a portion of the coil unusable since the imperfections in the coil cannot be removed unlike in the case of cut length.',NULL,'As per Std IS 15961, clause 11.2 Coils, however, may contain some abnormal imperfections which render a portion of the coil unusable since the imperfections in the coil cannot be removed unlike in the case of cut length.',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','THICKNESS','MM','RANGE','0.80 mm to 1.60 mm / as per Sales Order',NULL,'0.80 mm to 1.60 mm / as per Sales Order',0.8,1.6,NULL,NULL,NULL),
('BGL/OEM/0011','THICKNESS_TOLERANCE','MM','PLUS_MINUS','+/- 0.040 mm',NULL,'+/- 0.040 mm',NULL,NULL,NULL,0.04,0.04),
('BGL/OEM/0011','WIDTH','MM','TEXT','1060 / 1160 / 1180 / 1220 / 1250 / As per Sales Order',NULL,'1060 / 1160 / 1180 / 1220 / 1250 / As per Sales Order',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','WIDTH_TOLERANCE','MM','TEXT','Mill edge: +20 / -0 and Trimmed edge: +5 / -0',NULL,'Mill edge: +20 / -0 and Trimmed edge: +5 / -0',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','COIL_WEIGHT','MT','RANGE','10.0 MT to 18.0 MT',NULL,'10.0 MT to 18.0 MT',10.0,18.0,NULL,NULL,NULL),
('BGL/OEM/0011','ID_DIAMETER','MM','EXACT','508 mm',NULL,'508 mm',NULL,NULL,508.0,NULL,NULL),
('BGL/OEM/0011','RMT','MTR','TEXT','As per Colorshine (CIPL) standard RMT Chart',NULL,'As per Colorshine (CIPL) standard RMT Chart',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','YIELD_STRENGTH','MPA','MIN','YS 550 MPa Minimum',NULL,'YS 550 MPa Minimum',550.0,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','TENSILE_STRENGTH','MPA','MIN','TS 550 MPa Minimum',NULL,'TS 550 MPa Minimum',550.0,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','HARDNESS','HRB','MIN','85 Min',NULL,'85 Min',85.0,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','ELONGATION','%','NA','NA',NULL,'NA',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','IMPACT_TEST','JOULES','TEXT','Top: 7 J no tape loss, Back: 7 J no tape loss',NULL,'Top: 7 J no tape loss, Back: 7 J no tape loss',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','BEND_TEST_TOP','NA','TEXT','4T Pass',NULL,'4T Pass',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','BEND_TEST_BOTTOM','NA','TEXT','4T Pass',NULL,'4T Pass',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','MASS_OF_ZINC_COATING','GSM','EXACT','AZ 150',NULL,'AZ 150',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','PASSIVATION','GSM','TEXT','3 Grms min (Acrylic (Cr6) (Anti Fingerprint))',NULL,'3 Grms min (Acrylic (Cr6) (Anti Fingerprint))',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','SURFACE_CONDITION_SPANGLE','NA','TEXT','Surface Non Skinpass, Regular Spangles',NULL,'Surface Non Skinpass, Regular Spangles',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','EDGE_CONDITION','NA','TEXT','Trimmed Edge / Milled Edge (as per Sales Order)',NULL,'Trimmed Edge / Milled Edge (as per Sales Order)',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','OIL','GSM','NA','NA',NULL,'NA',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','SALT_SPRAY_TEST','HOURS','MIN','750 hours',NULL,'750 hours',750.0,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','SHAPE_FLATNESS','NA','TEXT','30 I value Max or 4 mm height, 3 waves in a meter',NULL,'30 I value Max or 4 mm height, 3 waves in a meter',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','PACKING','NA','TEXT','ID & OD metal side ring, ID paper sleeve, ID & OD cover with HDPE paper 100 GSM, OD outer side metal wrap, Metwrap side disc 300 GSM with Colorshine brand name. (CIPL Standard Packing)',NULL,'ID & OD metal side ring, ID paper sleeve, ID & OD cover with HDPE paper 100 GSM, OD outer side metal wrap, Metwrap side disc 300 GSM with Colorshine brand name. (CIPL Standard Packing)',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','SLEEVE','NA','TEXT','CIPL Standard',NULL,'CIPL Standard',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','PRINTING_MARKING','NA','NA','NA',NULL,'NA',NULL,NULL,NULL,NULL,NULL),
('BGL/OEM/0011','LOGO','NA','NA','NA',NULL,'NA',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','CONFIRMING_STANDARD','NA','AS_PER_STANDARD','IS 513 (Part 1)','IS 513 (Part 1)','IS 513 (Part 1)',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','BASE_METAL_GRADE','NA','AS_PER_STANDARD','As Per IS 11513','OK','As Per IS 11513',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','GRADE_DESIGNATION','MPA','TEXT','TS 650','OK','TS 650',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','END_USE','NA','TEXT','HTSS (Apex Quality)','OK','HTSS (Apex Quality)',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','TEST_CERTIFICATE','NA','TEXT','Shall Confirm the above-mentioned standard','OK','Shall Confirm the above-mentioned standard',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','WIDTH','MM','AS_PER_PO','As Per PO (HR Coil will be directly rolled in Mill, may have +0 to +200 mm Width)','As per PO','As per PO',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','WIDTH_TOLERANCE','MM','AS_PER_PO','As Per PO','OK','As Per PO',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','THICKNESS','MM','AS_PER_PO','As Per PO','OK','As Per PO',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','THICKNESS_TOLERANCE','MM','PLUS_MINUS','+/- 0.03 mm','OK','+/- 0.03 mm',NULL,NULL,NULL,0.03,0.03),
('CRFH/OEM/0002','COIL_WEIGHT','MT','RANGE','20 - 30 MT','OK','20 - 30 MT',20.0,30.0,NULL,NULL,NULL),
('CRFH/OEM/0002','ID_DIAMETER','MM','PLUS_MINUS','508 mm +/- 10 mm','OK','508 mm +/- 10 mm',NULL,NULL,508.0,10.0,10.0),
('CRFH/OEM/0002','OUTER_DIAMETER','MM','MAX','2200 mm (Max.)','OK','2200 mm (Max.)',NULL,2200.0,NULL,NULL,NULL),
('CRFH/OEM/0002','TELESCOPE','MM','MAX','20 mm (Max.)','OK','20 mm (Max.)',NULL,20.0,NULL,NULL,NULL),
('CRFH/OEM/0002','CHEMICAL_COMPOSITION_BASE_METAL','NA','AS_PER_STANDARD','As Per IS 11513','OK','As Per IS 11513',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','HARDNESS','HRB','MIN','90 (Min)','OK','90 (Min)',90.0,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','YIELD_STRENGTH','MPA','NA','NA','NA','NA',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','TENSILE_STRENGTH','MPA','MIN','Min 650 MPa','MIN - 760','Min 760 MPa',760.0,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','ELONGATION','%','NA','NA','NA','NA',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','EDGE_CONDITION','NA','TEXT','Mill Edge','Trimmed Edge','Trimmed Edge',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','OIL','NA','TEXT','Slightly Oiled Surface from Mill','OK','Slightly Oiled Surface from Mill',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','SURFACE_FINISH','NA','EXACT','Bright','OK','Bright',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','RA_VALUE','MICRON','MAX','0.40 (Max.)','OK','0.40 (Max.)',NULL,0.4,NULL,NULL,NULL),
('CRFH/OEM/0002','CAMBER','MM','TEXT','+/- 5 mm per 2000 mm length','OK','+/- 5 mm per 2000 mm length',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','SHAPE_FLATNESS','NA','TEXT','< 30 I Units','< 20 I UNITS','< 20 I Units',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','FREE_FROM_DEFECTS','NA','TEXT','Free from defects like lamination, slivers or any other surface flaw.','OK','Free from defects like lamination, slivers or any other surface flaw.',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','PACKING','NA','TEXT','As Per CIPL Norms','OK','As Per CIPL Norms',NULL,NULL,NULL,NULL,NULL),
('CRFH/OEM/0002','SLEEVE','NA','TEXT','As Per CIPL Norms','OK','As Per CIPL Norms',NULL,NULL,NULL,NULL,NULL),
('HRPO/CIPL/0001','CONFIRMING_STANDARD','NA','AS_PER_STANDARD','IS 1079 : 2017',NULL,'IS 1079 : 2017',NULL,NULL,NULL,NULL,NULL),
('HRPO/CIPL/0001','SPEC_GRADE','NA','EXACT','HR 2',NULL,'HR 2',NULL,NULL,NULL,NULL,NULL),
('HRPO/CIPL/0001','THICKNESS','MM','RANGE','1.60 mm to 4.00 mm / as per Sales Order',NULL,'1.60 mm to 4.00 mm / as per Sales Order',1.6,4.0,NULL,NULL,NULL),
('HRPO/CIPL/0001','THICKNESS_TOLERANCE','MM','PLUS_MINUS','+/- 0.20 mm',NULL,'+/- 0.20 mm',NULL,NULL,NULL,0.2,0.2),
('HRPO/CIPL/0001','WIDTH','MM','TEXT','1250 mm / As per Sales Order',NULL,'1250 mm / As per Sales Order',NULL,NULL,NULL,NULL,NULL),
('HRPO/CIPL/0001','WIDTH_TOLERANCE','MM','TEXT','Mill Edge: +20 / -0',NULL,'Mill Edge: +20 / -0',NULL,NULL,NULL,NULL,NULL),
('HRPO/CIPL/0001','ID_DIAMETER','MM','EXACT','610 mm',NULL,'610 mm',NULL,NULL,610.0,NULL,NULL),
('HRPO/CIPL/0001','COIL_WEIGHT','MT','RANGE','13.0 MT to 25.0 MT',NULL,'13.0 MT to 25.0 MT',13.0,25.0,NULL,NULL,NULL),
('HRPO/CIPL/0001','CARBON','%','MAX','0.100 Max',NULL,'0.100 Max',NULL,0.1,NULL,NULL,NULL),
('HRPO/CIPL/0001','MANGANESE','%','MAX','0.450 Max',NULL,'0.450 Max',NULL,0.45,NULL,NULL,NULL),
('HRPO/CIPL/0001','PHOSPHORUS','%','MAX','0.040 Max',NULL,'0.040 Max',NULL,0.04,NULL,NULL,NULL),
('HRPO/CIPL/0001','SULFUR','%','MAX','0.035 Max',NULL,'0.035 Max',NULL,0.035,NULL,NULL,NULL),
('HRPO/CIPL/0001','YIELD_STRENGTH','MPA','NA','---',NULL,'---',NULL,NULL,NULL,NULL,NULL),
('HRPO/CIPL/0001','TENSILE_STRENGTH','MPA','MAX','TS 420 MPa Max',NULL,'TS 420 MPa Max',NULL,420.0,NULL,NULL,NULL),
('HRPO/CIPL/0001','ELONGATION','%','MIN','26 Min',NULL,'26 Min',26.0,NULL,NULL,NULL,NULL),
('HRPO/CIPL/0001','EDGE_CONDITION','NA','TEXT','Mill Edge',NULL,'Mill Edge',NULL,NULL,NULL,NULL,NULL),
('HRPO/CIPL/0001','OIL','NA','EXACT','YES',NULL,'YES',NULL,NULL,NULL,NULL,NULL),
('HRPO/CIPL/0001','SHAPE_FLATNESS','NA','TEXT','T<=2.0 mm : 40 mm Max; T>2.0 mm as per EN 10051',NULL,'T<=2.0 mm : 40 mm Max; T>2.0 mm as per EN 10051',NULL,NULL,NULL,NULL,NULL),
('HRPO/CIPL/0001','CAMBER','NA','TEXT','20 mm Max in 5-meter length except ID/OD',NULL,'20 mm Max in 5-meter length except ID/OD',NULL,NULL,NULL,NULL,NULL),
('HRPO/CIPL/0001','PACKING','NA','TEXT','OD cover with HDPE paper 100 GSM, OD outer side metal wrap, Metwrap side disc 300 GSM with Colorshine brand name. (CIPL Standard Packing)',NULL,'OD cover with HDPE paper 100 GSM, OD outer side metal wrap, Metwrap side disc 300 GSM with Colorshine brand name. (CIPL Standard Packing)',NULL,NULL,NULL,NULL,NULL)
)
UPDATE mes.tdc_characteristic_value cv
SET uom=s.uom,
    value_mode=s.value_mode,
    colorshine_specification=s.colorshine_specification,
    customer_comment=s.customer_comment,
    final_agreed_specification=s.final_agreed_specification,
    min_value=s.min_value,
    max_value=s.max_value,
    target_value=s.target_value,
    tolerance_minus=s.tolerance_minus,
    tolerance_plus=s.tolerance_plus,
    updated_at=now()
FROM src s
JOIN mes.tdc_master m ON m.tdc_no=s.tdc_no
JOIN mes.tdc_version v ON v.tdc_id=m.tdc_id AND v.version_no=1
WHERE cv.tdc_version_id=v.tdc_version_id
  AND cv.characteristic_code=s.characteristic_code
  AND v.general_remarks LIKE 'SOURCE_IMPORT_V0111:%';

-- --------------------------------------------------------------------------
-- 6. Create auditable legacy approval history. We do not falsely attribute
--    legacy approvals to the ADMIN user; action_by_username records import.
-- --------------------------------------------------------------------------
WITH imported AS (
    SELECT v.tdc_version_id,v.tdc_date
    FROM mes.tdc_version v
    WHERE v.version_no=1 AND v.general_remarks LIKE 'SOURCE_IMPORT_V0111:%'
),
stages(seq,stage_code,group_code,offset_hours) AS (
VALUES
(1,'CREATOR',NULL,1),
(2,'QC_HEAD','TDC_QC_HEAD_2000',2),
(3,'PPC_HEAD','TDC_PPC_HEAD_2000',3),
(4,'PLANT_HEAD','TDC_PLANT_HEAD_2000',4)
)
INSERT INTO mes.tdc_workflow_approval(
    tdc_version_id,approval_sequence,approval_stage,approver_group_code,
    approval_status,action_by_user_id,action_by_username,action_at,remarks,
    intended_email,actual_email,email_status,created_at,updated_at)
SELECT i.tdc_version_id,s.seq,s.stage_code,s.group_code,
       'APPROVED',NULL,'LEGACY_IMPORT',
       i.tdc_date::timestamptz + make_interval(hours=>s.offset_hours),
       'Imported from already approved legacy TDC source. Original approval predates MES.',
       NULL,NULL,NULL,
       i.tdc_date::timestamptz,now()
FROM imported i CROSS JOIN stages s
ON CONFLICT(tdc_version_id,approval_sequence) DO NOTHING;

-- --------------------------------------------------------------------------
-- 7. Reassert protected source baselines. Import does not consume numbers.
-- --------------------------------------------------------------------------
UPDATE mes.tdc_number_object n
SET current_number=GREATEST(n.current_number,x.min_current),
    updated_at=now()
FROM (
    SELECT s.series_id,v.prefix,v.min_current
    FROM (VALUES
        ('BGL','OEM',11),
        ('CRFH','OEM',2),
        ('HRPO','CIPL',1)
    ) v(prefix,series_code,min_current)
    JOIN mes.tdc_series_master s ON s.series_code=v.series_code
) x
WHERE n.plant_code='2000'
  AND n.tdc_prefix=x.prefix
  AND n.series_id=x.series_id;

COMMIT;
