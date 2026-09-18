import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db';
import { requireIntegrationKey } from '../middleware/integration-key';

export const integrationRouter = Router();
integrationRouter.use(requireIntegrationKey);

const grnSchema = z.object({
  PLANT_CODE: z.string().min(4).max(4),
  BATCH_NO: z.string().min(2).max(40),
  BATCH_THICK: z.coerce.number().positive().optional().nullable(),
  BATCH_WIDTH: z.coerce.number().positive().optional().nullable(),
  BATCH_WEIGHT: z.coerce.number().positive(),
  RM_SOURCE: z.string().min(1).max(40),
  MATERIAL_CODE: z.string().min(1).max(40),
  MATERIAL_DESC: z.string().max(200).optional().nullable(),
  PRODUCT_GROUP: z.string().max(40).optional().nullable(),
  VENDOR: z.string().max(200).optional().nullable(),
  VENDOR_BATCH: z.string().max(60).optional().nullable(),
  PRODUCT_TYPE: z.string().max(40).optional().nullable(),
  EQ_SPEC: z.string().max(100).optional().nullable(),
  GRN: z.string().min(1).max(20),
  MATERIAL_DOC_YEAR: z.string().regex(/^\d{4}$/).optional().nullable(),
  PO_DELIVERY_DATE: z.string().optional().nullable(),
  PO_LINE_NO: z.coerce.string().max(10).optional().nullable(),
  PO_NO: z.string().max(20).optional().nullable(),
  MOVEMENT_TYPE: z.coerce.string().max(4).optional().nullable(),
  STORAGE_LOC: z.string().min(1).max(4),
  SO_ITEM_NO: z.coerce.string().max(10).optional().nullable(),
  SO_NO: z.coerce.string().max(20).optional().nullable(),
  EQ_SPEC_GROUP: z.string().max(60).optional().nullable(),
  EQ_SUB_SPEC: z.string().max(60).optional().nullable(),
  CHAPTER_ID: z.coerce.string().max(40).optional().nullable(),
  CHAPTER_TYPE: z.string().max(20).optional().nullable(),
  CROWN: z.coerce.number().optional().nullable(),
  READ_FLAG: z.coerce.string().max(20).optional().nullable(),
  MODIFIED_BY: z.string().max(80).optional().nullable(),
  MODIFIED_DATE: z.string().optional().nullable(),
  CREATED_BY: z.string().max(80).optional().nullable(),
  CREATED_DATE: z.string().optional().nullable()
}).passthrough();

function yearFrom(row: z.infer<typeof grnSchema>) {
  if (row.MATERIAL_DOC_YEAR) return row.MATERIAL_DOC_YEAR;
  const d = row.CREATED_DATE ? new Date(row.CREATED_DATE) : new Date();
  return String(Number.isNaN(d.valueOf()) ? new Date().getFullYear() : d.getFullYear());
}

