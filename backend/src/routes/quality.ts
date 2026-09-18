import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { assertPlantAccess, assertReversalAuthority, resolvePlantScope } from '../security';

export const qualityRouter = Router();
qualityRouter.use(requireAuth);

qualityRouter.get('/pending', async (req, res) => {
  const plant = await resolvePlantScope(req.user!.userId,String(req.query.plant ?? ''));
  const result = await query(`
    SELECT q.*, qi.inspection_id
    FROM mes.vw_grn_ud_queue q
    LEFT JOIN LATERAL (
      SELECT x.inspection_id FROM mes.rm_quality_inspection x
      WHERE x.batch_id=q.batch_id
      ORDER BY x.inspection_sequence DESC, x.created_at DESC LIMIT 1
    ) qi ON true
    WHERE ($1='' OR q.plant_code=$1)
      AND (q.current_ud IS NULL OR q.current_ud='HOLD')
      AND q.quality_hold_weight_mt>0
    ORDER BY q.grn_posting_date NULLS LAST, q.sap_grn_no, q.batch_no`, [plant ?? '']);
  res.json({ rows: result.rows });
});

qualityRouter.get('/:inspectionId', async (req, res) => {
  const q = await query(`
    SELECT qi.*, b.batch_no, m.sap_material_code, m.material_description,
           c.plant_code,s.sap_vendor_no,s.supplier_name,tc.supplier_tc_no,tc.heat_no,tc.hr_grade,tc.quality_level,
           c.batch_thickness_mm,c.batch_width_mm,c.batch_weight_mt,g.sap_grn_no,c.sap_po_no,c.sap_po_item
    FROM mes.rm_quality_inspection qi
    JOIN mes.batch_master b ON b.batch_id=qi.batch_id
    JOIN mes.material_master m ON m.material_id=b.material_id
    LEFT JOIN mes.goods_receipt_coil c ON c.grn_coil_id=qi.grn_coil_id
    LEFT JOIN mes.goods_receipt g ON g.grn_id=c.grn_id
    LEFT JOIN mes.supplier_master s ON s.supplier_id=c.supplier_id
    LEFT JOIN mes.rm_supplier_tc tc ON tc.supplier_tc_id=qi.supplier_tc_id
    WHERE qi.inspection_id=$1`, [req.params.inspectionId]);
  if (!q.rows[0]) return res.status(404).json({ error: 'Inspection not found' });
  await assertPlantAccess(req.user!.userId,q.rows[0].plant_code);
  const r = await query(`
    SELECT qr.result_id,p.parameter_code,p.parameter_name,p.parameter_category,
           qr.supplier_tc_numeric,qr.supplier_tc_text,qr.measured_numeric,qr.measured_text,
           qr.uom,qr.spec_min,qr.spec_max,qr.spec_target,qr.spec_text,qr.within_spec,qr.result_remark
    FROM mes.rm_quality_result qr
    JOIN mes.quality_parameter_master p ON p.parameter_id=qr.parameter_id
    WHERE qr.inspection_id=$1 ORDER BY p.parameter_category,p.parameter_name`, [req.params.inspectionId]);
  res.json({ inspection: q.rows[0], results: r.rows });
});

const decisionSchema = z.object({
  decision: z.enum(['ACCEPT','CONDITIONAL_ACCEPT','HOLD','REJECT']),
  reasonCode: z.string().min(2).max(60),
  remarks: z.string().min(3).max(1000),
  overallResult: z.enum(['PASS','FAIL','DEVIATION','NOT_TESTED']).optional()
});

