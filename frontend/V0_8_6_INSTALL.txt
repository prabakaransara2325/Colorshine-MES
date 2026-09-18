# Colorshine MES V2.0.8.6 — Working Screen Reliability Fix

This build fixes two issues reported on MES Overview:

1. Clicking a Favorite transaction screen such as **1102 RM Inventory** could show **Unexpected server error** if the Working Screens database object was missing/out of sync.
2. Processing screens were not reliably appearing in the Working Screens tab strip.

## What changed

- Working tabs are created **immediately in the frontend** when a transaction screen opens.
- Maximum 8 screens is enforced before opening a 9th screen.
- Tabs are restored per logged-in user from a local resilience cache and synchronized to PostgreSQL when available.
- The backend now checks Working Screens storage readiness and returns a controlled `WORKING_SCREENS_NOT_READY` response instead of a generic 500 error.
- New idempotent repair migration: `backend/sql/14_working_screens_repair.sql`.
- Dashboard screens do not consume Working Screen slots; transaction/processing screens do.
- Favorite tiles, Module Launcher, Screen Number direct call, and direct URL navigation all use the same Working Screen behavior.

## Required database step

Run in `colorshine_mes` using pgAdmin:

`backend/sql/14_working_screens_repair.sql`

At the bottom, both values should be non-null:

- `mes.app_user_working_screen`
- `mes.vw_user_working_screens`

## Restart

Backend:

```powershell
cd D:\Colorshine\Color_MES\ColorshineMes\backend
npm run dev
```

Frontend:

```powershell
cd D:\Colorshine\Color_MES\ColorshineMes\frontend
npm run dev
```

Then press **Ctrl + F5** in Chrome.

## Test

From Screen 0001, click Favorite **1102 RM Inventory**.

Expected:
- RM Inventory opens.
- A Working Screen tab `1102 RM Inventory ×` appears under the main header.
- No server-error toast appears.

Open 1101, 1102, 4101, 4201, 6101, 9001, 9002 and 9003. Attempting a ninth processing screen must ask the user to close an existing unused screen first.
