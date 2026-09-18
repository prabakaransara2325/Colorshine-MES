import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {api,plantQueryParam,selectedPlant,subscribePlantChange} from '../lib/api';
import {Empty,PageHeader,num} from '../components/UI';

const dt=(v:any)=>v?new Date(v).toLocaleString('en-IN'):'—';

export default function RmReversalReport(){
  const[tab,setTab]=useState<'GRN'|'QC'>('GRN');
  const[rows,setRows]=useState<any[]>([]);
  const[busy,setBusy]=useState(false);
  const[plant,setPlant]=useState(selectedPlant());

  function load(){
    setBusy(true);
    const p=plantQueryParam();
    const path=tab==='GRN'?'/grn/reversals/report':'/rm-quality/reversals/report';
    api(`${path}${p?`?${p}`:''}`).then(d=>setRows(d.rows||[])).finally(()=>setBusy(false));
  }
  useEffect(()=>subscribePlantChange(setPlant),[]);
  useEffect(load,[tab,plant]);

  return <>
    <PageHeader title="RM Reversal Report" subtitle="GRN and QC reversal audit trail - RM today, Paints once that module exists."/>
    <div className="tabs">
      <button className={tab==='GRN'?'active':''} onClick={()=>setTab('GRN')}>GRN Reversals</button>
      <button className={tab==='QC'?'active':''} onClick={()=>setTab('QC')}>QC Reversals</button>
      <button className="secondary-btn" onClick={load} disabled={busy}><RefreshCw size={15}/> Refresh</button>
    </div>
    <section className="master-table-panel professional-master-panel">
      <div className="master-table-scroll">
        <table className="master-table">
          <thead><tr>
            <th>Batch</th><th>Material</th><th>GRN</th><th>Supplier</th>
            {tab==='QC'&&<><th>UD No</th><th>Reversed Decision</th></>}
            <th>Qty (MT)</th><th>Reason</th><th>Reversed By</th><th>Reversed At</th><th>Client / IP</th>
          </tr></thead>
          <tbody>
            {rows.map(r=><tr key={r.reversal_id}>
              <td><b>{r.batch_no}</b></td>
              <td>{r.sap_material_code}<small>{r.material_description}</small></td>
              <td>{r.sap_grn_no||'—'}</td>
              <td>{r.supplier_name||'—'}</td>
              {tab==='QC'&&<><td>{r.ud_no||'—'}</td><td>{r.reversed_ud_decision||'—'}</td></>}
              <td className="danger-text"><b>-{num(r.reversed_qty_mt)}</b></td>
              <td>{r.reason}</td>
              <td>{r.reversed_by}</td>
              <td>{dt(r.reversed_at)}</td>
              <td><small>{r.client_host||'—'}</small><small>{r.client_ip||'—'}</small></td>
            </tr>)}
            {!rows.length&&<tr><td colSpan={tab==='QC'?10:8} className="empty-table-cell">No {tab} reversals recorded.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="table-footer"><b>{rows.length} reversal{rows.length===1?'':'s'}</b><small>Only users assigned the RM GRN/QC Reversal authorization can post reversals.</small></div>
    </section>
    {!rows.length&&busy&&<Empty text="Loading…"/>}
  </>;
}