integrationRouter.post('/grn', async (req, res) => {
  const parsed = grnSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid SAP GRN payload', details: parsed.error.flatten() });
  const row = parsed.data;
  const docYear = yearFrom(row);
  const idempotencyKey = `${row.PLANT_CODE}|${row.GRN}|${docYear}|${row.BATCH_NO}|${row.PO_LINE_NO ?? ''}`;
  const sourceRowKey = `${row.PLANT_CODE}|${row.GRN}|${row.BATCH_NO}|${row.PO_LINE_NO ?? ''}`;

  const inbox = await query(`
    INSERT INTO mes.sap_inbound_message(interface_name,source_system,source_table,idempotency_key,source_row_key,source_read_flag,payload,process_status)
    VALUES('SAP_RM_GRN','SAP_S4HANA','IFTLI_L4L3_RM_POST_GRN_DETAILS',$1,$2,$3,$4::jsonb,'RECEIVED')
    ON CONFLICT(interface_name,idempotency_key) DO UPDATE SET source_read_flag=EXCLUDED.source_read_flag
    RETURNING message_id,process_status`, [idempotencyKey, sourceRowKey, row.READ_FLAG ?? null, JSON.stringify(req.body)]);
  const message = inbox.rows[0];
  if (message.process_status === 'PROCESSED') {
    const existing = await query(`SELECT * FROM mes.vw_rm_inventory WHERE batch_no=$1 LIMIT 1`, [row.BATCH_NO]);
    return res.status(200).json({ duplicate: true, messageId: message.message_id, inventory: existing.rows[0] ?? null });
  }

  try {
    const result = await tx(async (client) => {
      await client.query(`UPDATE mes.sap_inbound_message SET process_status='PROCESSING',processing_started_at=now(),last_error_code=NULL,last_error_message=NULL WHERE message_id=$1`, [message.message_id]);
      const plant = await client.query(`SELECT 1 FROM mes.plant_master WHERE plant_code=$1 AND is_active=true`, [row.PLANT_CODE]);
      if (!plant.rowCount) throw new Error(`Plant ${row.PLANT_CODE} is not configured/active`);
      const sloc = await client.query(`SELECT 1 FROM mes.storage_location_master WHERE plant_code=$1 AND storage_location=$2 AND is_active=true`, [row.PLANT_CODE,row.STORAGE_LOC]);
      if (!sloc.rowCount) throw new Error(`Storage location ${row.PLANT_CODE}/${row.STORAGE_LOC} is not configured/active`);
      const material = await client.query(`SELECT material_id FROM mes.material_master WHERE sap_material_code=$1 AND is_active=true`, [row.MATERIAL_CODE]);
      if (!material.rows[0]) throw new Error(`Material ${row.MATERIAL_CODE} is not configured/active`);
      const supplier = await client.query(`
        SELECT s.supplier_id FROM mes.supplier_master s
        LEFT JOIN mes.supplier_external_key k ON k.supplier_id=s.supplier_id AND k.source_system='SAP'
        WHERE s.is_active=true AND (s.sap_vendor_no=$1 OR k.external_key=$1) LIMIT 1`, [row.RM_SOURCE]);
      if (!supplier.rows[0]) throw new Error(`Supplier ${row.RM_SOURCE} is not configured/active`);

      const mother = /R0$/i.test(row.BATCH_NO) ? row.BATCH_NO.slice(0,-2) : row.BATCH_NO;
      const batch = await client.query(`
        INSERT INTO mes.batch_master(batch_no,material_id,mother_lot_no,stage_letter,sequence_no,batch_origin,original_weight_mt,quality_status,lifecycle_status)
        VALUES($1,$2,$3,'R',0,'GRN',$4,'PENDING_UD','ACTIVE')
        ON CONFLICT(material_id,batch_no) DO UPDATE SET original_weight_mt=COALESCE(mes.batch_master.original_weight_mt,EXCLUDED.original_weight_mt)
        RETURNING batch_id`, [row.BATCH_NO, material.rows[0].material_id, mother, row.BATCH_WEIGHT]);
      const grn = await client.query(`
        INSERT INTO mes.goods_receipt(plant_code,sap_grn_no,sap_material_doc_year,received_at,status,source_message_id)
        VALUES($1,$2,$3,$4,'POSTED',$5)
        ON CONFLICT(plant_code,sap_grn_no,sap_material_doc_year) DO UPDATE SET source_message_id=COALESCE(mes.goods_receipt.source_message_id,EXCLUDED.source_message_id)
        RETURNING grn_id`, [row.PLANT_CODE,row.GRN,docYear,row.CREATED_DATE ? new Date(row.CREATED_DATE) : new Date(),message.message_id]);
      const coil = await client.query(`
        INSERT INTO mes.goods_receipt_coil(
          grn_id,source_row_key,plant_code,storage_location,material_id,batch_id,supplier_id,batch_no,vendor_batch_no,
          sap_po_no,sap_po_item,movement_type,rm_source,batch_thickness_mm,batch_width_mm,batch_weight_mt,product_group,product_type,
          equivalent_spec,eq_spec_group,eq_sub_spec,chapter_id,chapter_type,crown,sales_order_no,sales_order_item,po_delivery_date,
          source_created_by,source_created_at,source_modified_by,source_modified_at,source_message_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
        ON CONFLICT(grn_id,batch_no) DO NOTHING RETURNING grn_coil_id`, [
          grn.rows[0].grn_id,sourceRowKey,row.PLANT_CODE,row.STORAGE_LOC,material.rows[0].material_id,batch.rows[0].batch_id,supplier.rows[0].supplier_id,row.BATCH_NO,row.VENDOR_BATCH??null,
          row.PO_NO??null,row.PO_LINE_NO??null,row.MOVEMENT_TYPE??null,row.RM_SOURCE,row.BATCH_THICK??null,row.BATCH_WIDTH??null,row.BATCH_WEIGHT,row.PRODUCT_GROUP??null,row.PRODUCT_TYPE??null,
          row.EQ_SPEC??null,row.EQ_SPEC_GROUP??null,row.EQ_SUB_SPEC??null,row.CHAPTER_ID??null,row.CHAPTER_TYPE??null,row.CROWN??null,row.SO_NO??null,row.SO_ITEM_NO??null,row.PO_DELIVERY_DATE||null,
          row.CREATED_BY??null,row.CREATED_DATE?new Date(row.CREATED_DATE):null,row.MODIFIED_BY??null,row.MODIFIED_DATE?new Date(row.MODIFIED_DATE):null,message.message_id
        ]);
      await client.query(`UPDATE mes.sap_inbound_message SET process_status='PROCESSED',processed_at=now() WHERE message_id=$1`, [message.message_id]);
      return { batchId: batch.rows[0].batch_id, grnId: grn.rows[0].grn_id, grnCoilId: coil.rows[0]?.grn_coil_id ?? null };
    });
    const inv = await query(`SELECT * FROM mes.vw_rm_inventory WHERE batch_no=$1 LIMIT 1`, [row.BATCH_NO]);
    res.status(201).json({ duplicate: false, messageId: message.message_id, ...result, inventory: inv.rows[0] ?? null });
  } catch (e: any) {
    await query(`UPDATE mes.sap_inbound_message SET process_status='FAILED',retry_count=retry_count+1,last_error_code='GRN_PROCESSING',last_error_message=$2 WHERE message_id=$1`, [message.message_id,String(e.message).slice(0,2000)]);
    return res.status(422).json({ error: e.message, messageId: message.message_id });
  }
});