qualityRouter.post('/:inspectionId/decision', requireRole('ADMIN','QC'), async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid decision request', details: parsed.error.flatten() });
  try {
    const response = await tx(async (client) => {
      const ins = await client.query(`
        SELECT qi.inspection_id,qi.batch_id,b.batch_no,c.plant_code
        FROM mes.rm_quality_inspection qi JOIN mes.batch_master b ON b.batch_id=qi.batch_id
        LEFT JOIN mes.goods_receipt_coil c ON c.grn_coil_id=qi.grn_coil_id
        WHERE qi.inspection_id=$1 FOR UPDATE OF qi`, [req.params.inspectionId]);
      if (!ins.rows[0]) { const e:any=new Error('Inspection not found'); e.status=404; throw e; }
      const { batch_id, batch_no, plant_code } = ins.rows[0];
      await assertPlantAccess(req.user!.userId,plant_code);
      const result = parsed.data.overallResult ?? (parsed.data.decision==='ACCEPT' ? 'PASS' : parsed.data.decision==='REJECT' ? 'FAIL' : 'DEVIATION');
      await client.query(`UPDATE mes.rm_quality_inspection
        SET inspection_status='COMPLETED', overall_result=$2, inspected_by=$3,
            inspection_started_at=COALESCE(inspection_started_at,now()), inspection_completed_at=now(), remarks=$4
        WHERE inspection_id=$1`, [req.params.inspectionId,result,req.user!.username,parsed.data.remarks]);
      const seq = await client.query(`SELECT COALESCE(count(*),0)+1 n FROM mes.rm_usage_decision WHERE batch_id=$1`, [batch_id]);
      const udNo = `RMUD-${batch_no}-${String(seq.rows[0].n).padStart(2,'0')}`;
      const ud = await client.query(`INSERT INTO mes.rm_usage_decision
        (ud_no,batch_id,inspection_id,decision,decision_reason_code,decision_reason,decided_by,source_system,sap_sync_required)
        VALUES($1,$2,$3,$4,$5,$6,$7,'MES',false) RETURNING *`,
        [udNo,batch_id,req.params.inspectionId,parsed.data.decision,parsed.data.reasonCode,parsed.data.remarks,req.user!.username]);
      await client.query(`INSERT INTO mes.audit_log(user_name,action,entity_type,entity_id,after_value,request_id,ip_address)
        VALUES($1,'UD_DECISION','RM_USAGE_DECISION',$2,$3,$4,$5)`,
        [req.user!.username,ud.rows[0].ud_id,JSON.stringify(ud.rows[0]),req.requestId,req.ip]);
      return ud.rows[0];
    });
    res.status(201).json({ usageDecision: response });
  } catch (e:any) {
    if (String(e.message).includes('Final RM UD already exists')) e.status=409;
    throw e;
  }
});

// ---------------------------------------------------------------------------
// v0.11.3 QC Reversal. RM only today (process_area='RM'); Paints will reuse
// the same authorization object and log once that module exists. If a final
// UD (ACCEPT/CONDITIONAL_ACCEPT/REJECT) had moved stock out of QUALITY_HOLD,
// that movement is reversed first; GRN Reversal is blocked until this runs.
// ---------------------------------------------------------------------------
const reversalSchema = z.object({
  reason: z.string().min(5).max(1000),
  clientHost: z.string().max(120).optional().nullable()
});

