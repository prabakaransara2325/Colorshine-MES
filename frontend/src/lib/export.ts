function csvCell(value:any){
  const s=value===null||value===undefined?'':String(value);
  return `"${s.replaceAll('"','""')}"`;
}

function saveCsv(filename:string, matrix:any[][]){
  const csv='\uFEFF'+matrix.map(row=>row.map(csvCell).join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function parameterColumns(rows:any[]){
  const map=new Map<string,any>();
  rows.forEach(r=>{
    Object.entries(r.parameters||{}).forEach(([code,p]:any)=>{
      if(!map.has(code)) map.set(code,{code,...p});
    });
  });
  return [...map.values()].sort((a,b)=>`${a.category||''}|${a.name||a.code}`.localeCompare(`${b.category||''}|${b.name||b.code}`));
}

function paramValue(row:any,p:any){
  const v=row.parameters?.[p.code];
  if(!v) return '';
  const value=v.value??'';
  return v.uom?`${value} ${v.uom}`:value;
}

const commonColumns=[
  ['Plant','plant_code'],
  ['GRN','sap_grn_no'],
  ['GRN Year','sap_material_doc_year'],
  ['GRN Posting Date','grn_posting_date'],
  ['PO No','sap_po_no'],
  ['PO Item','sap_po_item'],
  ['MES Batch','batch_no'],
  ['Supplier Batch','vendor_batch_no'],
  ['Supplier Code','sap_vendor_no'],
  ['Supplier Name','supplier_name'],
  ['Supplier Grade','vendor_grade'],
  ['Steel Grade','hr_grade'],
  ['Heat No','heat_no'],
  ['Supplier TC No','supplier_tc_no'],
  ['Quality Level','quality_level'],
  ['Material','sap_material_code'],
  ['Material Description','material_description'],
  ['Thickness (mm)','batch_thickness_mm'],
  ['Width (mm)','batch_width_mm'],
  ['Received Weight (MT)','batch_weight_mt'],
  ['Quality Status','quality_status'],
  ['Available (MT)','available_weight_mt'],
  ['Quality Hold (MT)','quality_hold_weight_mt'],
  ['Blocked (MT)','blocked_weight_mt']
] as const;

export function downloadGrnAnalysis(rows:any[],filename='GRN_RM_Analysis.csv'){
  const params=parameterColumns(rows);
  const headers=[...commonColumns.map(c=>c[0]),...params.map(p=>`${p.category||'PARAMETER'} - ${p.name||p.code}${p.uom?` (${p.uom})`:''}`)];
  const body=rows.map(r=>[
    ...commonColumns.map(c=>r[c[1]]??''),
    ...params.map(p=>paramValue(r,p))
  ]);
  saveCsv(filename,[headers,...body]);
}

export function downloadInventoryAnalysis(rows:any[],filename='RM_Inventory_Analysis.csv'){
  const params=parameterColumns(rows);
  const invColumns=[
    ...commonColumns,
    ['Storage Location','storage_location'],
    ['On Hand (MT)','on_hand_weight_mt'],
    ['Reserved (MT)','reserved_weight_mt'],
    ['Stock Status','stock_status'],
    ['Last Movement','last_movement_at']
  ] as const;
  const headers=[...invColumns.map(c=>c[0]),...params.map(p=>`${p.category||'PARAMETER'} - ${p.name||p.code}${p.uom?` (${p.uom})`:''}`)];
  const body=rows.map(r=>[
    ...invColumns.map(c=>r[c[1]]??''),
    ...params.map(p=>paramValue(r,p))
  ]);
  saveCsv(filename,[headers,...body]);
}

export function detailToAnalysisRow(detail:any){
  const parameters:any={};
  (detail?.supplierTcParameters||[]).forEach((p:any)=>{
    parameters[p.parameter_code]={
      name:p.parameter_name,
      category:p.parameter_category,
      value:p.numeric_value??p.text_value??p.source_raw_value??'',
      uom:p.uom||p.default_uom||''
    };
  });
  return {...detail,parameters};
}

// Exact business report format from InventoryMaster_MES.xlsx (49 columns, same order).
export const inventoryMasterReportColumns = [
  ['Material Type','material_type'],
  ['RM/WIP/FG','stock_stage'],
  ['Plant','plant_code'],
  ['Storage Location','storage_location'],
  ['Material','material_code'],
  ['Batch','batch_no'],
  ['Batch Qty','batch_qty_mt'],
  ['QA Grade','qa_grade'],
  ['Thickness','thickness_mm'],
  ['Width','width_mm'],
  ['Length','length_value'],
  ['Temper','temper'],
  ['Coating','coating'],
  ['Jet Printing','jet_printing'],
  ['Stock Generated Date','stock_generated_date'],
  ['Stock Age','stock_age_days'],
  ['MES PO','mes_po'],
  ['SO No','so_no'],
  ['SO Line Item','so_line_item'],
  ['SO Thickness','so_thickness_mm'],
  ['SO Width','so_width_mm'],
  ['SO Temper','so_temper'],
  ['SO Quality','so_quality'],
  ['SO Coating','so_coating'],
  ['SO Min Wt','so_min_wt_mt'],
  ['SO Max Wt','so_max_wt_mt'],
  ['SO Logo','so_logo'],
  ['SO Spangle','so_spangle'],
  ['SO Jet Printing','so_jet_printing'],
  ['SO TLL','so_tll'],
  ['Mother RM Batch','mother_rm_batch'],
  ['Supplier Batch','supplier_batch'],
  ['Heat No','heat_no'],
  ['Mother Stock GRN Date','mother_stock_grn_date'],
  ['Mother Stock GRN Age','mother_stock_grn_age_days'],
  ['RM Steel Grade','rm_steel_grade'],
  ['Carbon','carbon'],
  ['Manganese','manganese'],
  ['Sulphur','sulphur'],
  ['Phosphorus','phosphorus'],
  ['Silicon','silicon'],
  ['Aluminium','aluminium'],
  ['Carbon Equivalent','carbon_equivalent'],
  ['Nitrogen','nitrogen'],
  ['Copper','copper'],
  ['Molybdenum','molybdenum'],
  ['Chromium','chromium'],
  ['Nickel','nickel'],
  ['RM Supplier','rm_supplier']
] as const;

export function downloadInventoryMasterReport(rows:any[],filename='InventoryMaster_MES.csv'){
  const headers=inventoryMasterReportColumns.map(c=>c[0]);
  const body=rows.map(r=>inventoryMasterReportColumns.map(c=>r[c[1]]??''));
  saveCsv(filename,[headers,...body]);
}

// RM Stores screen 1102 deliberately excludes WIP/FG and Sales Order/planning fields.
export const rmInventoryReportColumns = [
  ['Material Type','material_type'],
  ['Plant','plant_code'],
  ['Storage Location','storage_location'],
  ['Material','material_code'],
  ['Material Description','material_description'],
  ['Product Group','product_group'],
  ['Batch','batch_no'],
  ['Batch Qty','batch_qty_mt'],
  ['QA Grade','qa_grade'],
  ['Stock Status','stock_status'],
  ['Thickness','thickness_mm'],
  ['Width','width_mm'],
  ['GRN','sap_grn_no'],
  ['PO No','sap_po_no'],
  ['PO Item','sap_po_item'],
  ['PO Delivery Date','po_delivery_date'],
  ['RM Source','rm_source'],
  ['Supplier','rm_supplier'],
  ['Supplier Batch','supplier_batch'],
  ['Stock Generated Date','stock_generated_date'],
  ['Stock Age','stock_age_days'],
  ['Heat No','heat_no'],
  ['RM Steel Grade','rm_steel_grade'],
  ['EQ Spec','eq_spec'],
  ['EQ Spec Group','eq_spec_group'],
  ['EQ Sub Spec','eq_sub_spec'],
  ['Crown','crown'],
  ['Carbon','carbon'],
  ['Manganese','manganese'],
  ['Sulphur','sulphur'],
  ['Phosphorus','phosphorus'],
  ['Silicon','silicon'],
  ['Aluminium','aluminium'],
  ['Carbon Equivalent','carbon_equivalent'],
  ['Nitrogen','nitrogen'],
  ['Copper','copper'],
  ['Molybdenum','molybdenum'],
  ['Chromium','chromium'],
  ['Nickel','nickel']
] as const;

const rmChemistryKeys=new Set(['carbon','manganese','sulphur','phosphorus','silicon','aluminium','carbon_equivalent','nitrogen','copper','molybdenum','chromium','nickel']);
function rmReportValue(key:string,value:any){
  if(value===null||value===undefined||value==='') return '';
  if(key==='thickness_mm') return Number(value).toFixed(3);
  if(key==='width_mm') return Number(value).toFixed(0);
  if(key==='batch_qty_mt'||key==='crown') return Number(value).toFixed(3);
  if(rmChemistryKeys.has(key)) return Number(value).toFixed(3);
  if(key==='rm_source') return String(value).replace(/^0+/,'')||'0';
  if(key==='stock_generated_date'||key==='mother_stock_grn_date'||key==='po_delivery_date'){
    const x=String(value); if(/^\d{4}-\d{2}-\d{2}/.test(x)){const [y,m,d]=x.slice(0,10).split('-');return `${d}-${m}-${y}`;}
  }
  return value;
}

export function downloadRmInventoryReport(
  rows:any[],
  filename='RM_Inventory.csv',
  columns:readonly (readonly [string,string])[]=rmInventoryReportColumns
){
  const headers=columns.map(c=>c[0]);
  const body=rows.map(r=>columns.map(c=>rmReportValue(c[1],r[c[1]])));
  saveCsv(filename,[headers,...body]);
}
