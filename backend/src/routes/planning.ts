import { Router } from 'express';
import { query } from '../db';
import { requireAuth } from '../middleware/auth';
import { resolvePlantScope } from '../security';

export const planningRouter=Router();
planningRouter.use(requireAuth);

function str(v:any){return String(v??'').trim();}

planningRouter.get('/sales-orders',async(req,res)=>{
  const plant=await resolvePlantScope(req.user!.userId,str(req.query.plant));
  const soNo=str(req.query.soNo); const item=str(req.query.item); const material=str(req.query.material);
  const customer=str(req.query.customer); const status=str(req.query.status).toUpperCase();
  const requestedLimit=Number(req.query.limit??100); const requestedOffset=Number(req.query.offset??0);
  const limit=Math.max(20,Math.min(Number.isFinite(requestedLimit)?Math.floor(requestedLimit):100,500));
  const offset=Math.max(0,Number.isFinite(requestedOffset)?Math.floor(requestedOffset):0);
  const params=[plant??'',soNo,item,material,customer,status];
  const where=`WHERE ($1='' OR v.plant_code=$1)
    AND ($2='' OR v.so_no ILIKE '%'||$2||'%')
    AND ($3='' OR v.so_item_no ILIKE '%'||$3||'%')
    AND ($4='' OR v.material_code ILIKE '%'||$4||'%')
    AND ($5='' OR COALESCE(v.sold_to_party_name,'') ILIKE '%'||$5||'%' OR COALESCE(v.sold_to_code,'') ILIKE '%'||$5||'%')
    AND ($6='' OR v.planning_status=$6)`;

  const [data,summary]=await Promise.all([
    query(`SELECT v.*,
        ink.characteristic_value AS inkjet,
        guard.characteristic_value AS guardfilm
      FROM mes.vw_sap_sales_order_monitor v
      LEFT JOIN LATERAL (
        SELECT ch.characteristic_value
        FROM mes.sap_sales_order_characteristic ch
        WHERE ch.so_no=v.so_no AND ch.so_item_no=v.so_item_no
          AND ch.source_category='ORDER_DETAIL' AND ch.material_code=v.material_code
          AND ch.characteristic_name='INKJET'
        ORDER BY CASE WHEN ch.route_ind='P1' THEN 0 ELSE 1 END,ch.route_ind
        LIMIT 1
      ) ink ON true
      LEFT JOIN LATERAL (
        SELECT ch.characteristic_value
        FROM mes.sap_sales_order_characteristic ch
        WHERE ch.so_no=v.so_no AND ch.so_item_no=v.so_item_no
          AND ch.source_category='ORDER_DETAIL' AND ch.material_code=v.material_code
          AND upper(replace(replace(ch.characteristic_name,' ',''),'_','')) IN
              ('GUARDFILM','GUARDFILMREQ','PROTECTIVEFILM','PROTECTIVEFILMREQ','PROTECTIONFILM','FILMREQ','GUARDFLM')
        ORDER BY CASE WHEN ch.route_ind='P1' THEN 0 ELSE 1 END,ch.route_ind
        LIMIT 1
      ) guard ON true
      ${where}
      ORDER BY v.so_no DESC, CASE WHEN v.so_item_no ~ '^\\d+$' THEN v.so_item_no::int ELSE 999999 END, v.so_item_no
      LIMIT $7 OFFSET $8`,[...params,limit,offset]),
    query(`SELECT count(*)::int total_items,count(DISTINCT v.so_no)::int total_orders,
      COALESCE(sum(v.qty),0)::numeric(18,3) total_qty_mt,
      count(*) FILTER(WHERE v.planning_status='READY_FOR_PLANNING')::int ready_items,
      count(*) FILTER(WHERE v.planning_status='MASTER_PENDING')::int master_pending_items,
      count(*) FILTER(WHERE v.planning_status='ROUTE_PENDING')::int route_pending_items
      FROM mes.vw_sap_sales_order_monitor v ${where}`,params)
  ]);
  const s=summary.rows[0]??{};
  res.json({rows:data.rows,summary:s,total:Number(s.total_items??0),limit,offset});
});

