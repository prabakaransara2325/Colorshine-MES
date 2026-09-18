import {Download,FlaskConical,Layers3,ShieldCheck,X} from 'lucide-react';
import {Status,num} from './UI';
import {detailToAnalysisRow,downloadGrnAnalysis,downloadInventoryAnalysis} from '../lib/export';

type Props={detail:any;onClose:()=>void;mode:'grn'|'inventory'};

const categoryOrder=['CHEMICAL','MECHANICAL','DIMENSION','COATING','GENERAL','SURFACE'];
const categoryTitle:any={CHEMICAL:'Chemical Properties',MECHANICAL:'Mechanical Properties',DIMENSION:'Dimensions',COATING:'Coating',GENERAL:'Grade & General Properties',SURFACE:'Surface Properties'};

function valueOf(p:any){
  const v=p.numeric_value??p.text_value??p.source_raw_value;
  if(v===null||v===undefined||v==='') return '—';
  const n=Number(v);
  const uom=p.uom||p.default_uom;
  const shown=Number.isFinite(n)&&p.numeric_value!=null?n.toFixed(uom==='%'?2:3):v;
  return `${shown}${uom?` ${uom}`:''}`;
}

export default function BatchAnalysisDrawer({detail,onClose,mode}:Props){
  const grouped=(detail?.supplierTcParameters||[]).reduce((acc:any,p:any)=>{
    const cat=p.parameter_category||'OTHER';
    (acc[cat] ||= []).push(p);
    return acc;
  },{});

  const download=()=>{
    const row=detailToAnalysisRow(detail);
    const name=`${mode==='grn'?'GRN':'RM_Inventory'}_${detail.batch_no}_Analysis.csv`;
    mode==='grn'?downloadGrnAnalysis([row],name):downloadInventoryAnalysis([row],name);
  };

  return <div className="drawer-scrim" onClick={onClose}>
    <aside className="drawer analysis-drawer" onClick={e=>e.stopPropagation()}>
      <div className="drawer-head">
        <div><span className="eyebrow">RAW MATERIAL ANALYSIS</span><h2>{detail.batch_no}</h2></div>
        <button className="drawer-close" onClick={onClose}><X size={18}/></button>
      </div>

      <div className="drawer-actions"><button className="secondary-btn" onClick={download}><Download size={16}/> Download Batch Analysis</button></div>

      <section className="analysis-section">
        <div className="analysis-section-title"><Layers3 size={17}/><h3>GRN & Supplier Identification</h3></div>
        <div className="detail-grid analysis-summary-grid">
          <span>GRN<b>{detail.sap_grn_no||'—'}</b></span>
          <span>PO<b>{detail.sap_po_no?`${detail.sap_po_no}/${detail.sap_po_item||''}`:'—'}</b></span>
          <span>Supplier<b>{detail.supplier_name||'—'}</b></span>
          <span>Supplier Batch<b>{detail.vendor_batch_no||'—'}</b></span>
          <span>Supplier Grade<b>{detail.vendor_grade||'—'}</b></span>
          <span>Steel Grade<b>{detail.hr_grade||'—'}</b></span>
          <span>Heat No<b>{detail.heat_no||'—'}</b></span>
          <span>Supplier TC<b>{detail.supplier_tc_no||'—'}</b></span>
          <span>Quality Level<b>{detail.quality_level||'—'}</b></span>
          <span>Material<b>{detail.sap_material_code||'—'}</b></span>
          <span>Thickness<b>{detail.batch_thickness_mm?`${num(detail.batch_thickness_mm,3)} mm`:'—'}</b></span>
          <span>Width<b>{detail.batch_width_mm?`${num(detail.batch_width_mm,0)} mm`:'—'}</b></span>
          <span>Received Weight<b>{detail.batch_weight_mt?`${num(detail.batch_weight_mt)} MT`:'—'}</b></span>
          <span>Quality<b><Status value={detail.quality_status}/></b></span>
          {mode==='inventory'&&<><span>On Hand<b>{num(detail.on_hand_weight_mt)} MT</b></span><span>Available<b>{num(detail.available_weight_mt)} MT</b></span><span>Quality Hold<b>{num(detail.quality_hold_weight_mt)} MT</b></span><span>Blocked<b>{num(detail.blocked_weight_mt)} MT</b></span></>}
        </div>
      </section>

      {categoryOrder.filter(c=>grouped[c]?.length).map(cat=><section className="analysis-section" key={cat}>
        <div className="analysis-section-title">{cat==='CHEMICAL'?<FlaskConical size={17}/>:<ShieldCheck size={17}/>}<h3>{categoryTitle[cat]||cat}</h3><span>{grouped[cat].length} parameters</span></div>
        <div className="parameter-table-wrap"><table className="parameter-table"><thead><tr><th>Parameter</th><th>Value</th><th>Source Field</th></tr></thead><tbody>
          {grouped[cat].map((p:any)=><tr key={`${p.parameter_code}-${p.source_field_name||''}`}><td><b>{p.parameter_name}</b><small>{p.parameter_code}</small></td><td>{valueOf(p)}</td><td>{p.source_field_name||'—'}</td></tr>)}
        </tbody></table></div>
      </section>)}

      {Object.keys(grouped).filter(c=>!categoryOrder.includes(c)).map(cat=><section className="analysis-section" key={cat}>
        <div className="analysis-section-title"><h3>{cat}</h3></div>
        <div className="parameter-list">{grouped[cat].map((p:any)=><div key={p.parameter_code}><span>{p.parameter_name}</span><b>{valueOf(p)}</b></div>)}</div>
      </section>)}
    </aside>
  </div>;
}
