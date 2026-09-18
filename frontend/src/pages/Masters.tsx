import {useEffect,useMemo,useRef,useState} from 'react';
import {api,currentUser} from '../lib/api';
import {CheckCircle2, Pencil, Plus, Power, PowerOff, RefreshCcw, Search, ShieldAlert, X} from 'lucide-react';
import {PageHeader,Status} from '../components/UI';

type Option={value:string,label:string};
type Field={key:string,label:string,type?:'text'|'number'|'select'|'checkbox';required?:boolean;options?:Option[];default?:any;immutable?:boolean;placeholder?:string};
type Column={key:string,label:string};
type MasterDef={label:string;singular:string;key:(r:any)=>string;columns:Column[];fields:Field[];editable?:boolean};

const categoryOptions=['RAW_MATERIAL','SEMI_FINISHED','FINISHED_GOOD','SCRAP','PACKING','OTHER'].map(v=>({value:v,label:v.replaceAll('_',' ')}));
const qualityCategories=['DIMENSION','CHEMICAL','MECHANICAL','COATING','SURFACE','PACKING','GENERAL','OTHER'].map(v=>({value:v,label:v}));
const dataTypes=['NUMERIC','TEXT','BOOLEAN','OPTION'].map(v=>({value:v,label:v}));
const inventoryCategories=['GENERAL','RAW_MATERIAL','SEMI_FINISHED','FINISHED_GOOD','SCRAP','QUALITY_HOLD','OTHER'].map(v=>({value:v,label:v.replaceAll('_',' ')}));

const defs:Record<string,MasterDef>={
  companies:{label:'Companies',singular:'Company',editable:true,key:r=>r.company_code,columns:[
    {key:'company_code',label:'Company Code'},{key:'company_name',label:'Company Name'},{key:'short_name',label:'Short Name'}
  ],fields:[
    {key:'company_code',label:'Company Code',required:true,immutable:true},{key:'company_name',label:'Company Name',required:true},{key:'short_name',label:'Short Name',required:true}
  ]},
  suppliers:{label:'Suppliers',singular:'Supplier',key:r=>r.supplier_id,columns:[
    {key:'sap_vendor_no',label:'SAP Vendor No'},{key:'supplier_name',label:'Supplier Name'},{key:'short_name',label:'Short Name'},{key:'country_code',label:'Country'},{key:'source_system',label:'Source'}
  ],fields:[
    {key:'sap_vendor_no',label:'SAP Vendor No',required:true,immutable:true},{key:'supplier_name',label:'Supplier Name',required:true},{key:'short_name',label:'Short Name'},{key:'country_code',label:'Country Code',default:'IND',required:true}
  ]},
  materials:{label:'Materials',singular:'Material',editable:true,key:r=>r.material_id,columns:[
    {key:'sap_material_code',label:'Material Code'},{key:'material_description',label:'Description'},{key:'material_type',label:'Type'},{key:'product_group',label:'Product Group'},{key:'base_uom',label:'UOM'},{key:'material_category',label:'Category'}
  ],fields:[
    {key:'sap_material_code',label:'Material Code',required:true,immutable:true},{key:'material_description',label:'Description',required:true},{key:'material_type',label:'Material Type'},{key:'material_group',label:'Material Group'},{key:'product_group',label:'Product Group'},{key:'product_type',label:'Product Type'},{key:'base_uom',label:'Base UOM',default:'MT',required:true},{key:'material_category',label:'Category',type:'select',options:categoryOptions,default:'RAW_MATERIAL',required:true},{key:'is_batch_managed',label:'Batch Managed',type:'checkbox',default:true}
  ]},
  plants:{label:'Plants',singular:'Plant',editable:true,key:r=>r.plant_code,columns:[
    {key:'plant_code',label:'Plant'},{key:'company_code',label:'Company Code'},{key:'plant_name',label:'Plant Name'},{key:'timezone_name',label:'Timezone'},{key:'source_system',label:'Source'}
  ],fields:[
    {key:'plant_code',label:'Plant Code',required:true,immutable:true},{key:'company_code',label:'Company Code',required:true},{key:'plant_name',label:'Plant Name',required:true},{key:'timezone_name',label:'Timezone',default:'Asia/Kolkata',required:true}
  ]},
  'storage-locations':{label:'Storage Locations',singular:'Storage Location',key:r=>`${r.plant_code}~${r.storage_location}`,columns:[
    {key:'plant_code',label:'Plant'},{key:'storage_location',label:'SLoc'},{key:'storage_name',label:'Storage Name'},{key:'inventory_category',label:'Inventory Category'},{key:'source_system',label:'Source'}
  ],fields:[
    {key:'plant_code',label:'Plant Code',required:true,immutable:true},{key:'storage_location',label:'Storage Location',required:true,immutable:true},{key:'storage_name',label:'Storage Name'},{key:'inventory_category',label:'Inventory Category',type:'select',options:inventoryCategories,default:'GENERAL',required:true}
  ]},
  customers:{label:'Customers',singular:'Customer',key:r=>r.customer_id,columns:[
    {key:'sap_customer_no',label:'SAP Customer No'},{key:'customer_name',label:'Customer Name'},{key:'source_system',label:'Source'}
  ],fields:[
    {key:'sap_customer_no',label:'SAP Customer No',required:true,immutable:true},{key:'customer_name',label:'Customer Name',required:true}
  ]},
  brands:{label:'Brands',singular:'Brand',key:r=>r.brand_id,columns:[
    {key:'brand_code',label:'Brand Code'},{key:'brand_name',label:'Brand Name'},{key:'brand_sequence_no',label:'Sequence'}
  ],fields:[
    {key:'brand_code',label:'Brand Code',required:true,immutable:true},{key:'brand_name',label:'Brand Name',required:true},{key:'brand_sequence_no',label:'Sequence No',type:'number'}
  ]},
  'quality-parameters':{label:'Quality Parameters',singular:'Quality Parameter',key:r=>r.parameter_id,columns:[
    {key:'parameter_code',label:'Parameter Code'},{key:'parameter_name',label:'Parameter Name'},{key:'parameter_category',label:'Category'},{key:'data_type',label:'Data Type'},{key:'default_uom',label:'UOM'},{key:'decimal_places',label:'Decimals'}
  ],fields:[
    {key:'parameter_code',label:'Parameter Code',required:true,immutable:true},{key:'parameter_name',label:'Parameter Name',required:true},{key:'parameter_category',label:'Category',type:'select',options:qualityCategories,required:true,default:'GENERAL'},{key:'data_type',label:'Data Type',type:'select',options:dataTypes,required:true,default:'NUMERIC'},{key:'default_uom',label:'Default UOM'},{key:'decimal_places',label:'Decimal Places',type:'number',default:3}
  ]}
};

