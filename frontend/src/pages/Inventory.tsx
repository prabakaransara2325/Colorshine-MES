import {useEffect,useMemo,useState} from 'react';
import {api,plantQueryParam,selectedPlant,subscribePlantChange} from '../lib/api';
import {ArrowDown,ArrowUp,ChevronLeft,ChevronRight,Columns3,Download,RefreshCw,RotateCcw,Save,Trash2,X} from 'lucide-react';
import {Empty,PageHeader} from '../components/UI';
import {downloadRmInventoryReport,rmInventoryReportColumns} from '../lib/export';

const SCREEN_CODE='RM_INVENTORY';
const defaultOrder=rmInventoryReportColumns.map(([,key])=>String(key));
const labelByKey=new Map(rmInventoryReportColumns.map(([label,key])=>[String(key),String(label)]));

function d(v:any){
  if(!v)return '';
  const s=String(v);
  if(/^\d{4}-\d{2}-\d{2}/.test(s)){
    const [y,m,dd]=s.slice(0,10).split('-');
    return `${dd}-${m}-${y}`;
  }
  return s;
}

const chemistryKeys=new Set([
  'carbon','manganese','sulphur','phosphorus','silicon','aluminium',
  'carbon_equivalent','nitrogen','copper','chromium','nickel'
]);

function fixed(v:any,decimals:number){
  if(v===null||v===undefined||v==='')return '';
  const n=Number(v);
  return Number.isFinite(n)?n.toFixed(decimals):String(v);
}

function display(key:string,value:any){
  if(value===null||value===undefined)return '';
  if(key==='stock_generated_date'||key==='mother_stock_grn_date'||key==='po_delivery_date')return d(value);
  if(key==='thickness_mm')return fixed(value,3);
  if(key==='width_mm')return fixed(value,0);
  if(key==='batch_qty_mt')return fixed(value,3);
  if(key==='crown')return fixed(value,3);
  if(chemistryKeys.has(key))return fixed(value,3);
  if(key==='rm_source'){
    const s=String(value);
    const stripped=s.replace(/^0+/,'');
    return stripped||'0';
  }
  return value;
}

const blankFilters={
  materialCode:'',batchNo:'',storageLocation:'',heatNo:'',supplier:'',qualityGrade:'',steelGrade:''
};

type SavedLayout={
  layout_id:string;
  screen_code:string;
  layout_name:string;
  is_default:boolean;
  layout_config?:{columnOrder?:string[];hiddenColumns?:string[];pageSize?:number};
};

function normalizedOrder(input?:string[]){
  const valid=new Set(defaultOrder);
  const first=(input||[]).filter(k=>valid.has(k));
  return [...first,...defaultOrder.filter(k=>!first.includes(k))];
}

