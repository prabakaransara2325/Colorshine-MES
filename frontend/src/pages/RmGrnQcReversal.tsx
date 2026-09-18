import {useEffect,useMemo,useState} from 'react';
import {AlertTriangle,RotateCcw} from 'lucide-react';
import {api,canReverse,clientLabel,plantQueryParam,selectedPlant,subscribePlantChange} from '../lib/api';
import {Empty,PageHeader,Status,num} from '../components/UI';

type Tab='GRN'|'QC';

const grnEligible=(r:any)=>!['ACCEPT','CONDITIONAL_ACCEPT','REJECT'].includes(r.current_ud)&&Number(r.quality_hold_weight_mt)>0;
const qcEligible=(r:any)=>['ACCEPT','CONDITIONAL_ACCEPT'].includes(r.current_ud);

export default function RmGrnQcReversal(){
  const authorized=canReverse();
  const[tab,setTab]=useState<Tab>('GRN');
  const[rows,setRows]=useState<any[]>([]);
  const[selected,setSelected]=useState<Set<string>>(new Set());
  const[reason,setReason]=useState('');
  const[busy,setBusy]=useState(false);
  const[results,setResults]=useState<{batch:string;ok:boolean;message:string}[]>([]);
  const[plant,setPlant]=useState(selectedPlant());

  function load(){
    const p=plantQueryParam();
    api(`/grn?limit=500${p?`&${p}`:''}`).then(d=>{
      setRows((d.rows||[]).filter((r:any)=>r.entry_type!=='GRN_REVERSAL'));
      setSelected(new Set());
    });
  }
  useEffect(()=>subscribePlantChange(setPlant),[]);
  useEffect(load,[plant]);

  const eligibleFn=tab==='GRN'?grnEligible:qcEligible;
  const rowKey=(r:any)=>tab==='GRN'?r.grn_coil_id:r.inspection_id;

  const toggle=(r:any)=>{
    if(!eligibleFn(r))return;
    const key=rowKey(r);
    setSelected(prev=>{const next=new Set(prev);next.has(key)?next.delete(key):next.add(key);return next});
  };

  const selectedCount=selected.size;

  async function reverseSelected(){
    if(!reason.trim()||reason.trim().length<5){setResults([{batch:'',ok:false,message:'Reason must be at least 5 characters.'}]);return}
    setBusy(true);setResults([]);
    const targets=rows.filter(r=>selected.has(rowKey(r)));
    const out:{batch:string;ok:boolean;message:string}[]=[];
    for(const r of targets){
      try{
        const path=tab==='GRN'?`/grn/${r.grn_coil_id}/reverse`:`/rm-quality/${r.inspection_id}/reverse`;
        await api(path,{method:'POST',body:JSON.stringify({reason:reason.trim(),clientHost:clientLabel()})});
        out.push({batch:r.batch_no,ok:true,message:tab==='GRN'?'GRN reversed.':'QC decision reversed.'});
      }catch(e:any){
        out.push({batch:r.batch_no,ok:false,message:e.message});
      }
    }
    setResults(out);
    setBusy(false);
    setReason('');
    load();
  }

  const eligibleCount=useMemo(()=>rows.filter(eligibleFn).length,[rows,tab]);

  if(!authorized) return <>
    <PageHeader title="GRN / QC Reversal"/>
    <div className="masters-dashboard-alert error"><AlertTriangle size={18}/><div><b>Not authorized</b><span>You need the RM GRN/QC Reversal access group (or ADMIN) to use this screen. Contact your MES administrator.</span></div></div>
  </>;

  return <>
    <PageHeader title="GRN / QC Reversal" actions={<span className="tolerance-rule-chip">{eligibleCount} eligible for {tab} reversal</span>}/>
    <div className="tabs">
      <button className={tab==='GRN'?'active':''} onClick={()=>{setTab('GRN');setSelected(new Set());setResults([])}}>Reverse GRN</button>
      <button className={tab==='QC'?'active':''} onClick={()=>{setTab('QC');setSelected(new Set());setResults([])}}>Reverse QC</button>
    </div>

    <div className="tolerance-guard">
      {tab==='GRN'
        ?'Only batches still fully in Quality Hold (no active QC decision) can be GRN-reversed. If a Usage Decision was posted, reverse QC first.'
        :'Only batches currently Available (ACCEPT / CONDITIONAL_ACCEPT) can be QC-reversed. Rejected/Blocked and other statuses are not yet supported here.'}
    </div>

    <section className="master-table-panel professional-master-panel">
      <div className="master-table-scroll">
        <table className="master-table">
          <thead><tr>
            <th></th><th>GRN</th><th>Batch</th><th>Supplier</th><th>Material</th>
            <th>Weight (MT)</th><th>Status</th><th>Quality Hold (MT)</th><th>Available (MT)</th><th>Blocked (MT)</th>
          </tr></thead>
          <tbody>
            {rows.map(r=>{
              const ok=eligibleFn(r);
              const key=rowKey(r);
              return <tr key={r.grn_coil_id} className={!ok?'inactive-row':''}>
                <td><input type="checkbox" disabled={!ok} checked={!!key&&selected.has(key)} onChange={()=>toggle(r)} title={ok?'Select for reversal':'Not eligible for reversal in current status'}/></td>
                <td><b>{r.sap_grn_no}</b></td>
                <td><b>{r.batch_no}</b></td>
                <td>{r.supplier_name||'—'}</td>
                <td>{r.sap_material_code}</td>
                <td>{num(r.batch_weight_mt)}</td>
                <td><Status value={r.current_ud||'PENDING_UD'}/></td>
                <td>{num(r.quality_hold_weight_mt)}</td>
                <td>{num(r.available_weight_mt)}</td>
                <td>{num(r.blocked_weight_mt)}</td>
              </tr>;
            })}
            {!rows.length&&<tr><td colSpan={10} className="empty-table-cell">No GRN batches found.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="table-footer"><b>{rows.length} batches</b><small>{selectedCount} selected</small></div>
    </section>

    <div className="master-modal wide-master-modal" style={{marginTop:12,padding:16}}>
      <label>Reversal reason<textarea rows={2} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Required - minimum 5 characters"/></label>
      <div className="modal-actions">
        <button className="primary" disabled={busy||!selectedCount} onClick={()=>void reverseSelected()}><RotateCcw size={16}/> {busy?'Reversing…':`Reverse ${selectedCount||''} selected`}</button>
      </div>
      {!!results.length&&<div style={{marginTop:10}}>
        {results.map((r,i)=><div key={i} className={r.ok?'success-toast toast':'error-toast toast'}><span>{r.batch?`${r.batch}: `:''}{r.message}</span></div>)}
      </div>}
    </div>
    {!rows.length&&<Empty text="No GRN batches available"/>}
  </>;
}