function display(v:any){if(v===null||v===undefined||v==='')return '—';if(typeof v==='boolean')return v?'Yes':'No';return String(v).replaceAll('_',' ')}

export default function Masters(){
  const[tab,setTab]=useState('companies');
  const[rows,setRows]=useState<any[]>([]);
  const[loading,setLoading]=useState(false);
  const[search,setSearch]=useState('');
  const[status,setStatus]=useState<'ALL'|'ACTIVE'|'INACTIVE'>('ALL');
  const[editor,setEditor]=useState<{mode:'add'|'edit',row?:any}|null>(null);
  const[form,setForm]=useState<Record<string,any>>({});
  const[busy,setBusy]=useState(false);
  const[notice,setNotice]=useState('');
  const[error,setError]=useState('');
  const[deactivate,setDeactivate]=useState<any>(null);
  const loadSeq=useRef(0);
  const activeTab=useRef(tab);
  const user=currentUser();
  const def=defs[tab];
  const canMaintain=(user?.roles||[]).includes('ADMIN')&&def.editable===true;

  async function load(targetTab:string=tab){
    const seq=++loadSeq.current;
    const targetDef=defs[targetTab];
    setLoading(true);
    setError('');
    try{
      const d=await api(`/masters/${targetTab}?active=all`);
      // Ignore an older request that finished after the user moved to another tab.
      // This prevents rows from Quality Parameters/Suppliers/etc. being rendered
      // with Storage Location columns on a later visit.
      if(seq!==loadSeq.current||activeTab.current!==targetTab)return;
      const raw=Array.isArray(d?.rows)?d.rows:[];
      const safeRows=raw.filter((r:any)=>{
        if(!r||typeof r!=='object')return false;
        try{const k=targetDef.key(r);return !!k&&!String(k).includes('undefined')&&!String(k).includes('null')}catch{return false}
      });
      setRows(safeRows);
    }catch(e:any){
      if(seq===loadSeq.current&&activeTab.current===targetTab)setError(e.message);
    }finally{
      if(seq===loadSeq.current&&activeTab.current===targetTab)setLoading(false);
    }
  }
  useEffect(()=>{
    activeTab.current=tab;
    // Invalidate any request from the previous tab immediately and clear its rows
    // so stale data can never flash under the new column definition.
    loadSeq.current++;
    setRows([]);
    setSearch('');
    setStatus('ALL');
    void load(tab);
  },[tab]);

  const filtered=useMemo(()=>rows.filter(r=>{
    if(status==='ACTIVE'&&!r.is_active)return false;if(status==='INACTIVE'&&r.is_active)return false;
    if(!search.trim())return true;const s=search.toLowerCase();return def.columns.some(c=>String(r[c.key]??'').toLowerCase().includes(s));
  }),[rows,status,search,def]);

  function openAdd(){const f:any={};def.fields.forEach(x=>f[x.key]=x.default??(x.type==='checkbox'?false:''));setForm(f);setEditor({mode:'add'});setError('');}
  function openEdit(row:any){const f:any={};def.fields.forEach(x=>f[x.key]=row[x.key]??(x.type==='checkbox'?false:''));setForm(f);setEditor({mode:'edit',row});setError('');}
  function changeField(f:Field,v:any){setForm(x=>({...x,[f.key]:v}))}
  function payload(){const p:any={};def.fields.forEach(f=>{let v=form[f.key];if(f.type==='number'&&v!=='')v=Number(v);if(f.type==='checkbox')v=!!v;p[f.key]=v===''?null:v});return p}
  async function save(e:any){e.preventDefault();if(!editor)return;setBusy(true);setError('');try{
    const key=editor.row?def.key(editor.row):'';const path=editor.mode==='add'?`/masters/${tab}`:`/masters/${tab}/${encodeURIComponent(key)}`;
    await api(path,{method:editor.mode==='add'?'POST':'PUT',body:JSON.stringify(payload())});
    setEditor(null);setNotice(`${def.singular} ${editor.mode==='add'?'created':'updated'} successfully.`);await load();
  }catch(e:any){setError(e.message)}finally{setBusy(false)}}

  async function askDeactivate(row:any){setBusy(true);setError('');try{const key=def.key(row);const d=await api(`/masters/${tab}/${encodeURIComponent(key)}/deactivation-check`);setDeactivate({...d,row,key})}catch(e:any){setError(e.message)}finally{setBusy(false)}}
  async function confirmDeactivate(){if(!deactivate?.allowed)return;setBusy(true);try{await api(`/masters/${tab}/${encodeURIComponent(deactivate.key)}/deactivate`,{method:'POST',body:'{}'});setDeactivate(null);setNotice(`${def.singular} deactivated.`);await load()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
  async function activate(row:any){setBusy(true);setError('');try{await api(`/masters/${tab}/${encodeURIComponent(def.key(row))}/activate`,{method:'POST',body:'{}'});setNotice(`${def.singular} activated.`);await load()}catch(e:any){setError(e.message)}finally{setBusy(false)}}

  return <>
    <PageHeader title="Reference Masters" subtitle="Enterprise reference data. Manufacturing masters are maintained from the Masters Control Center." actions={canMaintain?<button className="primary compact" onClick={openAdd}><Plus size={16}/> Add {def.singular}</button>:undefined}/>

    <div className="master-tabs">{Object.entries(defs).map(([k,d])=><button key={k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{d.label}</button>)}</div>

    {notice&&<div className="toast success-toast"><CheckCircle2 size={17}/>{notice}<button onClick={()=>setNotice('')}><X size={15}/></button></div>}
    {error&&<div className="toast error-toast"><ShieldAlert size={17}/>{error}<button onClick={()=>setError('')}><X size={15}/></button></div>}

    <div className="master-toolbar">
      <div className="search master-search"><Search size={17}/><input placeholder={`Search ${def.label.toLowerCase()}…`} value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <select value={status} onChange={e=>setStatus(e.target.value as any)}><option value="ALL">All status</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>
      <button className="secondary-btn" onClick={()=>load(tab)} disabled={loading}><RefreshCcw size={16}/>{loading?'Loading…':'Refresh'}</button>
    </div>

    <div className="table-panel master-table-panel">
      <div className="master-table-scroll"><table className="master-table"><thead><tr>{def.columns.map(c=><th key={c.key}>{c.label}</th>)}<th>Status</th>{canMaintain&&<th className="actions-col">Actions</th>}</tr></thead><tbody>
        {filtered.map(r=><tr key={def.key(r)} className={!r.is_active?'inactive-row':''}>{def.columns.map(c=><td key={c.key}>{display(r[c.key])}</td>)}<td><Status value={r.is_active?'ACTIVE':'INACTIVE'}/></td>{canMaintain&&<td className="master-actions"><button title="Edit" onClick={()=>openEdit(r)}><Pencil size={16}/></button>{r.is_active?<button className="danger-action" title="Deactivate" onClick={()=>askDeactivate(r)}><PowerOff size={16}/></button>:<button className="good-action" title="Activate" onClick={()=>activate(r)}><Power size={16}/></button>}</td>}</tr>)}
      </tbody></table></div>
      {!filtered.length&&<div className="empty">{loading?'Loading…':'No records found'}</div>}
      <div className="table-footer"><span>{filtered.length} record{filtered.length===1?'':'s'}</span><small>Inactive masters remain in history and cannot be used for new transactions.</small></div>
    </div>

    {editor&&<div className="modal-scrim" onMouseDown={()=>!busy&&setEditor(null)}><div className="modal master-modal" onMouseDown={e=>e.stopPropagation()}>
      <div className="modal-head"><div><span className="eyebrow">MASTER MAINTENANCE</span><h2>{editor.mode==='add'?`Add ${def.singular}`:`Edit ${def.singular}`}</h2></div><button onClick={()=>setEditor(null)}><X/></button></div>
      <form onSubmit={save}><div className="master-form-grid">{def.fields.map(f=><label key={f.key} className={f.type==='checkbox'?'checkbox-field':''}>{f.type==='checkbox'?<><input type="checkbox" checked={!!form[f.key]} onChange={e=>changeField(f,e.target.checked)}/><span>{f.label}</span></>:<><span>{f.label}{f.required&&<em>*</em>}</span>{f.type==='select'?<select required={f.required} disabled={editor.mode==='edit'&&f.immutable} value={form[f.key]??''} onChange={e=>changeField(f,e.target.value)}><option value="">Select…</option>{f.options?.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<input type={f.type==='number'?'number':'text'} step={f.type==='number'?'any':undefined} required={f.required} disabled={editor.mode==='edit'&&f.immutable} value={form[f.key]??''} onChange={e=>changeField(f,e.target.value)} placeholder={f.placeholder}/>} {editor.mode==='edit'&&f.immutable&&<small>Business key cannot be changed after creation.</small>}</>}</label>)}</div>
      <div className="modal-actions"><button type="button" className="secondary-btn" onClick={()=>setEditor(null)}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving…':'Save'}</button></div></form>
    </div></div>}

    {deactivate&&<div className="modal-scrim" onMouseDown={()=>!busy&&setDeactivate(null)}><div className="modal deactivate-modal" onMouseDown={e=>e.stopPropagation()}>
      <div className="modal-head"><div><span className="eyebrow">DEACTIVATION CHECK</span><h2>{def.singular}</h2></div><button onClick={()=>setDeactivate(null)}><X/></button></div>
      {deactivate.allowed?<div className="deactivation-safe"><CheckCircle2/><div><b>Safe to deactivate</b><p>No current inventory, open transaction, plan or other blocking dependency was found.</p></div></div>:<div className="deactivation-blocked"><ShieldAlert/><div><b>Deactivation blocked</b><p>This master is still required by active business data.</p></div></div>}
      {!!deactivate.blockers?.length&&<div className="blocker-list">{deactivate.blockers.map((b:any)=><div key={b.code}><span>{b.label}</span><b>{b.count}</b><small>{b.detail}</small></div>)}</div>}
      <div className="deactivation-note">Historical references are preserved. Only current/open dependencies block deactivation.</div>
      <div className="modal-actions"><button className="secondary-btn" onClick={()=>setDeactivate(null)}>Cancel</button><button className="danger-btn" disabled={!deactivate.allowed||busy} onClick={confirmDeactivate}>{busy?'Checking…':'Deactivate'}</button></div>
    </div></div>}
  </>
}
