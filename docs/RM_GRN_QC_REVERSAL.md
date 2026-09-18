# RM GRN / QC Reversal (v0.11.3)

## Two bugs fixed first
Every GRN receipt was permanently stuck in `QUALITY_HOLD`:
1. Nothing in the system ever created `mes.rm_quality_inspection` rows, so
   Quality > RM Usage Decision could never post a decision
   ("No inspection record is linked to this batch."). Fixed with a new
   trigger `trg_create_rm_inspection_from_grn` (mirrors the existing GRN
   inventory trigger) plus a backfill for GRNs received before this fix.
2. The `/decision` endpoint's query combined `FOR UPDATE` with a `LEFT JOIN`,
   which PostgreSQL always rejects ("FOR UPDATE cannot be applied to the
   nullable side of an outer join") — so even with an inspection record,
   posting a decision would 500. Fixed with `FOR UPDATE OF qi`.

## Reversal feature
Scope note: **RM only today.** Every reversal row carries `process_area`
(`RM` / `PAINTS`) so the same authorization object, log table and report
extend to Paints once that module exists — nothing else needs to change.

**Rule:** if QC (Usage Decision) has been posted, it must be reversed before
the GRN can be reversed. GRN Reversal is blocked with a clear error
otherwise.

**Authorization object**: access group `RM_GRN_QC_REVERSAL_2000` (or
ADMIN role) is required for both reversal actions. Assign it to a user via
**Admin > User Management > Access Groups**.

**QC Reversal** — `POST /api/rm-quality/:inspectionId/reverse`
- Reverses the current Usage Decision's inventory movement (AVAILABLE/BLOCKED
  → back to QUALITY_HOLD), sets it `is_current=false`, resets the inspection
  to `PENDING` so it reappears in the RM Usage Decision queue.

**GRN Reversal** — `POST /api/grn/:grnCoilId/reverse`
- Blocked while a final Usage Decision (ACCEPT/CONDITIONAL_ACCEPT/REJECT) is
  still current for the batch.
- Deletes the live `rm_inventory_balance` row entirely (per requirement).
- Posts a `REVERSAL` inventory movement (QUALITY_HOLD → EXTERNAL).
- Closes the batch (`lifecycle_status='CLOSED'`).

Both actions require a `reason` (min 5 chars) and record `reversed_by`,
`reversed_at`, `client_ip` (server-captured, reliable) and `client_host`
(best-effort browser label — **a browser cannot read the real Windows PC
hostname**; this is a deliberate browser security restriction, not a gap in
this implementation. `client_ip` is the trustworthy "which machine" anchor,
consistent with how `audit_log.ip_address` is already used elsewhere in this
app).

## Where it shows up
- **GRN Monitor** (screen 1101): reversed GRNs show an extra highlighted row
  with a **negative** quantity, "Reversed by ... on ... — reason", right
  alongside the original receipt line.
- **RM Reversal Report** (new screen 1103, RM Stores): full audit list for
  both GRN and QC reversals, separately.
- Both reversal actions are also available from the GRN Monitor's Analysis
  drawer ("Reverse QC" / "Reverse GRN" buttons — visible only to authorized
  users).

## Migration
`backend/sql/44_rm_grn_qc_reversal_v0113.sql` — apply via
`backend/APPLY_V0113_RM_REVERSAL.bat` or `npm run migrate:v0113`.