// ---------------------------------------------------------------------------
// v0.11.2 SAP RM QA / Supplier TC inbound (second ERP touch on RM GRN data,
// posted once QA/TC results are available for a batch already received via
// POST /grn). Field names mirror the real SAP interface table
// IFTLI_L4L3_RM_POST_QA_DETAILS so SAP/middleware does not have to learn a
// second field vocabulary - same principle as /grn.
// ---------------------------------------------------------------------------

// (parameter_code, source field, category, data_type, uom)
const QA_NUMERIC_FIELDS: [string, string, string, string | null][] = [
  ['CARBON_PCT', 'CARBON_PCT', 'CHEMICAL', '%'],
  ['CARBON_EQ', 'CARBON_EQ', 'CHEMICAL', null],
  ['MANGANESE_PCT', 'MANGANESE_PCT', 'CHEMICAL', '%'],
  ['PHOSPHORUS_PCT', 'PHOSPHORUS_PCT', 'CHEMICAL', '%'],
  ['SULPHUR_PCT', 'SULPHUR_PCT', 'CHEMICAL', '%'],
  ['SILICON_PCT', 'SILICON_PCT', 'CHEMICAL', '%'],
  ['ALUMINIUM_PCT', 'ALUMINIUM_PCT', 'CHEMICAL', '%'],
  ['NITROGEN_PCT', 'NITROGEN_PCT', 'CHEMICAL', '%'],
  ['NITROGEN_PPM', 'NITROGEN_PPM', 'CHEMICAL', 'ppm'],
  ['BORON_PCT', 'BORON_PCT', 'CHEMICAL', '%'],
  ['COPPER_PCT', 'COPPER_PCT', 'CHEMICAL', '%'],
  ['CHROMIUM_PCT', 'CHROMIUM_PCT', 'CHEMICAL', '%'],
  ['NICKEL_PCT', 'NICKEL_PCT', 'CHEMICAL', '%'],
  ['TIN_PCT', 'TIN_PCT', 'CHEMICAL', '%'],
  ['YMPA', 'YMPA', 'MECHANICAL', 'MPa'],
  ['TMPA', 'TMPA', 'MECHANICAL', 'MPa'],
  ['EL_PCT', 'EL_PCT', 'MECHANICAL', '%'],
  ['HARDNESS', 'HARDNESS', 'MECHANICAL', null],
  ['UTS', 'UTS', 'MECHANICAL', 'MPa'],
  ['YS', 'YS', 'MECHANICAL', 'MPa'],
  ['CHEM_1', 'CHEM_1', 'CHEMICAL_OTHER', null],
  ['CHEM_2', 'CHEM_2', 'CHEMICAL_OTHER', null],
  ['CHEM_3', 'CHEM_3', 'CHEMICAL_OTHER', null],
  ['CHEM_4', 'CHEM_4', 'CHEMICAL_OTHER', null],
  ['CHEM_5', 'CHEM_5', 'CHEMICAL_OTHER', null]
];
const QA_TEXT_FIELDS: [string, string, string][] = [
  ['GEN_1', 'GEN_1', 'GENERAL'],
  ['GEN_2', 'GEN_2', 'GENERAL'],
  ['GEN_3', 'GEN_3', 'GENERAL'],
  ['GEN_4', 'GEN_4', 'GENERAL'],
  ['GEN_5', 'GEN_5', 'GENERAL']
];

