import {useEffect,useState} from 'react';
import {api,plantQueryParam,selectedPlant,subscribePlantChange} from '../lib/api';
import {Download,Eye,Search,Truck} from 'lucide-react';
import {Empty,PageHeader,Status,num,plain} from '../components/UI';
import BatchAnalysisDrawer from '../components/BatchAnalysisDrawer';
import {downloadGrnAnalysis} from '../lib/export';

export default function GRN(){
  const[rows,setRows]=useState<any[]>([]);
  const[q,setQ]=useState('');
  const[detail,setDetail]=useState<any>(null);
  const[plant,setPlant]=useState(selectedPlant());
  const[exporting,setExporting]=useState(false);

  function queryString(){const p=plantQueryParam();return `search=${encodeURIComponent(q)}${p?`&${p}`:''}`}
  function load(){api(`/grn?${queryString()}`).then(d=>setRows(d.rows||[]))}
  useEffect(()=>subscribePlantChange(setPlant),[]);
  useEffect(load,[plant]);

  async function open(r:any){setDetail(await api(`/grn/batch/${encodeURIComponent(r.batch_no)}`))}
  async function downloadAll(){
    try{setExporting(true);const d=await api(`/grn/analysis?${queryString()}`);downloadGrnAnalysis(d.rows||[],`GRN_RM_Analysis_${plant}.csv`)}finally{setExporting(false)}
  }

  return <>
    <PageHeader title="GRN Monitor" subtitle="SAP raw-material receipts with supplier traceability, steel grade and complete chemical/mechanical analysis." actions={<button className="secondary-btn download-btn" onClick={downloadAll} disabled={exporting}><Download size={16}/>{exporting?'Preparing…':'Download Analysis'}</button>}/>
    <div className="toolbar"><div className="search"><Search size={18}/><input placeholder="Search GRN, batch, supplier batch, heat, grade or PO…" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&load()}/></div><button className="secondary-btn" onClick={load}>Search</button></div>
    <div className="table-panel analysis-table-panel">
      <div className="responsive-table"><table className="analysis-main-table"><thead><tr><th>GRN</th><th>MES Batch</th><th>Supplier Batch</th><th>Supplier</th><th>Supplier Grade</th><th>Heat No</th><th>Steel Grade</th><th>Material</th><th>Thickness (mm)</th><th>Width (mm)</th><th>Weight (MT)</th><th>Quality</th><th>Stock</th><th>Reversed By</th><th>Reversed At</th><th>Analysis</th></tr></thead><tbody>
      {rows.map(r=>{
        const isReversal=r.entry_type==='GRN_REVERSAL';
        return <tr key={isReversal?`${r.grn_coil_id}-rev`:r.grn_coil_id} className={isReversal?'reversal-row':''}>
          <td><b>{r.sap_grn_no}</b><small>{isReversal?'REVERSAL':(r.sap_po_no&&`PO ${r.sap_po_no}/${r.sap_po_item||''}`)}</small></td>
          <td><b>{r.batch_no}</b></td>
          <td><b>{r.vendor_batch_no||'—'}</b></td>
          <td>{r.supplier_name||'—'}</td>
          <td>{r.vendor_grade||'—'}</td>
          <td>{r.heat_no||'—'}</td>
          <td><b>{r.hr_grade||'—'}</b></td>
          <td>{r.sap_material_code}</td>
          <td>{r.batch_thickness_mm?plain(r.batch_thickness_mm,3):'—'}</td>
          <td>{r.batch_width_mm?plain(r.batch_width_mm,0):'—'}</td>
          <td><b className={isReversal?'danger-text':''}>{num(r.batch_weight_mt)}</b></td>
          <td>{isReversal?'—':<Status value={r.quality_status}/>}</td>
          <td>{isReversal?<Status value="REVERSED"/>:<Status value={Number(r.available_weight_mt)>0?'AVAILABLE':Number(r.blocked_weight_mt)>0?'BLOCKED':'QUALITY_HOLD'}/>}</td>
          <td title={r.reversal_reason||undefined}>{r.reversed_by||'—'}</td>
          <td>{r.reversed_at?new Date(r.reversed_at).toLocaleString('en-IN'):'—'}</td>
          <td><button className="icon-btn" title="View complete analysis" onClick={()=>open(r)}><Eye size={17}/></button></td>
        </tr>;
      })}</tbody></table>{!rows.length&&<Empty/>}</div>
      <div className="card-list">{rows.filter(r=>r.entry_type!=='GRN_REVERSAL').map(r=><button className="data-card" key={r.grn_coil_id} onClick={()=>open(r)}><div><Truck size={18}/><b>{r.sap_grn_no}</b><Status value={r.quality_status}/></div><h3>{r.batch_no}</h3><p>{r.supplier_name}</p><div className="data-grid"><span>Supplier Batch<b>{r.vendor_batch_no||'—'}</b></span><span>Supplier Grade<b>{r.vendor_grade||'—'}</b></span><span>Heat No<b>{r.heat_no||'—'}</b></span><span>Steel Grade<b>{r.hr_grade||'—'}</b></span><span>Size (mm)<b>{plain(r.batch_thickness_mm,3)} × {plain(r.batch_width_mm,0)}</b></span><span>Weight (MT)<b>{num(r.batch_weight_mt)}</b></span></div></button>)}</div>
    </div>
    {detail&&<BatchAnalysisDrawer detail={detail} onClose={()=>setDetail(null)} mode="grn"/>}
  </>;
}
