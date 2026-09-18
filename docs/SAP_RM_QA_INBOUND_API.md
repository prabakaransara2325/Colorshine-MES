# SAP RM QA / Supplier TC inbound

Added in v0.11.2. This is the second ERP touch point on RM GRN data — GRN
posts the batch (`POST /api/integration/sap/grn`), and this endpoint posts
the QA/supplier Test Certificate results for that same batch once available.

Field names mirror SAP's own interface table `IFTLI_L4L3_RM_POST_QA_DETAILS`
exactly (same principle as the GRN endpoint), so SAP/middleware does not have
to learn a second field vocabulary.

Endpoint: `POST /api/integration/sap/rm-qa`

Header:

`X-MES-Integration-Key: <SAP_INBOUND_API_KEY>`

## Payload

Example using a real validated batch:

```json
{
  "PLANT_CODE": "2000",
  "BATCH_NO": "26HW0506R0",
  "BATCH_THICK": 2.2,
  "BATCH_WIDTH": 1230,
  "BATCH_WEIGHT": 21.08,
  "HEAT_NO": "0",
  "HR_GRADE": "CR3",
  "QUALITY_LEVEL": "PRIME",
  "SENT_DATE": "2026-08-17T05:30:00",
  "CHEM_TREATMENT": "NA",
  "SURFACE": "NA",
  "BATCH_LENGTH": "",
  "SUPPLIER_TC_NO": "1",
  "GSM_COATING": "0",
  "REMARK": "Remarks",
  "CARBON_PCT": 0.041,
  "CARBON_EQ": 0.077,
  "MANGANESE_PCT": 0.2,
  "PHOSPHORUS_PCT": 0.015,
  "SULPHUR_PCT": 0.003,
  "SILICON_PCT": 0.022,
  "ALUMINIUM_PCT": 0.039,
  "NITROGEN_PCT": 0,
  "NITROGEN_PPM": 40,
  "BORON_PCT": 0.03,
  "COPPER_PCT": 0.003,
  "CHROMIUM_PCT": 0.007,
  "NICKEL_PCT": 0.003,
  "TIN_PCT": 0.01,
  "YMPA": 475,
  "TMPA": 325,
  "EL_PCT": 0.01,
  "EL_GL_TYPE": "Gl_Type",
  "HARDNESS": 55,
  "UTS": "500",
  "YS": "350",
  "INNER_DIA": "756",
  "OUTER_DIA": "0",
  "VENDOR_GRADE": "CR3",
  "GEN_1": "OK", "GEN_2": "OK", "GEN_3": "OK", "GEN_4": "OK", "GEN_5": "OK",
  "CHEM_1": 0.041, "CHEM_2": 0.01, "CHEM_3": 0.01, "CHEM_4": 0.01, "CHEM_5": 0.01,
  "READ_FLAG": "1",
  "CREATED_BY": "PLANT_GRN2",
  "CREATED_DATE": "2026-08-08T05:30:00"
}
```

Only `PLANT_CODE` and `BATCH_NO` are mandatory. Everything else is optional
— send whatever the TC/interface row has.

## Field mapping
- **Header fields** (`HEAT_NO`, `HR_GRADE`, `QUALITY_LEVEL`, `CHEM_TREATMENT`,
  `SURFACE`, `BATCH_LENGTH`, `SUPPLIER_TC_NO`, `GSM_COATING`, `REMARK`,
  `EL_GL_TYPE`, `INNER_DIA`, `OUTER_DIA`, `VENDOR_GRADE`, `SENT_DATE`) are
  stored directly on `mes.rm_supplier_tc`, one row per batch, upserted in
  place on repeat/corrected sends.
- **Chemical/mechanical fields** (`CARBON_PCT`, `CARBON_EQ`, `MANGANESE_PCT`,
  `PHOSPHORUS_PCT`, `SULPHUR_PCT`, `SILICON_PCT`, `ALUMINIUM_PCT`,
  `NITROGEN_PCT`, `NITROGEN_PPM`, `BORON_PCT`, `COPPER_PCT`, `CHROMIUM_PCT`,
  `NICKEL_PCT`, `TIN_PCT`, `YMPA`, `TMPA`, `EL_PCT`, `HARDNESS`, `UTS`, `YS`,
  `CHEM_1`..`CHEM_5`) and the **general check flags** (`GEN_1`..`GEN_5`) are
  each stored as one row in `mes.rm_supplier_tc_result`, linked to a matching
  code in `mes.quality_parameter_master` (seeded by this same migration —
  see below). A field that's omitted or blank is simply not stored; nothing
  fails.

## Result
On success (`201`):

```json
{
  "messageId": "...",
  "batchId": "...",
  "supplierTcId": "...",
  "characteristicsStored": 30,
  "characteristicsSkipped": []
}
```

- The batch must already exist (i.e. GRN must have been posted first) — this
  is the master-data gate, same principle as the GRN endpoint. If not found,
  the call fails with `422` and the inbound message is marked `FAILED`.
- `characteristicsSkipped` lists any field whose code isn't (yet) active in
  `quality_parameter_master` — visible for monitoring, but never fatal to
  the rest of the call.

## Idempotency
Repeated calls with the same `PLANT_CODE` + `BATCH_NO` + `SUPPLIER_TC_NO`
reuse the same inbound-message row and upsert the same supplier-TC record —
safe to resend.

## Migration
`backend/sql/43_sap_rm_qa_inbound_v0112.sql` (apply via
`backend/APPLY_V0112_RM_QA_INBOUND.bat` or `npm run migrate:v0112`) adds:
- `UNIQUE(batch_id)` on `mes.rm_supplier_tc` — makes the upsert idempotent.
- `UNIQUE(sap_vendor_no)` on `mes.supplier_master`.
- The QA parameter catalog (30 codes matching the fields above) in
  `mes.quality_parameter_master`.
- RM master data sourced from the real SAP extract: storage location `2001`
  (Plant 2000) and suppliers TATA STEEL LTD, NMDC STEEL LIMITED, JSW Steel
  Limited, JSW Vijayanagar Metallics Limited.
