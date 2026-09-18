import { useEffect,useMemo,useState } from 'react';
import { api, plantQueryParam, selectedPlant, subscribePlantChange } from '../lib/api';
import { ArrowRight, BellRing, Star, X } from 'lucide-react';
import {Empty,PageHeader,Status,num} from '../components/UI';
import { moduleByCode, screenByCode } from '../navigation';

type FavoriteRow={
  favorite_id:string;
  screen_code:string;
  screen_no:string;
  screen_name:string;
  route_path:string;
  module_code:string;
  module_name:string;
};

export default function Dashboard(){
  const[d,setD]=useState<any>({});
  const[recent,setRecent]=useState<any[]>([]);
  const[favorites,setFavorites]=useState<FavoriteRow[]>([]);
  const[plant,setPlant]=useState(selectedPlant());
  const openMesScreen=(screenCode:string,route:string)=>window.dispatchEvent(new CustomEvent('mes:open-screen',{detail:{screenCode,route}}));

  const loadFavorites=()=>api('/user/favorites').then(x=>setFavorites(x.rows||[])).catch(console.error);

  useEffect(()=>subscribePlantChange(setPlant),[]);
  useEffect(()=>{
    const q=plantQueryParam();
    api(`/dashboard/summary${q?`?${q}`:''}`).then(setD).catch(console.error);
    api(`/grn?limit=6${q?`&${q}`:''}`).then(x=>setRecent(x.rows||[])).catch(console.error);
  },[plant]);
  useEffect(()=>{
    loadFavorites();
    const h=()=>loadFavorites();
    window.addEventListener('mes:favorites-changed',h);
    return()=>window.removeEventListener('mes:favorites-changed',h);
  },[]);

  const removeFavorite=async(screenCode:string)=>{
    await api(`/user/favorites/${encodeURIComponent(screenCode)}`,{method:'DELETE'});
    setFavorites(x=>x.filter(f=>f.screen_code!==screenCode));
    window.dispatchEvent(new CustomEvent('mes:favorites-changed'));
  };

  const favoriteTiles=useMemo(()=>favorites.map(f=>{
    const local=screenByCode(f.screen_code);
    const mod=moduleByCode(f.module_code);
    return {...f,icon:local?.icon,moduleNo:mod?.number};
  }),[favorites]);

  return <>
    <PageHeader title="Manufacturing Overview" subtitle="Current raw-material receipt, quality and inventory position."/>

    <section className="favorites-island" aria-label="My Favorites">
      <div className="favorites-island-head">
        <div className="favorites-title"><span className="favorites-star"><Star size={17} fill="currentColor"/></span><div><h3>My Favorites</h3><p>Your personal shortcuts to frequently used MES screens.</p></div></div>
        <span className="favorites-count">{favorites.length}/8</span>
      </div>
      {favoriteTiles.length?<div className="favorite-tile-grid">
        {favoriteTiles.map(f=>{
          const Icon=f.icon;
          return <div key={f.favorite_id} className="favorite-tile" data-module={f.module_code}>
            <button className="favorite-open" onClick={()=>openMesScreen(f.screen_code,f.route_path)} title={`Open Screen ${f.screen_no} - ${f.screen_name}`}>
              <span className="favorite-icon">{Icon?<Icon size={20}/>:<Star size={20}/>}</span>
              <span className="favorite-copy"><small>{f.module_name} · SCREEN {f.screen_no}</small><b>{f.screen_name}</b></span>
              <ArrowRight size={17} className="favorite-arrow"/>
            </button>
            <button className="favorite-remove" onClick={()=>removeFavorite(f.screen_code)} aria-label={`Remove ${f.screen_name} from favorites`} title="Remove from Favorites"><X size={14}/></button>
          </div>
        })}
      </div>:<div className="favorites-empty"><div><Star size={19}/><span>No favorite screens selected yet.</span></div><button onClick={()=>window.dispatchEvent(new CustomEvent('mes:open-launcher'))}>Choose Favorites</button></div>}
    </section>

    <div className="dashboard-grid dashboard-grid-v3">
      <section className="panel dashboard-panel">
        <div className="panel-title panel-title-spread"><div><h3>Recent GRN coils</h3><p>Latest receipts available in MES.</p></div><button className="secondary-btn compact-btn" onClick={()=>openMesScreen('RMS_GRN_MONITOR','/grn')}>View All</button></div>
        <div className="responsive-table compact-table"><table><thead><tr><th>GRN</th><th>Batch</th><th>Supplier</th><th>Material</th><th>Weight</th><th>Quality</th></tr></thead><tbody>
          {recent.map(r=><tr key={r.grn_coil_id}><td><b>{r.sap_grn_no}</b></td><td>{r.batch_no}</td><td>{r.supplier_name||'—'}</td><td>{r.sap_material_code}</td><td>{num(r.batch_weight_mt)} MT</td><td><Status value={r.quality_status}/></td></tr>)}
        </tbody></table>{!recent.length&&<Empty text="No GRN records yet"/>}</div>
        <div className="dashboard-mobile-list">{recent.map(r=><div className="dashboard-row-card" key={r.grn_coil_id}><div><b>{r.batch_no}</b><small>{r.sap_grn_no}</small></div><div><span>{r.supplier_name||'—'}</span><strong>{num(r.batch_weight_mt)} MT</strong></div><Status value={r.quality_status}/></div>)}</div>
      </section>

      <section className="panel dashboard-panel attention-panel">
        <div className="panel-title"><div className="panel-title-icon"><BellRing size={18}/><div><h3>Execution attention</h3><p>Items requiring operational follow-up.</p></div></div></div>
        <div className="attention-list">
          <div><span>Pending RM Usage Decision</span><b>{d.pending_batches??0} batches</b></div>
          <div><span>Quality-hold stock</span><b>{num(d.quality_hold_mt)} MT</b></div>
          <div><span>Blocked stock</span><b>{num(d.blocked_mt)} MT</b></div>
          <div className="attention-positive"><span>Production-ready RM</span><b>{num(d.available_mt)} MT</b></div>
        </div>
      </section>
    </div>
  </>
}
