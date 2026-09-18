import { Router } from 'express';
import { query } from '../db';
import { requireAuth } from '../middleware/auth';
import { resolvePlantScope } from '../security';

export const reportsRouter=Router();
reportsRouter.use(requireAuth);

reportsRouter.get('/rm-supplier',async(req,res)=>{
  const plant=await resolvePlantScope(req.user!.userId,String(req.query.plant??''));
  const result=await query(`SELECT * FROM mes.vw_rm_supplier_performance
    WHERE ($1='' OR plant_code=$1) ORDER BY received_weight_mt DESC,supplier_name`,[plant ?? '']);
  res.json({rows:result.rows});
});

function plantStockFilters(req:any){
  return {
    materialCode:String(req.query.materialCode??'').trim(),
    storageLocation:String(req.query.storageLocation??'').trim(),
    category:String(req.query.category??'').trim().toUpperCase(),
    thickness:String(req.query.thickness??'').trim(),
    heatNo:String(req.query.heatNo??'').trim(),
    steelGrade:String(req.query.steelGrade??'').trim(),
    qualityGrade:String(req.query.qualityGrade??'').trim().toUpperCase(),
  };
}

// v0.9.9: server-side paging. The browser receives only the visible page instead
// of rendering thousands of 49-column rows. all=1 is reserved for CSV export.
reportsRouter.get('/plant-stock',async(req,res)=>{
  const plant=await resolvePlantScope(req.user!.userId,String(req.query.plant??''));
  const f=plantStockFilters(req);
  if(f.thickness && !Number.isFinite(Number(f.thickness))) return res.status(400).json({error:'Thickness must be numeric'});

  const exportAll=String(req.query.all??'')==='1';
  const requestedLimit=Number(req.query.limit??200);
  const requestedOffset=Number(req.query.offset??0);
  const limit=exportAll?50000:Math.max(50,Math.min(Number.isFinite(requestedLimit)?Math.floor(requestedLimit):200,500));
  const offset=exportAll?0:Math.max(0,Number.isFinite(requestedOffset)?Math.floor(requestedOffset):0);

  const params=[
    plant ?? '',
    f.materialCode,
    f.storageLocation,
    f.category,
    f.thickness,
    f.heatNo,
    f.steelGrade,
    f.qualityGrade
  ];

  const where=`
    WHERE ($1='' OR plant_code=$1)
      AND ($2='' OR COALESCE(material_code,'') ILIKE '%'||$2||'%')
      AND ($3='' OR COALESCE(storage_location,'')=$3)
      AND ($4='' OR COALESCE(stock_stage,'')=$4)
      AND ($5='' OR thickness_mm=$5::numeric)
      AND ($6='' OR COALESCE(heat_no,'') ILIKE '%'||$6||'%')
      AND ($7='' OR COALESCE(rm_steel_grade,'') ILIKE '%'||$7||'%')
      AND ($8='' OR UPPER(COALESCE(qa_grade,''))=$8)`;

  const dataSql=`
      SELECT *
      FROM mes.vw_plant_stock_report
      ${where}
      ORDER BY
        CASE stock_stage WHEN 'RM' THEN 1 WHEN 'WIP' THEN 2 WHEN 'FG' THEN 3 ELSE 9 END,
        material_type, material_code, batch_no
      LIMIT $9 OFFSET $10`;

  if(exportAll){
    const data=await query(dataSql,[...params,limit,offset]);
    return res.json({rows:data.rows,total:data.rows.length,exportLimit:limit});
  }

  const [data,summary]=await Promise.all([
    query(dataSql,[...params,limit,offset]),
    query(`
      SELECT
        count(*)::int AS total_records,
        COALESCE(sum(batch_qty_mt),0)::numeric(16,3) AS total_qty_mt,
        count(*) FILTER (WHERE stock_stage='RM')::int AS rm_records,
        COALESCE(sum(batch_qty_mt) FILTER (WHERE stock_stage='RM'),0)::numeric(16,3) AS rm_qty_mt,
        count(*) FILTER (WHERE stock_stage='WIP')::int AS wip_records,
        COALESCE(sum(batch_qty_mt) FILTER (WHERE stock_stage='WIP'),0)::numeric(16,3) AS wip_qty_mt,
        count(*) FILTER (WHERE stock_stage='FG')::int AS fg_records,
        COALESCE(sum(batch_qty_mt) FILTER (WHERE stock_stage='FG'),0)::numeric(16,3) AS fg_qty_mt,
        count(*) FILTER (
          WHERE COALESCE(NULLIF(so_no,''),'0') NOT IN ('0')
             OR COALESCE(NULLIF(mes_po,''),'0') NOT IN ('0')
        )::int AS linked_records
      FROM mes.vw_plant_stock_report
      ${where}`,params)
  ]);

  const s=summary.rows[0]??{};
  res.json({rows:data.rows,summary:s,total:Number(s.total_records??0),limit,offset});
});

// v0.9.9 lightweight filter values. Heat number is deliberately a normal text
// filter, so we no longer send thousands of heat numbers to the browser.
reportsRouter.get('/plant-stock/filters',async(req,res)=>{
  const plant=await resolvePlantScope(req.user!.userId,String(req.query.plant??''));
  const p=plant ?? '';
  const result=await query(`
    WITH stock AS (
      SELECT ib.plant_code,ib.storage_location,m.sap_material_code AS material_code,
             c.batch_thickness_mm AS thickness_mm,tc.hr_grade AS steel_grade,tc.quality_level AS quality_grade
        FROM mes.rm_inventory_balance ib
        JOIN mes.batch_master b ON b.batch_id=ib.batch_id
        JOIN mes.material_master m ON m.material_id=b.material_id
        LEFT JOIN mes.goods_receipt_coil c ON c.batch_id=b.batch_id AND c.plant_code=ib.plant_code
        LEFT JOIN mes.rm_supplier_tc tc ON tc.batch_id=b.batch_id
       WHERE m.sap_material_code LIKE 'R_HR%'
      UNION ALL
      SELECT plant_code,storage_location,material_code,thickness_mm,rm_steel_grade,qa_grade
        FROM mes.inventory_master
       WHERE UPPER(COALESCE(stock_stage,'')) IN ('WIP','FG')
    )
    SELECT
      ARRAY(SELECT DISTINCT material_code FROM stock
            WHERE ($1='' OR plant_code=$1) AND NULLIF(material_code,'') IS NOT NULL
            ORDER BY material_code) AS material_codes,
      ARRAY(SELECT DISTINCT storage_location FROM stock
            WHERE ($1='' OR plant_code=$1) AND NULLIF(storage_location,'') IS NOT NULL
            ORDER BY storage_location) AS storage_locations,
      ARRAY(SELECT DISTINCT steel_grade FROM stock
            WHERE ($1='' OR plant_code=$1) AND NULLIF(steel_grade,'') IS NOT NULL
            ORDER BY steel_grade) AS steel_grades,
      ARRAY(SELECT DISTINCT quality_grade FROM stock
            WHERE ($1='' OR plant_code=$1) AND NULLIF(quality_grade,'') IS NOT NULL
            ORDER BY quality_grade) AS quality_grades`,[p]);
  res.json(result.rows[0]??{});
});
