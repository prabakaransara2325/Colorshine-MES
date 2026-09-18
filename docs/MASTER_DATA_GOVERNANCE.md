# Colorshine MES V2 — Master Data Governance (v0.2)

## Maintenance model

Master Data is maintained in a compact table view on desktop, laptop, tablet and mobile. The table is horizontally scrollable on smaller screens so the same controlled tabular representation is retained instead of switching to cards.

Only users with the `ADMIN` role can create, edit, activate or deactivate masters. Other authenticated users can view active masters through the existing read APIs.

## Supported master areas

- Suppliers
- Materials
- Plants
- Storage Locations
- Customers
- Brands
- Quality Parameters

## Business-key policy

Business keys cannot be changed after creation. Examples: SAP Vendor No, Material Code, Plant Code, Storage Location, Customer No, Brand Code and Quality Parameter Code. Descriptions and other attributes can be edited.

Manually created records in SAP-replica masters are stamped with `source_system = MES` so they can be distinguished from future SAP-synchronized records.

## Deactivation policy

No physical delete is exposed. Deactivation changes `is_active` to false and writes an audit entry.

Before deactivation, the API checks current/open dependencies. If one exists, the action is blocked and the UI explains why.

Current checks include:

| Master | Blocking checks |
|---|---|
| Supplier | On-hand RM inventory, pending/in-progress RM inspection, future open PO/PR if those tables exist |
| Material | On-hand inventory, pending/in-progress RM inspection, future open production order, production plan, sales-order line |
| Plant | On-hand inventory, pending/in-progress RM inspection, active MES users assigned to plant, future open production order/plan |
| Storage Location | On-hand inventory, future open production order/plan |
| Quality Parameter | Pending/in-progress inspection use, Draft/Pending Approval/Active TDC use |
| Customer | Draft/Pending Approval/Active TDC, future open sales order |
| Brand | Draft/Pending Approval/Active TDC |

Future production/planning checks are schema-aware: the backend checks whether those future tables/columns exist before applying the rule, so Phase 1 works now and the guard automatically begins applying when compatible future tables are introduced.

Historical references do not block deactivation. They remain intact for traceability and audit.

## API

- `GET /api/masters/:type?active=all`
- `POST /api/masters/:type`
- `PUT /api/masters/:type/:key`
- `GET /api/masters/:type/:key/deactivation-check`
- `POST /api/masters/:type/:key/deactivate`
- `POST /api/masters/:type/:key/activate`

Write endpoints require `ADMIN`.
