import {useState} from 'react';
import {ArrowRight,KeyRound,LockKeyhole,ShieldCheck} from 'lucide-react';
import {api,currentUser,setSession} from '../lib/api';

export default function ChangePassword(){
  const user=currentUser();
  const[currentPassword,setCurrentPassword]=useState('');
  const[newPassword,setNewPassword]=useState('');
  const[confirmPassword,setConfirmPassword]=useState('');
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState('');
  async function submit(e:any){
    e.preventDefault();setError('');
    if(newPassword.length<8){setError('New password must contain at least 8 characters.');return}
    if(newPassword!==confirmPassword){setError('New password and confirmation do not match.');return}
    setBusy(true);
    try{
      const d=await api('/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})});
      setSession(d.token,d.user);
      location.href='/';
    }catch(e:any){setError(e.message)}finally{setBusy(false)}
  }
  return <main className="password-page">
    <section className="password-card">
      <div className="password-brand"><img src="/brand/colorshine-logo.png" alt="Colorshine"/></div>
      <div className="password-icon"><KeyRound size={24}/></div>
      <span className="eyebrow">ACCOUNT SECURITY</span>
      <h1>{user?.mustChangePassword?'Create your new password':'Change password'}</h1>
      <p>{user?.mustChangePassword?'Your administrator issued a temporary password. Change it before accessing MES.':'Update the password for your Colorshine MES account.'}</p>
      <div className="password-user"><ShieldCheck size={16}/><span>{user?.username}</span><small>{user?.displayName}</small></div>
      <form onSubmit={submit}>
        <label><span>Current Password</span><div className="input-icon"><LockKeyhole size={17}/><input autoFocus type="password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} required/></div></label>
        <label><span>New Password</span><input type="password" minLength={8} value={newPassword} onChange={e=>setNewPassword(e.target.value)} required/></label>
        <label><span>Confirm New Password</span><input type="password" minLength={8} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required/></label>
        {error&&<div className="form-error">{error}</div>}
        <button className="primary password-submit" disabled={busy}><span>{busy?'Updating…':'Update Password'}</span><ArrowRight size={17}/></button>
      </form>
    </section>
  </main>
}
