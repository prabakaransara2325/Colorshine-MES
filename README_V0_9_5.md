# Colorshine MES V2 v0.9.5

## RM Stores fresh-start correction

This release prepares RM Stores for a clean one-time CURRENT RM opening inventory upload.

### Screen 1101 - GRN Monitor
- RM Stores GRN Monitor now restricts data to `R_HR*` raw-material codes.
- Fresh opening inventory is posted into canonical `goods_receipt` / `goods_receipt_coil` / `batch_master` records.
- Therefore the same migrated coil appears in GRN Monitor automatically.

### Screen 1102 - RM Inventory
- Title is `RM Inventory`.
- No KPI tiles on this screen.
- No WIP / FG category or tiles.
- No Sales Order fields.
- Only `R_HR*` raw-material coils.
- Filters are exactly:
  1. Material Code
  2. Batch No
  3. Storage Location
  4. Heat No
  5. Supplier
  6. QA Grade
  7. Steel Grade
- Screen 1102 reads canonical RM inventory, the same batch source used by GRN Monitor.

### SQL execution order
Run now:
1. `23_fresh_rm_inventory_reset_and_upload_foundation.sql`
   - removes pilot batch `26HW0466R0`
   - clears old `inventory_master` snapshot
   - creates opening upload run/staging tables
   - creates validation/posting functions
   - switches RM Stores to canonical inventory source
2. `24_rm_qa_reference_stage_load.sql`
   - loads 8,714 RM_QA rows as reference staging only
   - DOES NOT create stock
   - matching QA will enrich only the fresh current inventory batches later uploaded

Do NOT run archived SQL 22. It represented the earlier historical RM_GRN-as-opening-stock approach and is intentionally retired.

### Next fresh inventory file
When the current inventory file is supplied, generate/load only current Plant 2000 `R_HR*` coils into `mes.rm_opening_inventory_upload`, validate the run, then execute `mes.post_rm_opening_inventory_run(...)`.
The post function creates canonical GRN + batch + inventory records, so GRN Monitor and RM Inventory stay synchronized.
