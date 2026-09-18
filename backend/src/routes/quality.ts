import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { assertPlantAccess, resolvePlantScope } from '../security';

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
        WHERE qi.inspection_id=$1 FOR UPDATE`, [req.params.inspectionId]);
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
