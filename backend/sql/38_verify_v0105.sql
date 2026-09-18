SET search_path TO mes, public;

SELECT 'MATERIALS' check_name,count(*)::bigint value FROM mes.material_master
UNION ALL SELECT 'WORK_CENTERS',count(*) FROM mes.work_center_master
UNION ALL SELECT 'OPERATIONS',count(*) FROM mes.operation_master
UNION ALL SELECT 'THICKNESS_ROWS',count(*) FROM mes.planning_thickness_matrix
UNION ALL SELECT 'ROUTES',count(*) FROM mes.route_master
UNION ALL SELECT 'SAP_SO_ITEMS',count(*) FROM mes.sap_sales_order_item
UNION ALL SELECT 'SAP_SO_ROUTES',count(*) FROM mes.sap_sales_order_route
UNION ALL SELECT 'SAP_SO_ORDER_DETAIL',count(*) FROM mes.sap_sales_order_characteristic WHERE source_category='ORDER_DETAIL'
UNION ALL SELECT 'SAP_SO_CHEM_MECH',count(*) FROM mes.sap_sales_order_characteristic WHERE source_category='CHEM_MECH';

SELECT so_no,count(*) item_count,sum(qty)::numeric(18,3) total_qty_mt,
       count(*) FILTER (WHERE planning_status='READY_FOR_PLANNING') ready_items,
       count(*) FILTER (WHERE planning_status='MASTER_PENDING') master_pending_items
FROM mes.vw_sap_sales_order_monitor
GROUP BY so_no ORDER BY so_no;

SELECT so_no,so_item_no,material_code,qty,uom,plant_code,route_count,order_spec_count,chem_mech_count,
       order_thickness_mm,order_width_mm,cr_thickness_aim_mm,cr_thickness_min_mm,cr_thickness_max_mm,
       gl_thickness_aim_mm,gl_thickness_min_mm,gl_thickness_max_mm,coating_gsm_aim,
       planning_status,validation_message
FROM mes.vw_sap_sales_order_monitor
ORDER BY so_no,so_item_no::integer;
