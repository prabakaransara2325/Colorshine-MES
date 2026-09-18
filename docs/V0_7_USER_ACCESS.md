# Colorshine MES V2 — v0.7 User & Access Group Foundation

This release keeps the validated Phase-1 MES transaction flow and adds the first authorization layer:

**USER → ACCESS GROUP → COMPANY → PLANT**

## Access groups currently configured
- `RM_STORE_1000_TEAM` — Plant 1000 only
- `RM_STORE_2000_TEAM` — Plant 2000 only
- `RM_STORE_HEAD` — Plants 1000 + 2000 + consolidated ALL view
- `SYSTEM_ADMIN` — Plants 1000 + 2000 + consolidated ALL view

## User Management
System Administrators can now use **Profile → User Management** to:
- create users
- maintain employee ID, name, email, mobile, department and designation
- assign one or more access groups
- set home/default plant only within authorized plant scope
- set validity dates
- reset password
- force password change at next login
- lock/unlock account
- deactivate/reactivate account

Users are never physically deleted. Historical transaction/audit references remain intact.

## Plant isolation already enforced by backend
RM operational APIs resolve plant scope from the database, not from the browser only.

- Plant 1000 store user cannot request Plant 2000 GRN/inventory/quality/report data.
- Plant 2000 store user cannot request Plant 1000 data.
- RM Stores Head can select ALL / 1000 / 2000.
- A single-plant user's header shows the authorized plant as locked.

Direct attempts to request an unauthorized plant return **403 Forbidden**.

## Immediate account enforcement
User active/locked/validity state is checked against PostgreSQL on every authenticated API request. Locking or deactivating a user therefore invalidates practical access immediately, even if an old JWT has not expired.

## Password handling
When an administrator resets a password with **Force password change**, the user is redirected to the dedicated password-change page before MES transactions are available.

## Database migration
The database foundation required by this release is:

`backend/sql/10_user_access_group_foundation.sql`

If you have already run that migration successfully, **do not need to run another SQL migration for v0.7**.

## Apply the application update
Replace the supplied backend and frontend application files, then restart both services.

### Backend
```powershell
cd D:\Colorshine\Color_MES\ColorshineMes\backend
npm install
npm run dev
```

### Frontend
```powershell
cd D:\Colorshine\Color_MES\ColorshineMes\frontend
npm install
npm run dev
```

Then press **Ctrl + F5** in the browser.

## Recommended validation
1. Login as `ADMIN`.
2. Open **ADMIN → User Management**.
3. Create a Plant 1000 store user and assign `RM_STORE_1000_TEAM`.
4. Login as that user — Plant 1000 must be locked in the header.
5. Confirm GRN / RM Inventory show only Plant 1000.
6. Try a manual API request for `plant=2000` — it must return 403.
7. Create a Plant 2000 store user and repeat the reverse test.
8. Create an RM Stores Head user with `RM_STORE_HEAD` — header must offer ALL, 1000 and 2000.

## Next authorization phase
The next migration will attach the six business modules and their dashboards/screens/actions to access groups:

1. RM Stores
2. Planning
3. Production
4. Quality
5. Maintenance
6. Reports

The final chain will be:

**USER → ACCESS GROUP → COMPANY → PLANT → MODULE → SCREEN → ACTION**
