# Colorshine MES Screen Register v0.8

Screen numbers are permanent identifiers. Once a screen is released, its number must not be reused for another screen.

| Screen No | Module | Screen | Route |
|---|---|---|---|
| 0001 | MES | MES Overview | `/` |
| 1000 | RM Stores | RM Stores Dashboard | `/modules/rm-stores` |
| 1101 | RM Stores | GRN Monitor | `/grn` |
| 1102 | RM Stores | RM Inventory | `/inventory` |
| 2000 | Planning | Planning Dashboard | `/modules/planning` |
| 3000 | Production | Production Dashboard | `/modules/production` |
| 4000 | Quality | Quality Dashboard | `/modules/quality` |
| 4101 | Quality | RM Usage Decision | `/quality` |
| 4201 | Quality | TDC Management | `/tdc` |
| 5000 | Maintenance | Maintenance Dashboard | `/modules/maintenance` |
| 6000 | Reports | Reports Dashboard | `/modules/reports` |
| 6101 | Reports | Supplier Report | `/suppliers` |
| 9001 | Administration | User Management | `/admin/users` |
| 9002 | Administration | Master Data | `/masters` |

## Number ranges

- `0xxx`: Enterprise / common screens
- `1xxx`: RM Stores
- `2xxx`: Planning
- `3xxx`: Production
- `4xxx`: Quality
- `5xxx`: Maintenance
- `6xxx`: Reports
- `9xxx`: System Administration

Future module screens should be registered in `src/navigation.ts` before development.

| 9003 | ADM | User Maintenance | /admin/users/manage | Create/Edit user full-page maintenance |

## Module 7 – Masters (v0.9.0 addition)

| Screen No | Screen Code | Screen Name | Route |
|---|---|---|---|
| 7000 | MDM_DASHBOARD | Masters Dashboard | /modules/masters |
| 7101 | MDM_THICKNESS_MATRIX | Thickness Matrix | /masters/thickness-matrix |
| 7102 | MDM_WORK_CENTERS | Work Center Master | /masters/work-centers |
| 7103 | MDM_WC_TOLERANCE | Work Center Tolerance Matrix | /masters/work-center-tolerance |

These numbers are proposed/current working numbers and can be replaced by the final approved screen-number register without changing the permanent `screen_code` / `screen_id` identity.
