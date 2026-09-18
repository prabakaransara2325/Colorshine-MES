import { useEffect, useMemo, useState } from 'react';
import { Copy, Edit3, Plus, RefreshCw, X } from 'lucide-react';
import { api, currentUser } from '../lib/api';
import { PageHeader, Status } from '../components/UI';

const blank:any={companyCode:'',plantCode:'',workCenterId:'',operationCode:'',operationName:'',description:'',sequenceNo:100,planningRelevant:true,confirmationRequired:true,qualityRelevant:false,isActive:true};
const rowForm=(r:any)=>({companyCode:r.company_code||'',plantCode:r.plant_code||'',workCenterId:r.work_center_id||'',operationCode:r.operation_code||'',operationName:r.operation_name||'',description:r.description||'',sequenceNo:r.sequence_no??100,planningRelevant:Boolean(r.planning_relevant),confirmationRequired:Boolean(r.confirmation_required),qualityRelevant:Boolean(r.quality_relevant),isActive:Boolean(r.is_active)});

export default function OperationMaster(){
  const [rows,setRows]=useState<any[]>([]);
  const [companies,setCompanies]=useState<any[]>([]);
  const [plants,setPlants]=useState<any[]>([]);
  const [workCenters,setWorkCenters]=useState<any[]>([]);
  const [companyFilter,setCompanyFilter]=useState('');
  const [plantFilter,setPlantFilter]=useState('');
  const [wcFilter,setWcFilter]=useState('');
  const [q,setQ]=useState('');
  const [edit,setEdit]=useState<any|null>(null);
  const [form,setForm]=useState<any>({...blank});
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const canEdit=(currentUser()?.roles||[]).includes('ADMIN');

  const filteredPlants=useMemo(()=>plants.filter(p=>!form.companyCode||p.company_code===form.companyCode),[plants,form.companyCode]);
  const filteredWcs=useMemo(()=>workCenters.filter(w=>(!form.companyCode||w.company_code===form.companyCode)&&(!form.plantCode||w.plant_code===form.plantCode)),[workCenters,form.companyCode,form.plantCode]);
  const filterWcs=useMemo(()=>workCenters.filter(w=>(!companyFilter||w.company_code===companyFilter)&&(!plantFilter||w.plant_code===plantFilter)),[workCenters,companyFilter,plantFilter]);

  const loadRefs=async()=>{
    const [c,p,w]=await Promise.all([api('/masters/companies'),api('/masters/plants'),api('/masters/work-centers')]);
    setCompanies(c.rows||[]);setPlants(p.rows||[]);setWorkCenters(w.rows||[]);
  };
  const load=async()=>{
    setBusy(true);setMessage('');
    try{
      const qs=new URLSearchParams();
      if(companyFilter)qs.set('companyCode',companyFilter);
      if(plantFilter)qs.set('plantCode',plantFilter);
      if(wcFilter)qs.set('workCenterId',wcFilter);
      if(q)qs.set('q',q);
      const d=await api(`/masters/operations?${qs.toString()}`);setRows(d.rows||[]);
    }catch(e:any){setMessage(e.message)}finally{setBusy(false)}
  };
  useEffect(()=>{void Promise.all([loadRefs(),load()]).catch((e:any)=>setMessage(e.message))},[]);
  useEffect(()=>{void load()},[companyFilter,plantFilter,wcFilter]);

  const openNew=()=>{
    const companyCode=companyFilter||companies[0]?.company_code||'';
    const plantCode=plantFilter||plants.find(p=>p.company_code===companyCode)?.plant_code||'';
    const workCenterId=wcFilter||workCenters.find(w=>w.company_code===companyCode&&w.plant_code===plantCode)?.work_center_id||'';
    setEdit({mode:'add'});setForm({...blank,companyCode,plantCode,workCenterId});
  };
  const openEdit=(r:any)=>{setEdit(r);setForm(rowForm(r))};
  const openCopy=(r:any)=>{setEdit({mode:'copy',copySource:r.operation_id});setForm({...rowForm(r),operationCode:'',isActive:true});setMessage(`Copying ${r.operation_code}. Enter a new Operation Code and save.`)};
  const save=async()=>{
    try{
      setBusy(true);setMessage('');
      if(!form.companyCode||!form.plantCode||!form.workCenterId||!form.operationCode||!form.operationName)throw new Error('Company, Plant, Work Center, Operation Code and Operation Name are mandatory.');
      const path=edit?.operation_id?`/masters/operations/${edit.operation_id}`:'/masters/operations';
      await api(path,{method:edit?.operation_id?'PUT':'POST',body:JSON.stringify(form)});
      const wasEdit=Boolean(edit?.operation_id);setEdit(null);setMessage(wasEdit?'Operation updated.':'Operation created.');await load();
    }catch(e:any){setMessage(e.message)}finally{setBusy(false)}
  };
  const modalTitle=edit?.operation_id?'Edit Operation':edit?.mode==='copy'?'Copy Operation':'Add Operation';

  return <>
    <PageHeader title="Operation Master" subtitle="Company + Plant + Work Center specific operation sequence used by Planning, Production Confirmation, Quality and Dynamic Controls." actions={canEdit?<button className="primary" onClick={openNew}><Plus size={17}/> Add Operation</button>:undefined}/>
    <div className="wc-scope-bar operation-filter-bar">
      <label>Company<select value={companyFilter} onChange={e=>{setCompanyFilter(e.target.value);setPlantFilter('');setWcFilter('')}}><option value="">All Companies</option>{companies.map(c=><option key={c.company_code} value={c.company_code}>{c.company_code} · {c.short_name}</option>)}</select></label>
      <label>Plant<select value={plantFilter} onChange={e=>{setPlantFilter(e.target.value);setWcFilter('')}}><option value="">All Plants</option>{plants.filter(p=>!companyFilter||p.company_code===companyFilter).map(p=><option key={p.plant_code} value={p.plant_code}>{p.plant_code} · {p.plant_name}</option>)}</select></label>
      <label>Work Center<select value={wcFilter} onChange={e=>setWcFilter(e.target.value)}><option value="">All Work Centers</option>{filterWcs.map(w=><option key={w.work_center_id} value={w.work_center_id}>{w.work_center_code} · {w.work_center_name}</option>)}</select></label>
      <label className="operation-search-label">Search<input value={q} placeholder="Operation code / description" onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void load()}}/></label>
      <button className="secondary-btn" onClick={()=>void load()} disabled={busy}><RefreshCw size={16}/> Refresh</button>
    </div>
    {message&&<div className="inline-message">{message}</div>}
    <section className="professional-master-panel operation-master-panel"><div className="master-table-scroll"><table className="master-table operation-master-table"><thead><tr><th>Company</th><th>Plant</th><th>Work Center</th><th>Operation</th><th>Description</th><th>Seq</th><th>Planning</th><th>Confirmation</th><th>Quality</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      {rows.map(r=><tr key={r.operation_id}><td><b>{r.company_code}</b><small>{r.company_short_name}</small></td><td><b>{r.plant_code}</b><small>{r.plant_name}</small></td><td><b>{r.work_center_code}</b><small>{r.work_center_name}</small></td><td><b>{r.operation_code}</b><small>{r.operation_name}</small></td><td>{r.description||'—'}</td><td>{r.sequence_no}</td><td>{r.planning_relevant?'Yes':'No'}</td><td>{r.confirmation_required?'Yes':'No'}</td><td>{r.quality_relevant?'Yes':'No'}</td><td><Status value={r.is_active?'ACTIVE':'INACTIVE'}/></td><td>{canEdit&&<div className="master-actions"><button title="Copy as New" onClick={()=>openCopy(r)}><Copy size={14}/></button><button title="Edit" onClick={()=>openEdit(r)}><Edit3 size={14}/></button></div>}</td></tr>)}
      {!rows.length&&<tr><td colSpan={11} className="empty-table-cell">{busy?'Loading…':'No operations created yet.'}</td></tr>}
    </tbody></table></div><div className="table-footer"><b>{rows.length} operations</b><small>Use Copy to reuse work-center assignment and control flags with a new Operation Code.</small></div></section>

    {edit&&<div className="modal-scrim master-editor-scrim"><div className="modal master-modal wide-master-modal"><div className="modal-head"><div><span className="screen-title-kicker">OPERATION MASTER</span><h2>{modalTitle}</h2>{edit?.mode==='copy'&&<small className="copy-mode-note">Work Center and control flags are copied. Operation Code is blank because it must be unique.</small>}</div><button onClick={()=>setEdit(null)}><X/></button></div><div className="master-form-grid three-col">
      <label>Company Code<select value={form.companyCode} onChange={e=>{const companyCode=e.target.value;const plantCode=plants.find(p=>p.company_code===companyCode)?.plant_code||'';const workCenterId=workCenters.find(w=>w.company_code===companyCode&&w.plant_code===plantCode)?.work_center_id||'';setForm({...form,companyCode,plantCode,workCenterId})}}><option value="">Select Company</option>{companies.filter(c=>c.is_active!==false).map(c=><option key={c.company_code} value={c.company_code}>{c.company_code} · {c.short_name}</option>)}</select></label>
      <label>Plant Code<select value={form.plantCode} onChange={e=>{const plantCode=e.target.value;setForm({...form,plantCode,workCenterId:workCenters.find(w=>w.company_code===form.companyCode&&w.plant_code===plantCode)?.work_center_id||''})}}><option value="">Select Plant</option>{filteredPlants.filter(p=>p.is_active!==false).map(p=><option key={p.plant_code} value={p.plant_code}>{p.plant_code} · {p.plant_name}</option>)}</select></label>
      <label>Work Center<select value={form.workCenterId} onChange={e=>setForm({...form,workCenterId:e.target.value})}><option value="">Select Work Center</option>{filteredWcs.filter(w=>w.is_active!==false).map(w=><option key={w.work_center_id} value={w.work_center_id}>{w.work_center_code} · {w.work_center_name}</option>)}</select></label>
      <label>Operation Code<input disabled={Boolean(edit.operation_id)} value={form.operationCode} onChange={e=>setForm({...form,operationCode:e.target.value.toUpperCase()})}/></label>
      <label>Operation Name<input value={form.operationName} onChange={e=>setForm({...form,operationName:e.target.value})}/></label>
      <label>Sequence No<input type="number" min="1" value={form.sequenceNo} onChange={e=>setForm({...form,sequenceNo:e.target.value})}/></label>
      <label className="operation-description-field">Description<input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
      <div className="operation-flags"><label><input type="checkbox" checked={form.planningRelevant} onChange={e=>setForm({...form,planningRelevant:e.target.checked})}/> Planning Relevant</label><label><input type="checkbox" checked={form.confirmationRequired} onChange={e=>setForm({...form,confirmationRequired:e.target.checked})}/> Confirmation Required</label><label><input type="checkbox" checked={form.qualityRelevant} onChange={e=>setForm({...form,qualityRelevant:e.target.checked})}/> Quality Relevant</label><label><input type="checkbox" checked={form.isActive} onChange={e=>setForm({...form,isActive:e.target.checked})}/> Active</label></div>
    </div><div className="modal-actions"><button onClick={()=>setEdit(null)}>Cancel</button><button className="primary" onClick={()=>void save()} disabled={busy}>{edit?.operation_id?'Save Changes':'Create Operation'}</button></div></div></div>}
  </>;
}
