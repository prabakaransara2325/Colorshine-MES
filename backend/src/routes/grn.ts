import { Router } from 'express';
import { query } from '../db';
import { requireAuth } from '../middleware/auth';
import { assertPlantAccess, resolvePlantScope } from '../security';

export const grnRouter = Router();
grnRouter.use(requireAuth);

const grnWhere = `
  WHERE q.sap_material_code LIKE 'R_HR%'
    AND ($1='' OR q.plant_code=$1)
    AND ($2='' OR q.quality_status=$2 OR COALESCE(q.current_ud,'PENDING_UD')=$2)
    AND ($3='' OR q.sap_vendor_no=$3)
    AND ($4='' OR q.sap_grn_no ILIKE '%'||$4||'%'
                 OR q.batch_no ILIKE '%'||$4||'%'
                 OR COALESCE(q.vendor_batch_no,'') ILIKE '%'||$4||'%'
                 OR COALESCE(q.heat_no,'') ILIKE '%'||$4||'%'
                 OR COALESCE(q.hr_grade,'') ILIKE '%'||$4||'%'
                 OR COALESCE(tc.vendor_grade,'') ILIKE '%'||$4||'%'
                 OR COALESCE(q.supplier_name,'') ILIKE '%'||$4||'%'
                 OR COALESCE(q.sap_po_no,'') ILIKE '%'||$4||'%')`;

grnRouter.get('/', async (req, res) => {
  const search = String(req.query.search ?? '').trim();
  const plant = await resolvePlantScope(req.user!.userId, String(req.query.plant ?? ''));
  const status = String(req.query.status ?? '').trim();
  const supplier = String(req.query.supplier ?? '').trim();
  const limit = Math.min(Number(req.query.limit ?? 100), 500);

  const result = await query(`
    SELECT q.*,
           tc.vendor_grade,
           tc.chemical_treatment,
           tc.surface_condition,
           tc.inner_dia_mm,
           tc.outer_dia_mm,
           tc.batch_length_m,
           tc.gsm_coating
    FROM mes.vw_grn_ud_queue q
    LEFT JOIN mes.rm_supplier_tc tc ON tc.batch_id=q.batch_id
    ${grnWhere}
    ORDER BY COALESCE(q.grn_posting_date, CURRENT_DATE) DESC, q.sap_grn_no DESC, q.batch_no
    LIMIT $5`, [plant ?? '', status, supplier, search, limit]);

  res.json({ rows: result.rows });
});

// Download/report dataset: one row per GRN coil plus ALL supplier-TC parameters.
grnRouter.get('/analysis', async (req, res) => {
  const search = String(req.query.search ?? '').trim();
  const plant = await resolvePlantScope(req.user!.userId, String(req.query.plant ?? ''));
  const status = String(req.query.status ?? '').trim();
  const supplier = String(req.query.supplier ?? '').trim();
  const limit = Math.min(Number(req.query.limit ?? 500), 2000);

  const result = await query(`
    SELECT q.*,
           tc.vendor_grade,
           tc.chemical_treatment,
           tc.surface_condition,
           tc.inner_dia_mm,
           tc.outer_dia_mm,
           tc.batch_length_m,
           tc.gsm_coating,
           COALESCE(props.parameters,'{}'::jsonb) AS parameters
    FROM mes.vw_grn_ud_queue q
    LEFT JOIN mes.rm_supplier_tc tc ON tc.batch_id=q.batch_id
    LEFT JOIN LATERAL (
      SELECT jsonb_object_agg(
               p.parameter_code,
               jsonb_build_object(
                 'name', p.parameter_name,
                 'category', p.parameter_category,
                 'value', COALESCE(r.numeric_value::text, r.text_value, r.source_raw_value),
                 'uom', COALESCE(r.uom, p.default_uom, '')
               )
               ORDER BY p.parameter_category, p.parameter_name
             ) AS parameters
      FROM mes.rm_supplier_tc_result r
      JOIN mes.quality_parameter_master p ON p.parameter_id=r.parameter_id
      WHERE r.supplier_tc_id=tc.supplier_tc_id
    ) props ON true
    ${grnWhere}
    ORDER BY COALESCE(q.grn_posting_date, CURRENT_DATE) DESC, q.sap_grn_no DESC, q.batch_no
    LIMIT $5`, [plant ?? '', status, supplier, search, limit]);

  res.json({ rows: result.rows });
});

grnRouter.get('/batch/:batchNo', async (req, res) => {
  const batchNo = req.params.batchNo;
  const head = await query(`
    SELECT q.*,
           tc.vendor_grade,
           tc.chemical_treatment,
           tc.surface_condition,
           tc.elongation_gl_type,
           tc.inner_dia_mm,
           tc.outer_dia_mm,
           tc.batch_length_m,
           tc.gsm_coating,
           tc.remarks AS supplier_tc_remarks
    FROM mes.vw_grn_ud_queue q
    LEFT JOIN mes.rm_supplier_tc tc ON tc.batch_id=q.batch_id
    WHERE q.batch_no=$1
    LIMIT 1`, [batchNo]);

  if (!head.rows[0]) return res.status(404).json({ error: 'Batch not found' });
  await assertPlantAccess(req.user!.userId, head.rows[0].plant_code);

  const tc = await query(`
    SELECT p.parameter_code,
           p.parameter_name,
           p.parameter_category,
           p.default_uom,
           p.decimal_places,
           r.numeric_value,
           r.text_value,
           r.uom,
           r.source_field_name,
           r.source_raw_value
    FROM mes.rm_supplier_tc_result r
    JOIN mes.rm_supplier_tc tc ON tc.supplier_tc_id=r.supplier_tc_id
    JOIN mes.quality_parameter_master p ON p.parameter_id=r.parameter_id
    WHERE tc.batch_no=$1
    ORDER BY p.parameter_category,p.parameter_name,p.parameter_code`, [batchNo]);

  const moves = await query(`
    SELECT mv.*
    FROM mes.rm_inventory_movement mv
    JOIN mes.batch_master b ON b.batch_id=mv.batch_id
    WHERE b.batch_no=$1
    ORDER BY mv.posted_at DESC`, [batchNo]);

  res.json({ ...head.rows[0], supplierTcParameters: tc.rows, movements: moves.rows });
});
