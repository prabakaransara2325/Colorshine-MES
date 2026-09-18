# Colorshine MES V2 v0.10.7 — ADMIN Access Repair

This release fixes the login blocker shown after v0.10.6:

`No active company/plant access group is assigned to this user`

The cause is a migration compatibility gap: an older administrator can have the legacy `ADMIN` role without an active `SYSTEM_ADMIN` assignment in the newer company/plant access model.

## Repair behavior

Only users that **already have the legacy ADMIN role** are eligible for automatic repair. They are assigned to `SYSTEM_ADMIN`, which is mapped to Companies/Plants `1000` and `2000` with consolidated access. Normal users are never auto-promoted.

Login contains the same idempotent compatibility repair so this bootstrap gap does not recur. The `seed:admin` script has also been updated to create the access-group assignment at the time an administrator is seeded.

## One-time install step

Run:

`backend\REPAIR_ADMIN_ACCESS_V0107.bat`

Then restart the backend, refresh the browser with `Ctrl+F5`, and sign in again.

This patch does **not** delete or recreate master data.
