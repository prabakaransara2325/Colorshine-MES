import {useEffect,useState} from 'react';
import {ChevronLeft,ChevronRight,RefreshCw,Search,X} from 'lucide-react';
import {api,plantQueryParam,subscribePlantChange} from '../lib/api';

const blank={soNo:'',item:'',material:'',customer:'',status:''};
function n(v:any,d=3){const x=Number(v??0);return Number.isFinite(x)?x.toLocaleString('en-IN',{minimumFractionDigits:d,maximumFractionDigits:d}):''}
function plain(v:any,d=0){if(v===null||v===undefined||v==='')return '—';const x=Number(v);if(!Number.isFinite(x))return String(v);return d>0?x.toFixed(d):String(Math.round(x))}
function txt(v:any){const s=String(v??'').trim();return s||'—'}
function date(v:any){if(!v)return '—';const s=String(v).slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(s)){const [y,m,d]=s.split('-');return `${d}-${m}-${y}`}return String(v)}
function st(v:string){return String(v||'').replaceAll('_',' ')}

export default function SalesOrderMonitor(){
  const[rows,setRows]=useState<any[]>([]);const[filters,setFilters]=useState({...blank});const[applied,setApplied]=useState({...blank});
  const[loading,setLoading]=useState(false);const[page,setPage]=useState(0);const[pageSize,setPageSize]=useState(100);const[total,setTotal]=useState(0);const[detail,setDetail]=useState<any|null>(null);const[detailLoading,setDetailLoading]=useState(false);const[msg,setMsg]=useState('');

  useEffect(()=>subscribePlantChange(()=>{setPage(0);void load({...blank},0,pageSize)}),[]);
  useEffect(()=>{void load(blank,0,pageSize)},[]);

  function qs(f=applied,p=page,size=pageSize){const q=new URLSearchParams();const plant=plantQueryParam();if(plant){const [k,v]=plant.split('=');q.set(k,decodeURIComponent(v||''))}Object.entries(f).forEach(([k,v])=>{if(v)q.set(k,String(v))});q.set('limit',String(size));q.set('offset',String(p*size));return q.toString()}
  async function load(f=applied,p=page,size=pageSize){setLoading(true);setMsg('');try{const d=await api(`/planning/sales-orders?${qs(f,p,size)}`);setRows(d.rows||[]);setTotal(Number(d.total||0));setApplied({...f});setPage(p)}catch(e:any){setMsg(e.message)}finally{setLoading(false)}}
  function search(){void load({...filters},0,pageSize)}
  function reset(){const f={...blank};setFilters(f);void load(f,0,pageSize)}
  const set=(k:keyof typeof blank)=>(e:any)=>setFilters(x=>({...x,[k]:e.target.value}));
  async function open(r:any){setDetailLoading(true);setMsg('');try{setDetail(await api(`/planning/sales-orders/${encodeURIComponent(r.so_no)}/${encodeURIComponent(r.so_item_no)}`))}catch(e:any){setMsg(e.message)}finally{setDetailLoading(false)}}
  const pages=Math.max(1,Math.ceil(total/pageSize));const first=total?page*pageSize+1:0;const last=Math.min((page+1)*pageSize,total);

  return <div className="sap-so-page-v0105 content-first-page">
    <div className="sap-so-filter-line">
      <input autoComplete="off" value={filters.soNo} onChange={set('soNo')} placeholder="SO No"/>
      <input autoComplete="off" value={filters.item} onChange={set('item')} placeholder="Item"/>
      <input autoComplete="off" value={filters.material} onChange={set('material')} placeholder="Material"/>
      <input autoComplete="off" className="wide" value={filters.customer} onChange={set('customer')} placeholder="Customer / Code"/>
      <select value={filters.status} onChange={set('status')}><option value="">Status: All</option><option value="READY_FOR_PLANNING">Ready for Planning</option><option value="MASTER_PENDING">Master Pending</option><option value="ROUTE_PENDING">Route Pending</option></select>
      <button className="primary compact-btn" onClick={search} disabled={loading}><Search size={14}/> Search</button>
      <button className="ghost-btn compact-btn" onClick={reset}>Reset</button>
      <button className="ghost-btn compact-btn refresh-only" onClick={()=>void load(applied,page,pageSize)} disabled={loading} title="Refresh"><RefreshCw size={14} className={loading?'spin':''}/><span>Refresh</span></button>
    </div>
    {msg&&<div className="inline-message">{msg}</div>}

    <section className={`sap-so-table-panel ${loading?'is-loading':''}`}>
      {loading&&<div className="sap-so-loading"><RefreshCw size={26} className="spin"/><b>Receiving SAP Sales Order view…</b><span>Loading only the current page.</span></div>}
      <div className="sap-so-table-scroll"><table className="master-table sap-so-table"><thead><tr>
        <th>SO / Item</th><th>Material</th><th>Qty (MT)</th><th>Sold-To Customer</th><th>Plant</th><th>Required Date</th><th>Release Date</th><th>Thickness (mm)</th><th>Width (mm)</th><th>Steel Grade</th><th>Quality Grade</th><th>Coating GSM</th><th>Jet Printing</th><th>Guardfilm</th><th>Planning Status</th>
      </tr></thead><tbody>{rows.map(r=><tr key={`${r.so_no}-${r.so_item_no}`} onDoubleClick={()=>void open(r)} className="clickable-row">
        <td><button className="link-button" onClick={()=>void open(r)}><b>{r.so_no}</b> / {r.so_item_no}</button></td><td><b>{r.material_code}</b><small>{r.so_item_desc||''}</small></td><td>{n(r.qty)}</td><td>{r.sold_to_party_name}<small>{r.sold_to_code}</small></td><td>{r.plant_code}</td><td>{date(r.required_date)}</td><td>{date(r.release_date)}</td><td>{plain(r.order_thickness_mm,3)}</td><td>{plain(r.order_width_mm,0)}</td><td>{txt(r.steel_grade)}</td><td>{txt(r.quality_level)}</td><td>{plain(r.coating_gsm_aim,0)}</td><td>{txt(r.inkjet)}</td><td>{txt(r.guardfilm)}</td><td><span className={`sap-so-status ${String(r.planning_status||'').toLowerCase()}`} title={r.validation_message||''}>{st(r.planning_status)}</span>{r.validation_message&&<small className="validation-note">{r.validation_message}</small>}</td>
      </tr>)}{!loading&&!rows.length&&<tr><td colSpan={15} className="empty-table-cell">No SAP Sales Order items received for the selected criteria.</td></tr>}</tbody></table></div>
      <div className="sap-so-table-footer"><span>{total?`${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} items`:'0 items'}</span><div><label>Rows <select value={pageSize} onChange={e=>{const s=Number(e.target.value);setPageSize(s);void load(applied,0,s)}}><option>50</option><option>100</option><option>200</option><option>500</option></select></label><button className="ghost-btn compact-btn" disabled={loading||page<=0} onClick={()=>void load(applied,page-1,pageSize)}><ChevronLeft size={15}/></button><b>{page+1} / {pages}</b><button className="ghost-btn compact-btn" disabled={loading||page+1>=pages} onClick={()=>void load(applied,page+1,pageSize)}><ChevronRight size={15}/></button></div></div>
    </section>

    {(detail||detailLoading)&&<div className="modal-scrim"><div className="modal sap-so-detail-modal">{detailLoading?<div className="sap-so-detail-loading"><RefreshCw className="spin"/><b>Loading SAP SO details…</b></div>:<>
      <div className="modal-head"><div><span className="screen-title-kicker">SAP SALES ORDER</span><h2>{detail.item.so_no} / Item {detail.item.so_item_no}</h2><p>{detail.item.material_code} · {detail.item.sold_to_party_name}</p></div><button onClick={()=>setDetail(null)}><X/></button></div>
      <div className="sap-so-detail-info"><table><tbody><tr><th>Qty (MT)</th><td>{n(detail.item.qty)}</td><th>Plant</th><td>{detail.item.plant_code}</td><th>Thickness (mm)</th><td>{plain(detail.item.order_thickness_mm,3)}</td><th>Width (mm)</th><td>{plain(detail.item.order_width_mm,0)}</td></tr><tr><th>Steel Grade</th><td>{txt(detail.item.steel_grade)}</td><th>Quality Grade</th><td>{txt(detail.item.quality_level)}</td><th>Coating GSM</th><td>{plain(detail.item.coating_gsm_aim,0)}</td><th>Jet / Guardfilm</th><td>{txt(detail.item.inkjet)} / {txt(detail.item.guardfilm)}</td></tr></tbody></table></div>
      {detail.item.validation_message&&<div className="sap-so-master-warning"><b>Master readiness:</b> {detail.item.validation_message}. SAP data is retained exactly as received.</div>}
      <div className="sap-so-detail-grid"><section><h3>Process Path Variants</h3><div className="mini-table-scroll"><table className="master-table"><thead><tr><th>Route</th><th>Process Path</th><th>Material Tree</th></tr></thead><tbody>{detail.routes.map((x:any)=><tr key={x.route_ind}><td><b>{x.route_ind}</b></td><td>{x.process_path}</td><td>{x.material_tree}</td></tr>)}</tbody></table></div></section>
</div>
    </>}</div></div>}
  </div>
}
