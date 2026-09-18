import { ReactNode } from 'react';

export function PageHeader({title: _title,subtitle: _subtitle,actions}:{title:string,subtitle?:string,actions?:ReactNode}){
  // v0.10.9 content-first layout: the Shell breadcrumb already identifies the screen.
  // Keep only essential screen actions here so business content starts immediately.
  if(!actions)return null;
  return <div className="page-quick-actions"><div className="header-actions">{actions}</div></div>
}

export function Status({value}:{value?:string|null}){
  const v=value||'PENDING';
  const cls=v.toLowerCase().replaceAll('_','-');
  return <span className={`status ${cls}`}>{v.replaceAll('_',' ')}</span>
}

export function Kpi({label,value,unit,icon,caption,variant}:{label:string,value:any,unit?:string,icon?:ReactNode,caption?:string,variant?:string}){
  return <div className={`kpi ${variant||''}`}>
    <div className="kpi-icon">{icon}</div>
    <div className="kpi-body">
      <span>{label}</span>
      <strong>{value ?? '—'}{unit&&<small> {unit}</small>}</strong>
      {caption&&<em>{caption}</em>}
    </div>
  </div>
}

export function Empty({text='No records found'}:{text?:string}){return <div className="empty">{text}</div>}
// Zero renders as '—' everywhere (no value clutter), matching the convention
// used for null/empty. Only non-zero numbers get the decimal formatting.
export const num=(v:any,d=3)=>{const n=Number(v||0);return n===0?'—':n.toLocaleString('en-IN',{minimumFractionDigits:d,maximumFractionDigits:d})};
export const plain=(v:any,d=3)=>{const n=Number(v||0);return n===0?'—':n.toFixed(d)};
