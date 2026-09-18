const API=import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
const PLANT_KEY='mes_selected_plant';

export function token(){return localStorage.getItem('mes_token');}
export function setSession(t:string,user:any){localStorage.setItem('mes_token',t);localStorage.setItem('mes_user',JSON.stringify(user));}
export function clearSession(){localStorage.removeItem('mes_token');localStorage.removeItem('mes_user');localStorage.removeItem(PLANT_KEY);}
export function updateCurrentUser(user:any){localStorage.setItem('mes_user',JSON.stringify(user));}
export function currentUser(){try{return JSON.parse(localStorage.getItem('mes_user')||'null')}catch{return null}}
export function selectedPlant(){return localStorage.getItem(PLANT_KEY) || 'ALL';}
export function setSelectedPlant(plant:string){localStorage.setItem(PLANT_KEY, plant || 'ALL');window.dispatchEvent(new CustomEvent('mes:plant-changed',{detail:{plant:plant || 'ALL'}}));}
export function plantQueryParam(){const plant=selectedPlant();return plant && plant!=='ALL' ? `plant=${encodeURIComponent(plant)}` : '';}
export function subscribePlantChange(listener:(plant:string)=>void){
 const h=(e:any)=>listener(e?.detail?.plant || selectedPlant());
 window.addEventListener('mes:plant-changed',h as EventListener);
 return ()=>window.removeEventListener('mes:plant-changed',h as EventListener);
}
export async function api(path:string,options:RequestInit={}){
 const headers:any={'Content-Type':'application/json',...(options.headers||{})}; const t=token(); if(t) headers.Authorization=`Bearer ${t}`;
 const r=await fetch(`${API}${path}`,{...options,headers}); const data=await r.json().catch(()=>({}));
 if(r.status===401){clearSession();location.href='/login';}
 if(r.status===428 && !location.pathname.includes('/change-password')){location.href='/change-password';}
 if(!r.ok){ const err:any=new Error(data.error||`Request failed (${r.status})`); err.status=r.status; err.code=data.code; err.data=data; throw err; } return data;
}
