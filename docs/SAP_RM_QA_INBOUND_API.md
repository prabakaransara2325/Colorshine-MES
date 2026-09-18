# SAP RM QA / Supplier TC inbound

Added in v0.11.2. This is the second ERP touch point on RM GRN data — GRN
posts the batch (`POST /api/integration/sap/grn`), and this endpoint posts
the QA/supplier Test Certificate results for that same batch once available.

Endpoint: `POST /api/integration/sap/rm-qa`

Header:

`X-MES-Integration-Key: <SAP_INBOUND_API_KEY>`

## Payload

```json
{
  "PLANT_CODE": "2000",
  "BATCH_NO": "26HW0466R0",
  "RM_SOURCE": "0011000122",
  "TC_NO": "TC-2026-000456",
  "HEAT_NO": "H20260808A",
  "HR_GRADE": "IS2062-E250BR",
  "VENDOR_GRADE": "E250BR",
  "QUALITY_LEVEL": "PRIME",
  "CHEMICAL_TREATMENT": "PASSIVATED",
  "SURFACE_CONDITION": "MATT",
  "ELONGATION_GL_TYPE": "GL80",
  "INNER_DIA_MM": 508,
  "OUTER_DIA_MM": 1850,
  "GSM_COATING": 120,
  "BATCH_LENGTH_M": 3250,
  "REMARKS": "As per supplier TC",
  "CREATED_BY": "SAP_QA_INTERFACE",
  "CREATED_DATE": "2026-08-09T10:15:00+05:30",
  "CHARACTERISTICS": [
    { "PARAMETER_CODE": "C_PCT", "VALUE": 0.18, "UOM": "%" },
    { "PARAMETER_CODE": "MN_PCT", "VALUE": 0.75, "UOM": "%" },
    { "PARAMETER_CODE": "YS_MPA", "VALUE": 275, "UOM": "MPa" },
    { "PARAMETER_CODE": "UTS_MPA", "VALUE": 410, "UOM": "MPa" },
    { "PARAMETER_CODE": "ELONGATION_PCT", "VALUE": 28, "UOM": "%" }
  ]
}
```

Only `PLANT_CODE` and `BATCH_NO` are mandatory. Everything else, including
`CHARACTERISTICS`, is optional — send whatever the TC has.

## Result
On success (`201`):

```json
{
  "messageId": "...",
  "batchId": "...",
  "supplierTcId": "...",
  "characteristicsStored": 2,
  "characteristicsSkipped": ["ELONGATION_PCT"]
}
```

- The batch must already exist (i.e. GRN must have been posted first) — this
  is the master-data gate, same principle as the GRN endpoint. If not found,
  the call fails with `422` and the inbound message is marked `FAILED`.
- The supplier TC header (`mes.rm_supplier_tc`) is upserted **once per
  batch** — a repeat or corrected call for the same batch updates the
  existing row in place rather than creating a duplicate.
- Each `CHARACTERISTICS` row is matched to `mes.quality_parameter_master` by
  `PARAMETER_CODE`. A code that doesn't exist there yet is **skipped, not
  fatal** — it's listed in `characteristicsSkipped` so ERP/integration
  monitoring can see it, but the rest of the TC (including other
  characteristics) is still stored.
- `quality_parameter_master` is currently **empty** in this environment, so
  every characteristic will be skipped until that catalog (chemical/
  mechanical test parameters — C%, Mn%, YS, UTS, Elongation%, etc.) is
  seeded. The header-level TC fields (heat no, grade, TC no, dimensions)
  store regardless.

## Idempotency
Repeated calls with the same `PLANT_CODE` + `BATCH_NO` + `TC_NO` reuse the
same inbound-message row and upsert the same supplier-TC record — safe to
resend.

## Migration
This endpoint's idempotent upsert relies on a `UNIQUE(batch_id)` constraint
on `mes.rm_supplier_tc`, added by `backend/sql/43_sap_rm_qa_inbound_v0112.sql`
(apply via `backend/APPLY_V0112_RM_QA_INBOUND.bat` or
`npm run migrate:v0112`).
