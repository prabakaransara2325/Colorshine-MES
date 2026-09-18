# SAP GRN inbound API

Endpoint: `POST /api/integration/sap/grn`

Header:

`X-MES-Integration-Key: <SAP_INBOUND_API_KEY>`

The payload uses the existing source field names from `IFTLI_L4L3_RM_POST_GRN_DETAILS`, so SAP / middleware does not have to learn a second field vocabulary.

Example using the validated batch:

```json
{
  "PLANT_CODE": "2000",
  "BATCH_NO": "26HW0466R0",
  "BATCH_THICK": 2.500,
  "BATCH_WIDTH": 1230,
  "BATCH_WEIGHT": 20.900,
  "RM_SOURCE": "0011000122",
  "MATERIAL_CODE": "R_HR_CO",
  "VENDOR": "NMDC STEEL LIMITED",
  "VENDOR_BATCH": "D204331105",
  "GRN": "5000108243",
  "PO_LINE_NO": "30",
  "PO_NO": "4600000344",
  "MOVEMENT_TYPE": "101",
  "STORAGE_LOC": "2001",
  "EQ_SPEC": "11513:2017",
  "EQ_SPEC_GROUP": "BIS",
  "EQ_SUB_SPEC": "cr3",
  "CROWN": 7.453,
  "READ_FLAG": "1",
  "CREATED_BY": "PLANT_GRN2",
  "CREATED_DATE": "2026-08-08T05:30:00+05:30",
  "PO_DELIVERY_DATE": "2026-08-11"
}
```

## Result
On the first successful call:
- integration inbox row is retained;
- GRN header is created/reused;
- root raw-material batch is created/reused;
- GRN coil is created exactly once;
- database trigger puts the quantity into `QUALITY_HOLD`;
- response returns the resulting inventory.

Repeated calls with the same idempotency key do not duplicate stock.

## Master-data gate
The call fails safely when Plant, Storage Location, Material or Supplier is not configured. The inbound message is marked `FAILED` with the reason for monitoring/retry.
