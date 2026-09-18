# Colorshine MES V2 v0.11.1 — TDC Source Templates + Initial TDC Seed

Scope: **Company 2000 / Plant 2000**.

This release keeps the v0.11.0 template-driven TDC framework and loads the first real source data. It also adds a separate **Document No** field to the TDC header so the Colorshine controlled document number is not incorrectly stored as Customer Reference.

## System templates

The system-created templates are now prefilled from the approved source formats. Each first template is kept exact to its selected source format; future characteristic additions are made by **Copy as New Template**:

- `SYS_BGL_GL_2000_V1` — BGL / GL TDC - Plant 2000 - Base Template V1 — 29 source fields
- `SYS_CRFH_2000_V1` — CRFH TDC - Plant 2000 - Base Template V1 — 27 source fields
- `SYS_HRPO_2000_V1` — HRPO TDC - Plant 2000 - Base Template V1 — 20 source fields

Template default values are only starting values for a new DRAFT TDC. The user can change them before Creator Approval. ACTIVE templates remain immutable; add/change characteristics by copying the template to a new template code/name.

## Initial TDCs imported

The following source TDCs are loaded as historical **APPROVED V01** records:

- `BGL/OEM/0011` — Bondada Green Engineering Pvt Ltd
- `CRFH/OEM/0002` — Krishca Strapping Solutions Ltd
- `HRPO/CIPL/0001` — JBM Group

These imported versions are immutable. Approval rows are recorded as `LEGACY_IMPORT`, because their original approvals happened before the MES workflow.

The CRFH customer comments are preserved separately from the Colorshine specification. Where the customer changed the requirement, **Final Agreed Specification** stores the agreed customer requirement.

## Number objects

Importing historical TDCs does **not** consume a number.

Protected minimum counters remain:

- BGL / OEM current >= 11 → next is at least `BGL/OEM/0012`
- CRFH / OEM current >= 2 → next is at least `CRFH/OEM/0003`
- HRPO / CIPL current >= 1 → next is at least `HRPO/CIPL/0002`

If newer TDCs were already created, the migration never moves the counter backwards.

## Installation

1. Back up PostgreSQL.
2. Stop backend and frontend.
3. Extract this full package over the existing `D:\Colorshine\Color_MES\ColorshineMes` folder.
4. In `backend`, run `APPLY_V0111_TDC_SOURCE_SEED.bat`.
5. Run `VERIFY_V0111_TDC_SOURCE_SEED.bat`.
6. Restart backend and frontend.
7. Press **Ctrl+F5** in Chrome.
8. Confirm footer **MES V2 0.11.1**.
9. Open **Quality → 4200 TDC Template Master** and **4201 TDC Register**.

No existing user-created TDC is deleted or overwritten by this seed.
