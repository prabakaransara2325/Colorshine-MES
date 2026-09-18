import {useEffect,useMemo,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {
  AlertTriangle,ArrowRight,Boxes,Building2,CheckCircle2,Database,Factory,GitBranch,
  ListChecks,RefreshCw,Ruler,SlidersHorizontal
} from 'lucide-react';
import {api} from '../lib/api';
import {PageHeader,Status} from '../components/UI';

type Overview={
  materials?:{total:number;active:number;inactive:number};
  workCenters?:{total:number;active:number;capacity_milestones:number};
  operations?:{total:number;active:number};
  thickness?:{total:number;active_valid:number;review:number;inactive:number;bad_tolerance_rows:number};
  routes?:{total:number;active_valid:number;review:number;inactive:number};
  groupCodes?:{total:number;active:number};
  plants?:Array<{company_code:string;plant_code:string;plant_name:string;work_centers:number;operations:number}>;
  toleranceRuleMm?:number;
  generatedAt?:string;
};

const n=(v:any)=>Number(v||0).toLocaleString('en-IN');

export default function MastersDashboard(){
  const nav=useNavigate();
  const[data,setData]=useState<Overview>({});
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState('');

  const load=async()=>{setLoading(true);setError('');try{setData(await api('/masters/overview'))}catch(e:any){setError(e.message||'Unable to load master summary');setData({})}finally{setLoading(false)}};
  useEffect(()=>{void load()},[]);
  const ready=Boolean(data.generatedAt);

  const cards=useMemo(()=>[
    {screen:'7106',title:'Material Master',description:'RM, WIP and FG material structure',route:'/masters/materials',icon:Boxes,total:data.materials?.total??null,meta:ready?`${n(data.materials?.active)} active`:'Awaiting data'},
    {screen:'7102',title:'Work Center Master',description:'Plant-specific work centers and capacity milestones',route:'/masters/work-centers',icon:Factory,total:data.workCenters?.total??null,meta:ready?`${n(data.workCenters?.capacity_milestones)} capacity milestones`:'Awaiting data'},
    {screen:'7105',title:'Operation Master',description:'Operations assigned to work centers',route:'/masters/operations',icon:ListChecks,total:data.operations?.total??null,meta:ready?`${n(data.operations?.active)} active`:'Awaiting data'},
    {screen:'7101',title:'Thickness Matrix',description:'Planning thickness targets and controlled tolerances',route:'/masters/thickness-matrix',icon:Ruler,total:data.thickness?.total??null,meta:ready?`${n(data.thickness?.active_valid)} valid · ${n(data.thickness?.review)} review`:'Awaiting data'},
    {screen:'7107',title:'Route Master',description:'Finished-material process paths and material genealogy',route:'/masters/routes',icon:GitBranch,total:data.routes?.total??null,meta:ready?`${n(data.routes?.active_valid)} valid · ${n(data.routes?.review)} review`:'Awaiting data'},
    {screen:'7104',title:'Group Code & Controls',description:'Dynamic runtime, validation and screen-control parameters',route:'/masters/group-codes',icon:SlidersHorizontal,total:data.groupCodes?.total??null,meta:ready?`${n(data.groupCodes?.active)} active`:'Awaiting data'},
    {screen:'7103',title:'Work Center Tolerance',description:'Work-center limits used by production and quality',route:'/masters/work-center-tolerance',icon:Database,total:null,meta:'Open matrix'},
  ],[data,ready]);

  const toleranceOk=ready&&(data.thickness?.bad_tolerance_rows??0)===0;

  return <div className="masters-control-page">
    <PageHeader title="Masters Control Center" subtitle="Live master-data visibility for Planning, Production and Quality." actions={<button className="secondary-btn masters-refresh" onClick={()=>void load()} disabled={loading}><RefreshCw size={16}/>{loading?'Refreshing…':'Refresh'}</button>}/>

    {error&&<div className="masters-dashboard-alert error"><AlertTriangle size={18}/><div><b>Master summary could not be loaded</b><span>{error}</span></div></div>}

    {ready&&<div className={`masters-validation-banner ${toleranceOk?'good':'warn'}`}>
      {toleranceOk?<CheckCircle2 size={20}/>:<AlertTriangle size={20}/>}<div><b>{toleranceOk?'Thickness tolerance validation passed':'Thickness tolerance needs review'}</b><span>GL/CR target tolerance rule: ±{Number(data.toleranceRuleMm??0.005).toFixed(3)} mm · Exceptions: {n(data.thickness?.bad_tolerance_rows)}</span></div>
      <Status value={toleranceOk?'VALID':'REVIEW'}/>
    </div>}

    <section className="masters-section-card">
      <div className="masters-section-head"><div><span>MANUFACTURING MASTERS</span><h2>Open a master</h2><p>The record count is live from PostgreSQL, so you can confirm data availability before entering a screen.</p></div></div>
      <div className="masters-live-grid">
        {cards.map(c=>{const Icon=c.icon;return <button key={c.screen} className="masters-live-card" onClick={()=>nav(c.route)}>
          <div className="masters-live-icon"><Icon size={21}/></div>
          <div className="masters-live-copy"><small>SCREEN {c.screen}</small><b>{c.title}</b><span>{c.description}</span></div>
          <div className="masters-live-count">{c.total===null?(ready?'OPEN':'—'):loading||!ready?'—':n(c.total)}<small>{c.meta}</small></div>
          <ArrowRight className="masters-live-arrow" size={18}/>
        </button>})}
      </div>
    </section>

    <section className="masters-section-card compact-card masters-plant-section">
      <div className="masters-section-head"><div><span>PLANT SCOPE</span><h2>Master coverage by plant</h2></div></div>
      <div className="masters-plant-list">{(data.plants||[]).map(p=><div key={p.plant_code}><span className="masters-plant-code"><Building2 size={16}/>{p.plant_code}</span><div><b>{p.plant_name}</b><small>Company {p.company_code}</small></div><strong>{n(p.work_centers)} WC</strong><strong>{n(p.operations)} OP</strong></div>)}{!loading&&!(data.plants||[]).length&&<p>No authorized plants found.</p>}</div>
      <small className="masters-last-refresh">{data.generatedAt?`Last refreshed ${new Date(data.generatedAt).toLocaleString('en-IN')}`:'Live database'}</small>
    </section>
  </div>;
}