planningRouter.get('/sales-orders/:soNo/:itemNo',async(req,res)=>{
  const soNo=str(req.params.soNo),itemNo=str(req.params.itemNo);
  const item=await query(`SELECT v.*,
      ink.characteristic_value AS inkjet,
      guard.characteristic_value AS guardfilm
    FROM mes.vw_sap_sales_order_monitor v
    LEFT JOIN LATERAL (
      SELECT ch.characteristic_value
      FROM mes.sap_sales_order_characteristic ch
      WHERE ch.so_no=v.so_no AND ch.so_item_no=v.so_item_no
        AND ch.source_category='ORDER_DETAIL' AND ch.material_code=v.material_code
        AND ch.characteristic_name='INKJET'
      ORDER BY CASE WHEN ch.route_ind='P1' THEN 0 ELSE 1 END,ch.route_ind
      LIMIT 1
    ) ink ON true
    LEFT JOIN LATERAL (
      SELECT ch.characteristic_value
      FROM mes.sap_sales_order_characteristic ch
      WHERE ch.so_no=v.so_no AND ch.so_item_no=v.so_item_no
        AND ch.source_category='ORDER_DETAIL' AND ch.material_code=v.material_code
        AND upper(replace(replace(ch.characteristic_name,' ',''),'_','')) IN
            ('GUARDFILM','GUARDFILMREQ','PROTECTIVEFILM','PROTECTIVEFILMREQ','PROTECTIONFILM','FILMREQ','GUARDFLM')
      ORDER BY CASE WHEN ch.route_ind='P1' THEN 0 ELSE 1 END,ch.route_ind
      LIMIT 1
    ) guard ON true
    WHERE v.so_no=$1 AND v.so_item_no=$2`,[soNo,itemNo]);
  if(!item.rows[0])return res.status(404).json({error:'SAP Sales Order item not found'});
  await resolvePlantScope(req.user!.userId,item.rows[0].plant_code);
  const routes=await query(`SELECT route_ind,process_path,material_tree,sent_date,source_read_flag,last_received_at
    FROM mes.sap_sales_order_route WHERE so_no=$1 AND so_item_no=$2
    ORDER BY CASE WHEN route_ind='P1' THEN 0 ELSE 1 END,route_ind`,[soNo,itemNo]);
  res.json({item:item.rows[0],routes:routes.rows});
});

planningRouter.get('/sales-orders/:soNo/:itemNo/characteristics',async(req,res)=>{
  const soNo=str(req.params.soNo),itemNo=str(req.params.itemNo); const source=str(req.query.source).toUpperCase();
  const routeInd=str(req.query.routeInd); const materialCode=str(req.query.materialCode); const q=str(req.query.q); const limit=Math.max(50,Math.min(Number(req.query.limit??500)||500,2000));
  const item=await query(`SELECT plant_code FROM mes.sap_sales_order_item WHERE so_no=$1 AND so_item_no=$2`,[soNo,itemNo]);
  if(!item.rows[0])return res.status(404).json({error:'SAP Sales Order item not found'});
  await resolvePlantScope(req.user!.userId,item.rows[0].plant_code);
  const data=await query(`SELECT source_category,material_code,route_ind,characteristic_name,characteristic_value,characteristic_uom,sent_date,last_received_at
    FROM mes.sap_sales_order_characteristic WHERE so_no=$1 AND so_item_no=$2
      AND ($3='' OR source_category=$3) AND ($4='' OR route_ind=$4) AND ($5='' OR material_code=$5)
      AND ($6='' OR characteristic_name ILIKE '%'||$6||'%' OR COALESCE(characteristic_value,'') ILIKE '%'||$6||'%')
    ORDER BY source_category,route_ind,material_code,characteristic_name LIMIT $7`,[soNo,itemNo,source,routeInd,materialCode,q,limit]);
  res.json({rows:data.rows,total:data.rows.length});
});