export default function Inventory(){
  const[rows,setRows]=useState<any[]>([]);
  const[plant,setPlant]=useState(selectedPlant());
  const[loading,setLoading]=useState(false);
  const[exporting,setExporting]=useState(false);
  const[filters,setFilters]=useState({...blankFilters});
  const[appliedFilters,setAppliedFilters]=useState({...blankFilters});
  const[options,setOptions]=useState<any>({});
  const[page,setPage]=useState(0);
  const[pageSize,setPageSize]=useState(200);
  const[total,setTotal]=useState(0);

  const[layouts,setLayouts]=useState<SavedLayout[]>([]);
  const[layoutStorageReady,setLayoutStorageReady]=useState(true);
  const[activeLayoutId,setActiveLayoutId]=useState('STANDARD');
  const[columnOrder,setColumnOrder]=useState<string[]>([...defaultOrder]);
  const[hiddenColumns,setHiddenColumns]=useState<string[]>([]);
  const[layoutModal,setLayoutModal]=useState(false);
  const[editOrder,setEditOrder]=useState<string[]>([...defaultOrder]);
  const[editHidden,setEditHidden]=useState<string[]>([]);
  const[layoutName,setLayoutName]=useState('');
  const[makeDefault,setMakeDefault]=useState(false);
  const[savingLayout,setSavingLayout]=useState(false);
  const[layoutMessage,setLayoutMessage]=useState('');

  useEffect(()=>subscribePlantChange(setPlant),[]);

  function qs(f=appliedFilters,extra:Record<string,string|number>={}){
    const p=plantQueryParam();
    const fp=new URLSearchParams();
    if(p){const [k,v]=p.split('=');fp.set(k,decodeURIComponent(v||''));}
    Object.entries(f).forEach(([k,v])=>{const value=String(v??'');if(value.trim())fp.set(k,value.trim());});
    Object.entries(extra).forEach(([k,v])=>fp.set(k,String(v)));
    return fp.toString();
  }

  async function load(f=appliedFilters,nextPage=page,nextPageSize=pageSize){
    try{
      setLoading(true);
      const query=qs(f,{limit:nextPageSize,offset:nextPage*nextPageSize});
      const result=await api(`/rm-inventory/report?${query}`);
      setRows(result.rows||[]);
      setTotal(Number(result.total||0));
      setPage(nextPage);
    }finally{setLoading(false);}
  }

  async function loadLayouts(){
    try{
      const result=await api(`/user/report-layouts?screenCode=${encodeURIComponent(SCREEN_CODE)}`);
      const list:SavedLayout[]=result.rows||[];
      setLayouts(list);
      setLayoutStorageReady(result.storageReady!==false);
      const def=list.find(x=>x.is_default);
      if(def){applyLayout(def,true);}
    }catch{
      setLayouts([]);
      setLayoutStorageReady(false);
    }
  }

  useEffect(()=>{
    setPage(0);
    load(appliedFilters,0,pageSize);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[plant]);

  useEffect(()=>{
    const p=plantQueryParam();
    api(`/rm-inventory/report/filters${p?`?${p}`:''}`).then(setOptions).catch(()=>setOptions({}));
  },[plant]);

  useEffect(()=>{loadLayouts();/* eslint-disable-next-line react-hooks/exhaustive-deps */},[]);

  function search(){
    const f={...filters};
    setAppliedFilters(f);
    load(f,0,pageSize);
  }

  function reset(){
    const f={...blankFilters};
    setFilters(f);
    setAppliedFilters(f);
    load(f,0,pageSize);
  }

  const visibleColumns=useMemo(()=>{
    const hidden=new Set(hiddenColumns);
    const defs=new Map(rmInventoryReportColumns.map(c=>[String(c[1]),c]));
    return columnOrder.filter(k=>!hidden.has(k)).map(k=>defs.get(k)).filter(Boolean) as Array<(typeof rmInventoryReportColumns)[number]>;
  },[columnOrder,hiddenColumns]);

  async function download(){
    try{
      setExporting(true);
      const query=qs(appliedFilters,{all:1});
      const result=await api(`/rm-inventory/report?${query}`);
      downloadRmInventoryReport(result.rows||[],`RM_Inventory_${plant}_${new Date().toISOString().slice(0,10)}.csv`,visibleColumns);
    }finally{setExporting(false);}
  }

  function changePageSize(e:any){
    const size=Number(e.target.value)||200;
    setPageSize(size);
    load(appliedFilters,0,size);
  }

  function applyLayout(layout:SavedLayout|undefined,reload=true){
    if(!layout){
      setActiveLayoutId('STANDARD');
      setColumnOrder([...defaultOrder]);
      setHiddenColumns([]);
      if(pageSize!==200){setPageSize(200);if(reload)load(appliedFilters,0,200);}
      return;
    }
    const cfg=layout.layout_config||{};
    const nextOrder=normalizedOrder(cfg.columnOrder);
    const valid=new Set(defaultOrder);
    const nextHidden=(cfg.hiddenColumns||[]).filter(k=>valid.has(k));
    const nextSize=[100,200,500].includes(Number(cfg.pageSize))?Number(cfg.pageSize):200;
    setActiveLayoutId(layout.layout_id);
    setColumnOrder(nextOrder);
    setHiddenColumns(nextHidden);
    if(nextSize!==pageSize){setPageSize(nextSize);if(reload)load(appliedFilters,0,nextSize);}
  }

  function selectLayout(e:any){
    const id=String(e.target.value);
    if(id==='STANDARD'){applyLayout(undefined);return;}
    if(id==='CUSTOM')return;
    applyLayout(layouts.find(x=>x.layout_id===id));
  }

  function openLayoutManager(){
    setEditOrder([...columnOrder]);
    setEditHidden([...hiddenColumns]);
    const active=layouts.find(x=>x.layout_id===activeLayoutId);
    setLayoutName(active?.layout_name||'');
    setMakeDefault(Boolean(active?.is_default));
    setLayoutMessage('');
    setLayoutModal(true);
  }

  function moveColumn(key:string,delta:number){
    setEditOrder(order=>{
      const i=order.indexOf(key);const j=i+delta;
      if(i<0||j<0||j>=order.length)return order;
      const next=[...order];[next[i],next[j]]=[next[j],next[i]];return next;
    });
  }

  function toggleColumn(key:string){
    setEditHidden(h=>h.includes(key)?h.filter(x=>x!==key):[...h,key]);
  }

  function applyEditedLayout(){
    setColumnOrder([...editOrder]);
    setHiddenColumns([...editHidden]);
    setActiveLayoutId('CUSTOM');
    setLayoutModal(false);
  }

  async function saveLayout(){
    const name=layoutName.trim();
    if(!name){setLayoutMessage('Enter a layout name.');return;}
    if(editHidden.length>=editOrder.length){setLayoutMessage('At least one column must remain visible.');return;}
    try{
      setSavingLayout(true);setLayoutMessage('');
      const result=await api('/user/report-layouts',{
        method:'POST',
        body:JSON.stringify({screenCode:SCREEN_CODE,layoutName:name,isDefault:makeDefault,config:{columnOrder:editOrder,hiddenColumns:editHidden,pageSize}})
      });
      setColumnOrder([...editOrder]);setHiddenColumns([...editHidden]);
      await loadLayouts();
      if(result.row?.layout_id)setActiveLayoutId(result.row.layout_id);
      setLayoutModal(false);
    }catch(e:any){setLayoutMessage(e?.message||'Unable to save layout.');}
    finally{setSavingLayout(false);}
  }

  async function deleteActiveLayout(){
    const active=layouts.find(x=>x.layout_id===activeLayoutId);
    if(!active)return;
    if(!window.confirm(`Delete your layout "${active.layout_name}"?`))return;
    await api(`/user/report-layouts/${encodeURIComponent(active.layout_id)}`,{method:'DELETE'});
    setLayoutModal(false);
    applyLayout(undefined);
    await loadLayouts();
  }

  const set=(key:string)=>(e:any)=>setFilters(f=>({...f,[key]:e.target.value}));
  const first=total===0?0:page*pageSize+1;
  const last=Math.min((page+1)*pageSize,total);
  const pages=Math.max(1,Math.ceil(total/pageSize));

  return <div className="rm-inventory-page-v098">
    <PageHeader
      title="RM Inventory"
      actions={<div className="rm-report-actions">
        <select className="rm-layout-select" value={activeLayoutId} onChange={selectLayout} title="User report layout">
          <option value="STANDARD">Standard Layout</option>
          {activeLayoutId==='CUSTOM'&&<option value="CUSTOM">Unsaved Custom Layout</option>}
          {layouts.map(x=><option key={x.layout_id} value={x.layout_id}>{x.is_default?'★ ':''}{x.layout_name}</option>)}
        </select>
        <button className="secondary-btn rm-layout-btn" onClick={openLayoutManager}><Columns3 size={16}/>Layout</button>
        <button className="secondary-btn download-btn" onClick={download} disabled={exporting||loading}><Download size={16}/>{exporting?'Preparing…':'Download'}</button>
      </div>}
    />

    <div className="rm-compact-filter-bar">
      <input list="rm-material-codes" aria-label="Material Code" title="Material Code" value={filters.materialCode} onChange={set('materialCode')} placeholder="Material Code"/>
      <input aria-label="Batch No" title="Batch No" value={filters.batchNo} onChange={set('batchNo')} placeholder="Batch No" onKeyDown={e=>e.key==='Enter'&&search()}/>
      <input list="rm-storage-locations" aria-label="Storage Location" title="Storage Location" value={filters.storageLocation} onChange={set('storageLocation')} placeholder="Storage Location"/>
      <input aria-label="Heat No" title="Heat No" value={filters.heatNo} onChange={set('heatNo')} placeholder="Heat No" onKeyDown={e=>e.key==='Enter'&&search()}/>
      <input list="rm-suppliers" aria-label="Supplier" title="Supplier" value={filters.supplier} onChange={set('supplier')} placeholder="Supplier"/>
      <input list="rm-quality-grades" aria-label="QA Grade" title="QA Grade" value={filters.qualityGrade} onChange={set('qualityGrade')} placeholder="QA Grade"/>
      <input list="rm-steel-grades" aria-label="Steel Grade" title="Steel Grade" value={filters.steelGrade} onChange={set('steelGrade')} placeholder="Steel Grade"/>
      <button className="secondary-btn rm-compact-search" onClick={search} disabled={loading}>{loading?<RefreshCw size={16} className="spin"/>:'Search'}</button>
      <button className="ghost-btn rm-compact-reset" onClick={reset} disabled={loading} title="Reset filters"><RotateCcw size={16}/></button>
    </div>

    <datalist id="rm-material-codes">{(options.material_codes||[]).map((x:string)=><option key={x} value={x}/>)}</datalist>
    <datalist id="rm-storage-locations">{(options.storage_locations||[]).map((x:string)=><option key={x} value={x}/>)}</datalist>
    <datalist id="rm-suppliers">{(options.suppliers||[]).map((x:string)=><option key={x} value={x}/>)}</datalist>
    <datalist id="rm-quality-grades">{(options.quality_grades||[]).map((x:string)=><option key={x} value={x}/>)}</datalist>
    <datalist id="rm-steel-grades">{(options.steel_grades||[]).map((x:string)=><option key={x} value={x}/>)}</datalist>

    <div className={`table-panel inventory-report-panel rm-fast-panel rm-max-table ${loading?'is-loading':''}`}>
      <div className="responsive-table inventory-report-scroll">
        <table className="inventory-master-report-table rm-inventory-table rm-layout-table">
          <thead><tr>{visibleColumns.map(([label,key])=><th key={String(key)}>{label}</th>)}</tr></thead>
          <tbody>{rows.map(r=><tr key={r.inventory_id} className="stage-rm">
            {visibleColumns.map(([,key])=><td key={String(key)} title={String(display(String(key),r[key])??'')}>{display(String(key),r[key])}</td>)}
          </tr>)}</tbody>
        </table>
        {!loading&&!rows.length&&<Empty text="No RM inventory found for the selected filters"/>}
        {loading&&<div className="rm-loading-overlay"><RefreshCw size={32} className="spin"/><b>Loading RM inventory…</b><span>Retrieving the current page.</span></div>}
      </div>

      <div className="inventory-report-footer rm-pagination-footer">
        <span>{total.toLocaleString()} RM records · {first.toLocaleString()}–{last.toLocaleString()} · {visibleColumns.length}/{rmInventoryReportColumns.length} columns</span>
        <div className="rm-pagination-controls">
          <label>Rows <select value={pageSize} onChange={changePageSize} disabled={loading}><option value="100">100</option><option value="200">200</option><option value="500">500</option></select></label>
          <button className="ghost-btn compact-btn" disabled={loading||page<=0} onClick={()=>load(appliedFilters,page-1,pageSize)}><ChevronLeft size={15}/>Previous</button>
          <b>Page {Math.min(page+1,pages)} / {pages}</b>
          <button className="ghost-btn compact-btn" disabled={loading||page+1>=pages} onClick={()=>load(appliedFilters,page+1,pageSize)}>Next<ChevronRight size={15}/></button>
        </div>
      </div>
    </div>

    {layoutModal&&<div className="modal-scrim rm-layout-scrim" onMouseDown={e=>e.target===e.currentTarget&&setLayoutModal(false)}>
      <div className="modal rm-layout-modal">
        <div className="rm-layout-modal-head">
          <div><h2>RM Inventory Layout</h2><p>Choose columns and order, then save the layout against your MES user.</p></div>
          <button className="icon-btn" onClick={()=>setLayoutModal(false)}><X size={17}/></button>
        </div>

        {!layoutStorageReady&&<div className="notice">User layout storage is not initialized. Run backend migration 29_user_report_layouts.sql first.</div>}

        <div className="rm-layout-save-row">
          <label><span>Layout Name</span><input value={layoutName} onChange={e=>setLayoutName(e.target.value)} placeholder="e.g. Stores Daily View" maxLength={80}/></label>
          <label className="rm-default-layout-check"><input type="checkbox" checked={makeDefault} onChange={e=>setMakeDefault(e.target.checked)}/><span>Set as my default</span></label>
        </div>

        <div className="rm-layout-column-list">
          {editOrder.map((key,index)=>{
            const hidden=editHidden.includes(key);
            return <div className={`rm-layout-column-row ${hidden?'is-hidden':''}`} key={key}>
              <label><input type="checkbox" checked={!hidden} onChange={()=>toggleColumn(key)}/><span>{labelByKey.get(key)||key}</span></label>
              <small>{key}</small>
              <div>
                <button className="icon-btn" disabled={index===0} onClick={()=>moveColumn(key,-1)} title="Move up"><ArrowUp size={14}/></button>
                <button className="icon-btn" disabled={index===editOrder.length-1} onClick={()=>moveColumn(key,1)} title="Move down"><ArrowDown size={14}/></button>
              </div>
            </div>;
          })}
        </div>

        {layoutMessage&&<div className="form-error">{layoutMessage}</div>}
        <div className="modal-actions rm-layout-modal-actions">
          {layouts.some(x=>x.layout_id===activeLayoutId)&&<button className="danger-outline" onClick={deleteActiveLayout}><Trash2 size={15}/>Delete</button>}
          <button onClick={()=>{setEditOrder([...defaultOrder]);setEditHidden([]);}}>Standard Columns</button>
          <button onClick={applyEditedLayout}>Apply Only</button>
          <button className="primary" onClick={saveLayout} disabled={savingLayout||!layoutStorageReady}><Save size={15}/>{savingLayout?'Saving…':'Save User Layout'}</button>
        </div>
      </div>
    </div>}
  </div>;
}
