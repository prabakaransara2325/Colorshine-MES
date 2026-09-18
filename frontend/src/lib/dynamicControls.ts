import { api } from './api';

export type DynamicControlContext={
  companyCode?:string;
  plantCode?:string;
  workCenterCode?:string;
  operationCode?:string;
  materialCode?:string;
  productGroup?:string;
  onDate?:string;
};

export type DynamicValidationInput=DynamicControlContext&{
  groupCode:string;
  usageContext:'ANY'|'PLANNING'|'PRODUCTION'|'QUALITY';
  actualNumber?:number|null;
  actualCode?:string|null;
  actualText?:string|null;
  actualBoolean?:boolean|null;
};

function qs(context:DynamicControlContext){
  const p=new URLSearchParams();
  Object.entries(context).forEach(([k,v])=>{if(v!==undefined&&v!==null&&String(v).trim()!=='')p.set(k,String(v))});
  return p.toString();
}

/**
 * Resolve all Group Code controls bound to a transaction screen in one request.
 * Planning / Production / Quality screens should use this instead of embedding
 * limits, dropdown values or validation thresholds in React code.
 */
export async function resolveScreenControls(screenCode:string,context:DynamicControlContext={}){
  const suffix=qs(context);
  return api(`/masters/runtime-controls/screen/${encodeURIComponent(screenCode)}${suffix?`?${suffix}`:''}`);
}

/**
 * Validate one entered transaction value against the currently effective rule.
 * blocks_transaction=true means the caller must not post/confirm the transaction.
 */
export async function validateDynamicControl(input:DynamicValidationInput){
  return api('/masters/runtime-controls/validate',{method:'POST',body:JSON.stringify(input)});
}

/** Active lookup values for dynamic dropdowns such as UD code / quality level. */
export async function dynamicCodeValues(groupCode:string){
  return api(`/masters/group-code-values/${encodeURIComponent(groupCode)}`);
}
