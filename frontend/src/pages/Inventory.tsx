import {useEffect,useState} from 'react';
import {api,plantQueryParam,selectedPlant,subscribePlantChange} from '../lib/api';
import {ChevronLeft,ChevronRight,Download,RefreshCw,RotateCcw} from 'lucide-react';
import {Empty,PageHeader} from '../components/UI';
import {ReportLayoutBar,ReportSummaryBar,useReportLayout} from '../components/ReportLayout';
import {downloadRmInventoryReport,rmInventoryReportColumns} from '../lib/export';

const SCREEN_CODE='RM_INVENTORY';
const PAGE_SIZES=[100,200,500];

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
  if(!Number.isFinite(n))return String(v);
  return n===0?'—':n.toFixed(decimals);
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

export default function Inventory(){
  const[rows,setRows]=useState<any[]>([]);
  const[plant,setPlant]=useState(selectedPlant());
  const[loading,setLoading]=useState(false);
  const[exporting,setExporting]=useState(false);
  const[filters,setFilters]=useState({...blankFilters});
  const[appliedFilters,setAppliedFilters]=useState({...blankFilters});
  const[options,setOptions]=useState<any>({});
  const[page,setPage]=useState(0);
  const[total,setTotal]=useState(0);
  const[totalQtyMt,setTotalQtyMt]=useState(0);

  const layout=useReportLayout(SCREEN_CODE,rmInventoryReportColumns,{
    pageSizes:PAGE_SIZES,defaultPageSize:200,
    onLayoutChange:(size)=>load(appliedFilters,0,size)
  });

  useEffect(()=>subscribePlantChange(setPlant),[]);

  function qs(f=appliedFilters,extra:Record<string,string|number>={}){
    const p=plantQueryParam();
    const fp=new URLSearchParams();
    if(p){const [k,v]=p.split('=');fp.set(k,decodeURIComponent(v||''));}
    Object.entries(f).forEach(([k,v])=>{const value=String(v??'');if(value.trim())fp.set(k,value.trim());});
    Object.entries(extra).forEach(([k,v])=>fp.set(k,String(v)));
    return fp.toString();
  }

  async function load(f=appliedFilters,nextPage=page,nextPageSize=layout.pageSize){
    try{
      setLoading(true);
      const query=qs(f,{limit:nextPageSize,offset:nextPage*nextPageSize});
      const result=await api(`/rm-inventory/report?${query}`);
      setRows(result.rows||[]);
      setTotal(Number(result.total||0));
      setTotalQtyMt(Number(result.totalQtyMt||0));
      setPage(nextPage);
    }finally{setLoading(false);}
  }

  useEffect(()=>{
    setPage(0);
    load(appliedFilters,0,layout.pageSize);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[plant]);

  useEffect(()=>{
    const p=plantQueryParam();
    api(`/rm-inventory/report/filters${p?`?${p}`:''}`).then(setOptions).catch(()=>setOptions({}));
  },[plant]);

  function search(){
    const f={...filters};
    setAppliedFilters(f);
    load(f,0,layout.pageSize);
  }

  function reset(){
    const f={...blankFilters};
    setFilters(f);
    setAppliedFilters(f);
    load(f,0,layout.pageSize);
  }

  async function download(){
    try{
      setExporting(true);
      const query=qs(appliedFilters,{all:1});
      const result=await api(`/rm-inventory/report?${query}`);
      downloadRmInventoryReport(result.rows||[],`RM_Inventory_${plant}_${new Date().toISOString().slice(0,10)}.csv`,layout.visibleColumns);
    }finally{setExporting(false);}
  }

  function changePageSize(e:any){
    const size=Number(e.target.value)||200;
    layout.setPageSize(size);
    load(appliedFilters,0,size);
  }

  const set=(key:string)=>(e:any)=>setFilters(f=>({...f,[key]:e.target.value}));
  const first=total===0?0:page*layout.pageSize+1;
  const last=Math.min((page+1)*layout.pageSize,total);
  const pages=Math.max(1,Math.ceil(total/layout.pageSize));

  return <div className="rm-inventory-page-v098">
    <PageHeader
      title="RM Inventory"
      actions={<div className="rm-report-actions">
        <ReportLayoutBar title="RM Inventory" state={layout}/>
        <button className="secondary-btn download-btn" onClick={download} disabled={exporting||loading}><Download size={16}/>{exporting?'Preparing…':'Download'}</button>
      </div>}
    />

    <ReportSummaryBar count={total} qty={totalQtyMt}/>

    <div className="rm-compact-filter-bar">
      <input autoComplete="off" list="rm-material-codes" aria-label="Material Code" title="Material Code" value={filters.materialCode} onChange={set('materialCode')} placeholder="Material Code"/>
      <input autoComplete="off" aria-label="Batch No" title="Batch No" value={filters.batchNo} onChange={set('batchNo')} placeholder="Batch No" onKeyDown={e=>e.key==='Enter'&&search()}/>
      <input autoComplete="off" list="rm-storage-locations" aria-label="Storage Location" title="Storage Location" value={filters.storageLocation} onChange={set('storageLocation')} placeholder="Storage Location"/>
      <input autoComplete="off" aria-label="Heat No" title="Heat No" value={filters.heatNo} onChange={set('heatNo')} placeholder="Heat No" onKeyDown={e=>e.key==='Enter'&&search()}/>
      <input autoComplete="off" list="rm-suppliers" aria-label="Supplier" title="Supplier" value={filters.supplier} onChange={set('supplier')} placeholder="Supplier"/>
      <input autoComplete="off" list="rm-quality-grades" aria-label="QA Grade" title="QA Grade" value={filters.qualityGrade} onChange={set('qualityGrade')} placeholder="QA Grade"/>
      <input autoComplete="off" list="rm-steel-grades" aria-label="Steel Grade" title="Steel Grade" value={filters.steelGrade} onChange={set('steelGrade')} placeholder="Steel Grade"/>
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
          <thead><tr>{layout.visibleColumns.map(([label,key])=><th key={String(key)}>{label}</th>)}</tr></thead>
          <tbody>{rows.map(r=><tr key={r.inventory_id} className="stage-rm">
            {layout.visibleColumns.map(([,key])=><td key={String(key)} title={String(display(String(key),r[key])??'')}>{display(String(key),r[key])}</td>)}
          </tr>)}</tbody>
        </table>
        {!loading&&!rows.length&&<Empty text="No RM inventory found for the selected filters"/>}
        {loading&&<div className="rm-loading-overlay"><RefreshCw size={32} className="spin"/><b>Loading RM inventory…</b><span>Retrieving the current page.</span></div>}
      </div>

      <div className="inventory-report-footer rm-pagination-footer">
        <span>{total.toLocaleString()} RM records · {first.toLocaleString()}–{last.toLocaleString()} · {layout.visibleColumns.length}/{rmInventoryReportColumns.length} columns</span>
        <div className="rm-pagination-controls">
          <label>Rows <select value={layout.pageSize} onChange={changePageSize} disabled={loading}>{PAGE_SIZES.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
          <button className="ghost-btn compact-btn" disabled={loading||page<=0} onClick={()=>load(appliedFilters,page-1,layout.pageSize)}><ChevronLeft size={15}/>Previous</button>
          <b>Page {Math.min(page+1,pages)} / {pages}</b>
          <button className="ghost-btn compact-btn" disabled={loading||page+1>=pages} onClick={()=>load(appliedFilters,page+1,layout.pageSize)}>Next<ChevronRight size={15}/></button>
        </div>
      </div>
    </div>
  </div>;
}
