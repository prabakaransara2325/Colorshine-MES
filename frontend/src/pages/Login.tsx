import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api,setSession } from '../lib/api';
import { ArrowRight, LockKeyhole } from 'lucide-react';

type ServiceState='checking'|'online'|'offline';

function healthUrl(){
  const apiUrl=import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
  return apiUrl.replace(/\/api\/?$/,'') + '/health';
}

export default function Login(){
  const [username,setUsername]=useState('ADMIN');
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [leaving,setLeaving]=useState(false);
  const [serviceState,setServiceState]=useState<ServiceState>('checking');
  const nav=useNavigate();

  useEffect(()=>{
    let active=true;
    let timer:number|undefined;
    const check=async()=>{
      try{
        const controller=new AbortController();
        const timeout=window.setTimeout(()=>controller.abort(),2500);
        const response=await fetch(healthUrl(),{signal:controller.signal,cache:'no-store'});
        window.clearTimeout(timeout);
        if(active)setServiceState(response.ok?'online':'offline');
      }catch{
        if(active)setServiceState('offline');
      }
    };
    check();
    timer=window.setInterval(check,30000);
    return()=>{active=false;if(timer)window.clearInterval(timer)};
  },[]);

  async function submit(e:any){
    e.preventDefault();
    setBusy(true);setError('');
    try{
      const d=await api('/auth/login',{method:'POST',body:JSON.stringify({username,password})});
      setSession(d.token,d.user);
      setLeaving(true);
      window.setTimeout(()=>nav(d.user?.mustChangePassword?'/change-password':'/'),360);
    }catch(e:any){
      setError(e.message);
      setBusy(false);
    }
  }

  return <main className={`login-page login-v6 login-v65${leaving?' login-authenticated':''}`}>
    <div className="login-scene" aria-hidden="true">
      <img className="login-process-art" src="/brand/login-process-flow.png" alt=""/>
      <div className="login-scene-shade"/>
      <div className="login-coil-sheen"/>

      <div className="login-scene-caption">
        <span>COLORSHINE MANUFACTURING</span>
        <strong>Raw HR Coil → Prepainted Coils → Customer</strong>
        <small>Traceable. Controlled. Connected.</small>
      </div>
    </div>

    <section className="login-card-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo-wrap">
          <img className="login-brand-logo-v6" src="/brand/colorshine-logo.png" alt="Colorshine"/>
        </div>
        <div className="login-card-copy">
          <div className="eyebrow">MANUFACTURING EXECUTION SYSTEM</div>
          <h1>Welcome</h1>
          <p>Sign in with your authorized Colorshine MES account.</p>
        </div>

        <label>Username
          <input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" autoFocus/>
        </label>
        <label>Password
          <div className="input-icon">
            <LockKeyhole size={18}/>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password"/>
          </div>
        </label>
        {error&&<div className="form-error">{error}</div>}
        <button className="primary login-submit" disabled={busy||leaving}>
          <span>{busy||leaving?'Signing in…':'Sign in'}</span><ArrowRight size={18}/>
        </button>
        <div className={`login-service-status ${serviceState}`} role="status" aria-live="polite">
          <i aria-hidden="true"/>
          <span>{serviceState==='online'?'MES services online':serviceState==='offline'?'MES services unavailable':'Checking MES services'}</span>
        </div>
      </form>
    </section>
  </main>
}
