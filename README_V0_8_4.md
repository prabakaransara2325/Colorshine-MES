# Colorshine MES V2.0.8.4 — Working Screens

This update adds a persistent **Working Screens** tab strip below the main header.

## Business rules
- Maximum 8 processing screens per user.
- Dashboard screens are not counted as working screens.
- Opening a screen already in the bar activates the existing tab; duplicates are not created.
- Opening a 9th processing screen is blocked. The user is shown the 8 open screens and must close an unused one.
- The application never auto-closes a working screen.
- Each tab has a close button.
- `Close Others` and `Close All` are provided.
- Open tabs are stored in PostgreSQL per user and return after refresh/login until the user closes them.
- Plant selection is retained while switching tabs.
- A foundation event `mes:screen-dirty` is supported for future transaction pages to warn before closing unsaved work.

## Database
Run after SQL 11/12:

`backend/sql/13_user_working_screens.sql`

It creates `mes.app_user_working_screen` and `mes.vw_user_working_screens` and enforces the 8-screen maximum at database level.

## Backend
New endpoints:
- `GET /api/user/working-screens`
- `POST /api/user/working-screens`
- `DELETE /api/user/working-screens/:screenCode`
- `DELETE /api/user/working-screens`
- `POST /api/user/working-screens/close-others`

## Frontend
The working tab bar is placed under the primary MES header and above the current-screen context strip. It is horizontally scrollable on smaller devices.

## Installation
1. Run `13_user_working_screens.sql` in `colorshine_mes`.
2. Replace backend/frontend files from this update.
3. Restart backend and frontend.
4. Hard-refresh Chrome (`Ctrl + F5`).
