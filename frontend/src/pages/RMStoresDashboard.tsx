import {useEffect,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {ArrowRight} from 'lucide-react';
import {api,plantQueryParam,selectedPlant,subscribePlantChange} from '../lib/api';
import {Empty,PageHeader,num,plain} from '../components/UI';
import {moduleByCode} from '../navigation';

export default function RMStoresDashboard(){
  const navigate=useNavigate();
  const[plant,setPlant]=useState(selectedPlant());
  const[data,setData]=useState<any>({summary:{},recent:[]});
  const mod=moduleByCode('RMS');
  const stockDate=(v:any)=>{if(!v)return '—';const x=String(v).slice(0,10);const [y,m,d]=x.split('-');return y&&m&&d?`${d}-${m}-${y}`:String(v)};

  useEffect(()=>subscribePlantChange(setPlant),[]);
  useEffect(()=>{
    const q=plantQueryParam();
    api(`/dashboard/rm-stores${q?`?${q}`:''}`).then(setData).catch(console.error);
  },[plant]);

  const s=data.summary||{};
  const screens=(mod?.screens||[]).filter(x=>x.route!==mod?.route);

  return <>
    <PageHeader
      title="RM Stores Dashboard"
      subtitle="Plant 2000 raw-material position from one-time opening inventory plus live MES GRNs."
    />

    <section className="module-screen-section">
      <div className="module-section-title">
        <div><h3>RM Stores screens</h3><p>Open the required RM Stores transaction or report.</p></div>
      </div>
      <div className="module-screen-grid">
        {screens.map(screen=>{
          const Icon=screen.icon;
          return <button key={screen.screenNo} className="module-screen-card" onClick={()=>navigate(screen.route)}>
            <span className="module-screen-icon"><Icon size={22}/></span>
            <span className="module-screen-copy"><small>SCREEN {screen.screenNo}</small><b>{screen.title}</b></span>
            <ArrowRight size={18}/>
          </button>;
        })}
      </div>
    </section>

    <section className="panel dashboard-panel">
      <div className="panel-title panel-title-spread">
        <div><h3>Recent RM inventory</h3><p>Opening stock and live GRN stock use one unified RM Stores source.</p></div>
        <button className="secondary-btn compact-btn" onClick={()=>navigate('/inventory')}>View RM Inventory</button>
      </div>
      <div className="responsive-table compact-table">
        <table>
          <thead><tr><th>Batch</th><th>Material</th><th>Storage</th><th>Thickness (mm)</th><th>Width (mm)</th><th>Qty</th><th>Supplier</th><th>QA Grade</th><th>Stock Date</th><th>Age</th></tr></thead>
          <tbody>
            {(data.recent||[]).map((r:any)=><tr key={r.inventory_id}>
              <td><b>{r.batch_no}</b></td>
              <td>{r.material_code}</td>
              <td>{r.storage_location||'—'}</td>
              <td>{r.thickness_mm?plain(r.thickness_mm,3):'—'}</td>
              <td>{r.width_mm?plain(r.width_mm,0):'—'}</td>
              <td>{num(r.batch_qty_mt)} MT</td>
              <td>{r.rm_supplier||'—'}</td>
              <td>{r.qa_grade||'PENDING_QA'}</td>
              <td>{stockDate(r.stock_generated_date)}</td>
              <td>{r.stock_age_days??'—'} days</td>
            </tr>)}
          </tbody>
        </table>
        {!(data.recent||[]).length&&<Empty text="No RM inventory available"/>}
      </div>
      <div className="inventory-report-footer">
        <span>{s.grns??0} referenced GRNs · {s.suppliers??0} suppliers</span>
        <span>{s.pending_qa_coils??0} coils pending QA enrichment</span>
      </div>
    </section>
  </>;
}
