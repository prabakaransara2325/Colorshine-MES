import { useEffect, useMemo, useState } from 'react';
import { Copy, Edit3, Plus, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, currentUser } from '../lib/api';
import { PageHeader, Status } from '../components/UI';

const currentYear=new Date().getFullYear();
const blank:any={companyCode:'',plantCode:'',workCenterCode:'',workCenterName:'',processArea:'',displaySequence:'',capacityYear:currentYear,yearCapacity:'',monthCapacity:'',dayCapacity:'',capacityUom:'MT',capacityRemarks:'',isActive:true};
const fmt=(v:any)=>v===null||v===undefined||v===''?'—':Number(v).toLocaleString('en-IN',{maximumFractionDigits:3});
const rowForm=(r:any)=>({companyCode:r.company_code||'',plantCode:r.plant_code||'',workCenterCode:r.work_center_code||'',workCenterName:r.work_center_name||'',processArea:r.process_area||'',displaySequence:r.display_sequence??'',capacityYear:r.capacity_year||currentYear,yearCapacity:r.year_capacity??'',monthCapacity:r.month_capacity??'',dayCapacity:r.day_capacity??'',capacityUom:r.milestone_uom||r.capacity_uom||'MT',capacityRemarks:r.capacity_remarks||'',isActive:Boolean(r.is_active)});

