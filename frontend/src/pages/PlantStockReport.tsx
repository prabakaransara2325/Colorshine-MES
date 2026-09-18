import {useEffect,useState} from 'react';
import {ChevronLeft,ChevronRight,Download,RefreshCw,RotateCcw} from 'lucide-react';
import {api,plantQueryParam,selectedPlant,subscribePlantChange} from '../lib/api';
import {Empty,PageHeader} from '../components/UI';
import {ReportLayoutBar,ReportSummaryBar,useReportLayout} from '../components/ReportLayout';
import {downloadInventoryMasterReport,inventoryMasterReportColumns} from '../lib/export';

const SCREEN_CODE='PLANT_STOCK_REPORT';
const PAGE_SIZES=[100,200,500];
const emptyFilters={materialCode:'',storageLocation:'',category:'',thickness:'',heatNo:'',steelGrade:'',qualityGrade:''};
const chemistryKeys=new Set(['carbon','manganese','sulphur','phosphorus','silicon','aluminium','carbon_equivalent','nitrogen','copper','chromium','nickel']);

function d(v:any){if(!v)return '';const s=String(v);if(/^\d{4}-\d{2}-\d{2}/.test(s)){const [y,m,dd]=s.slice(0,10).split('-');return `${dd}-${m}-${y}`}return s}
function fixed(v:any,decimals:number){if(v===null||v===undefined||v==='')return '';const x=Number(v);if(!Number.isFinite(x))return String(v);return x===0?'—':x.toFixed(decimals)}
function display(key:string,value:any){
  if(value===null||value===undefined)return '';
  if(key==='stock_generated_date'||key==='mother_stock_grn_date')return d(value);
  if(key==='thickness_mm'||key==='so_thickness_mm')return fixed(value,3);
  if(key==='width_mm'||key==='so_width_mm')return fixed(value,0);
  if(key==='batch_qty_mt'||key==='so_min_wt_mt'||key==='so_max_wt_mt')return fixed(value,3);
  if(chemistryKeys.has(key))return fixed(value,3);
  if(key==='stock_status')return String(value).replaceAll('_',' ');
  return value;
}

