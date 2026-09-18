import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Building2, CalendarDays, ChevronDown, Grid3X3, Hash, KeyRound,
  LockKeyhole, LogOut, Search, ShieldCheck, Star, UserCircle2, X
} from 'lucide-react';
import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api, clearSession, currentUser, selectedPlant, setSelectedPlant, updateCurrentUser } from '../lib/api';
import { adminScreens, allScreens, moduleByCode, modules, overviewScreen, screenByCode, screenByNo, screenByPath, type MesScreen } from '../navigation';

type WorkingScreenRow={
  working_screen_id:string;
  screen_id:string;
  screen_code:string;
  screen_no:string;
  screen_name:string;
  screen_type:string;
  route_path:string;
  module_code:string;
  module_name:string;
  opened_at:string;
  last_active_at:string;
  sequence_no:number;
};

const MAX_WORKING_SCREENS=8;
const isWorkingScreen=(screen:MesScreen)=>screen.screenCode!=='MES_OVERVIEW'&&!screen.screenCode.endsWith('_DASHBOARD');

const makeLocalWorkingRow=(screen:MesScreen,sequenceNo:number):WorkingScreenRow=>{
  const mod=moduleByCode(screen.moduleCode);
  const stamp=new Date().toISOString();
  return {
    working_screen_id:`local:${screen.screenCode}`,screen_id:'',screen_code:screen.screenCode,
    screen_no:screen.screenNo,screen_name:screen.title,screen_type:'TRANSACTION',route_path:screen.route,
    module_code:screen.moduleCode,module_name:mod?.name??(screen.moduleCode==='ADM'?'Administration':'MES'),
    opened_at:stamp,last_active_at:stamp,sequence_no:sequenceNo
  };
};