export default function WorkCenters(){
 const [rows,setRows]=useState<any[]>([]);const [companies,setCompanies]=useState<any[]>([]);const [plants,setPlants]=useState<any[]>([]);
 const [companyFilter,setCompanyFilter]=useState('');const [plantFilter,setPlantFilter]=useState('');
 const [edit,setEdit]=useState<any|null>(null);const [form,setForm]=useState<any>({...blank});const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const nav=useNavigate();
 const canEdit=(currentUser()?.roles||[]).includes('ADMIN');
 const availablePlants=useMemo(()=>plants.filter(p=>!form.companyCode||p.company_code===form.companyCode),[plants,form.companyCode]);

 const loadMasters=async()=>{const [c,p]=await Promise.all([api('/masters/companies'),api('/masters/plants')]);setCompanies(c.rows||[]);setPlants(p.rows||[])};
 const load=async()=>{setBusy(true);try{const qs=new URLSearchParams();if(companyFilter)qs.set('companyCode',companyFilter);if(plantFilter)qs.set('plant',plantFilter);setRows((await api(`/masters/work-centers?${qs.toString()}`)).rows||[])}catch(e:any){setMessage(e.message)}finally{setBusy(false)}};
 useEffect(()=>{void Promise.all([loadMasters(),load()]).catch((e:any)=>setMessage(e.message))},[]);
 useEffect(()=>{void load()},[companyFilter,plantFilter]);

 const openNew=()=>{const company=companyFilter||companies[0]?.company_code||'';const plant=plantFilter||plants.find(p=>p.company_code===company)?.plant_code||'';setEdit({mode:'add'});setForm({...blank,companyCode:company,plantCode:plant})};
 const openEdit=(r:any)=>{setEdit(r);setForm(rowForm(r))};
 const openCopy=(r:any)=>{setEdit({mode:'copy',copySource:r.work_center_id});setForm({...rowForm(r),workCenterCode:'',isActive:true});setMessage(`Copying ${r.work_center_code}. Enter a new Work Center Code before saving.`)};
 const save=async()=>{try{setBusy(true);setMessage('');if(!form.companyCode||!form.plantCode||!form.workCenterCode||!form.workCenterName)throw new Error('Company, Plant, Work Center Code and Work Center Name are mandatory.');const path=edit?.work_center_id?`/masters/work-centers/${edit.work_center_id}`:'/masters/work-centers';await api(path,{method:edit?.work_center_id?'PUT':'POST',body:JSON.stringify(form)});const wasEdit=Boolean(edit?.work_center_id);setEdit(null);setMessage(wasEdit?'Work center updated.':'Work center and capacity milestone created.');await load()}catch(e:any){setMessage(e.message)}finally{setBusy(false)}};
 const modalTitle=edit?.work_center_id?'Edit Work Center':edit?.mode==='copy'?'Copy Work Center':'Add Work Center';

 return <>
 <PageHeader title="Work Center Master" subtitle="Company + Plant specific work centers with capacity milestones used by Planning and Production." actions={<div className="master-header-actions">{canEdit&&<button className="primary" onClick={openNew}><Plus size={17}/> Add Work Center</button>}</div>}/>
 <div className="wc-scope-bar">
   <label>Company<select value={companyFilter} onChange={e=>{setCompanyFilter(e.target.value);setPlantFilter('')}}><option value="">All Companies</option>{companies.map(c=><option key={c.company_code} value={c.company_code}>{c.company_code} · {c.short_name}</option>)}</select></label>
   <label>Plant<select value={plantFilter} onChange={e=>setPlantFilter(e.target.value)}><option value="">All Plants</option>{plants.filter(p=>!companyFilter||p.company_code===companyFilter).map(p=><option key={p.plant_code} value={p.plant_code}>{p.plant_code} · {p.plant_name}</option>)}</select></label>
   <button className="secondary-btn" onClick={()=>void load()} disabled={busy}><RefreshCw size={16}/> Refresh</button>
   <span className="toolbar-note">Capacity is maintained as a yearly milestone with Year / Month / Day targets. No capacity value is hardcoded.</span>
 </div>
 {message&&<div className="inline-message">{message}</div>}
 <section className="master-table-panel professional-master-panel wc-master-panel"><div className="master-table-scroll"><table className="master-table wc-master-table"><thead><tr><th>Company</th><th>Plant</th><th>Work Center</th><th>Description</th><th>Process Area</th><th>Capacity Year</th><th>Year Capacity</th><th>Month Capacity</th><th>Day Capacity</th><th>UOM</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map(r=><tr key={r.work_center_id} className={!r.is_active?'inactive-row':''}><td><b>{r.company_code}</b><small>{r.company_short_name}</small></td><td><b>{r.plant_code}</b><small>{r.plant_name}</small></td><td><b>{r.work_center_code}</b></td><td>{r.work_center_name}</td><td>{r.process_area||'—'}</td><td>{r.capacity_year||'—'}</td><td><b>{fmt(r.year_capacity)}</b></td><td>{fmt(r.month_capacity)}</td><td>{fmt(r.day_capacity)}</td><td>{r.milestone_uom||r.capacity_uom||'MT'}</td><td><Status value={r.is_active?'ACTIVE':'INACTIVE'}/></td><td><div className="master-actions"><button title="Tolerance Matrix" onClick={()=>nav(`/masters/work-center-tolerance?wc=${encodeURIComponent(r.work_center_code)}`)}><SlidersHorizontal size={15}/></button>{canEdit&&<><button title="Copy as New" onClick={()=>openCopy(r)}><Copy size={15}/></button><button title="Edit" onClick={()=>openEdit(r)}><Edit3 size={15}/></button></>}</div></td></tr>)}{!rows.length&&<tr><td className="empty-table-cell" colSpan={12}>{busy?'Loading…':'No Work Centers created yet.'}</td></tr>}</tbody></table></div><div className="table-footer"><b>{rows.length} work centers</b><small>Use Copy to reuse plant/capacity settings while assigning a new Work Center Code.</small></div></section>
 {edit&&<div className="modal-scrim master-editor-scrim"><div className="modal master-modal wide-master-modal"><div className="modal-head"><div><span className="screen-title-kicker">WORK CENTER MASTER</span><h2>{modalTitle}</h2>{edit?.mode==='copy'&&<small className="copy-mode-note">Company, Plant and capacity values are copied. Work Center Code is blank because it must be unique.</small>}</div><button onClick={()=>setEdit(null)}><X/></button></div><div className="master-form-grid three-col">
 <label>Company Code<select value={form.companyCode} onChange={e=>{const companyCode=e.target.value;setForm({...form,companyCode,plantCode:plants.find(p=>p.company_code===companyCode)?.plant_code||''})}}><option value="">Select Company</option>{companies.filter(c=>c.is_active!==false).map(c=><option key={c.company_code} value={c.company_code}>{c.company_code} · {c.short_name}</option>)}</select></label>
 <label>Plant Code<select value={form.plantCode} onChange={e=>setForm({...form,plantCode:e.target.value})}><option value="">Select Plant</option>{availablePlants.filter(p=>p.is_active!==false).map(p=><option key={p.plant_code} value={p.plant_code}>{p.plant_code} · {p.plant_name}</option>)}</select></label>
 <label>Work Center Code<input disabled={Boolean(edit.work_center_id)} value={form.workCenterCode} onChange={e=>setForm({...form,workCenterCode:e.target.value.toUpperCase()})}/></label>
 <label>Work Center Name<input value={form.workCenterName} onChange={e=>setForm({...form,workCenterName:e.target.value})}/></label>
 <label>Process Area<input value={form.processArea} onChange={e=>setForm({...form,processArea:e.target.value})}/></label>
 <label>Display Sequence<input type="number" value={form.displaySequence} onChange={e=>setForm({...form,displaySequence:e.target.value})}/></label>
 <div className="matrix-form-group"><b>Capacity Milestone</b><div className="capacity-milestone-grid"><label>Capacity Year<input type="number" min="2000" max="2200" value={form.capacityYear} onChange={e=>setForm({...form,capacityYear:e.target.value})}/></label><label>Year Capacity<input type="number" min="0" step="0.001" value={form.yearCapacity} onChange={e=>setForm({...form,yearCapacity:e.target.value})}/></label><label>Month Capacity<input type="number" min="0" step="0.001" value={form.monthCapacity} onChange={e=>setForm({...form,monthCapacity:e.target.value})}/></label><label>Day Capacity<input type="number" min="0" step="0.001" value={form.dayCapacity} onChange={e=>setForm({...form,dayCapacity:e.target.value})}/></label><label>Capacity UOM<input value={form.capacityUom} onChange={e=>setForm({...form,capacityUom:e.target.value.toUpperCase()})}/></label><label>Capacity Remarks<input value={form.capacityRemarks} onChange={e=>setForm({...form,capacityRemarks:e.target.value})}/></label></div></div>
 <label className="checkbox-field"><input type="checkbox" checked={form.isActive} onChange={e=>setForm({...form,isActive:e.target.checked})}/><span>Active</span></label>
 </div><div className="modal-actions"><button onClick={()=>setEdit(null)}>Cancel</button><button className="primary" onClick={()=>void save()} disabled={busy}>{edit?.work_center_id?'Save Changes':'Create Work Center'}</button></div></div></div>}
 </>;
}