const qaSchema = z.object({
  PLANT_CODE: z.string().min(4).max(4),
  BATCH_NO: z.string().min(2).max(40),
  BATCH_THICK: z.coerce.number().optional().nullable(),
  BATCH_WIDTH: z.coerce.number().optional().nullable(),
  BATCH_WEIGHT: z.coerce.number().optional().nullable(),
  HEAT_NO: z.string().max(100).optional().nullable(),
  HR_GRADE: z.string().max(60).optional().nullable(),
  QUALITY_LEVEL: z.string().max(60).optional().nullable(),
  SENT_DATE: z.string().optional().nullable(),
  CHEM_TREATMENT: z.string().max(100).optional().nullable(),
  SURFACE: z.string().max(120).optional().nullable(),
  BATCH_LENGTH: z.coerce.number().optional().nullable(),
  SUPPLIER_TC_NO: z.coerce.string().max(100).optional().nullable(),
  GSM_COATING: z.coerce.number().optional().nullable(),
  REMARK: z.string().max(1000).optional().nullable(),
  EL_GL_TYPE: z.string().max(80).optional().nullable(),
  INNER_DIA: z.coerce.number().optional().nullable(),
  OUTER_DIA: z.coerce.number().optional().nullable(),
  VENDOR_GRADE: z.string().max(60).optional().nullable(),
  READ_FLAG: z.coerce.string().max(20).optional().nullable(),
  MODIFIED_BY: z.string().max(80).optional().nullable(),
  MODIFIED_DATE: z.string().optional().nullable(),
  CREATED_BY: z.string().max(80).optional().nullable(),
  CREATED_DATE: z.string().optional().nullable()
}).passthrough();

