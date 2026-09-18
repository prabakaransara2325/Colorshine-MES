import {useEffect,useState} from 'react';
import {api,plantQueryParam,selectedPlant,subscribePlantChange} from '../lib/api';
import {Download,Eye,Search,Truck} from 'lucide-react';
import {Empty,PageHeader,Status,num,plain} from '../components/UI';
import {ReportLayoutBar,ReportSummaryBar,useReportLayout} from '../components/ReportLayout';
import BatchAnalysisDrawer from '../components/BatchAnalysisDrawer';
import {downloadGrnAnalysis,grnMonitorColumns} from '../lib/export';

const SCREEN_CODE='GRN_MONITOR';

function cellValue(key:string,r:any){
  switch(key){
    case 'batch_thickness_mm': return r.batch_thickness_mm?plain(r.batch_thickness_mm,3):'—';
    case 'batch_width_mm': return r.batch_width_mm?plain(r.batch_width_mm,0):'—';
    case 'batch_weight_mt': return num(r.batch_weight_mt);
    case 'vendor_batch_no': case 'supplier_name': case 'vendor_grade': case 'heat_no': case 'hr_grade': case 'sap_material_code':
      return r[key]||'—';
    case 'reversed_by': return r.reversed_by||'—';
    case 'reversed_at': return r.reversed_at?new Date(r.reversed_at).toLocaleString('en-IN'):'—';
    default: return r[key]??'—';
  }
}

export default function GRN(){
  const[rows,setRows]=useState<any[]>([]);
  const[q,setQ]=useState('');
  const[detail,setDetail]=useState<any>(null);
  const[plant,setPlant]=useState(selectedPlant());
  const[exporting,setExporting]=useState(false);

  const layout=useReportLayout(SCREEN_CODE,grnMonitorColumns);

  function queryString(){const p=plantQueryParam();return `search=${encodeURIComponent(q)}${p?`&${p}`:''}`}
  function load(){api(`/grn?${queryString()}`).then(d=>setRows(d.rows||[]))}
  useEffect(()=>subscribePlantChange(setPlant),[]);
  useEffect(load,[plant]);

  async function open(r:any){setDetail(await api(`/grn/batch/${encodeURIComponent(r.batch_no)}`))}
  async function downloadAll(){
    try{setExporting(true);const d=await api(`/grn/analysis?${queryString()}`);downloadGrnAnalysis(d.rows||[],`GRN_RM_Analysis_${plant}.csv`)}finally{setExporting(false)}
  }

  const activeRows=rows.filter(r=>r.entry_type!=='GRN_REVERSAL');
  const coilCount=activeRows.length;
  const totalQtyMt=rows.reduce((s,r)=>s+Number(r.batch_weight_mt||0),0);

  return <>
    <PageHeader title="GRN Monitor" subtitle="SAP raw-material receipts with supplier traceability, steel grade and complete chemical/mechanical analysis." actions={<div className="rm-report-actions">
      <ReportLayoutBar title="GRN Monitor" state={layout}/>
      <button className="secondary-btn download-btn" onClick={downloadAll} disabled={exporting}><Download size={16}/>{exporting?'Preparing…':'Download Analysis'}</button>
    </div>}/>

    <ReportSummaryBar count={coilCount} qty={totalQtyMt}/>

    <div className="toolbar"><div className="search"><Search size={18}/><input autoComplete="off" placeholder="Search GRN, batch, supplier batch, heat, grade or PO…" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&load()}/></div><button className="secondary-btn" onClick={load}>Search</button></div>
    <div className="table-panel analysis-table-panel">
      <div className="responsive-table"><table className="analysis-main-table"><thead><tr>{layout.visibleColumns.map(([label,key])=><th key={key}>{label}</th>)}</tr></thead><tbody>
      {rows.map(r=>{
        const isReversal=r.entry_type==='GRN_REVERSAL';
        return <tr key={isReversal?`${r.grn_coil_id}-rev`:r.grn_coil_id} className={isReversal?'reversal-row':''}>
          {layout.visibleColumns.map(([,key])=>{
            if(key==='sap_grn_no')return <td key={key}><b>{r.sap_grn_no}</b><small>{isReversal?'REVERSAL':(r.sap_po_no&&`PO ${r.sap_po_no}/${r.sap_po_item||''}`)}</small></td>;
            if(key==='batch_no')return <td key={key}><b>{r.batch_no}</b></td>;
            if(key==='batch_weight_mt')return <td key={key}><b className={isReversal?'danger-text':''}>{cellValue(key,r)}</b></td>;
            if(key==='quality_status')return <td key={key}>{isReversal?'—':<Status value={r.quality_status}/>}</td>;
            if(key==='stock_status_derived')return <td key={key}>{isReversal?<Status value="REVERSED"/>:<Status value={Number(r.available_weight_mt)>0?'AVAILABLE':Number(r.blocked_weight_mt)>0?'BLOCKED':'QUALITY_HOLD'}/>}</td>;
            if(key==='reversed_by')return <td key={key} title={r.reversal_reason||undefined}>{cellValue(key,r)}</td>;
            if(key==='__analysis__')return <td key={key}><button className="icon-btn" title="View complete analysis" onClick={()=>open(r)}><Eye size={17}/></button></td>;
            return <td key={key}>{cellValue(key,r)}</td>;
          })}
        </tr>;
      })}</tbody></table>{!rows.length&&<Empty/>}</div>
      <div className="card-list">{activeRows.map(r=><button className="data-card" key={r.grn_coil_id} onClick={()=>open(r)}><div><Truck size={18}/><b>{r.sap_grn_no}</b><Status value={r.quality_status}/></div><h3>{r.batch_no}</h3><p>{r.supplier_name}</p><div className="data-grid"><span>Supplier Batch<b>{r.vendor_batch_no||'—'}</b></span><span>Supplier Grade<b>{r.vendor_grade||'—'}</b></span><span>Heat No<b>{r.heat_no||'—'}</b></span><span>Steel Grade<b>{r.hr_grade||'—'}</b></span><span>Size (mm)<b>{plain(r.batch_thickness_mm,3)} × {plain(r.batch_width_mm,0)}</b></span><span>Weight (MT)<b>{num(r.batch_weight_mt)}</b></span></div></button>)}</div>
      <div className="table-footer"><b>{coilCount} coils</b><small>{layout.visibleColumns.length}/{grnMonitorColumns.length} columns</small></div>
    </div>
    {detail&&<BatchAnalysisDrawer detail={detail} onClose={()=>setDetail(null)} mode="grn"/>}
  </>;
}