export default function PlantStockReport(){
  const[plant,setPlant]=useState(selectedPlant());
  const[rows,setRows]=useState<any[]>([]);
  const[options,setOptions]=useState<any>({});
  const[filters,setFilters]=useState({...emptyFilters});
  const[appliedFilters,setAppliedFilters]=useState({...emptyFilters});
  const[loading,setLoading]=useState(false);
  const[exporting,setExporting]=useState(false);
  const[page,setPage]=useState(0);
  const[total,setTotal]=useState(0);
  const[totalQtyMt,setTotalQtyMt]=useState(0);

  const layout=useReportLayout(SCREEN_CODE,inventoryMasterReportColumns,{
    pageSizes:PAGE_SIZES,defaultPageSize:200,
    onLayoutChange:(size)=>load(appliedFilters,0,size)
  });

  useEffect(()=>subscribePlantChange(setPlant),[]);

  function queryString(f=appliedFilters,extra:Record<string,string|number>={}){
    const params=new URLSearchParams();
    const p=plantQueryParam();
    if(p){const [k,v]=p.split('=');params.set(k,decodeURIComponent(v||''))}
    Object.entries(f).forEach(([k,v])=>{if(String(v).trim())params.set(k,String(v).trim())});
    Object.entries(extra).forEach(([k,v])=>params.set(k,String(v)));
    return params.toString();
  }

  async function load(f=appliedFilters,nextPage=page,nextPageSize=layout.pageSize){
    try{
      setLoading(true);
      const qs=queryString(f,{limit:nextPageSize,offset:nextPage*nextPageSize});
      const result=await api(`/reports/plant-stock?${qs}`);
      setRows(result.rows||[]);
      setTotal(Number(result.total ?? result.summary?.total_records ?? 0));
      setTotalQtyMt(Number(result.summary?.total_qty_mt ?? 0));
      setPage(nextPage);
    }finally{setLoading(false)}
  }

  async function loadOptions(){
    try{
      const p=plantQueryParam();
      const result=await api(`/reports/plant-stock/filters${p?`?${p}`:''}`);
      setOptions(result||{});
    }catch{setOptions({});}
  }

  useEffect(()=>{
    const f={...emptyFilters};
    setFilters(f);setAppliedFilters(f);setPage(0);
    load(f,0,layout.pageSize).finally(()=>{void loadOptions()});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[plant]);

  function search(){const f={...filters};setAppliedFilters(f);load(f,0,layout.pageSize)}
  function reset(){const f={...emptyFilters};setFilters(f);setAppliedFilters(f);load(f,0,layout.pageSize)}
  const set=(key:string)=>(e:any)=>setFilters(f=>({...f,[key]:e.target.value}));

  async function download(){
    try{
      setExporting(true);
      const qs=queryString(appliedFilters,{all:1});
      const result=await api(`/reports/plant-stock?${qs}`);
      downloadInventoryMasterReport(result.rows||[],`Plant_Stock_Report_${plant}_${new Date().toISOString().slice(0,10)}.csv`);
    }finally{setExporting(false)}
  }

  function changePageSize(e:any){const size=Number(e.target.value)||200;layout.setPageSize(size);load(appliedFilters,0,size)}
  const first=total===0?0:page*layout.pageSize+1;
  const last=Math.min((page+1)*layout.pageSize,total);
  const pages=Math.max(1,Math.ceil(total/layout.pageSize));

  return <div className="plant-stock-page-v099">
    <PageHeader
      title="Plant Stock Report"
      actions={<div className="rm-report-actions">
        <ReportLayoutBar title="Plant Stock Report" state={layout}/>
        <button className="secondary-btn compact-report-download" onClick={download} disabled={exporting}><Download size={15}/>{exporting?'Preparing…':'Download'}</button>
      </div>}
    />

    <ReportSummaryBar count={total} qty={totalQtyMt}/>

    <div className="plant-stock-compact-filters">
      <input autoComplete="off" value={filters.materialCode} onChange={set('materialCode')} placeholder="Material Code" aria-label="Material Code"/>
      <select value={filters.storageLocation} onChange={set('storageLocation')} aria-label="Storage Location"><option value="">Storage Location: All</option>{(options.storage_locations||[]).map((x:string)=><option key={x} value={x}>{x}</option>)}</select>
      <select value={filters.category} onChange={set('category')} aria-label="Category"><option value="">Category: All</option><option>RM</option><option>WIP</option><option>FG</option></select>
      <input autoComplete="off" value={filters.thickness} onChange={set('thickness')} inputMode="decimal" placeholder="Thickness" aria-label="Thickness"/>
      <input autoComplete="off" value={filters.heatNo} onChange={set('heatNo')} placeholder="Heat No" aria-label="Heat No"/>
      <input autoComplete="off" list="ps-steel-v099" value={filters.steelGrade} onChange={set('steelGrade')} placeholder="Steel Grade" aria-label="Steel Grade"/><datalist id="ps-steel-v099">{(options.steel_grades||[]).map((x:string)=><option key={x} value={x}/>)}</datalist>
      <select value={filters.qualityGrade} onChange={set('qualityGrade')} aria-label="Quality Grade"><option value="">QA Grade: All</option>{(options.quality_grades||[]).map((x:string)=><option key={x} value={x}>{x}</option>)}</select>
      <button className="secondary-btn plant-stock-search" onClick={search} disabled={loading}>{loading?<RefreshCw size={15} className="spin"/>:'Search'}</button>
      <button className="ghost-btn plant-stock-reset" onClick={reset} title="Reset filters" aria-label="Reset filters"><RotateCcw size={15}/></button>
    </div>

    <div className={`table-panel inventory-report-panel plant-stock-max-table ${loading?'is-loading':''}`}>
      <div className="responsive-table inventory-report-scroll">
        {loading&&<div className="plant-stock-loading-overlay"><RefreshCw size={25} className="spin"/><b>Loading plant stock…</b><span>Fetching only the current page for a faster response.</span></div>}
        <table className="inventory-master-report-table plant-stock-report-table">
          <thead><tr>{layout.visibleColumns.map(([label])=><th key={label}>{label}</th>)}</tr></thead>
          <tbody>{rows.map(r=><tr key={r.inventory_id} className={`stage-${String(r.stock_stage||'').toLowerCase()}`}>
            {layout.visibleColumns.map(([label,key])=><td key={key} title={String(display(String(key),r[key])??'')}>{display(String(key),r[key])}</td>)}
          </tr>)}</tbody>
        </table>
        {!loading&&!rows.length&&<Empty text="No plant stock found for the selected filters"/>}
      </div>
      <div className="inventory-report-footer plant-stock-pagination-footer">
        <span>{total?`${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} records`:'0 records'} · {layout.visibleColumns.length}/{inventoryMasterReportColumns.length} columns</span>
        <div className="plant-stock-pagination-controls">
          <label>Rows <select value={layout.pageSize} onChange={changePageSize}>{PAGE_SIZES.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
          <button className="ghost-btn compact-btn" disabled={loading||page<=0} onClick={()=>load(appliedFilters,page-1,layout.pageSize)}><ChevronLeft size={15}/></button>
          <b>{page+1} / {pages}</b>
          <button className="ghost-btn compact-btn" disabled={loading||page+1>=pages} onClick={()=>load(appliedFilters,page+1,layout.pageSize)}><ChevronRight size={15}/></button>
        </div>
      </div>
    </div>
  </div>;
}
