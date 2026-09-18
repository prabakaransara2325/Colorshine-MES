import {useEffect,useMemo,useState} from 'react';
import {ArrowLeft,Check,ShieldCheck,UserCog,X} from 'lucide-react';
import {useNavigate,useParams} from 'react-router-dom';
import {api,currentUser} from '../lib/api';
import {PageHeader} from '../components/UI';

type AccessGroup={group_code:string;group_name:string;group_type:string;company_codes:string;plant_codes:string;allow_consolidated_view:boolean};
const blank={username:'',displayName:'',employeeId:'',email:'',mobileNo:'',department:'',designation:'',homePlant:'',password:'',accessGroupCodes:[] as string[],mustChangePassword:true,validFrom:'',validTo:''};

export default function UserEditor(){
 const {userId}=useParams();
 const isEdit=Boolean(userId);
 const nav=useNavigate();
 const me=currentUser();
 const isAdmin=(me?.roles||[]).includes('ADMIN') || (me?.accessGroups||[]).some((g:any)=>g.groupCode==='SYSTEM_ADMIN');
 const [groups,setGroups]=useState<AccessGroup[]>([]),[form,setForm]=useState<any>(blank),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const allowedHomePlants=useMemo(()=>{const set=new Set<string>();groups.filter(g=>form.accessGroupCodes.includes(g.group_code)).forEach(g=>String(g.plant_codes||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(x=>set.add(x)));return [...set].sort()},[groups,form.accessGroupCodes]);
 useEffect(()=>{if(!isAdmin)return;setBusy(true);Promise.all([api('/admin/access-groups'),isEdit?api(`/admin/users/${userId}`):Promise.resolve(null)]).then(([g,d]:any[])=>{setGroups(g.rows||[]);if(d){const u=d.user;setForm({username:u.username,displayName:u.display_name||'',employeeId:u.employee_id||'',email:u.email||'',mobileNo:u.mobile_no||'',department:u.department||'',designation:u.designation||'',homePlant:u.home_plant||'',password:'',accessGroupCodes:(d.accessGroups||[]).filter((x:any)=>x.is_active).map((x:any)=>x.group_code),mustChangePassword:u.must_change_password,validFrom:u.valid_from?String(u.valid_from).slice(0,10):'',validTo:u.valid_to?String(u.valid_to).slice(0,10):''})}}).catch((e:any)=>setError(e.message)).finally(()=>setBusy(false))},[isAdmin,isEdit,userId]);
 function toggleGroup(code:string){setForm((f:any)=>{const codes=f.accessGroupCodes.includes(code)?f.accessGroupCodes.filter((x:string)=>x!==code):[...f.accessGroupCodes,code];const plants=new Set<string>();groups.filter(g=>codes.includes(g.group_code)).forEach(g=>String(g.plant_codes||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(x=>plants.add(x)));const list=[...plants].sort();let home=f.homePlant;if(home&&!list.includes(home))home=list.length===1?list[0]:'';if(!home&&list.length===1)home=list[0];return {...f,accessGroupCodes:codes,homePlant:home}})}
 async function save(e:any){e.preventDefault();setBusy(true);setError('');try{if(!form.accessGroupCodes.length)throw new Error('Assign at least one access group.');if(!isEdit&&(!form.password||form.password.length<8))throw new Error('Temporary password must contain at least 8 characters.');const payload={displayName:form.displayName,employeeId:form.employeeId||null,email:form.email||null,mobileNo:form.mobileNo||null,department:form.department||null,designation:form.designation||null,homePlant:form.homePlant||null,validFrom:form.validFrom||null,validTo:form.validTo||null,accessGroupCodes:form.accessGroupCodes};if(isEdit)await api(`/admin/users/${userId}`,{method:'PUT',body:JSON.stringify(payload)});else await api('/admin/users',{method:'POST',body:JSON.stringify({...payload,username:form.username,password:form.password,mustChangePassword:form.mustChangePassword})});nav('/admin/users',{replace:true})}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 if(!isAdmin)return <div className="empty">System Administrator access is required.</div>;
 return <>
  <PageHeader title={isEdit?'Edit MES User':'Create MES User'} subtitle="Maintain employee identity, validity and plant-scoped access groups." actions={<button className="secondary-btn" onClick={()=>nav('/admin/users')}><ArrowLeft size={16}/>Back to Users</button>}/>
  {error&&<div className="toast error-toast user-editor-error">{error}<button onClick={()=>setError('')}><X size={15}/></button></div>}
  <form className="user-editor-page" onSubmit={save}>
   <section className="user-editor-card identity-card">
    <div className="user-editor-section-head"><div className="section-icon"><UserCog size={20}/></div><div><span>USER PROFILE</span><h2>Identity & Employment</h2><p>Basic MES account and employee information.</p></div></div>
    <div className="master-form-grid user-form-grid">
     <label><span>Username *</span><input required disabled={isEdit} value={form.username} onChange={e=>setForm({...form,username:e.target.value.toUpperCase()})}/></label>
     <label><span>Display Name *</span><input required value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})}/></label>
     <label><span>Employee ID</span><input value={form.employeeId} onChange={e=>setForm({...form,employeeId:e.target.value})}/></label>
     <label><span>Email</span><input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
     <label><span>Mobile</span><input value={form.mobileNo} onChange={e=>setForm({...form,mobileNo:e.target.value})}/></label>
     <label><span>Department</span><input value={form.department} onChange={e=>setForm({...form,department:e.target.value})}/></label>
     <label><span>Designation</span><input value={form.designation} onChange={e=>setForm({...form,designation:e.target.value})}/></label>
     <label><span>Home / Default Plant</span><select value={form.homePlant} onChange={e=>setForm({...form,homePlant:e.target.value})} disabled={!allowedHomePlants.length}><option value="">{allowedHomePlants.length?'Select…':'Select access group first'}</option>{allowedHomePlants.map(p=><option key={p} value={p}>{p==='1000'?'1000 - CCPL':p==='2000'?'2000 - CIPL':p}</option>)}</select><small className="field-help">Only plants included in the selected access group are available.</small></label>
     {!isEdit&&<label><span>Temporary Password *</span><input required minLength={8} type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label>}
     <label><span>Valid From</span><input type="date" value={form.validFrom} onChange={e=>setForm({...form,validFrom:e.target.value})}/></label>
     <label><span>Valid To</span><input type="date" value={form.validTo} onChange={e=>setForm({...form,validTo:e.target.value})}/></label>
    </div>
   </section>

   <section className="user-editor-card access-card">
    <div className="user-editor-section-head"><div className="section-icon access-icon"><ShieldCheck size={20}/></div><div><span>AUTHORIZATION SCOPE</span><h2>Access Group *</h2><p>Access groups control the companies, plants and consolidated view available to this user.</p></div></div>
    <div className="group-options user-editor-groups">{groups.map(g=><label key={g.group_code} data-group={g.group_code} className={`group-option ${form.accessGroupCodes.includes(g.group_code)?'selected':''}`}><input type="checkbox" checked={form.accessGroupCodes.includes(g.group_code)} onChange={()=>toggleGroup(g.group_code)}/><span className="group-check"><Check size={15}/></span><span className="group-copy"><b>{g.group_name}</b><small>{g.group_code}</small><em>Plant {g.plant_codes||'—'}{g.allow_consolidated_view?' · ALL consolidated view':''}</em></span></label>)}</div>
    {!isEdit&&<label className="force-password"><input type="checkbox" checked={form.mustChangePassword} onChange={e=>setForm({...form,mustChangePassword:e.target.checked})}/> Force password change at first login</label>}
   </section>

   <div className="user-editor-actions"><button type="button" className="secondary-btn" onClick={()=>nav('/admin/users')}>Cancel</button><button className="primary user-save-btn" disabled={busy}><Check size={17}/>{busy?'Saving…':isEdit?'Save Changes':'Create User'}</button></div>
  </form>
 </>;
}