integrationRouter.post('/rm-qa', async (req, res) => {
  const parsed = qaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid SAP RM QA payload', details: parsed.error.flatten() });
  const row = parsed.data;
  const raw = req.body as Record<string, unknown>;
  const idempotencyKey = `${row.PLANT_CODE}|${row.BATCH_NO}|${row.SUPPLIER_TC_NO ?? 'NA'}`;

  const inbox = await query(`
    INSERT INTO mes.sap_inbound_message(interface_name,source_system,source_table,idempotency_key,source_row_key,source_read_flag,payload,process_status)
    VALUES('SAP_RM_QA','SAP_S4HANA','IFTLI_L4L3_RM_POST_QA_DETAILS',$1,$2,$3,$4::jsonb,'RECEIVED')
    ON CONFLICT(interface_name,idempotency_key) DO UPDATE SET payload=EXCLUDED.payload,source_read_flag=EXCLUDED.source_read_flag
    RETURNING message_id`, [idempotencyKey, `${row.PLANT_CODE}|${row.BATCH_NO}`, row.READ_FLAG ?? null, JSON.stringify(req.body)]);
  const message = inbox.rows[0];

  try {
    const result = await tx(async (client) => {
      await client.query(`UPDATE mes.sap_inbound_message SET process_status='PROCESSING',processing_started_at=now(),last_error_code=NULL,last_error_message=NULL WHERE message_id=$1`, [message.message_id]);
      const plant = await client.query(`SELECT 1 FROM mes.plant_master WHERE plant_code=$1 AND is_active=true`, [row.PLANT_CODE]);
      if (!plant.rowCount) throw new Error(`Plant ${row.PLANT_CODE} is not configured/active`);
      const batch = await client.query(`SELECT batch_id, material_id FROM mes.batch_master WHERE batch_no=$1`, [row.BATCH_NO]);
      if (!batch.rows[0]) throw new Error(`Batch ${row.BATCH_NO} not found - GRN must be posted before QA`);
      const coil = await client.query(`SELECT grn_coil_id, supplier_id FROM mes.goods_receipt_coil WHERE batch_no=$1 LIMIT 1`, [row.BATCH_NO]);

      const tc = await client.query(`
        INSERT INTO mes.rm_supplier_tc(
          batch_id,plant_code,material_id,supplier_id,batch_no,supplier_tc_no,heat_no,hr_grade,vendor_grade,quality_level,
          chemical_treatment,surface_condition,elongation_gl_type,inner_dia_mm,outer_dia_mm,gsm_coating,batch_length_m,remarks,
          sent_at,source_message_id,source_created_by,source_created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
        ON CONFLICT(batch_id) DO UPDATE SET
          supplier_tc_no=EXCLUDED.supplier_tc_no,heat_no=EXCLUDED.heat_no,hr_grade=EXCLUDED.hr_grade,vendor_grade=EXCLUDED.vendor_grade,
          quality_level=EXCLUDED.quality_level,chemical_treatment=EXCLUDED.chemical_treatment,surface_condition=EXCLUDED.surface_condition,
          elongation_gl_type=EXCLUDED.elongation_gl_type,inner_dia_mm=EXCLUDED.inner_dia_mm,outer_dia_mm=EXCLUDED.outer_dia_mm,
          gsm_coating=EXCLUDED.gsm_coating,batch_length_m=EXCLUDED.batch_length_m,remarks=EXCLUDED.remarks,sent_at=EXCLUDED.sent_at,
          source_message_id=EXCLUDED.source_message_id,source_modified_by=EXCLUDED.source_created_by,source_modified_at=now(),updated_at=now()
        RETURNING supplier_tc_id`, [
        batch.rows[0].batch_id, row.PLANT_CODE, batch.rows[0].material_id, coil.rows[0]?.supplier_id ?? null, row.BATCH_NO, row.SUPPLIER_TC_NO ?? null,
        row.HEAT_NO ?? null, row.HR_GRADE ?? null, row.VENDOR_GRADE ?? null, row.QUALITY_LEVEL ?? null,
        row.CHEM_TREATMENT ?? null, row.SURFACE ?? null, row.EL_GL_TYPE ?? null,
        row.INNER_DIA ?? null, row.OUTER_DIA ?? null, row.GSM_COATING ?? null, row.BATCH_LENGTH ?? null, row.REMARK ?? null,
        row.SENT_DATE ? new Date(row.SENT_DATE) : new Date(), message.message_id, row.CREATED_BY ?? null,
        row.CREATED_DATE ? new Date(row.CREATED_DATE) : new Date()
      ]);
      const supplierTcId = tc.rows[0].supplier_tc_id;
      if (coil.rows[0]?.grn_coil_id) {
        await client.query(`UPDATE mes.rm_quality_inspection SET supplier_tc_id=$1 WHERE grn_coil_id=$2 AND supplier_tc_id IS NULL`, [supplierTcId, coil.rows[0].grn_coil_id]);
      }

      const skipped: string[] = [];
      let stored = 0;
      async function upsertResult(parameterCode: string, sourceField: string, numericValue: number | null, textValue: string | null, uom: string | null, rawValue: unknown) {
        const param = await client.query(`SELECT parameter_id FROM mes.quality_parameter_master WHERE parameter_code=$1 AND is_active=true`, [parameterCode]);
        if (!param.rows[0]) { skipped.push(parameterCode); return; }
        await client.query(`
          INSERT INTO mes.rm_supplier_tc_result(supplier_tc_id,parameter_id,numeric_value,text_value,uom,source_field_name,source_raw_value)
          VALUES($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT(supplier_tc_id,parameter_id,source_field_name) DO UPDATE SET
            numeric_value=EXCLUDED.numeric_value,text_value=EXCLUDED.text_value,uom=EXCLUDED.uom,source_raw_value=EXCLUDED.source_raw_value`,
          [supplierTcId, param.rows[0].parameter_id, numericValue, textValue, uom, sourceField, rawValue == null ? null : String(rawValue)]);
        stored++;
      }

      for (const [code, field, , uom] of QA_NUMERIC_FIELDS) {
        const v = raw[field];
        if (v === undefined || v === null || v === '') continue;
        const n = Number(v);
        if (Number.isNaN(n)) continue;
        await upsertResult(code, field, n, null, uom, v);
      }
      for (const [code, field] of QA_TEXT_FIELDS) {
        const v = raw[field];
        if (v === undefined || v === null || v === '') continue;
        await upsertResult(code, field, null, String(v), null, v);
      }

      // Auto Usage Decision: PRIME quality level from SAP QA data is auto-accepted,
      // releasing stock straight to AVAILABLE instead of waiting in QUALITY_HOLD for
      // a manual QC decision. Only fires once, and only if no UD exists yet for the batch.
      let autoUsageDecision: { udNo: string; decision: string } | null = null;
      if (String(row.QUALITY_LEVEL ?? '').trim().toUpperCase() === 'PRIME') {
        const openInsp = await client.query(`
          SELECT inspection_id FROM mes.rm_quality_inspection
          WHERE batch_id=$1 AND inspection_status='PENDING'
          ORDER BY inspection_sequence DESC LIMIT 1 FOR UPDATE`, [batch.rows[0].batch_id]);
        const noExistingUd = await client.query(`
          SELECT 1 FROM mes.rm_usage_decision WHERE batch_id=$1 AND is_current=true LIMIT 1`, [batch.rows[0].batch_id]);
        if (openInsp.rows[0] && !noExistingUd.rows[0]) {
          const inspectionId = openInsp.rows[0].inspection_id;
          await client.query(`
            UPDATE mes.rm_quality_inspection SET inspection_status='COMPLETED',overall_result='PASS',
              inspected_by='AUTO_PRIME_QC',inspection_started_at=COALESCE(inspection_started_at,now()),inspection_completed_at=now()
            WHERE inspection_id=$1`, [inspectionId]);
          const seq = await client.query(`SELECT COALESCE(count(*),0)+1 n FROM mes.rm_usage_decision WHERE batch_id=$1`, [batch.rows[0].batch_id]);
          const udNo = `RMUD-${row.BATCH_NO}-${String(seq.rows[0].n).padStart(2, '0')}`;
          await client.query(`
            INSERT INTO mes.rm_usage_decision(ud_no,batch_id,inspection_id,decision,decision_reason_code,decision_reason,decided_by,source_system,sap_sync_required)
            VALUES($1,$2,$3,'ACCEPT','AUTO_PRIME','Automatically accepted - Quality Level PRIME received from SAP QA data.',$4,'MES',false)`,
            [udNo, batch.rows[0].batch_id, inspectionId, 'AUTO_PRIME_QC']);
          autoUsageDecision = { udNo, decision: 'ACCEPT' };
        }
      }

      await client.query(`UPDATE mes.sap_inbound_message SET process_status='PROCESSED',processed_at=now() WHERE message_id=$1`, [message.message_id]);
      return { batchId: batch.rows[0].batch_id, supplierTcId, characteristicsStored: stored, characteristicsSkipped: skipped, autoUsageDecision };
    });
    res.status(201).json({ messageId: message.message_id, ...result });
  } catch (e: any) {
    await query(`UPDATE mes.sap_inbound_message SET process_status='FAILED',retry_count=retry_count+1,last_error_code='RM_QA_PROCESSING',last_error_message=$2 WHERE message_id=$1`, [message.message_id, String(e.message).slice(0, 2000)]);
    return res.status(422).json({ error: e.message, messageId: message.message_id });
  }
});

