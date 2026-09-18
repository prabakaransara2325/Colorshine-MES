# Colorshine MES V2 v0.8.5

## Purpose
Complete project package consolidating the current MES work through v0.8.5.

## v0.8.5 launcher correction
- Reworked the Modules & Screens launcher to prevent MES Overview text/favorite overflow.
- Replaced the malformed Overview card with a compact Home row.
- Removed horizontal scrolling from the module rail.
- Reduced launcher width/height and tightened spacing.
- Kept module-based accent colors and the existing launcher pattern.
- Retained Favorites, direct Screen Number calling, Working Screens (max 8), User Management, plant scope and all existing Phase-1 RM functions.

## Included database migrations
Run only those not already applied, in order:
1. backend/sql/09_app_security.sql
2. backend/sql/10_user_access_group_foundation.sql
3. backend/sql/11_module_screen_master.sql
4. backend/sql/12_user_screen_favorites.sql
5. backend/sql/13_user_working_screens.sql

## Existing database
Do NOT recreate the Colorshine MES database if it is already running. This package is designed to continue using the existing `colorshine_mes` PostgreSQL database.

## Install / replace
Recommended project folder:
`D:\Colorshine\Color_MES\ColorshineMes`

Do not overwrite a working `.env` with `.env.example`.

Backend:
```powershell
cd D:\Colorshine\Color_MES\ColorshineMes\backend
npm install
npm run dev
```

Frontend:
```powershell
cd D:\Colorshine\Color_MES\ColorshineMes\frontend
npm install
npm run dev
```

Then use Ctrl+F5 in Chrome.

## Screen register
A draft screen register workbook is included under `docs/Colorshine_MES_V2_Draft_Screen_Register.xlsx` for final numbering review.
