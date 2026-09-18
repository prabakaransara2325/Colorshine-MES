import {useEffect,useMemo,useState} from 'react';
import {KeyRound,Lock,LockOpen,Pencil,Plus,Power,PowerOff,RefreshCcw,Search,ShieldCheck,X} from 'lucide-react';
import {api,currentUser} from '../lib/api';
import {PageHeader,Status} from '../components/UI';

type AccessGroup={group_code:string;group_name:string;group_type:string;company_codes:string;plant_codes:string;allow_consolidated_view:boolean};

export default function Users(){
 const [rows,setRows]=useState<any[]>([]),[groups,setGroups]=useState<AccessGroup[]>([]),[search,setSearch]=useState(''),[status,setStatus]=useState('ALL');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [reset,setReset]=useState<any>(null),[resetPwd,setResetPwd]=useState('');
 const me=currentUser();
 const isAdmin=(me?.roles||[]).includes('ADMIN') || (me?.accessGroups||[]).some((g:any)=>g.groupCode==='SYSTEM_ADMIN');
 async function load(){setBusy(true);setError('');try{const [u,g]=await Promise.all([api(`/admin/users?search=${encodeURIComponent(search)}&status=${status}`),api('/admin/access-groups')]);setRows(u.rows||[]);setGroups(g.rows||[])}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 useEffect(()=>{void load()},[status]);
 const filtered=useMemo(()=>rows,[rows]);
 const openScreen=(screenCode:string,route:string)=>window.dispatchEvent(new CustomEvent('mes:open-screen',{detail:{screenCode,route}}));
 const add=()=>openScreen('ADM_USER_MAINTENANCE','/admin/users/manage');
 const edit=(r:any)=>openScreen('ADM_USER_MAINTENANCE',`/admin/users/manage/${r.user_id}`);
 async function deactivate(r:any){if(!confirm(`Deactivate ${r.username}? The user will immediately lose MES login access.`))return;setBusy(true);try{await api(`/admin/users/${r.user_id}/deactivate`,{method:'POST',body:'{}'});setNotice('User deactivated.');await load()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 async function reactivate(r:any){setBusy(true);try{await api(`/admin/users/${r.user_id}/reactivate`,{method:'POST',body:'{}'});setNotice('User reactivated.');await load()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 async function lockUser(r:any){if(r.user_id===me?.userId)return;if(!confirm(`Lock ${r.username}? Existing sessions will be rejected immediately.`))return;setBusy(true);try{await api(`/admin/users/${r.user_id}/lock`,{method:'POST',body:'{}'});setNotice('User account locked.');await load()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 async function unlockUser(r:any){setBusy(true);try{await api(`/admin/users/${r.user_id}/unlock`,{method:'POST',body:'{}'});setNotice('User account unlocked.');await load()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 async function resetPassword(){if(!resetPwd||resetPwd.length<8){setError('Password must contain at least 8 characters.');return}setBusy(true);try{await api(`/admin/users/${reset.user_id}/reset-password`,{method:'POST',body:JSON.stringify({password:resetPwd,mustChangePassword:true})});setReset(null);setResetPwd('');setNotice('Password reset successfully. User must change it at next sign-in.')}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 if(!isAdmin)return <div className="empty">System Administrator access is required.</div>;
 return <>
  <PageHeader title="User Management" subtitle="Create MES users and assign company / plant access groups." actions={<button className="primary compact" onClick={add}><Plus size={16}/> Add User</button>}/>
  {notice&&<div className="toast success-toast"><ShieldCheck size={17}/>{notice}<button onClick={()=>setNotice('')}><X size={15}/></button></div>}
  {error&&<div className="toast error-toast">{error}<button onClick={()=>setError('')}><X size={15}/></button></div>}

  <section className="user-scope-summary" aria-label="Access group summary">
   <div className="user-scope-title"><ShieldCheck size={18}/><div><b>Access Group Scope</b><span>Plant access is inherited from the assigned group.</span></div></div>
   <div className="access-group-strip compact-access-strip">
    {groups.map(g=><div className="access-group-card" data-group={g.group_code} key={g.group_code}><div className="access-group-icon"><ShieldCheck size={17}/></div><div><b>{g.group_name}</b><span>{g.group_code}</span><small>{g.plant_codes?`Plant ${g.plant_codes}`:'No plant'}{g.allow_consolidated_view?' · Consolidated ALL':''}</small></div></div>)}
   </div>
  </section>

  <div className="master-toolbar user-toolbar"><div className="search master-search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&load()} placeholder="Search username, employee or name…"/></div><select value={status} onChange={e=>setStatus(e.target.value)}><option value="ALL">All status</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="LOCKED">Locked</option></select><button className="secondary-btn" onClick={load}><RefreshCcw size={16}/>Refresh</button></div>
  <div className="table-panel master-table-panel user-list-panel"><div className="master-table-scroll"><table className="master-table user-table"><thead><tr><th>User</th><th>Employee</th><th>Department</th><th>Home Plant</th><th>Access Group</th><th>Authorized Plants</th><th>Consolidated</th><th>Last Login</th><th>Status</th><th>Actions</th></tr></thead><tbody>{filtered.map(r=><tr key={r.user_id} className={!r.is_active?'inactive-row':''}><td><b>{r.username}</b><small className="cell-sub">{r.display_name}</small></td><td>{r.employee_id||'—'}</td><td>{r.department||'—'}<small className="cell-sub">{r.designation||''}</small></td><td>{r.home_plant||'—'}</td><td>{r.access_groups||'—'}</td><td><span className="plant-scope-pill">{r.authorized_plants||'—'}</span></td><td>{r.can_view_consolidated?'Yes':'No'}</td><td>{r.last_login_at?new Date(r.last_login_at).toLocaleString('en-IN'):'Never'}</td><td><Status value={r.account_locked?'LOCKED':r.is_active?'ACTIVE':'INACTIVE'}/>{r.must_change_password&&<small className="cell-sub warning-text">Password change required</small>}</td><td className="master-actions"><button title="Edit" onClick={()=>edit(r)}><Pencil size={16}/></button><button title="Reset password" onClick={()=>{setReset(r);setResetPwd('')}}><KeyRound size={16}/></button>{r.is_active&&(r.account_locked?<button className="good-action" title="Unlock account" onClick={()=>unlockUser(r)}><LockOpen size={16}/></button>:<button title="Lock account" onClick={()=>lockUser(r)} disabled={r.user_id===me?.userId}><Lock size={16}/></button>)}{r.is_active?<button className="danger-action" title="Deactivate" onClick={()=>deactivate(r)} disabled={r.user_id===me?.userId}><PowerOff size={16}/></button>:<button className="good-action" title="Reactivate" onClick={()=>reactivate(r)}><Power size={16}/></button>}</td></tr>)}</tbody></table></div>{!rows.length&&<div className="empty">{busy?'Loading…':'No users found'}</div>}</div>

  {reset&&<div className="modal-scrim" onMouseDown={()=>!busy&&setReset(null)}><div className="modal reset-modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">PASSWORD RESET</span><h2>{reset.username}</h2></div><button onClick={()=>setReset(null)}><X/></button></div><label className="reset-password-field"><span>Temporary Password</span><input autoFocus type="password" minLength={8} value={resetPwd} onChange={e=>setResetPwd(e.target.value)} placeholder="Minimum 8 characters"/></label><p className="helper-copy">The user will be required to change this password at the next sign-in.</p><div className="modal-actions"><button className="secondary-btn" onClick={()=>setReset(null)}>Cancel</button><button className="primary" onClick={resetPassword} disabled={busy}>Reset Password</button></div></div></div>}
 </>;
}