// ---------------------------------------------------------------------------
// v0.10.5 SAP Sales Order inbound landing
// Raw SAP data is accepted first. Local master gaps are evaluated later by
// vw_sap_sales_order_monitor and never cause the inbound row to be discarded.
// ---------------------------------------------------------------------------
function sapRows(body:any):any[]{
  const rows=Array.isArray(body)?body:Array.isArray(body?.rows)?body.rows:[body];
  return rows.filter(Boolean);
}
function sapDate(v:any){
  const s=String(v??'').trim(); if(!s)return null;
  const m=s.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if(m){const yy=Number(m[3]);const y=yy<=49?2000+yy:1900+yy;return `${y}-${m[2]}-${m[1]}`;}
  return s;
}
function sapNumber(v:any){const s=String(v??'').trim();if(!s)return null;const n=Number(s);return Number.isFinite(n)?n:null;}

integrationRouter.post('/so/header', async (req,res)=>{
  const rows=sapRows(req.body);
  if(!rows.length)return res.status(400).json({error:'No SAP SO header/item rows supplied'});
  if(rows.length>2000)return res.status(413).json({error:'Send SAP SO header rows in batches of 2000 or fewer'});
  try{
    const result=await tx(async client=>{
      let inserted=0;
      for(const r of rows){
        if(!r.SO_NO||!r.SO_ITEM_NO||!r.MATERIAL_CODE||sapNumber(r.QTY)===null)throw new Error('SO_NO, SO_ITEM_NO, MATERIAL_CODE and QTY are mandatory');
        await client.query(`
          INSERT INTO mes.sap_sales_order_item(
            so_no,so_item_no,tdc_no,material_code,qty,uom,required_date,sold_to_party_name,ship_to_party_name,sold_to_code,ship_to_code,
            sales_organization,distribution_channel,purchase_order_number,plant_code,destination_city,order_creation_date,mode_of_transport,error_description,
            send_date,so_overdelivery_tol,so_underdelivery_tol,route_id,route_description,unloading_point,receiving_point,material_tree,process_path,
            proposed_delivery_date,committed_date,division,sales_doc_type,manufacturing_plant,uname,yield_stng,release_date,region_code,region_desc,so_item_desc,
            status_flag,created_by,source_created_date,modified_by,source_modified_date,sch_line_cat,source_read_flag,source_payload,last_received_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47::jsonb,now())
          ON CONFLICT(so_no,so_item_no) DO UPDATE SET
            tdc_no=EXCLUDED.tdc_no,material_code=EXCLUDED.material_code,qty=EXCLUDED.qty,uom=EXCLUDED.uom,required_date=EXCLUDED.required_date,
            sold_to_party_name=EXCLUDED.sold_to_party_name,ship_to_party_name=EXCLUDED.ship_to_party_name,sold_to_code=EXCLUDED.sold_to_code,ship_to_code=EXCLUDED.ship_to_code,
            sales_organization=EXCLUDED.sales_organization,distribution_channel=EXCLUDED.distribution_channel,purchase_order_number=EXCLUDED.purchase_order_number,
            plant_code=EXCLUDED.plant_code,destination_city=EXCLUDED.destination_city,order_creation_date=EXCLUDED.order_creation_date,mode_of_transport=EXCLUDED.mode_of_transport,
            error_description=EXCLUDED.error_description,send_date=EXCLUDED.send_date,so_overdelivery_tol=EXCLUDED.so_overdelivery_tol,so_underdelivery_tol=EXCLUDED.so_underdelivery_tol,
            route_id=EXCLUDED.route_id,route_description=EXCLUDED.route_description,unloading_point=EXCLUDED.unloading_point,receiving_point=EXCLUDED.receiving_point,
            material_tree=EXCLUDED.material_tree,process_path=EXCLUDED.process_path,proposed_delivery_date=EXCLUDED.proposed_delivery_date,committed_date=EXCLUDED.committed_date,
            division=EXCLUDED.division,sales_doc_type=EXCLUDED.sales_doc_type,manufacturing_plant=EXCLUDED.manufacturing_plant,uname=EXCLUDED.uname,yield_stng=EXCLUDED.yield_stng,
            release_date=EXCLUDED.release_date,region_code=EXCLUDED.region_code,region_desc=EXCLUDED.region_desc,so_item_desc=EXCLUDED.so_item_desc,status_flag=EXCLUDED.status_flag,
            created_by=EXCLUDED.created_by,source_created_date=EXCLUDED.source_created_date,modified_by=EXCLUDED.modified_by,source_modified_date=EXCLUDED.source_modified_date,
            sch_line_cat=EXCLUDED.sch_line_cat,source_read_flag=EXCLUDED.source_read_flag,source_payload=EXCLUDED.source_payload,last_received_at=now()`,[
          String(r.SO_NO),String(r.SO_ITEM_NO),r.TDC_NO||null,String(r.MATERIAL_CODE),sapNumber(r.QTY),r.UOM||null,sapDate(r.REQUIRED_DATE),r.SOLD_TO_PARTY_NAME||null,r.SHIP_TO_PARTY_NAME||null,r.SOLD_TO_CODE||null,r.SHIP_TO_CODE||null,
          r.SALES_ORGANIZATION||null,r.DISTRIBUTION_CHANNEL||null,r.PURCHASE_ORDER_NUMBER||null,r.PLANT_CODE||null,r.DESTINATION_CITY||null,sapDate(r.ORDER_CREATION_DATE),r.MODE_OF_TRANSPORT||null,r.ERROR_DESCRIPTION||null,
          sapDate(r.SEND_DATE),sapNumber(r.SO_OVERDELIVERY_TOL),sapNumber(r.SO_UNDERDELIVERY_TOL),r.ROUTE_ID||null,r.ROUTE_DESCRIPTION||null,r.UNLOADING_POINT||null,r.RECEIVING_POINT||null,r.MATERIAL_TREE||null,r.PROCESS_PATH||null,
          sapDate(r.PROPOSED_DELIVERY_DATE),sapDate(r.COMMITTED_DATE),r.DIVISION||null,r.SALES_DOC_TYPE||null,r.MANUFACTURING_PLANT||null,r.UNAME||null,r.YIELD_STNG||null,sapDate(r.RELEASE_DATE),r.REGION_CODE||null,r.REGION_DESC||null,r.SO_ITEM_DESC||null,
          r.STATUS_FLAG==null?null:String(r.STATUS_FLAG),r.CREATED_BY||null,sapDate(r.CREATED_DATE),r.MODIFIED_BY||null,sapDate(r.MODIFIED_DATE),r.SCH_LINE_CAT||null,r.READ_FLAG==null?null:String(r.READ_FLAG),JSON.stringify(r)]);
        inserted++;
      }
      return inserted;
    });
    res.status(201).json({received:result,dataset:'SO_HEADER',message:'SAP SO item data received. Master validation is performed separately.'});
  }catch(e:any){res.status(422).json({error:e.message});}
});

