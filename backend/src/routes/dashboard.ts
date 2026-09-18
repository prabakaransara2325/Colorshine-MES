import { Router } from 'express';
import { query } from '../db';
import { requireAuth } from '../middleware/auth';
import { resolvePlantScope } from '../security';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/summary', async (req, res) => {
  const plant = await resolvePlantScope(req.user!.userId, String(req.query.plant ?? ''));
  const p=plant ?? '';

  const result = await query(`
    WITH inv AS (
      SELECT
        COALESCE(sum(batch_qty_mt),0) AS on_hand_mt,
        COALESCE(sum(batch_qty_mt) FILTER (WHERE UPPER(COALESCE(stock_status,''))='AVAILABLE'),0) AS available_mt,
        COALESCE(sum(batch_qty_mt) FILTER (WHERE UPPER(COALESCE(stock_status,''))='QUALITY_HOLD'),0) AS quality_hold_mt,
        COALESCE(sum(batch_qty_mt) FILTER (WHERE UPPER(COALESCE(stock_status,''))='BLOCKED'),0) AS blocked_mt,
        count(*) FILTER (WHERE UPPER(COALESCE(qa_grade,'')) IN ('','PENDING_QA')) AS pending_batches
      FROM mes.vw_rm_store_inventory
      WHERE ($1='' OR plant_code=$1)
    ), grn AS (
      SELECT
        count(*) AS coils,
        COALESCE(sum(batch_qty_mt),0) AS received_mt,
        count(DISTINCT sap_grn_no) FILTER (WHERE NULLIF(sap_grn_no,'') IS NOT NULL) AS grns
      FROM mes.vw_rm_store_inventory
      WHERE ($1='' OR plant_code=$1)
    ), sup AS (
      SELECT count(DISTINCT rm_supplier) FILTER (WHERE NULLIF(rm_supplier,'') IS NOT NULL) AS suppliers
      FROM mes.vw_rm_store_inventory
      WHERE ($1='' OR plant_code=$1)
    )
    SELECT * FROM inv CROSS JOIN grn CROSS JOIN sup`, [p]);

  res.json(result.rows[0]);
});

// RM Stores dashboard: uses the same unified RM inventory as Screen 1102.
dashboardRouter.get('/rm-stores', async (req,res) => {
  const plant=await resolvePlantScope(req.user!.userId,String(req.query.plant??''));
  const p=plant ?? '';

  const [summary,recent]=await Promise.all([
    query(`
      SELECT
        count(DISTINCT batch_no)::int AS total_coils,
        COALESCE(sum(batch_qty_mt),0)::numeric(18,3) AS total_qty_mt,
        COALESCE(sum(batch_qty_mt) FILTER (WHERE UPPER(COALESCE(qa_grade,''))='PRIME'),0)::numeric(18,3) AS prime_qty_mt,
        COALESCE(sum(batch_qty_mt) FILTER (WHERE storage_location='2001'),0)::numeric(18,3) AS storage_2001_qty_mt,
        COALESCE(sum(batch_qty_mt) FILTER (WHERE UPPER(COALESCE(storage_location,''))='RC01'),0)::numeric(18,3) AS storage_rc01_qty_mt,
        count(*) FILTER (WHERE UPPER(COALESCE(qa_grade,'')) IN ('','PENDING_QA'))::int AS pending_qa_coils,
        count(DISTINCT sap_grn_no) FILTER (WHERE NULLIF(sap_grn_no,'') IS NOT NULL)::int AS grns,
        count(DISTINCT rm_supplier) FILTER (WHERE NULLIF(rm_supplier,'') IS NOT NULL)::int AS suppliers
      FROM mes.vw_rm_store_inventory
      WHERE ($1='' OR plant_code=$1)
        AND material_code LIKE 'R_HR%'`,[p]),
    query(`
      SELECT
        row_id AS inventory_id,plant_code,storage_location,material_code,material_description,
        batch_no,batch_qty_mt,qa_grade,stock_status,thickness_mm,width_mm,sap_grn_no,
        rm_supplier,supplier_batch,heat_no,rm_steel_grade,stock_generated_date
      FROM mes.vw_rm_store_inventory
      WHERE ($1='' OR plant_code=$1)
        AND material_code LIKE 'R_HR%'
      ORDER BY stock_generated_date DESC NULLS LAST,updated_at DESC
      LIMIT 12`,[p])
  ]);

  res.json({summary:summary.rows[0]??{},recent:recent.rows});
});
