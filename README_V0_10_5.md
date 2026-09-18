# Colorshine MES V2 v0.10.5 — SAP Sales Order Inbound First

This patch does two things in the correct sequence:

1. Fixes the v0.10.4 master-creation failure (`operation_master.sequence_no` is INTEGER, not text).
2. Adds a raw-first SAP Sales Order inbound landing area and Planning Screen **2101 — SAP Sales Order Monitor**.

## Why raw-first
SAP sales-order interface records are stored exactly as received before MES master validation. Missing local material/plant mappings produce `MASTER_PENDING`; they do not reject or delete the inbound SAP row.

## Supplied SAP sample validated
- Sales Order: `3600000181`
- SO items: **5**
- Total quantity: **1,205.240 MT**
- Process path variants: **26**
- Order characteristics: **7,636**
- Chemistry/mechanical characteristics: **776**
- Duplicate business keys in the supplied files: **0**

The supplied SAP item material is `BGLSAZ150CF`. The approved workbook master currently contains `BGLAZ150CF`. v0.10.5 intentionally does **not** silently rename either value. The SAP order lands successfully and Screen 2101 flags the item as `MASTER_PENDING` until the master-code decision is made.

## Thickness proof from SAP sample
For item 10 / P1:
- CR AIM 1.155, MIN 1.150, MAX 1.160 → ±0.005 mm
- GI/GL AIM 1.200, MIN 1.195, MAX 1.205 → ±0.005 mm

v0.10.4/v0.10.5 master logic continues to use exactly **0.005 mm**, never 0.050 mm.

## Install
Extract over:
`D:\Colorshine\Color_MES\ColorshineMes`

Recommended one-click setup:
`backend\APPLY_AND_IMPORT_V0105_SAP_SO.bat`

Or separately:
1. `backend\APPLY_V0105_SAP_SO_INBOUND.bat`
2. `backend\IMPORT_SAMPLE_SAP_SO_V0105.bat`

After that restart backend/frontend, Ctrl+F5, and open Screen **2101**.

## Live SAP/Oracle inbound endpoints
Existing integration key protection is used.
- `POST /api/integration/sap/so/header`
- `POST /api/integration/sap/so/process-path`
- `POST /api/integration/sap/so/order-detail`
- `POST /api/integration/sap/so/chem-mech`

Each endpoint accepts one row, an array of rows, or `{ "rows": [...] }`. Send large characteristic feeds in batches of <= 2000 rows.

## MES landing tables
- `mes.sap_sales_order_item`
- `mes.sap_sales_order_route`
- `mes.sap_sales_order_characteristic`
- `mes.sap_so_inbound_run`
- `mes.vw_sap_sales_order_monitor`
- `mes.vw_sap_so_item_key_specs`

## Planning Screen 2101
Compact server-paged monitor with:
- SO / Item
- Material
- Qty
- Customer
- Plant
- Required/Release date
- Order thickness / width
- route count
- order-spec count
- chemistry/mechanical count
- Planning status

Open a row for SAP route variants, key order specifications and chemistry/mechanical limits.
