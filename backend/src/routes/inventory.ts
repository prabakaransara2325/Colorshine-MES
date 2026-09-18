import { Router } from 'express';
import { query } from '../db';
import { requireAuth } from '../middleware/auth';
import { assertPlantAccess, resolvePlantScope } from '../security';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

const inventoryWhere = `
  WHERE ($1='' OR i.plant_code=$1)
    AND ($2='' OR i.stock_status=$2)
    AND ($3='' OR i.batch_no ILIKE '%'||$3||'%'
                 OR i.sap_material_code ILIKE '%'||$3||'%'
                 OR COALESCE(i.supplier_name,'') ILIKE '%'||$3||'%'
                 OR COALESCE(i.sap_grn_no,'') ILIKE '%'||$3||'%'
                 OR COALESCE(i.vendor_batch_no,'') ILIKE '%'||$3||'%'
                 OR COALESCE(i.heat_no,'') ILIKE '%'||$3||'%'
                 OR COALESCE(i.hr_grade,'') ILIKE '%'||$3||'%'
                 OR COALESCE(tc.vendor_grade,'') ILIKE '%'||$3||'%')`;

inventoryRouter.get('/', async (req,res) => {
  const plant=await resolvePlantScope(req.user!.userId,String(req.query.plant??''));
  const status=String(req.query.status??'').trim();
  const search=String(req.query.search??'').trim();

  const result=await query(`
    SELECT i.*,
           tc.vendor_grade,
           tc.chemical_treatment,
           tc.surface_condition,
           tc.inner_dia_mm,
           tc.outer_dia_mm,
           tc.batch_length_m,
           tc.gsm_coating
    FROM mes.vw_rm_inventory i
    LEFT JOIN mes.rm_supplier_tc tc ON tc.batch_id=i.batch_id
    ${inventoryWhere}
    ORDER BY i.last_movement_at DESC
    LIMIT 500`,[plant ?? '',status,search]);

  res.json({rows:result.rows});
});

function reportFilters(req:any){
  return {
    materialCode:String(req.query.materialCode??'').trim(),
    batchNo:String(req.query.batchNo??'').trim(),
    storageLocation:String(req.query.storageLocation??'').trim(),
    heatNo:String(req.query.heatNo??'').trim(),
    supplier:String(req.query.supplier??'').trim(),
    qualityGrade:String(req.query.qualityGrade??'').trim().toUpperCase(),
    steelGrade:String(req.query.steelGrade??'').trim()
  };
}

// Screen 1102 - RM Stores Inventory.
// v0.9.7 uses server-side paging so the browser never has to render all 8,692
// coils at once. The SQL view itself is also optimized to aggregate QA once.
inventoryRouter.get('/report', async (req,res) => {
  const plant=await resolvePlantScope(req.user!.userId,String(req.query.plant??''));
  const f=reportFilters(req);
  const downloadAll=String(req.query.all??'')==='1';
  const limit=downloadAll ? 15000 : Math.min(Math.max(Number(req.query.limit??200)||200,50),500);
  const offset=downloadAll ? 0 : Math.max(Number(req.query.offset??0)||0,0);
  const params=[plant ?? '',f.materialCode,f.batchNo,f.storageLocation,f.heatNo,f.supplier,f.qualityGrade,f.steelGrade,limit,offset];
  const where=`
    WHERE UPPER(COALESCE(stock_stage,''))='RM'
      AND material_code LIKE 'R_HR%'
      AND ($1='' OR plant_code=$1)
      AND ($2='' OR COALESCE(material_code,'') ILIKE '%'||$2||'%')
      AND ($3='' OR COALESCE(batch_no,'') ILIKE '%'||$3||'%')
      AND ($4='' OR COALESCE(storage_location,'')=$4)
      AND ($5='' OR COALESCE(heat_no,'') ILIKE '%'||$5||'%')
      AND ($6='' OR COALESCE(rm_supplier,'') ILIKE '%'||$6||'%'
                  OR COALESCE(rm_source,'') ILIKE '%'||$6||'%')
      AND ($7='' OR UPPER(COALESCE(qa_grade,''))=$7)
      AND ($8='' OR COALESCE(rm_steel_grade,'') ILIKE '%'||$8||'%')`;

  const data=await query(`
      SELECT
        row_id AS inventory_id,
        source_system,source_row_no,source_file,
        material_type,stock_stage,plant_code,storage_location,
        material_code,material_description,product_group,product_type,
        batch_no,batch_qty_mt,qa_grade,stock_status,
        thickness_mm,width_mm,length_value,temper,coating,jet_printing,
        stock_generated_date,stock_age_days,
        rm_source,sap_grn_no,sap_po_no,sap_po_item,po_delivery_date,movement_type,
        eq_spec,eq_spec_group,eq_sub_spec,chapter_id,chapter_type,crown,
        supplier_batch,heat_no,mother_stock_grn_date,mother_stock_grn_age_days,
        rm_steel_grade,
        carbon,manganese,sulphur,phosphorus,silicon,aluminium,
        carbon_equivalent,nitrogen,copper,molybdenum,chromium,nickel,
        rm_supplier,imported_at,updated_at,
        count(*) OVER()::int AS total_count,
        sum(batch_qty_mt) OVER()::numeric(16,3) AS total_qty_mt
      FROM mes.vw_rm_store_inventory
      ${where}
      ORDER BY stock_generated_date DESC NULLS LAST,material_code,batch_no
      LIMIT $9 OFFSET $10`,params);

  const total=data.rows.length ? Number(data.rows[0].total_count||0) : 0;
  const totalQtyMt=data.rows.length ? Number(data.rows[0].total_qty_mt||0) : 0;
  const rows=data.rows.map(({total_count,total_qty_mt,...r}:any)=>r);
  res.json({scope:'RM_ONLY',rows,total,totalQtyMt,limit,offset,hasMore:offset+rows.length<total});
});

