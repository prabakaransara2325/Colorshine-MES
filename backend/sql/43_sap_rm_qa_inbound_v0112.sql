-- Colorshine MES v0.11.2 - SAP RM QA / Supplier TC inbound
-- Scope: Company 2000 / Plant 2000
--
-- Adds the constraint needed to make the new SAP QA-time inbound endpoint
-- (POST /api/integration/sap/rm-qa) idempotent: one current supplier TC
-- header per batch, upserted in place on repeated/corrected sends.
-- Also seeds the QA parameter catalog and the RM master data (storage
-- location, suppliers) sourced from the real SAP_MES_RM.xlsx extract
-- (IFTLI_L4L3_RM_POST_GRN_DETAILS / IFTLI_L4L3_RM_POST_QA_DETAILS sheets)
-- so real GRN/QA payloads can be posted through the two endpoints.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rm_supplier_tc_batch_id_key'
  ) THEN
    ALTER TABLE mes.rm_supplier_tc
      ADD CONSTRAINT rm_supplier_tc_batch_id_key UNIQUE (batch_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supplier_master_sap_vendor_no_key'
  ) THEN
    ALTER TABLE mes.supplier_master
      ADD CONSTRAINT supplier_master_sap_vendor_no_key UNIQUE (sap_vendor_no);
  END IF;
END $$;

-- QA parameter catalog: one row per IFTLI_L4L3_RM_POST_QA_DETAILS field that
-- carries a chemical/mechanical value or a generic OK/NOT-OK flag.
INSERT INTO mes.quality_parameter_master(parameter_code,parameter_name,parameter_category,data_type,default_uom) VALUES
  ('CARBON_PCT','Carbon %','CHEMICAL','NUMERIC','%'),
  ('CARBON_EQ','Carbon Equivalent','CHEMICAL','NUMERIC',NULL),
  ('MANGANESE_PCT','Manganese %','CHEMICAL','NUMERIC','%'),
  ('PHOSPHORUS_PCT','Phosphorus %','CHEMICAL','NUMERIC','%'),
  ('SULPHUR_PCT','Sulphur %','CHEMICAL','NUMERIC','%'),
  ('SILICON_PCT','Silicon %','CHEMICAL','NUMERIC','%'),
  ('ALUMINIUM_PCT','Aluminium %','CHEMICAL','NUMERIC','%'),
  ('NITROGEN_PCT','Nitrogen %','CHEMICAL','NUMERIC','%'),
  ('NITROGEN_PPM','Nitrogen ppm','CHEMICAL','NUMERIC','ppm'),
  ('BORON_PCT','Boron %','CHEMICAL','NUMERIC','%'),
  ('COPPER_PCT','Copper %','CHEMICAL','NUMERIC','%'),
  ('CHROMIUM_PCT','Chromium %','CHEMICAL','NUMERIC','%'),
  ('NICKEL_PCT','Nickel %','CHEMICAL','NUMERIC','%'),
  ('TIN_PCT','Tin %','CHEMICAL','NUMERIC','%'),
  ('YMPA','Yield (spec) MPa','MECHANICAL','NUMERIC','MPa'),
  ('TMPA','Tensile (spec) MPa','MECHANICAL','NUMERIC','MPa'),
  ('EL_PCT','Elongation %','MECHANICAL','NUMERIC','%'),
  ('HARDNESS','Hardness','MECHANICAL','NUMERIC',NULL),
  ('UTS','Ultimate Tensile Strength','MECHANICAL','NUMERIC','MPa'),
  ('YS','Yield Strength','MECHANICAL','NUMERIC','MPa'),
  ('CHEM_1','Chemical characteristic 1 (source array)','OTHER','NUMERIC',NULL),
  ('CHEM_2','Chemical characteristic 2 (source array)','OTHER','NUMERIC',NULL),
  ('CHEM_3','Chemical characteristic 3 (source array)','OTHER','NUMERIC',NULL),
  ('CHEM_4','Chemical characteristic 4 (source array)','OTHER','NUMERIC',NULL),
  ('CHEM_5','Chemical characteristic 5 (source array)','OTHER','NUMERIC',NULL),
  ('GEN_1','General check 1','GENERAL','TEXT',NULL),
  ('GEN_2','General check 2','GENERAL','TEXT',NULL),
  ('GEN_3','General check 3','GENERAL','TEXT',NULL),
  ('GEN_4','General check 4','GENERAL','TEXT',NULL),
  ('GEN_5','General check 5','GENERAL','TEXT',NULL)
ON CONFLICT(parameter_code) DO NOTHING;

-- RM master data from the real SAP extract (Plant 2000).
INSERT INTO mes.storage_location_master(plant_code,storage_location,storage_name,inventory_category)
VALUES('2000','2001','RM Stores - Plant 2000','RAW_MATERIAL')
ON CONFLICT(plant_code,storage_location) DO NOTHING;

INSERT INTO mes.supplier_master(sap_vendor_no,supplier_name,source_system) VALUES
  ('0011000082','TATA STEEL LTD','SAP'),
  ('0011000122','NMDC STEEL LIMITED','SAP'),
  ('0011000139','JSW Steel Limited','SAP'),
  ('0011000144','JSW Vijayanagar Metallics Limited','SAP')
ON CONFLICT(sap_vendor_no) DO NOTHING;