export default function Shell(){
  const [launcherOpen,setLauncherOpen]=useState(false);
  const [selectedModule,setSelectedModule]=useState('RMS');
  const [userOpen,setUserOpen]=useState(false);
  const [plantOpen,setPlantOpen]=useState(false);
  const [screenOpen,setScreenOpen]=useState(false);
  const [screenInput,setScreenInput]=useState('');
  const [screenSearch,setScreenSearch]=useState('');
  const [user,setUser]=useState<any>(currentUser());
  const [plant,setPlant]=useState(selectedPlant());
  const [now,setNow]=useState(()=>new Date());
  const [favoriteCodes,setFavoriteCodes]=useState<Set<string>>(new Set());
  const [favoriteBusy,setFavoriteBusy]=useState<string>('');
  const [favoriteMessage,setFavoriteMessage]=useState('');
  const [workingScreens,setWorkingScreens]=useState<WorkingScreenRow[]>([]);
  const [workingLoaded,setWorkingLoaded]=useState(false);
  const [workingBusy,setWorkingBusy]=useState<string>('');
  const [workingMessage,setWorkingMessage]=useState('');
  const [limitTarget,setLimitTarget]=useState<MesScreen|null>(null);
  const [dirtyScreens,setDirtyScreens]=useState<Set<string>>(new Set());
  const nav=useNavigate();
  const location=useLocation();
  const lastAcceptedRoute=useRef(location.pathname);
  const routeGuardBusy=useRef(false);
  // Guards against a slow/stale working-screens POST response overwriting a newer
  // optimistic tab list (e.g. opening screen A, then immediately clicking an
  // already-open tab B before A's persist call returns - whichever response lands
  // last used to win, silently dropping the other tab from the bar).
  const workingSyncSeq=useRef(0);
  const currentScreen=useMemo(()=>screenByPath(location.pathname),[location.pathname]);
  const currentModule=moduleByCode(currentScreen.moduleCode);
  const currentModuleName=currentModule?.name ?? (currentScreen.moduleCode==='ADM'?'Administration':'MES');
  const initials=useMemo(()=>String(user?.displayName||user?.username||'U').trim().charAt(0).toUpperCase(),[user]);
  const isAdmin=(user?.roles||[]).includes('ADMIN') || (user?.accessGroups||[]).some((g:any)=>g.groupCode==='SYSTEM_ADMIN');
  const plants=user?.authorizedPlants||[];
  const canAll=Boolean(user?.canViewConsolidated)&&plants.length>1;

  const loadFavorites=()=>api('/user/favorites').then(d=>{
    setFavoriteCodes(new Set((d.rows||[]).map((x:any)=>String(x.screen_code))));
  }).catch(()=>{});

  const workingCacheKey=()=>`mes_working_screens_${String((currentUser()||user)?.username||'USER').trim().toUpperCase()}`;
  const normalizeWorkingRows=(rows:any[]):WorkingScreenRow[]=>(rows||[]).map((r:any,index:number)=>({
    working_screen_id:String(r.working_screen_id||`local:${r.screen_code||index}`),screen_id:String(r.screen_id||''),screen_code:String(r.screen_code||''),
    screen_no:String(r.screen_no||''),screen_name:String(r.screen_name||''),screen_type:String(r.screen_type||'TRANSACTION'),
    route_path:String(r.route_path||'/'),module_code:String(r.module_code||''),module_name:String(r.module_name||''),
    opened_at:String(r.opened_at||new Date().toISOString()),last_active_at:String(r.last_active_at||new Date().toISOString()),sequence_no:Number(r.sequence_no||((index+1)*10))
  })).filter(r=>{const local=screenByCode(r.screen_code);return Boolean(local&&isWorkingScreen(local))}).slice(0,MAX_WORKING_SCREENS);
  const readWorkingCache=():WorkingScreenRow[]=>{try{return normalizeWorkingRows(JSON.parse(localStorage.getItem(workingCacheKey())||'[]'))}catch{return []}};
  const applyWorkingRows=(rows:any[])=>{const normalized=normalizeWorkingRows(rows);setWorkingScreens(normalized);try{localStorage.setItem(workingCacheKey(),JSON.stringify(normalized))}catch{};return normalized};

  const loadWorkingScreens=()=>{
    const cached=readWorkingCache();
    if(cached.length)setWorkingScreens(cached);
    return api('/user/working-screens').then(async d=>{
      if(d?.storageReady===false){setWorkingLoaded(true);return}
      const remote=normalizeWorkingRows(d.rows||[]);
      if(!remote.length&&cached.length){
        // Restore the user's locally remembered tabs to PostgreSQL after a backend/migration restart.
        for(const row of cached){try{await api('/user/working-screens',{method:'POST',body:JSON.stringify({screenCode:row.screen_code})})}catch{break}}
        try{const synced=await api('/user/working-screens');if(synced?.storageReady!==false)applyWorkingRows(synced.rows||cached);else applyWorkingRows(cached)}catch{applyWorkingRows(cached)}
      }else applyWorkingRows(remote);
      setWorkingLoaded(true);
    }).catch(()=>{applyWorkingRows(cached);setWorkingLoaded(true)});
  };

  useEffect(()=>{
    setScreenInput(currentScreen.screenNo);
    if(currentScreen.moduleCode!=='MES'&&currentScreen.moduleCode!=='ADM')setSelectedModule(currentScreen.moduleCode);
  },[currentScreen]);

  useEffect(()=>{
    api('/auth/me').then(d=>{
      const fresh=d.user;setUser(fresh);updateCurrentUser(fresh);
      const valid=(fresh.authorizedPlants||[]).some((p:any)=>p.plantCode===selectedPlant());
      if(selectedPlant()==='ALL'&&!fresh.canViewConsolidated){const first=fresh.authorizedPlants?.[0]?.plantCode||'';if(first){setPlant(first);setSelectedPlant(first)}}
      else if(selectedPlant()!=='ALL'&&!valid){const first=fresh.authorizedPlants?.[0]?.plantCode||'';if(first){setPlant(first);setSelectedPlant(first)}}
    }).catch(()=>{});
    loadFavorites();
    loadWorkingScreens();
  },[]);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),30000);return()=>window.clearInterval(timer)},[]);
  useEffect(()=>{
    const close=()=>{setPlantOpen(false);setUserOpen(false);setScreenOpen(false)};
    window.addEventListener('click',close);return()=>window.removeEventListener('click',close)
  },[]);
  useEffect(()=>{
    const openLauncher=()=>{setLauncherOpen(true);setPlantOpen(false);setUserOpen(false);setScreenOpen(false)};
    const refreshFavorites=()=>loadFavorites();
    const openRequested=(e:any)=>{
      const route=String(e?.detail?.route||'');
      const screen=screenByCode(e?.detail?.screenCode)||screenByPath(route||'/');
      if(screen) void openScreen(route||screen);
    };
    const dirtyChanged=(e:any)=>{
      const code=String(e?.detail?.screenCode||'').toUpperCase();if(!code)return;
      setDirtyScreens(prev=>{const n=new Set(prev);if(e?.detail?.dirty===false)n.delete(code);else n.add(code);return n});
    };
    window.addEventListener('mes:open-launcher',openLauncher);
    window.addEventListener('mes:favorites-changed',refreshFavorites);
    window.addEventListener('mes:open-screen',openRequested);
    window.addEventListener('mes:screen-dirty',dirtyChanged);
    return()=>{
      window.removeEventListener('mes:open-launcher',openLauncher);
      window.removeEventListener('mes:favorites-changed',refreshFavorites);
      window.removeEventListener('mes:open-screen',openRequested);
      window.removeEventListener('mes:screen-dirty',dirtyChanged);
    };
  });

  // Direct URL/browser navigation is guarded too. The tab is created locally first so
  // navigation still works if the preference table is temporarily unavailable; server sync
  // resumes automatically after the migration/backend is healthy.
  useEffect(()=>{
    if(!workingLoaded||!isWorkingScreen(currentScreen)||routeGuardBusy.current)return;
    const existing=workingScreens.some(x=>x.screen_code===currentScreen.screenCode);
    if(existing){
      lastAcceptedRoute.current=location.pathname;
      const seq=++workingSyncSeq.current;
      void api('/user/working-screens',{method:'POST',body:JSON.stringify({screenCode:currentScreen.screenCode})})
        .then(d=>{if(seq===workingSyncSeq.current&&d?.storageReady!==false&&d.rows)applyWorkingRows(d.rows)}).catch(()=>{});
      return;
    }
    if(workingScreens.length>=MAX_WORKING_SCREENS){
      setLimitTarget(currentScreen);
      const fallback=workingScreens[workingScreens.length-1]?.route_path||lastAcceptedRoute.current||'/';
      if(fallback!==location.pathname)nav(fallback,{replace:true});
      return;
    }
    routeGuardBusy.current=true;
    const seq=++workingSyncSeq.current;
    const optimistic=applyWorkingRows([...workingScreens,makeLocalWorkingRow(currentScreen,(workingScreens.length+1)*10)]);
    lastAcceptedRoute.current=location.pathname;
    api('/user/working-screens',{method:'POST',body:JSON.stringify({screenCode:currentScreen.screenCode})})
      .then(d=>{if(seq===workingSyncSeq.current&&d?.storageReady!==false&&d.rows)applyWorkingRows(d.rows)})
      .catch((err:any)=>{
        if(seq!==workingSyncSeq.current)return;
        if(err?.code==='MAX_WORKING_SCREENS'||err?.status===409){
          if(err?.data?.rows)applyWorkingRows(err.data.rows);else applyWorkingRows(optimistic.filter(x=>x.screen_code!==currentScreen.screenCode));
          setLimitTarget(currentScreen);
          const fallback=workingScreens[workingScreens.length-1]?.route_path||lastAcceptedRoute.current||'/';
          if(fallback!==location.pathname)nav(fallback,{replace:true});
        }
        // 5xx/503 preference-storage failures intentionally keep the local working tab.
      })
      .finally(()=>{routeGuardBusy.current=false});
  },[currentScreen.screenCode,location.pathname,workingLoaded]);

  const logout=()=>{clearSession();nav('/login')};
  const selectPlant=(value:string)=>{setPlant(value);setSelectedPlant(value);setPlantOpen(false)};
  const plantLabel=(p:any)=>`${p.plantCode} - ${p.companyShortName||p.plantName||''}`;

  const openScreen=async(target:string|MesScreen)=>{
    const screen=typeof target==='string'?screenByPath(target):target;
    const route=typeof target==='string'?target:target.route;
    setLauncherOpen(false);setScreenOpen(false);
    if(!isWorkingScreen(screen)){lastAcceptedRoute.current=route;nav(route);return}

    const alreadyOpen=workingScreens.some(x=>x.screen_code===screen.screenCode);
    if(!alreadyOpen&&workingScreens.length>=MAX_WORKING_SCREENS){setLimitTarget(screen);return}

    setWorkingBusy(screen.screenCode);setWorkingMessage('');
    const seq=++workingSyncSeq.current;
    if(!alreadyOpen)applyWorkingRows([...workingScreens,makeLocalWorkingRow(screen,(workingScreens.length+1)*10)]);
    lastAcceptedRoute.current=route;
    nav(route);

    try{
      const d=await api('/user/working-screens',{method:'POST',body:JSON.stringify({screenCode:screen.screenCode})});
      if(seq===workingSyncSeq.current&&d?.storageReady!==false&&d.rows)applyWorkingRows(d.rows);
    }catch(err:any){
      if(seq!==workingSyncSeq.current)return;
      if(err?.code==='MAX_WORKING_SCREENS'||err?.status===409){
        if(err?.data?.rows)applyWorkingRows(err.data.rows);
        setLimitTarget(screen);
      }
      // A missing/out-of-date preference migration must never block the business screen.
      // Tabs remain functional from the per-user local cache until server persistence is restored.
    }finally{setWorkingBusy('')}
  };

  const jumpToScreen=async(e?:FormEvent)=>{
    e?.preventDefault();
    const screen=screenByNo(screenInput);
    if(screen){await openScreen(screen);setScreenInput(screen.screenNo)}
    else {setScreenOpen(true);setScreenSearch(screenInput)}
  };

  const closeWorkingScreen=async(row:WorkingScreenRow,suppressNavigation=false)=>{
    if(workingBusy)return false;
    if(dirtyScreens.has(row.screen_code)&&!window.confirm(`${row.screen_name} has unsaved changes. Close this working screen?`))return false;
    setWorkingBusy(row.screen_code);
    const seq=++workingSyncSeq.current;
    const oldRows=[...workingScreens];
    const localRows=applyWorkingRows(oldRows.filter(x=>x.screen_code!==row.screen_code));
    setDirtyScreens(prev=>{const n=new Set(prev);n.delete(row.screen_code);return n});
    if(!suppressNavigation&&currentScreen.screenCode===row.screen_code){
      const oldIndex=oldRows.findIndex(x=>x.screen_code===row.screen_code);
      const next=localRows[Math.min(oldIndex,Math.max(localRows.length-1,0))]||localRows[localRows.length-1];
      const route=next?.route_path||'/';lastAcceptedRoute.current=route;nav(route);
    }
    try{
      const d=await api(`/user/working-screens/${encodeURIComponent(row.screen_code)}`,{method:'DELETE'});
      if(seq===workingSyncSeq.current&&d?.storageReady!==false&&d.rows)applyWorkingRows(d.rows);
    }catch{}
    finally{setWorkingBusy('')}
    return true;
  };

  const closeAllWorkingScreens=async()=>{
    if(workingScreens.some(x=>dirtyScreens.has(x.screen_code))&&!window.confirm('One or more working screens have unsaved changes. Close all working screens?'))return;
    setWorkingBusy('ALL');++workingSyncSeq.current;applyWorkingRows([]);setDirtyScreens(new Set());if(isWorkingScreen(currentScreen)){lastAcceptedRoute.current='/';nav('/')}
    try{await api('/user/working-screens',{method:'DELETE'})}catch{}finally{setWorkingBusy('')}
  };

  const closeOtherWorkingScreens=async()=>{
    if(!isWorkingScreen(currentScreen)||!workingScreens.some(x=>x.screen_code===currentScreen.screenCode))return;
    const others=workingScreens.filter(x=>x.screen_code!==currentScreen.screenCode);
    if(others.some(x=>dirtyScreens.has(x.screen_code))&&!window.confirm('One or more other working screens have unsaved changes. Close them?'))return;
    setWorkingBusy('OTHERS');
    const seq=++workingSyncSeq.current;
    const keep=workingScreens.filter(x=>x.screen_code===currentScreen.screenCode);applyWorkingRows(keep);setDirtyScreens(prev=>new Set([...prev].filter(x=>x===currentScreen.screenCode)));
    try{const d=await api('/user/working-screens/close-others',{method:'POST',body:JSON.stringify({screenCode:currentScreen.screenCode})});if(seq===workingSyncSeq.current&&d?.storageReady!==false&&d.rows)applyWorkingRows(d.rows)}catch{}finally{setWorkingBusy('')}
  };

  const closeOneThenOpenRequested=async(row:WorkingScreenRow)=>{
    const target=limitTarget;if(!target)return;
    const closed=await closeWorkingScreen(row,true);if(!closed)return;
    setLimitTarget(null);await openScreen(target);
  };

  const filteredScreens=allScreens.filter(s=>{
    if(s.moduleCode==='ADM'&&!isAdmin)return false;
    const q=screenSearch.trim().toLowerCase();
    return !q || s.screenNo.includes(q) || s.title.toLowerCase().includes(q);
  }).slice(0,18);
  const activeModule=moduleByCode(selectedModule)||modules[0];
  const OverviewIcon=overviewScreen.icon;

  const toggleFavorite=async(screen:MesScreen,e?:MouseEvent)=>{
    e?.stopPropagation();
    if(favoriteBusy)return;
    const isFavorite=favoriteCodes.has(screen.screenCode);
    setFavoriteBusy(screen.screenCode);setFavoriteMessage('');
    try{
      if(isFavorite){
        await api(`/user/favorites/${encodeURIComponent(screen.screenCode)}`,{method:'DELETE'});
        setFavoriteCodes(prev=>{const n=new Set(prev);n.delete(screen.screenCode);return n});
        setFavoriteMessage(`${screen.title} removed from Favorites`);
      }else{
        await api('/user/favorites',{method:'POST',body:JSON.stringify({screenCode:screen.screenCode})});
        setFavoriteCodes(prev=>new Set(prev).add(screen.screenCode));
        setFavoriteMessage(`${screen.title} added to Favorites`);
      }
      window.dispatchEvent(new CustomEvent('mes:favorites-changed'));
    }catch(err:any){setFavoriteMessage(err?.message||'Unable to update Favorites')}
    finally{setFavoriteBusy('');window.setTimeout(()=>setFavoriteMessage(''),2600)}
  };

  const ScreenFavoriteButton=({screen,compact=false}:{screen:MesScreen,compact?:boolean})=>{
    const active=favoriteCodes.has(screen.screenCode);
    return <button type="button" className={`screen-favorite-button ${compact?'compact':''} ${active?'active':''}`} onClick={e=>toggleFavorite(screen,e)} disabled={favoriteBusy===screen.screenCode} aria-label={`${active?'Remove':'Add'} ${screen.title} ${active?'from':'to'} Favorites`} title={active?'Remove from Favorites':'Add to Favorites'}>
      <Star size={compact?14:16} fill={active?'currentColor':'none'}/>
    </button>;
  };

  const LauncherScreenCard=({screen,label}:{screen:MesScreen,label:string})=>{
    const Icon=screen.icon;
    return <div className="launcher-screen-card-shell" data-module={screen.moduleCode}>
      <button className="launcher-screen-open" onClick={()=>void openScreen(screen)} disabled={workingBusy===screen.screenCode}>
        <span className="launcher-screen-no">{screen.screenNo}</span><Icon size={22}/><div><b>{screen.title}</b><small>{label}</small></div><ArrowRight size={17}/>
      </button>
      <ScreenFavoriteButton screen={screen}/>
    </div>;
  };

  return <div className="app-shell full-shell">
    <main className="main full-main">
      <header className="topbar full-topbar">
        <div className="topbar-left">
          <button className="module-launcher-button" aria-label="Open MES modules" title="Modules" onClick={e=>{e.stopPropagation();setLauncherOpen(true);setPlantOpen(false);setUserOpen(false);setScreenOpen(false)}}>
            <Grid3X3 size={22}/>
          </button>
          <img className="topbar-logo" src="/brand/colorshine-logo.png" alt="Colorshine"/>
          <div className="topbar-title full-title">
            <div className="eyebrow">COLORSHINE GROUP</div>
            <b>MES Control Center</b>
          </div>
        </div>

        <div className="topbar-actions full-actions">
          <div className="screen-jump-wrap" onClick={e=>e.stopPropagation()}>
            <form className="screen-jump" onSubmit={jumpToScreen}>
              <Hash size={16}/><span>Screen</span>
              <input aria-label="Screen number" value={screenInput} maxLength={4} inputMode="numeric" onFocus={e=>{e.currentTarget.select();setScreenOpen(true);setScreenSearch('')}} onChange={e=>{const v=e.target.value.replace(/\D/g,'').slice(0,4);setScreenInput(v);setScreenSearch(v);setScreenOpen(true)}}/>
              <button type="submit" title="Open screen"><ArrowRight size={16}/></button>
            </form>
            {screenOpen&&<div className="screen-picker">
              <div className="screen-picker-search"><Search size={15}/><input placeholder="Search screen no. or name" value={screenSearch} onChange={e=>setScreenSearch(e.target.value)}/></div>
              <div className="screen-picker-list">{filteredScreens.map(s=><div className="screen-picker-row" key={s.screenCode}><button className="screen-picker-open" onClick={()=>void openScreen(s)}><span>{s.screenNo}</span><div><b>{s.title}</b><small>{moduleByCode(s.moduleCode)?.name ?? (s.moduleCode==='ADM'?'Administration':'MES')}</small></div></button><ScreenFavoriteButton screen={s} compact/></div>)}{!filteredScreens.length&&<p>No matching screen.</p>}</div>
            </div>}
          </div>

          <div className="header-datetime" aria-label="Current date and time"><CalendarDays size={18}/><div><b>{now.toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short',year:'numeric'})}</b><span>{now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})}</span></div></div>

          <div className="topbar-dropdown" onClick={e=>e.stopPropagation()}>
            {plants.length<=1&&!canAll ? <div className="dropdown-trigger plant-trigger plant-locked"><Building2 size={18}/><span>Plant</span><strong>{plants[0]?plantLabel(plants[0]):'No Access'}</strong><LockKeyhole size={14}/></div> : <>
              <button className="dropdown-trigger plant-trigger" onClick={()=>{setPlantOpen(x=>!x);setUserOpen(false);setScreenOpen(false)}}><Building2 size={18}/><span>Plant</span><strong>{plant==='ALL'?'ALL':plant}</strong><ChevronDown size={16}/></button>
              {plantOpen&&<div className="dropdown-menu plant-menu">{canAll&&<button className={plant==='ALL'?'selected':''} onClick={()=>selectPlant('ALL')}>ALL - Consolidated</button>}{plants.map((p:any)=><button key={p.plantCode} className={plant===p.plantCode?'selected':''} onClick={()=>selectPlant(p.plantCode)}>{plantLabel(p)}</button>)}</div>}
            </>}
          </div>

          <div className="topbar-dropdown" onClick={e=>e.stopPropagation()}>
            <button className="dropdown-trigger user-trigger" onClick={()=>{setUserOpen(x=>!x);setPlantOpen(false);setScreenOpen(false)}}><span className="user-avatar">{initials}</span><div className="user-meta"><strong>{user?.username||'USER'}</strong><small>{user?.displayName||'MES User'}</small></div><ChevronDown size={16}/></button>
            {userOpen&&<div className="dropdown-menu user-menu"><div className="dropdown-user-header"><UserCircle2 size={18}/><div><b>{user?.displayName||user?.username}</b><small>{(user?.accessGroups||[]).map((g:any)=>g.groupName).join(' · ')||(user?.roles||[]).join(' · ')||'User'}</small></div></div>{isAdmin&&<button onClick={()=>{setUserOpen(false);void openScreen('/admin/users')}}><ShieldCheck size={16}/> User Management</button>}<button onClick={()=>{setUserOpen(false);nav('/change-password')}}><KeyRound size={16}/> Change Password</button><button onClick={logout}><LogOut size={16}/> Sign out</button></div>}
          </div>
        </div>
      </header>

      {workingScreens.length>0&&<div className="working-screen-bar" aria-label="Open working screens">
        <div className="working-screen-tabs">
          {workingScreens.map(row=>{
            const local=screenByCode(row.screen_code);const Icon=local?.icon;const active=currentScreen.screenCode===row.screen_code;
            return <div className={`working-tab ${active?'active':''}`} data-module={row.module_code} key={row.working_screen_id} title={`Screen ${row.screen_no} - ${row.screen_name}`}>
              <button className="working-tab-open" onClick={()=>void openScreen(local||row.route_path)}>{Icon&&<Icon size={15}/>}<span className="working-tab-no">{row.screen_no}</span><b>{row.screen_name}</b>{dirtyScreens.has(row.screen_code)&&<i className="working-dirty" title="Unsaved changes"/>}</button>
              <button className="working-tab-close" onClick={()=>void closeWorkingScreen(row)} aria-label={`Close ${row.screen_name}`} title="Close working screen"><X size={14}/></button>
            </div>
          })}
        </div>
        <div className="working-screen-actions">
          <span className="working-count">{workingScreens.length}/{MAX_WORKING_SCREENS}</span>
          <button onClick={()=>void closeOtherWorkingScreens()} disabled={!isWorkingScreen(currentScreen)||workingScreens.length<2||Boolean(workingBusy)} title="Close all tabs except the active screen">Close Others</button>
          <button onClick={()=>void closeAllWorkingScreens()} disabled={!workingScreens.length||Boolean(workingBusy)} title="Close all working screens">Close All</button>
        </div>
      </div>}

      <div className="screen-context-strip">
        <div className="screen-context-path">
          <span className="screen-context-no">{currentScreen.screenNo}</span>
          <span>{currentModuleName}</span><i>›</i><strong>{currentScreen.title}</strong>
        </div>
        <div className="screen-context-tools">
          <button
            type="button"
            className={`current-screen-favorite ${favoriteCodes.has(currentScreen.screenCode)?'active':''}`}
            onClick={e=>toggleFavorite(currentScreen,e)}
            disabled={favoriteBusy===currentScreen.screenCode}
            title={favoriteCodes.has(currentScreen.screenCode)?'Remove this screen from My Favorites':'Add this screen to My Favorites'}
          >
            <Star size={16} fill={favoriteCodes.has(currentScreen.screenCode)?'currentColor':'none'}/>
            <span>{favoriteCodes.has(currentScreen.screenCode)?'Favorite':'Add to Favorites'}</span>
          </button>
        </div>
      </div>

      {favoriteMessage&&<div className="favorite-toast" role="status">{favoriteMessage}</div>}
      {workingMessage&&<div className="working-toast" role="status">{workingMessage}</div>}

      <section className="content full-content"><Outlet/></section>
      <footer className="app-footer"><span>© 2026 Colorshine Group. All rights reserved.</span><span>MES V2 0.11.5 <i/> Steel That Delivers Trust</span></footer>
    </main>

    {launcherOpen&&<div className="module-launcher-overlay" onClick={()=>setLauncherOpen(false)}>
      <section className="module-launcher" data-module={selectedModule} onClick={e=>e.stopPropagation()}>
        <header className="module-launcher-head"><div><span>COLORSHINE MES</span><h2>Active Modules & Screens</h2></div><button onClick={()=>setLauncherOpen(false)} aria-label="Close module launcher"><X/></button></header>
        <div className="module-launcher-body">
          <div className="module-list">
            <div className="module-home-card">
              <button className="module-home-open" onClick={()=>void openScreen(overviewScreen)} title={`Open Screen ${overviewScreen.screenNo} - ${overviewScreen.title}`}>
                <span className="module-home-icon"><OverviewIcon size={18}/></span>
                <span className="module-home-copy"><small>SCREEN {overviewScreen.screenNo}</small><b>{overviewScreen.title}</b></span>
                <ArrowRight size={15}/>
              </button>
              <ScreenFavoriteButton screen={overviewScreen} compact/>
            </div>
            <div className="module-list-label">{modules.length} ACTIVE MODULES</div>
            {modules.map(m=>{const Icon=m.icon;return <button key={m.code} data-module={m.code} className={selectedModule===m.code?'active':''} onClick={()=>setSelectedModule(m.code)}><span className="module-number">{m.number}</span><Icon size={20}/><div><b>{m.name}</b><small>{m.code}</small></div><ArrowRight size={16}/></button>})}
            {isAdmin&&<><div className="module-list-label admin-label">SYSTEM ADMINISTRATION</div><button className={selectedModule==='ADM'?'active':''} onClick={()=>{setSelectedModule('ADM')}}><span className="module-number">9</span><ShieldCheck size={20}/><div><b>Administration</b><small>ADM</small></div><ArrowRight size={16}/></button></>}
          </div>
          <div className="module-screen-list" data-module={selectedModule}>
            {selectedModule==='ADM'&&isAdmin?<>
              <div className="module-screen-heading"><span>ADMINISTRATION</span><h3>Administration Screens</h3></div>
              <div className="launcher-screen-grid">{adminScreens.map(s=><LauncherScreenCard key={s.screenCode} screen={s} label="Open screen"/>)}</div>
            </>:<>
              <div className="module-screen-heading"><span>MODULE {activeModule.number} · {activeModule.code}</span><h3>{activeModule.name}</h3></div>
              <div className="launcher-screen-grid">{activeModule.screens.map(s=><LauncherScreenCard key={s.screenCode} screen={s} label="Open screen"/>)}</div>
            </>}
          </div>
        </div>
        <footer className="module-launcher-foot"><span>Tip: star up to 8 screens. They appear as quick-access tiles on MES Overview.</span><button onClick={()=>{setLauncherOpen(false);setScreenOpen(true)}}><Hash size={15}/> Screen number</button></footer>
      </section>
    </div>}

    {limitTarget&&<div className="working-limit-overlay" role="dialog" aria-modal="true" aria-label="Maximum working screens reached">
      <section className="working-limit-dialog">
        <header><span className="working-limit-icon"><AlertTriangle size={21}/></span><div><h3>8 working screens are already open</h3><p>Close one unused screen below to open <b>{limitTarget.screenNo} · {limitTarget.title}</b>.</p></div><button onClick={()=>setLimitTarget(null)} aria-label="Cancel"><X size={18}/></button></header>
        <div className="working-limit-list">
          {workingScreens.map(row=><div className="working-limit-row" key={row.working_screen_id}><div><span>{row.screen_no}</span><b>{row.screen_name}</b><small>{row.module_name}</small></div><button onClick={()=>void closeOneThenOpenRequested(row)} disabled={Boolean(workingBusy)}>Close & Open Requested</button></div>)}
        </div>
        <footer><span>MES does not automatically close working screens.</span><button onClick={()=>setLimitTarget(null)}>Cancel</button></footer>
      </section>
    </div>}
  </div>
}