// Filter options deliberately exclude Batch No and Heat No datalists. With ~8.7k
// coils those thousands of DOM <option> nodes made Screen 1102 feel frozen.
// Batch/Heat remain normal searchable text inputs.
inventoryRouter.get('/report/filters', async (req,res) => {
  const plant=await resolvePlantScope(req.user!.userId,String(req.query.plant??''));
  const p=plant ?? '';
  const result=await query(`
    SELECT
      ARRAY(
        SELECT DISTINCT m.sap_material_code
        FROM mes.rm_inventory_balance ib
        JOIN mes.batch_master b ON b.batch_id=ib.batch_id
        JOIN mes.material_master m ON m.material_id=b.material_id
        WHERE ($1='' OR ib.plant_code=$1) AND m.sap_material_code LIKE 'R_HR%'
        ORDER BY m.sap_material_code
      ) AS material_codes,
      ARRAY(
        SELECT DISTINCT ib.storage_location
        FROM mes.rm_inventory_balance ib
        JOIN mes.batch_master b ON b.batch_id=ib.batch_id
        JOIN mes.material_master m ON m.material_id=b.material_id
        WHERE ($1='' OR ib.plant_code=$1) AND m.sap_material_code LIKE 'R_HR%'
          AND NULLIF(ib.storage_location,'') IS NOT NULL
        ORDER BY ib.storage_location
      ) AS storage_locations,
      ARRAY(
        SELECT DISTINCT COALESCE(s.supplier_name,c.source_supplier_name)
        FROM mes.rm_inventory_balance ib
        JOIN mes.batch_master b ON b.batch_id=ib.batch_id
        JOIN mes.material_master m ON m.material_id=b.material_id
        LEFT JOIN mes.goods_receipt_coil c ON c.batch_id=b.batch_id AND c.plant_code=ib.plant_code
        LEFT JOIN mes.supplier_master s ON s.supplier_id=c.supplier_id
        WHERE ($1='' OR ib.plant_code=$1) AND m.sap_material_code LIKE 'R_HR%'
          AND NULLIF(COALESCE(s.supplier_name,c.source_supplier_name),'') IS NOT NULL
        ORDER BY COALESCE(s.supplier_name,c.source_supplier_name)
      ) AS suppliers,
      ARRAY(
        SELECT DISTINCT COALESCE(NULLIF(tc.quality_level,''),
          CASE b.quality_status WHEN 'ACCEPTED' THEN 'PRIME' WHEN 'REJECTED' THEN 'REJECT' ELSE 'PENDING_QA' END)
        FROM mes.rm_inventory_balance ib
        JOIN mes.batch_master b ON b.batch_id=ib.batch_id
        JOIN mes.material_master m ON m.material_id=b.material_id
        LEFT JOIN mes.rm_supplier_tc tc ON tc.batch_id=b.batch_id
        WHERE ($1='' OR ib.plant_code=$1) AND m.sap_material_code LIKE 'R_HR%'
        ORDER BY 1
      ) AS quality_grades,
      ARRAY(
        SELECT DISTINCT tc.hr_grade
        FROM mes.rm_inventory_balance ib
        JOIN mes.batch_master b ON b.batch_id=ib.batch_id
        JOIN mes.material_master m ON m.material_id=b.material_id
        JOIN mes.rm_supplier_tc tc ON tc.batch_id=b.batch_id
        WHERE ($1='' OR ib.plant_code=$1) AND m.sap_material_code LIKE 'R_HR%'
          AND NULLIF(tc.hr_grade,'') IS NOT NULL
        ORDER BY tc.hr_grade
      ) AS steel_grades`,[p]);
  res.json(result.rows[0]??{});
});