integrationRouter.post('/so/process-path', async (req,res)=>{
  const rows=sapRows(req.body);
  if(!rows.length)return res.status(400).json({error:'No SAP SO process-path rows supplied'});
  if(rows.length>2000)return res.status(413).json({error:'Send process-path rows in batches of 2000 or fewer'});
  try{const count=await tx(async client=>{let n=0;for(const r of rows){
    if(!r.SO_NO||!r.SO_ITEM_NO||!r.ROUTE_IND)throw new Error('SO_NO, SO_ITEM_NO and ROUTE_IND are mandatory');
    await client.query(`INSERT INTO mes.sap_sales_order_route(so_no,so_item_no,route_ind,process_path,material_tree,sent_date,source_read_flag,created_by,source_created_date,modified_by,source_modified_date,source_payload,last_received_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,now())
      ON CONFLICT(so_no,so_item_no,route_ind) DO UPDATE SET process_path=EXCLUDED.process_path,material_tree=EXCLUDED.material_tree,sent_date=EXCLUDED.sent_date,source_read_flag=EXCLUDED.source_read_flag,
      created_by=EXCLUDED.created_by,source_created_date=EXCLUDED.source_created_date,modified_by=EXCLUDED.modified_by,source_modified_date=EXCLUDED.source_modified_date,source_payload=EXCLUDED.source_payload,last_received_at=now()`,
      [String(r.SO_NO),String(r.SO_ITEM_NO),String(r.ROUTE_IND),r.PROCESS_PATH||'',r.MATERIAL_TREE||'',sapDate(r.SENT_DATE),r.READ_FLAG==null?null:String(r.READ_FLAG),r.CREATED_BY||null,sapDate(r.CREATED_DATE),r.MODIFIED_BY||null,sapDate(r.MODIFIED_DATE),JSON.stringify(r)]);n++;}return n;});
    res.status(201).json({received:count,dataset:'SO_PROCESS_PATH'});
  }catch(e:any){res.status(422).json({error:e.message});}
});

