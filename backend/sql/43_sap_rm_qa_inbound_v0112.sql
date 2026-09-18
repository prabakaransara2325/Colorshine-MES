-- Colorshine MES v0.11.2 - SAP RM QA / Supplier TC inbound
-- Scope: Company 2000 / Plant 2000
--
-- Adds the constraint needed to make the new SAP QA-time inbound endpoint
-- (POST /api/integration/sap/rm-qa) idempotent: one current supplier TC
-- header per batch, upserted in place on repeated/corrected sends.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rm_supplier_tc_batch_id_key'
  ) THEN
    ALTER TABLE mes.rm_supplier_tc
      ADD CONSTRAINT rm_supplier_tc_batch_id_key UNIQUE (batch_id);
  END IF;
END $$;
