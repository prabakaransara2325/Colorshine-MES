import { useNavigate } from 'react-router-dom';
import { ArrowRight, Construction, LayoutDashboard } from 'lucide-react';
import { moduleByCode } from '../navigation';

export default function ModuleDashboard({moduleCode}:{moduleCode:string}){
  const navigate=useNavigate();
  const mod=moduleByCode(moduleCode);
  if(!mod)return null;
  const transactionScreens=mod.screens.filter(s=>s.route!==mod.route);
  const ModuleIcon=mod.icon;

  return <>
    <div className="page-header module-page-header">
      <div>
        <div className="screen-title-kicker">MODULE {mod.number} · {mod.code}</div>
        <h1>{mod.name} Dashboard</h1>
        <p>{mod.description}.</p>
      </div>
    </div>

    <section className="module-dashboard-hero">
      <div className="module-dashboard-icon"><ModuleIcon size={32}/></div>
      <div>
        <span>Module Dashboard</span>
        <h2>{mod.name}</h2>
        <p>The dashboard shell is ready. Operational KPIs will be activated as each {mod.name.toLowerCase()} process is implemented.</p>
      </div>
    </section>

    <section className="module-screen-section">
      <div className="module-section-title"><div><h3>Available screens</h3><p>Open a transaction by screen number or from this list.</p></div></div>
      <div className="module-screen-grid">
        {transactionScreens.length?transactionScreens.map(s=>{const Icon=s.icon;return <button key={s.screenNo} className="module-screen-card" onClick={()=>navigate(s.route)}>
          <span className="module-screen-icon"><Icon size={22}/></span>
          <span className="module-screen-copy"><small>SCREEN {s.screenNo}</small><b>{s.title}</b></span>
          <ArrowRight size={18}/>
        </button>}):<div className="module-empty-state"><Construction size={26}/><div><b>Process screens will be added next</b><span>The module dashboard is registered as Screen {mod.screens[0]?.screenNo}.</span></div></div>}
      </div>
    </section>
  </>;
}