async function receiveSoCharacteristics(req:any,res:any,sourceCategory:'ORDER_DETAIL'|'CHEM_MECH'){
  const rows=sapRows(req.body);
  if(!rows.length)return res.status(400).json({error:'No SAP SO characteristic rows supplied'});
  if(rows.length>2000)return res.status(413).json({error:'Send characteristic rows in batches of 2000 or fewer'});
  try{const count=await tx(async client=>{let n=0;for(const r of rows){
    if(!r.SO_NO||!r.SO_ITEM_NO||!r.MATERIAL_CODE||!r.ROUTE_IND||!r.CHARACTERISTIC_NAME)throw new Error('SO_NO, SO_ITEM_NO, MATERIAL_CODE, ROUTE_IND and CHARACTERISTIC_NAME are mandatory');
    await client.query(`INSERT INTO mes.sap_sales_order_characteristic(source_category,so_no,so_item_no,material_code,route_ind,characteristic_name,characteristic_value,characteristic_uom,sent_date,source_read_flag,created_by,source_created_date,modified_by,source_modified_date,source_payload,last_received_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,now())
      ON CONFLICT(source_category,so_no,so_item_no,material_code,route_ind,characteristic_name) DO UPDATE SET characteristic_value=EXCLUDED.characteristic_value,characteristic_uom=EXCLUDED.characteristic_uom,sent_date=EXCLUDED.sent_date,
      source_read_flag=EXCLUDED.source_read_flag,created_by=EXCLUDED.created_by,source_created_date=EXCLUDED.source_created_date,modified_by=EXCLUDED.modified_by,source_modified_date=EXCLUDED.source_modified_date,
      source_payload=EXCLUDED.source_payload,last_received_at=now()`,
      [sourceCategory,String(r.SO_NO),String(r.SO_ITEM_NO),String(r.MATERIAL_CODE),String(r.ROUTE_IND),String(r.CHARACTERISTIC_NAME),r.CHARACTERISTIC_VALUE==null?null:String(r.CHARACTERISTIC_VALUE),r.CHARACTERISTIC_UOM||null,sapDate(r.SENT_DATE),r.READ_FLAG==null?null:String(r.READ_FLAG),r.CREATED_BY||null,sapDate(r.CREATED_DATE),r.MODIFIED_BY||null,sapDate(r.MODIFIED_DATE),JSON.stringify(r)]);n++;}return n;});
    return res.status(201).json({received:count,dataset:sourceCategory});
  }catch(e:any){return res.status(422).json({error:e.message});}
}
integrationRouter.post('/so/order-detail',(req,res)=>receiveSoCharacteristics(req,res,'ORDER_DETAIL'));
integrationRouter.post('/so/chem-mech',(req,res)=>receiveSoCharacteristics(req,res,'CHEM_MECH'));
