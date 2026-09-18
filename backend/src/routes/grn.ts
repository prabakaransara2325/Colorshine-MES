import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db';
import { requireAuth } from '../middleware/auth';
import { assertPlantAccess, assertReversalAuthority, resolvePlantScope } from '../security';

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
    FROM mes.vw_grn_monitor_feed q
    LEFT JOIN mes.rm_supplier_tc tc ON tc.batch_id=q.batch_id
    ${grnWhere}
    ORDER BY COALESCE(q.grn_posting_date, CURRENT_DATE) DESC, q.sap_grn_no DESC, q.batch_no, q.entry_type
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
    FROM mes.vw_grn_monitor_feed q
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

// ---------------------------------------------------------------------------
// v0.11.3 GRN Reversal. RM only today. Blocked while a final QC Usage
// Decision (ACCEPT/CONDITIONAL_ACCEPT/REJECT) is still current for the batch
// - QC must be reversed first. The live inventory balance row is removed
// entirely; the reversal shows up as a negative-quantity line in GRN Monitor
// via vw_grn_monitor_feed, and in the RM Reversal Report.
// ---------------------------------------------------------------------------
const grnReversalSchema = z.object({
  reason: z.string().min(5).max(1000),
  clientHost: z.string().max(120).optional().nullable()
});

grnRouter.post('/:grnCoilId/reverse', async (req, res) => {
  const parsed = grnReversalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid reversal request', details: parsed.error.flatten() });
  await assertReversalAuthority(req.user!.userId, req.user!.roles);

  const response = await tx(async (client) => {
    const coil = await client.query(`
      SELECT c.grn_coil_id,c.batch_id,c.plant_code,c.storage_location,b.batch_no
      FROM mes.goods_receipt_coil c JOIN mes.batch_master b ON b.batch_id=c.batch_id
      WHERE c.grn_coil_id=$1 FOR UPDATE`, [req.params.grnCoilId]);
    if (!coil.rows[0]) { const e:any=new Error('GRN coil not found'); e.status=404; throw e; }
    const { batch_id, plant_code, storage_location } = coil.rows[0];
    await assertPlantAccess(req.user!.userId, plant_code);

    const activeUd = await client.query(`
      SELECT ud_no,decision FROM mes.rm_usage_decision
      WHERE batch_id=$1 AND is_current=true AND decision IN ('ACCEPT','CONDITIONAL_ACCEPT','REJECT') LIMIT 1`, [batch_id]);
    if (activeUd.rows[0]) {
      const e:any=new Error(`QC Usage Decision ${activeUd.rows[0].ud_no} (${activeUd.rows[0].decision}) is still active for this batch. Reverse QC first, then GRN.`);
      e.status=409; throw e;
    }

    const bal = await client.query(`
      SELECT * FROM mes.rm_inventory_balance WHERE batch_id=$1 FOR UPDATE`, [batch_id]);
    const totalHeld = bal.rows.reduce((s:number,r:any)=>s+Number(r.quality_hold_weight_mt||0),0);
    const totalElsewhere = bal.rows.reduce((s:number,r:any)=>s+Number(r.available_weight_mt||0)+Number(r.reserved_weight_mt||0)+Number(r.blocked_weight_mt||0),0);
    if (totalElsewhere > 0) { const e:any=new Error('Batch has stock outside Quality Hold. Reverse the QC Usage Decision first, then GRN.'); e.status=409; throw e; }
    if (totalHeld <= 0) { const e:any=new Error('No Quality Hold stock to reverse for this batch (already reversed or consumed).'); e.status=409; throw e; }

    const rv = await client.query(`
      INSERT INTO mes.rm_inventory_movement(
        batch_id,movement_type,quantity_mt,from_plant_code,from_storage_location,to_plant_code,to_storage_location,
        from_bucket,to_bucket,reference_type,reference_id,reference_no,posted_by,remarks)
      VALUES($1,'REVERSAL',$2,$3,$4,$3,$4,'QUALITY_HOLD','EXTERNAL','GRN_COIL',$5,$6,$7,$8) RETURNING movement_id`,
      [batch_id, totalHeld, plant_code, storage_location, req.params.grnCoilId, coil.rows[0].batch_no, req.user!.username, parsed.data.reason]);

    await client.query(`DELETE FROM mes.rm_inventory_balance WHERE batch_id=$1`, [batch_id]);
    await client.query(`UPDATE mes.batch_master SET lifecycle_status='CLOSED',quality_status='NOT_APPLICABLE' WHERE batch_id=$1`, [batch_id]);
    await client.query(`UPDATE mes.rm_quality_inspection SET inspection_status='CANCELLED' WHERE batch_id=$1 AND inspection_status='PENDING'`, [batch_id]);

    const log = await client.query(`
      INSERT INTO mes.rm_reversal_log(reversal_type,process_area,batch_id,grn_coil_id,movement_id,reversed_qty_mt,reason,reversed_by,client_host,client_ip,request_id)
      VALUES('GRN','RM',$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [batch_id, req.params.grnCoilId, rv.rows[0].movement_id, totalHeld, parsed.data.reason, req.user!.username, parsed.data.clientHost ?? null, req.ip, req.requestId]);

    await client.query(`INSERT INTO mes.audit_log(user_name,action,entity_type,entity_id,after_value,request_id,ip_address)
      VALUES($1,'REVERSAL','GOODS_RECEIPT_COIL',$2,$3,$4,$5)`,
      [req.user!.username, req.params.grnCoilId, JSON.stringify(log.rows[0]), req.requestId, req.ip]);

    return log.rows[0];
  });
  res.status(201).json({ reversal: response });
});

grnRouter.get('/reversals/report', async (req, res) => {
  const plant = await resolvePlantScope(req.user!.userId, String(req.query.plant ?? ''));
  const result = await query(`
    SELECT * FROM mes.vw_rm_reversal_report
    WHERE ($1=''::text OR plant_code=$1) AND reversal_type='GRN'
    ORDER BY reversed_at DESC LIMIT 500`, [plant ?? '']);
  res.json({ rows: result.rows });
});