qualityRouter.post('/:inspectionId/reverse', async (req, res) => {
  const parsed = reversalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid reversal request', details: parsed.error.flatten() });
  await assertReversalAuthority(req.user!.userId, req.user!.roles);

  const response = await tx(async (client) => {
    const insp = await client.query(`
      SELECT qi.inspection_id,qi.batch_id,qi.grn_coil_id,b.batch_no,c.plant_code
      FROM mes.rm_quality_inspection qi
      JOIN mes.batch_master b ON b.batch_id=qi.batch_id
      LEFT JOIN mes.goods_receipt_coil c ON c.grn_coil_id=qi.grn_coil_id
      WHERE qi.inspection_id=$1 FOR UPDATE OF qi`, [req.params.inspectionId]);
    if (!insp.rows[0]) { const e:any=new Error('Inspection not found'); e.status=404; throw e; }
    const { batch_id, grn_coil_id, plant_code } = insp.rows[0];
    if (plant_code) await assertPlantAccess(req.user!.userId, plant_code);

    const udResult = await client.query(`
      SELECT * FROM mes.rm_usage_decision WHERE batch_id=$1 AND is_current=true ORDER BY decided_at DESC LIMIT 1 FOR UPDATE`, [batch_id]);
    if (!udResult.rows[0]) { const e:any=new Error('No active Usage Decision to reverse for this batch'); e.status=409; throw e; }
    const decision = udResult.rows[0];
    // QC Reversal is only allowed while stock is in Available status (ACCEPT/CONDITIONAL_ACCEPT).
    // REJECT (Blocked) and other statuses (allocated/consumed) are out of scope for now.
    if (!['ACCEPT','CONDITIONAL_ACCEPT'].includes(decision.decision)) {
      const e:any=new Error(`QC Reversal is only allowed when stock status is Available. This batch's current decision is ${decision.decision}.`);
      e.status=409; throw e;
    }

    let reversedQty = 0;
    let lastMovementId: string | null = null;
    if (['ACCEPT','CONDITIONAL_ACCEPT'].includes(decision.decision)) {
      const movs = await client.query(`
        SELECT * FROM mes.rm_inventory_movement
        WHERE reference_type='RM_UD' AND reference_id=$1
          AND NOT EXISTS (SELECT 1 FROM mes.rm_inventory_movement rv WHERE rv.reversal_of_movement_id=mes.rm_inventory_movement.movement_id)
        ORDER BY posted_at`, [decision.ud_id]);
      for (const m of movs.rows) {
        const bucketCol = m.to_bucket === 'AVAILABLE' ? 'available_weight_mt' : m.to_bucket === 'BLOCKED' ? 'blocked_weight_mt' : null;
        if (!bucketCol) continue;
        const bal = await client.query(`
          SELECT * FROM mes.rm_inventory_balance WHERE batch_id=$1 AND plant_code=$2 AND storage_location=$3 FOR UPDATE`,
          [batch_id, m.to_plant_code, m.to_storage_location]);
        if (!bal.rows[0]) continue;
        await client.query(`
          UPDATE mes.rm_inventory_balance SET
            ${bucketCol} = GREATEST(0, ${bucketCol} - $2),
            quality_hold_weight_mt = quality_hold_weight_mt + $2,
            stock_status = 'QUALITY_HOLD',
            last_movement_at = now()
          WHERE inventory_balance_id=$1`, [bal.rows[0].inventory_balance_id, m.quantity_mt]);
        const rv = await client.query(`
          INSERT INTO mes.rm_inventory_movement(
            batch_id,movement_type,quantity_mt,from_plant_code,from_storage_location,to_plant_code,to_storage_location,
            from_bucket,to_bucket,reference_type,reference_id,reference_no,posted_by,remarks,reversal_of_movement_id)
          VALUES($1,'REVERSAL',$2,$3,$4,$3,$4,$5,'QUALITY_HOLD','RM_UD_REVERSAL',$6,$7,$8,$9,$10) RETURNING movement_id`,
          [batch_id, m.quantity_mt, m.to_plant_code, m.to_storage_location, m.to_bucket, decision.ud_id, decision.ud_no, req.user!.username, parsed.data.reason, m.movement_id]);
        reversedQty += Number(m.quantity_mt);
        lastMovementId = rv.rows[0].movement_id;
      }
    }
    if (reversedQty <= 0) {
      const held = await client.query(`SELECT COALESCE(sum(quality_hold_weight_mt),0) qty FROM mes.rm_inventory_balance WHERE batch_id=$1`, [batch_id]);
      reversedQty = Number(held.rows[0].qty);
    }
    if (reversedQty <= 0) { const e:any=new Error('Nothing to reverse for this Usage Decision'); e.status=409; throw e; }

    await client.query(`UPDATE mes.rm_usage_decision SET is_current=false WHERE ud_id=$1`, [decision.ud_id]);
    await client.query(`UPDATE mes.batch_master SET quality_status='PENDING_UD' WHERE batch_id=$1`, [batch_id]);
    await client.query(`UPDATE mes.rm_quality_inspection SET inspection_status='PENDING',overall_result=NULL WHERE inspection_id=$1`, [req.params.inspectionId]);

    const log = await client.query(`
      INSERT INTO mes.rm_reversal_log(reversal_type,process_area,batch_id,grn_coil_id,inspection_id,ud_id,movement_id,reversed_qty_mt,reason,reversed_by,client_host,client_ip,request_id)
      VALUES('QC','RM',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [batch_id, grn_coil_id, req.params.inspectionId, decision.ud_id, lastMovementId, reversedQty, parsed.data.reason, req.user!.username, parsed.data.clientHost ?? null, req.ip, req.requestId]);

    await client.query(`INSERT INTO mes.audit_log(user_name,action,entity_type,entity_id,after_value,request_id,ip_address)
      VALUES($1,'REVERSAL','RM_USAGE_DECISION',$2,$3,$4,$5)`,
      [req.user!.username, decision.ud_id, JSON.stringify(log.rows[0]), req.requestId, req.ip]);

    return log.rows[0];
  });
  res.status(201).json({ reversal: response });
});

qualityRouter.get('/reversals/report', async (req, res) => {
  const plant = await resolvePlantScope(req.user!.userId, String(req.query.plant ?? ''));
  const result = await query(`
    SELECT * FROM mes.vw_rm_reversal_report
    WHERE ($1=''::text OR plant_code=$1) AND reversal_type='QC'
    ORDER BY reversed_at DESC LIMIT 500`, [plant ?? '']);
  res.json({ rows: result.rows });
});
