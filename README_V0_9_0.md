# Colorshine MES V2 v0.9.0 – Masters Module

Adds a dedicated **Masters** business module (Module 7) with:

- **7000 – Masters Dashboard**
- **7101 – Thickness Matrix** (Plant 2000 / CIPL)
- **7102 – Work Center Master** (initial Plant 2000 work centers)
- **7103 – Work Center Tolerance Matrix** (work-center-wise capability/tolerance maintenance)

## Plant 2000 work centers

- HRS01 – HR Slitter Line
- PPL01 – Push Pull Pickling Line
- CRM01 – 6Hi CR Mill
- CRS01 – CR Rewinding & Trimming Line
- CGL01 – Continuous Galvalume Line
- PACK2 – CIPL Packing Line

## Database order

If Planning foundation has not yet been completed, run:

1. `backend/sql/15_planning_plant2000_foundation.sql`
2. `backend/sql/16_planning_thickness_matrix_plant2000_seed_v2.sql`
3. `backend/sql/17_work_center_master_plant2000.sql`
4. `backend/sql/18_masters_module_and_tolerance.sql`

If SQL 15/16/17 are already complete, run only SQL 18.

## Important

No work-center tolerance values have been invented or auto-seeded. Screen 7103 is intentionally empty until actual Production/Quality tolerances are maintained.

The six work centers are a master list, **not a production route**. Product/TDC/process routing will be maintained separately.
