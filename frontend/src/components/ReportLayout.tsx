import {useEffect,useState} from 'react';
import {ArrowDown,ArrowUp,Columns3,Save,Trash2,X} from 'lucide-react';
import {api} from '../lib/api';

export type ReportColumn=readonly [string,string];

export type SavedLayout={
  layout_id:string;
  screen_code:string;
  layout_name:string;
  is_default:boolean;
  layout_config?:{columnOrder?:string[];hiddenColumns?:string[];pageSize?:number};
};

function normalizedOrder(defaultOrder:string[],input?:string[]){
  const valid=new Set(defaultOrder);
  const first=(input||[]).filter(k=>valid.has(k));
  return [...first,...defaultOrder.filter(k=>!first.includes(k))];
}

// Shared SAP-ALV-style "Layout" feature: per-user column order/visibility (and
// optional page size) saved against a screenCode, reusable on any report.
// RM Inventory (1102) was the first consumer; every other tabular report
// should wire this in the same way - see PlantStockReport.tsx / GRN.tsx.
export function useReportLayout(screenCode:string,columns:readonly ReportColumn[],options?:{pageSizes?:number[];defaultPageSize?:number;onLayoutChange?:(pageSize:number)=>void}){
  const defaultOrder=columns.map(([,key])=>String(key));
  const labelByKey=new Map(columns.map(([label,key])=>[String(key),String(label)]));
  const pageSizeChoices=options?.pageSizes;
  const defaultPageSize=options?.defaultPageSize??200;

  const[layouts,setLayouts]=useState<SavedLayout[]>([]);
  const[layoutStorageReady,setLayoutStorageReady]=useState(true);
  const[activeLayoutId,setActiveLayoutId]=useState('STANDARD');
  const[columnOrder,setColumnOrder]=useState<string[]>([...defaultOrder]);
  const[hiddenColumns,setHiddenColumns]=useState<string[]>([]);
  const[pageSize,setPageSize]=useState(defaultPageSize);
  const[layoutModal,setLayoutModal]=useState(false);
  const[editOrder,setEditOrder]=useState<string[]>([...defaultOrder]);
  const[editHidden,setEditHidden]=useState<string[]>([]);
  const[layoutName,setLayoutName]=useState('');
  const[makeDefault,setMakeDefault]=useState(false);
  const[savingLayout,setSavingLayout]=useState(false);
  const[layoutMessage,setLayoutMessage]=useState('');

  function applyLayout(layout:SavedLayout|undefined,fireChange=true){
    if(!layout){
      setActiveLayoutId('STANDARD');
      setColumnOrder([...defaultOrder]);
      setHiddenColumns([]);
      if(pageSizeChoices&&pageSize!==defaultPageSize){setPageSize(defaultPageSize);if(fireChange)options?.onLayoutChange?.(defaultPageSize);}
      return;
    }
    const cfg=layout.layout_config||{};
    const nextOrder=normalizedOrder(defaultOrder,cfg.columnOrder);
    const valid=new Set(defaultOrder);
    const nextHidden=(cfg.hiddenColumns||[]).filter(k=>valid.has(k));
    setActiveLayoutId(layout.layout_id);
    setColumnOrder(nextOrder);
    setHiddenColumns(nextHidden);
    if(pageSizeChoices){
      const nextSize=pageSizeChoices.includes(Number(cfg.pageSize))?Number(cfg.pageSize):defaultPageSize;
      if(nextSize!==pageSize){setPageSize(nextSize);if(fireChange)options?.onLayoutChange?.(nextSize);}
    }
  }

  async function loadLayouts(){
    try{
      const result=await api(`/user/report-layouts?screenCode=${encodeURIComponent(screenCode)}`);
      const list:SavedLayout[]=result.rows||[];
      setLayouts(list);
      setLayoutStorageReady(result.storageReady!==false);
      const def=list.find(x=>x.is_default);
      if(def)applyLayout(def,true);
    }catch{
      setLayouts([]);
      setLayoutStorageReady(false);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{loadLayouts()},[screenCode]);

  const visibleColumns=(()=>{
    const hidden=new Set(hiddenColumns);
    const defs=new Map(columns.map(c=>[String(c[1]),c]));
    return columnOrder.filter(k=>!hidden.has(k)).map(k=>defs.get(k)).filter(Boolean) as ReportColumn[];
  })();

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
        body:JSON.stringify({screenCode,layoutName:name,isDefault:makeDefault,config:{columnOrder:editOrder,hiddenColumns:editHidden,pageSize}})
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

  return {
    layouts,layoutStorageReady,activeLayoutId,columnOrder,hiddenColumns,visibleColumns,defaultOrder,labelByKey,
    pageSize,setPageSize,
    layoutModal,setLayoutModal,editOrder,editHidden,layoutName,setLayoutName,makeDefault,setMakeDefault,
    savingLayout,layoutMessage,
    selectLayout,openLayoutManager,moveColumn,toggleColumn,applyEditedLayout,saveLayout,deleteActiveLayout
  };
}

export function ReportLayoutBar({title,state}:{title:string;state:ReturnType<typeof useReportLayout>}){
  return <>
    <select className="rm-layout-select" value={state.activeLayoutId} onChange={state.selectLayout} title="User report layout">
      <option value="STANDARD">Standard Layout</option>
      {state.activeLayoutId==='CUSTOM'&&<option value="CUSTOM">Unsaved Custom Layout</option>}
      {state.layouts.map(x=><option key={x.layout_id} value={x.layout_id}>{x.is_default?'★ ':''}{x.layout_name}</option>)}
    </select>
    <button className="secondary-btn rm-layout-btn" onClick={state.openLayoutManager}><Columns3 size={16}/>Layout</button>
    {state.layoutModal&&<div className="modal-scrim rm-layout-scrim" onMouseDown={e=>e.target===e.currentTarget&&state.setLayoutModal(false)}>
      <div className="modal rm-layout-modal">
        <div className="rm-layout-modal-head">
          <div><h2>{title} Layout</h2><p>Choose columns and order, then save the layout against your MES user.</p></div>
          <button className="icon-btn" onClick={()=>state.setLayoutModal(false)}><X size={17}/></button>
        </div>

        {!state.layoutStorageReady&&<div className="notice">User layout storage is not initialized. Run backend migration 29_user_report_layouts.sql first.</div>}

        <div className="rm-layout-save-row">
          <label><span>Layout Name</span><input autoComplete="off" value={state.layoutName} onChange={e=>state.setLayoutName(e.target.value)} placeholder="e.g. Stores Daily View" maxLength={80}/></label>
          <label className="rm-default-layout-check"><input type="checkbox" checked={state.makeDefault} onChange={e=>state.setMakeDefault(e.target.checked)}/><span>Set as my default</span></label>
        </div>

        <div className="rm-layout-column-list">
          {state.editOrder.map((key,index)=>{
            const hidden=state.editHidden.includes(key);
            return <div className={`rm-layout-column-row ${hidden?'is-hidden':''}`} key={key}>
              <label><input type="checkbox" checked={!hidden} onChange={()=>state.toggleColumn(key)}/><span>{state.labelByKey.get(key)||key}</span></label>
              <small>{key}</small>
              <div>
                <button className="icon-btn" disabled={index===0} onClick={()=>state.moveColumn(key,-1)} title="Move up"><ArrowUp size={14}/></button>
                <button className="icon-btn" disabled={index===state.editOrder.length-1} onClick={()=>state.moveColumn(key,1)} title="Move down"><ArrowDown size={14}/></button>
              </div>
            </div>;
          })}
        </div>

        {state.layoutMessage&&<div className="form-error">{state.layoutMessage}</div>}
        <div className="modal-actions rm-layout-modal-actions">
          {state.layouts.some(x=>x.layout_id===state.activeLayoutId)&&<button className="danger-outline" onClick={state.deleteActiveLayout}><Trash2 size={15}/>Delete</button>}
          <button onClick={()=>{state.applyEditedLayout()}}>Apply Only</button>
          <button className="primary" onClick={state.saveLayout} disabled={state.savingLayout||!state.layoutStorageReady}><Save size={15}/>{state.savingLayout?'Saving…':'Save User Layout'}</button>
        </div>
      </div>
    </div>}
  </>;
}

// No. of Coils / Total Qty summary - reusable across every quantity-bearing
// report, always reflecting the CURRENT filtered result set.
export function ReportSummaryBar({count,countLabel='No. of Coils',qty,qtyLabel='Total Qty (MT)'}:{count:number;countLabel?:string;qty:number;qtyLabel?:string}){
  return <div className="report-summary-bar">
    <span>{countLabel}<b>{count.toLocaleString('en-IN')}</b></span>
    <span>{qtyLabel}<b>{qty.toLocaleString('en-IN',{minimumFractionDigits:3,maximumFractionDigits:3})}</b></span>
  </div>;
}