// Download/report dataset: current operational RM inventory plus ALL supplier-TC analysis parameters.
inventoryRouter.get('/analysis', async (req,res) => {
  const plant=await resolvePlantScope(req.user!.userId,String(req.query.plant??''));
  const status=String(req.query.status??'').trim();
  const search=String(req.query.search??'').trim();

  const result=await query(`
    SELECT i.*,
           tc.vendor_grade,
           tc.chemical_treatment,
           tc.surface_condition,
           tc.inner_dia_mm,
           tc.outer_dia_mm,
           tc.batch_length_m,
           tc.gsm_coating,
           COALESCE(props.parameters,'{}'::jsonb) AS parameters
    FROM mes.vw_rm_inventory i
    LEFT JOIN mes.rm_supplier_tc tc ON tc.batch_id=i.batch_id
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
    ${inventoryWhere}
    ORDER BY i.last_movement_at DESC
    LIMIT 2000`,[plant ?? '',status,search]);

  res.json({rows:result.rows});
});

inventoryRouter.get('/batch/:batchNo', async (req,res) => {
  const batchNo=String(req.params.batchNo||'').trim();

  const head=await query(`
    SELECT i.*,
           tc.vendor_grade,
           tc.chemical_treatment,
           tc.surface_condition,
           tc.elongation_gl_type,
           tc.inner_dia_mm,
           tc.outer_dia_mm,
           tc.batch_length_m,
           tc.gsm_coating,
           tc.remarks AS supplier_tc_remarks
    FROM mes.vw_rm_inventory i
    LEFT JOIN mes.rm_supplier_tc tc ON tc.batch_id=i.batch_id
    WHERE i.batch_no=$1
    ORDER BY i.last_movement_at DESC
    LIMIT 1`,[batchNo]);

  if(head.rows[0]) {
    await assertPlantAccess(req.user!.userId,head.rows[0].plant_code);

    const tc=await query(`
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
      ORDER BY p.parameter_category,p.parameter_name,p.parameter_code`,[batchNo]);

    const moves=await query(`
      SELECT mv.*
      FROM mes.rm_inventory_movement mv
      JOIN mes.batch_master b ON b.batch_id=mv.batch_id
      WHERE b.batch_no=$1
      ORDER BY mv.posted_at DESC`,[batchNo]);

    return res.json({...head.rows[0],supplierTcParameters:tc.rows,movements:moves.rows});
  }

  const snap=await query(`SELECT * FROM mes.vw_rm_store_inventory WHERE batch_no=$1 LIMIT 1`,[batchNo]);
  const r=snap.rows[0];
  if(!r) return res.status(404).json({error:'Batch not found'});
  await assertPlantAccess(req.user!.userId,r.plant_code);

  const parameters=[
    ['CARBON','Carbon',r.carbon],['MANGANESE','Manganese',r.manganese],['SULPHUR','Sulphur',r.sulphur],
    ['PHOSPHORUS','Phosphorus',r.phosphorus],['SILICON','Silicon',r.silicon],['ALUMINIUM','Aluminium',r.aluminium],
    ['CARBON_EQUIVALENT','Carbon Equivalent',r.carbon_equivalent],['NITROGEN','Nitrogen',r.nitrogen],
    ['COPPER','Copper',r.copper],['MOLYBDENUM','Molybdenum',r.molybdenum],['CHROMIUM','Chromium',r.chromium],['NICKEL','Nickel',r.nickel]
  ].map(([parameter_code,parameter_name,text_value])=>({parameter_code,parameter_name,parameter_category:'CHEMICAL',text_value,uom:''}));

  res.json({
    batch_no:r.batch_no,plant_code:r.plant_code,storage_location:r.storage_location,
    sap_material_code:r.material_code,material_description:r.material_description,
    vendor_batch_no:r.supplier_batch,supplier_name:r.rm_supplier,sap_grn_no:r.sap_grn_no,
    sap_po_no:r.sap_po_no,sap_po_item:r.sap_po_item,
    heat_no:r.heat_no,hr_grade:r.rm_steel_grade,batch_thickness_mm:r.thickness_mm,
    batch_width_mm:r.width_mm,batch_weight_mt:r.batch_qty_mt,quality_status:r.qa_grade,
    stock_status:r.stock_status,supplierTcParameters:parameters,movements:[],inventoryReportRow:r
  });
});
