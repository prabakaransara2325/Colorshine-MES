import { useEffect, useMemo, useState } from 'react';
import { Copy, Edit3, Link2, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { api, currentUser } from '../lib/api';
import { PageHeader, Status } from '../components/UI';

const groupBlank:any={
  groupCode:'',groupName:'',description:'',controlMode:'LOOKUP',valueType:'CODE',defaultUom:'',
  useInPlanning:false,useInProduction:false,useInQuality:false,
  missingRuleAction:'ERROR',missingRuleMessage:'',isActive:true
};
const detailBlank:any={detailCode:'',shortDescription:'',description:'',numericValue:'',textValue:'',uom:'',sequenceNo:100,isActive:true};
const ruleBlank:any={ruleName:'',companyCode:'',plantCode:'',workCenterId:'',operationCode:'',materialCode:'',productGroup:'',usageContext:'ANY',detailId:'',minValue:'',maxValue:'',targetValue:'',textValue:'',booleanValue:null,uom:'',validationAction:'ERROR',validationMessage:'',priorityNo:100,effectiveFrom:'',effectiveTo:'',isActive:true};
const bindingBlank:any={screenId:'',controlKey:'',usageContext:'ANY',validationTiming:'ON_SAVE',inputMode:'AUTO',isRequired:false,sequenceNo:100,isActive:true};
const show=(v:any)=>v===null||v===undefined||v===''?'—':String(v);

export default function GroupCodes(){
  const [groups,setGroups]=useState<any[]>([]);
  const [selected,setSelected]=useState<any|null>(null);
  const [details,setDetails]=useState<any[]>([]);
  const [rules,setRules]=useState<any[]>([]);
  const [bindings,setBindings]=useState<any[]>([]);
  const [companies,setCompanies]=useState<any[]>([]);
  const [plants,setPlants]=useState<any[]>([]);
  const [workCenters,setWorkCenters]=useState<any[]>([]);
  const [operations,setOperations]=useState<any[]>([]);
  const [screens,setScreens]=useState<any[]>([]);
  const [q,setQ]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [groupEdit,setGroupEdit]=useState<any|null>(null);
  const [groupForm,setGroupForm]=useState<any>(groupBlank);
  const [detailEdit,setDetailEdit]=useState<any|null>(null);
  const [detailForm,setDetailForm]=useState<any>(detailBlank);
  const [ruleEdit,setRuleEdit]=useState<any|null>(null);
  const [ruleForm,setRuleForm]=useState<any>(ruleBlank);
  const [bindingEdit,setBindingEdit]=useState<any|null>(null);
  const [bindingForm,setBindingForm]=useState<any>(bindingBlank);
  const canEdit=(currentUser()?.roles||[]).includes('ADMIN');

  const loadReference=async()=>{
    const [c,p,w,o,sc]=await Promise.all([
      api('/masters/companies'),api('/masters/plants'),api('/masters/work-centers'),api('/masters/operations'),api('/masters/runtime-control-screens')
    ]);
    setCompanies(c.rows||[]);setPlants(p.rows||[]);setWorkCenters(w.rows||[]);setOperations(o.rows||[]);setScreens(sc.rows||[]);
  };
  const loadGroups=async(search=q)=>{
    setBusy(true);
    try{
      const data=await api(`/masters/group-codes?q=${encodeURIComponent(search)}`);
      setGroups(data.rows||[]);
      if(selected){
        const fresh=(data.rows||[]).find((x:any)=>x.group_code_id===selected.group_code_id);
        if(fresh)setSelected(fresh);
      }
    }catch(e:any){setMessage(e.message)}finally{setBusy(false)}
  };
  const loadChildren=async(g:any)=>{
    if(!g){setDetails([]);setRules([]);setBindings([]);return}
    setBusy(true);
    try{
      const [d,r,b]=await Promise.all([
        api(`/masters/group-codes/${g.group_code_id}/details`),
        api(`/masters/group-code-rules?groupCodeId=${encodeURIComponent(g.group_code_id)}`),
        api(`/masters/screen-control-bindings?groupCodeId=${encodeURIComponent(g.group_code_id)}`)
      ]);
      setDetails(d.rows||[]);setRules(r.rows||[]);setBindings(b.rows||[]);
    }catch(e:any){setMessage(e.message)}finally{setBusy(false)}
  };
  useEffect(()=>{void Promise.all([loadGroups(''),loadReference()]).catch((e:any)=>setMessage(e.message))},[]);
  useEffect(()=>{void loadChildren(selected)},[selected?.group_code_id]);

  const rulePlants=useMemo(()=>plants.filter(p=>!ruleForm.companyCode||p.company_code===ruleForm.companyCode),[plants,ruleForm.companyCode]);
  const ruleWcs=useMemo(()=>workCenters.filter(w=>(!ruleForm.companyCode||w.company_code===ruleForm.companyCode)&&(!ruleForm.plantCode||w.plant_code===ruleForm.plantCode)),[workCenters,ruleForm.companyCode,ruleForm.plantCode]);
  const ruleOps=useMemo(()=>operations.filter(o=>!ruleForm.workCenterId||o.work_center_id===ruleForm.workCenterId),[operations,ruleForm.workCenterId]);

  const groupFormFromRow=(g:any)=>({groupCode:g.group_code,groupName:g.group_name,description:g.description||'',controlMode:g.control_mode,valueType:g.value_type,defaultUom:g.default_uom||'',useInPlanning:Boolean(g.use_in_planning),useInProduction:Boolean(g.use_in_production),useInQuality:Boolean(g.use_in_quality),missingRuleAction:g.missing_rule_action||'ERROR',missingRuleMessage:g.missing_rule_message||'',isActive:Boolean(g.is_active)});
  const detailFormFromRow=(d:any)=>({detailCode:d.detail_code,shortDescription:d.short_description,description:d.description||'',numericValue:d.numeric_value??'',textValue:d.text_value||'',uom:d.uom||'',sequenceNo:d.sequence_no??100,isActive:Boolean(d.is_active)});
  const ruleFormFromRow=(r:any)=>({ruleName:r.rule_name,companyCode:r.company_code||'',plantCode:r.plant_code||'',workCenterId:r.work_center_id||'',operationCode:r.operation_code||'',materialCode:r.material_code||'',productGroup:r.product_group||'',usageContext:r.usage_context||'ANY',detailId:r.detail_id||'',minValue:r.min_value??'',maxValue:r.max_value??'',targetValue:r.target_value??'',textValue:r.text_value||'',booleanValue:r.boolean_value,uom:r.uom||selected?.default_uom||'',validationAction:r.validation_action||'ERROR',validationMessage:r.validation_message||'',priorityNo:r.priority_no??100,effectiveFrom:r.effective_from?String(r.effective_from).slice(0,10):'',effectiveTo:r.effective_to?String(r.effective_to).slice(0,10):'',isActive:Boolean(r.is_active)});
  const bindingFormFromRow=(b:any)=>({screenId:b.screen_id,controlKey:b.control_key,usageContext:b.usage_context||'ANY',validationTiming:b.validation_timing||'ON_SAVE',inputMode:b.input_mode||'AUTO',isRequired:Boolean(b.is_required),sequenceNo:b.sequence_no??100,isActive:Boolean(b.is_active)});

  const editGroup=(g:any)=>{setGroupEdit(g);setGroupForm(groupFormFromRow(g))};
  const copyGroup=(g:any)=>{setGroupEdit({mode:'copy',copySource:g.group_code_id});setGroupForm({...groupFormFromRow(g),groupCode:'',isActive:false});setMessage(`Copying ${g.group_code}. Enter a new Group Code before saving.`)};
  const editDetail=(d:any)=>{setDetailEdit(d);setDetailForm(detailFormFromRow(d))};
  const copyDetail=(d:any)=>{setDetailEdit({mode:'copy',copySource:d.detail_id});setDetailForm({...detailFormFromRow(d),detailCode:'',sequenceNo:Number(d.sequence_no||100)+10,isActive:true});setMessage(`Copying detail ${d.detail_code}. Enter a new Detail Code before saving.`)};
  const editRule=(r:any)=>{setRuleEdit(r);setRuleForm(ruleFormFromRow(r))};
  const copyRule=(r:any)=>{setRuleEdit({mode:'copy',copySource:r.rule_id});setRuleForm({...ruleFormFromRow(r),ruleName:`${r.rule_name} COPY`,priorityNo:Number(r.priority_no||100)+10,isActive:false});setMessage('Control rule copied. Review priority/scope before activation.')};
  const editBinding=(b:any)=>{setBindingEdit(b);setBindingForm(bindingFormFromRow(b))};
  const copyBinding=(b:any)=>{setBindingEdit({mode:'copy',copySource:b.binding_id});setBindingForm({...bindingFormFromRow(b),controlKey:'',sequenceNo:Number(b.sequence_no||100)+10,isActive:false});setMessage('Screen binding copied. Enter a new Control Key before saving.')};

  const saveGroup=async()=>{
    try{
      setBusy(true);
      const path=groupEdit?.group_code_id?`/masters/group-codes/${groupEdit.group_code_id}`:'/masters/group-codes';
      await api(path,{method:groupEdit?.group_code_id?'PUT':'POST',body:JSON.stringify(groupForm)});
      setGroupEdit(null);setMessage('Group Code saved.');await loadGroups();
    }catch(e:any){setMessage(e.message)}finally{setBusy(false)}
  };
  const saveDetail=async()=>{
    if(!selected)return;
    try{
      setBusy(true);
      const path=detailEdit?.detail_id?`/masters/group-code-details/${detailEdit.detail_id}`:`/masters/group-codes/${selected.group_code_id}/details`;
      await api(path,{method:detailEdit?.detail_id?'PUT':'POST',body:JSON.stringify(detailForm)});
      setDetailEdit(null);setMessage('Code Detail saved.');await loadChildren(selected);await loadGroups();
    }catch(e:any){setMessage(e.message)}finally{setBusy(false)}
  };
  const saveRule=async()=>{
    if(!selected)return;
    try{
      setBusy(true);
      const body={...ruleForm,groupCodeId:selected.group_code_id};
      const path=ruleEdit?.rule_id?`/masters/group-code-rules/${ruleEdit.rule_id}`:'/masters/group-code-rules';
      await api(path,{method:ruleEdit?.rule_id?'PUT':'POST',body:JSON.stringify(body)});
      setRuleEdit(null);setMessage('Dynamic control rule saved.');await loadChildren(selected);await loadGroups();
    }catch(e:any){setMessage(e.message)}finally{setBusy(false)}
  };
  const saveBinding=async()=>{
    if(!selected)return;
    try{
      setBusy(true);
      const body={...bindingForm,groupCodeId:selected.group_code_id};
      const path=bindingEdit?.binding_id?`/masters/screen-control-bindings/${bindingEdit.binding_id}`:'/masters/screen-control-bindings';
      await api(path,{method:bindingEdit?.binding_id?'PUT':'POST',body:JSON.stringify(body)});
      setBindingEdit(null);setMessage('Screen control binding saved.');await loadChildren(selected);
    }catch(e:any){setMessage(e.message)}finally{setBusy(false)}
  };


  return <>
    <PageHeader title="Group Code & Dynamic Controls" subtitle="Central business parameter engine for Planning, Production and Quality. Values and limits are configured here and resolved at runtime." actions={<div className="master-header-actions">{canEdit&&<button className="primary" onClick={()=>{setGroupEdit({mode:'add'});setGroupForm({...groupBlank})}}><Plus size={17}/> Add Group Code</button>}</div>}/>
    <div className="dynamic-control-banner"><ShieldCheck size={18}/><div><b>Configuration drives transactions</b><span>Work Center and Operation limits, dropdown codes, quality decisions and planning controls are maintained as Group Codes. Transaction screens consume bindings instead of hardcoded business values.</span></div></div>
    {message&&<div className="inline-message">{message}</div>}

    <div className="group-code-split">
      <section className="group-code-panel professional-master-panel">
        <div className="group-code-panel-head"><div><b>Group Codes</b><small>Parameter/control definitions</small></div><div className="group-code-search"><input placeholder="Search group code" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void loadGroups()}}/><button onClick={()=>void loadGroups()}><RefreshCw size={15}/></button></div></div>
        <div className="group-code-list">{groups.map(g=><button key={g.group_code_id} className={`group-code-row ${selected?.group_code_id===g.group_code_id?'selected':''}`} onClick={()=>setSelected(g)}><div><b>{g.group_code}</b><span>{g.group_name}</span></div><div className="group-code-row-meta"><small>{g.control_mode}</small><em>{g.active_details||0} details · {g.active_rules||0} rules</em>{canEdit&&<span className="group-code-row-actions"><span role="button" title="Copy as New Group Code" onClick={e=>{e.stopPropagation();copyGroup(g)}}><Copy size={14}/></span><span role="button" title="Edit Group Code" onClick={e=>{e.stopPropagation();editGroup(g)}}><Edit3 size={14}/></span></span>}</div></button>)}{!groups.length&&<div className="empty-table-cell">No Group Codes created yet.</div>}</div>
      </section>

      <section className="group-code-panel professional-master-panel">
        <div className="group-code-panel-head"><div><b>Code Details</b><small>{selected?`${selected.group_code} · reusable values / parameter details`:'Select a Group Code'}</small></div>{canEdit&&selected&&<button className="secondary-btn compact" onClick={()=>{setDetailEdit({mode:'add'});setDetailForm({...detailBlank,uom:selected.default_uom||''})}}><Plus size={14}/> Add Detail</button>}</div>
        <div className="master-table-scroll group-detail-scroll"><table className="master-table compact-master-table"><thead><tr><th>Code</th><th>Short Description</th><th>Numeric</th><th>Text</th><th>UOM</th><th>Status</th><th></th></tr></thead><tbody>{details.map(d=><tr key={d.detail_id}><td><b>{d.detail_code}</b></td><td>{d.short_description}</td><td>{show(d.numeric_value)}</td><td>{show(d.text_value)}</td><td>{show(d.uom)}</td><td><Status value={d.is_active?'ACTIVE':'INACTIVE'}/></td><td>{canEdit&&<div className="master-actions"><button title="Copy as New" onClick={()=>copyDetail(d)}><Copy size={14}/></button><button title="Edit" onClick={()=>editDetail(d)}><Edit3 size={14}/></button></div>}</td></tr>)}{selected&&!details.length&&<tr><td colSpan={7} className="empty-table-cell">No code details yet.</td></tr>}{!selected&&<tr><td colSpan={7} className="empty-table-cell">Select a Group Code to view details.</td></tr>}</tbody></table></div>
      </section>
    </div>

    <section className="professional-master-panel dynamic-rule-panel">
      <div className="group-code-panel-head"><div><b>Work Center / Operation Control Rules</b><small>{selected?`${selected.group_code} rules resolved by specificity and priority`:'Select a Group Code to maintain runtime rules'}</small></div>{canEdit&&selected&&<button className="primary compact" onClick={()=>{setRuleEdit({mode:'add'});setRuleForm({...ruleBlank,uom:selected.default_uom||''})}}><Plus size={14}/> Add Control Rule</button>}</div>
      <div className="master-table-scroll dynamic-rule-scroll"><table className="master-table dynamic-rule-table"><thead><tr><th>Rule</th><th>Context</th><th>Company</th><th>Plant</th><th>Work Center</th><th>Operation</th><th>Min</th><th>Max</th><th>Target</th><th>Value/Detail</th><th>UOM</th><th>Action</th><th>Priority</th><th>Status</th><th></th></tr></thead><tbody>{rules.map(r=><tr key={r.rule_id}><td><b>{r.rule_name}</b></td><td>{r.usage_context}</td><td>{show(r.company_code)}</td><td>{show(r.plant_code)}</td><td><b>{show(r.work_center_code)}</b></td><td>{show(r.operation_code)}</td><td>{show(r.min_value)}</td><td>{show(r.max_value)}</td><td>{show(r.target_value)}</td><td>{r.detail_code||r.text_value||show(r.boolean_value)}</td><td>{show(r.uom)}</td><td><span className={`rule-action ${String(r.validation_action||'').toLowerCase()}`}>{r.validation_action}</span></td><td>{r.priority_no}</td><td><Status value={r.is_active?'ACTIVE':'INACTIVE'}/></td><td>{canEdit&&<div className="master-actions"><button title="Copy as New" onClick={()=>copyRule(r)}><Copy size={14}/></button><button title="Edit" onClick={()=>editRule(r)}><Edit3 size={14}/></button></div>}</td></tr>)}{selected&&!rules.length&&<tr><td colSpan={15} className="empty-table-cell">No rules yet. Example: RUNTIME + Work Center + Operation + Min/Max.</td></tr>}{!selected&&<tr><td colSpan={15} className="empty-table-cell">Select a Group Code first.</td></tr>}</tbody></table></div>
    </section>

    <section className="professional-master-panel screen-binding-panel">
      <div className="group-code-panel-head"><div><b>Screen Usage / Runtime Bindings</b><small>{selected?`Declare where ${selected.group_code} is consumed. Screens then resolve this Group Code at runtime.`:'Select a Group Code to bind it to Planning, Production or Quality screens.'}</small></div>{canEdit&&selected&&<button className="secondary-btn compact" onClick={()=>{setBindingEdit({mode:'add'});setBindingForm({...bindingBlank,usageContext:selected.use_in_production?'PRODUCTION':selected.use_in_quality?'QUALITY':selected.use_in_planning?'PLANNING':'ANY'})}}><Link2 size={14}/> Bind to Screen</button>}</div>
      <div className="master-table-scroll screen-binding-scroll"><table className="master-table screen-binding-table"><thead><tr><th>Screen</th><th>Module</th><th>Control Key</th><th>Group Code</th><th>Context</th><th>Validation</th><th>Input</th><th>Required</th><th>Seq</th><th>Status</th><th></th></tr></thead><tbody>{bindings.map(b=><tr key={b.binding_id}><td><b>{b.screen_no}</b><small>{b.screen_name}</small></td><td>{b.module_code}</td><td><b>{b.control_key}</b></td><td>{b.group_code}</td><td>{b.usage_context}</td><td>{b.validation_timing}</td><td>{b.input_mode}</td><td>{b.is_required?'Yes':'No'}</td><td>{b.sequence_no}</td><td><Status value={b.is_active?'ACTIVE':'INACTIVE'}/></td><td>{canEdit&&<div className="master-actions"><button title="Copy as New" onClick={()=>copyBinding(b)}><Copy size={14}/></button><button title="Edit" onClick={()=>editBinding(b)}><Edit3 size={14}/></button></div>}</td></tr>)}{selected&&!bindings.length&&<tr><td colSpan={11} className="empty-table-cell">No screen bindings yet. Transactions will not use this Group Code until it is bound or called explicitly.</td></tr>}{!selected&&<tr><td colSpan={11} className="empty-table-cell">Select a Group Code first.</td></tr>}</tbody></table></div>
    </section>

    {groupEdit&&<div className="modal-scrim master-editor-scrim"><div className="modal master-modal wide-master-modal"><div className="modal-head"><div><span className="screen-title-kicker">GROUP CODE MASTER</span><h2>{groupEdit.group_code_id?'Edit Group Code':groupEdit.mode==='copy'?'Copy Group Code':'Add Group Code'}</h2>{groupEdit.mode==='copy'&&<small className="copy-mode-note">Settings are copied. Enter a new Group Code; the new group starts inactive until reviewed.</small>}</div><button onClick={()=>setGroupEdit(null)}><X/></button></div><div className="master-form-grid three-col">
      <label>Group Code<input disabled={Boolean(groupEdit.group_code_id)} value={groupForm.groupCode} onChange={e=>setGroupForm({...groupForm,groupCode:e.target.value.toUpperCase()})}/></label>
      <label>Group Name<input value={groupForm.groupName} onChange={e=>setGroupForm({...groupForm,groupName:e.target.value})}/></label>
      <label>Control Mode<select value={groupForm.controlMode} onChange={e=>setGroupForm({...groupForm,controlMode:e.target.value})}><option>LOOKUP</option><option>RANGE</option><option>VALUE</option><option>BOOLEAN</option><option>TEXT</option></select></label>
      <label>Value Type<select value={groupForm.valueType} onChange={e=>setGroupForm({...groupForm,valueType:e.target.value})}><option>CODE</option><option>NUMBER</option><option>TEXT</option><option>BOOLEAN</option></select></label>
      <label>Default UOM<input placeholder="e.g. MIN, MT, MM" value={groupForm.defaultUom} onChange={e=>setGroupForm({...groupForm,defaultUom:e.target.value.toUpperCase()})}/></label>
      <label>Missing Rule Action<select value={groupForm.missingRuleAction} onChange={e=>setGroupForm({...groupForm,missingRuleAction:e.target.value})}><option>ERROR</option><option>WARNING</option><option>INFO</option><option>IGNORE</option></select></label>
      <label className="rule-message-field">Description<input value={groupForm.description} onChange={e=>setGroupForm({...groupForm,description:e.target.value})}/></label>
      <label className="rule-message-field">Missing Rule Message<input placeholder="Message when no applicable rule exists" value={groupForm.missingRuleMessage} onChange={e=>setGroupForm({...groupForm,missingRuleMessage:e.target.value})}/></label>
      <div className="matrix-form-group"><b>Used By Modules</b><div className="module-use-checks"><label><input type="checkbox" checked={groupForm.useInPlanning} onChange={e=>setGroupForm({...groupForm,useInPlanning:e.target.checked})}/> Planning</label><label><input type="checkbox" checked={groupForm.useInProduction} onChange={e=>setGroupForm({...groupForm,useInProduction:e.target.checked})}/> Production</label><label><input type="checkbox" checked={groupForm.useInQuality} onChange={e=>setGroupForm({...groupForm,useInQuality:e.target.checked})}/> Quality</label></div></div>
      <label className="checkbox-field"><input type="checkbox" checked={groupForm.isActive} onChange={e=>setGroupForm({...groupForm,isActive:e.target.checked})}/><span>Active</span></label>
    </div><div className="modal-actions"><button onClick={()=>setGroupEdit(null)}>Cancel</button><button className="primary" onClick={()=>void saveGroup()} disabled={busy}>Save Group Code</button></div></div></div>}

    {detailEdit&&<div className="modal-scrim master-editor-scrim"><div className="modal master-modal"><div className="modal-head"><div><span className="screen-title-kicker">{selected?.group_code}</span><h2>{detailEdit.detail_id?'Edit Code Detail':detailEdit.mode==='copy'?'Copy Code Detail':'Add Code Detail'}</h2>{detailEdit.mode==='copy'&&<small className="copy-mode-note">Values are copied. Enter a new Detail Code before saving.</small>}</div><button onClick={()=>setDetailEdit(null)}><X/></button></div><div className="master-form-grid">
      <label>Detail Code<input value={detailForm.detailCode} onChange={e=>setDetailForm({...detailForm,detailCode:e.target.value.toUpperCase()})}/></label><label>Short Description<input value={detailForm.shortDescription} onChange={e=>setDetailForm({...detailForm,shortDescription:e.target.value})}/></label><label>Numeric Value<input type="number" step="0.000001" value={detailForm.numericValue} onChange={e=>setDetailForm({...detailForm,numericValue:e.target.value})}/></label><label>UOM<input value={detailForm.uom} onChange={e=>setDetailForm({...detailForm,uom:e.target.value.toUpperCase()})}/></label><label>Text Value<input value={detailForm.textValue} onChange={e=>setDetailForm({...detailForm,textValue:e.target.value})}/></label><label>Sequence<input type="number" value={detailForm.sequenceNo} onChange={e=>setDetailForm({...detailForm,sequenceNo:e.target.value})}/></label><label>Description<input value={detailForm.description} onChange={e=>setDetailForm({...detailForm,description:e.target.value})}/></label><label className="checkbox-field"><input type="checkbox" checked={detailForm.isActive} onChange={e=>setDetailForm({...detailForm,isActive:e.target.checked})}/><span>Active</span></label>
    </div><div className="modal-actions"><button onClick={()=>setDetailEdit(null)}>Cancel</button><button className="primary" onClick={()=>void saveDetail()} disabled={busy}>Save Detail</button></div></div></div>}

    {ruleEdit&&<div className="modal-scrim master-editor-scrim"><div className="modal master-modal wide-master-modal"><div className="modal-head"><div><span className="screen-title-kicker">{selected?.group_code} · DYNAMIC RULE</span><h2>{ruleEdit.rule_id?'Edit Control Rule':ruleEdit.mode==='copy'?'Copy Control Rule':'Add Control Rule'}</h2>{ruleEdit.mode==='copy'&&<small className="copy-mode-note">Scope and values are copied. Review priority and activate only after validation.</small>}</div><button onClick={()=>setRuleEdit(null)}><X/></button></div><div className="master-form-grid three-col">
      <label>Rule Name<input value={ruleForm.ruleName} onChange={e=>setRuleForm({...ruleForm,ruleName:e.target.value})}/></label><label>Usage Context<select value={ruleForm.usageContext} onChange={e=>setRuleForm({...ruleForm,usageContext:e.target.value})}><option>ANY</option><option>PLANNING</option><option>PRODUCTION</option><option>QUALITY</option></select></label><label>Priority<input type="number" value={ruleForm.priorityNo} onChange={e=>setRuleForm({...ruleForm,priorityNo:e.target.value})}/></label>
      <label>Company<select value={ruleForm.companyCode} onChange={e=>setRuleForm({...ruleForm,companyCode:e.target.value,plantCode:'',workCenterId:'',operationCode:''})}><option value="">Global / Any Company</option>{companies.map(c=><option key={c.company_code} value={c.company_code}>{c.company_code} · {c.short_name}</option>)}</select></label><label>Plant<select value={ruleForm.plantCode} onChange={e=>setRuleForm({...ruleForm,plantCode:e.target.value,workCenterId:'',operationCode:''})}><option value="">Any Plant</option>{rulePlants.map(p=><option key={p.plant_code} value={p.plant_code}>{p.plant_code} · {p.plant_name}</option>)}</select></label><label>Work Center<select value={ruleForm.workCenterId} onChange={e=>setRuleForm({...ruleForm,workCenterId:e.target.value,operationCode:''})}><option value="">Any Work Center</option>{ruleWcs.map(w=><option key={w.work_center_id} value={w.work_center_id}>{w.work_center_code} · {w.work_center_name}</option>)}</select></label>
      <label>Operation<select disabled={!ruleForm.workCenterId} value={ruleForm.operationCode} onChange={e=>setRuleForm({...ruleForm,operationCode:e.target.value})}><option value="">Any Operation</option>{ruleOps.filter(o=>o.is_active!==false).map(o=><option key={o.operation_id} value={o.operation_code}>{o.operation_code} · {o.operation_name}</option>)}</select></label><label>Material Code<input placeholder="Optional" value={ruleForm.materialCode} onChange={e=>setRuleForm({...ruleForm,materialCode:e.target.value.toUpperCase()})}/></label><label>Product Group<input placeholder="Optional" value={ruleForm.productGroup} onChange={e=>setRuleForm({...ruleForm,productGroup:e.target.value.toUpperCase()})}/></label>
      <div className="matrix-form-group"><b>Runtime Values</b><div><label>Min Value<input type="number" step="0.000001" value={ruleForm.minValue} onChange={e=>setRuleForm({...ruleForm,minValue:e.target.value})}/></label><label>Max Value<input type="number" step="0.000001" value={ruleForm.maxValue} onChange={e=>setRuleForm({...ruleForm,maxValue:e.target.value})}/></label><label>Target Value<input type="number" step="0.000001" value={ruleForm.targetValue} onChange={e=>setRuleForm({...ruleForm,targetValue:e.target.value})}/></label><label>Detail Code<select value={ruleForm.detailId} onChange={e=>setRuleForm({...ruleForm,detailId:e.target.value})}><option value="">None</option>{details.filter(d=>d.is_active).map(d=><option key={d.detail_id} value={d.detail_id}>{d.detail_code} · {d.short_description}</option>)}</select></label><label>Text Value<input value={ruleForm.textValue} onChange={e=>setRuleForm({...ruleForm,textValue:e.target.value})}/></label><label>UOM<input value={ruleForm.uom} onChange={e=>setRuleForm({...ruleForm,uom:e.target.value.toUpperCase()})}/></label></div></div>
      <label>Validation Action<select value={ruleForm.validationAction} onChange={e=>setRuleForm({...ruleForm,validationAction:e.target.value})}><option>ERROR</option><option>WARNING</option><option>INFO</option></select></label><label>Effective From<input type="date" value={ruleForm.effectiveFrom} onChange={e=>setRuleForm({...ruleForm,effectiveFrom:e.target.value})}/></label><label>Effective To<input type="date" value={ruleForm.effectiveTo} onChange={e=>setRuleForm({...ruleForm,effectiveTo:e.target.value})}/></label><label className="rule-message-field">Validation Message<input placeholder="Message shown when rule is violated" value={ruleForm.validationMessage} onChange={e=>setRuleForm({...ruleForm,validationMessage:e.target.value})}/></label><label className="checkbox-field"><input type="checkbox" checked={ruleForm.isActive} onChange={e=>setRuleForm({...ruleForm,isActive:e.target.checked})}/><span>Active</span></label>
    </div><div className="modal-actions"><button onClick={()=>setRuleEdit(null)}>Cancel</button><button className="primary" onClick={()=>void saveRule()} disabled={busy}>Save Control Rule</button></div></div></div>}

    {bindingEdit&&<div className="modal-scrim master-editor-scrim"><div className="modal master-modal"><div className="modal-head"><div><span className="screen-title-kicker">{selected?.group_code} · SCREEN BINDING</span><h2>{bindingEdit.binding_id?'Edit Screen Binding':bindingEdit.mode==='copy'?'Copy Screen Binding':'Bind Group Code to Screen'}</h2>{bindingEdit.mode==='copy'&&<small className="copy-mode-note">Screen settings are copied. Enter a new Control Key before saving.</small>}</div><button onClick={()=>setBindingEdit(null)}><X/></button></div><div className="master-form-grid">
      <label>Screen<select value={bindingForm.screenId} onChange={e=>setBindingForm({...bindingForm,screenId:e.target.value})}><option value="">Select Screen</option>{screens.map(s=><option key={s.screen_id} value={s.screen_id}>{s.screen_no} · {s.module_code} · {s.screen_name}</option>)}</select></label>
      <label>Control Key<input placeholder="e.g. RUNTIME_MINMAX" value={bindingForm.controlKey} onChange={e=>setBindingForm({...bindingForm,controlKey:e.target.value.toUpperCase()})}/></label>
      <label>Usage Context<select value={bindingForm.usageContext} onChange={e=>setBindingForm({...bindingForm,usageContext:e.target.value})}><option>ANY</option><option>PLANNING</option><option>PRODUCTION</option><option>QUALITY</option></select></label>
      <label>Validation Timing<select value={bindingForm.validationTiming} onChange={e=>setBindingForm({...bindingForm,validationTiming:e.target.value})}><option>LOAD</option><option>ON_CHANGE</option><option>ON_SAVE</option><option>ON_CONFIRM</option></select></label>
      <label>Input Mode<select value={bindingForm.inputMode} onChange={e=>setBindingForm({...bindingForm,inputMode:e.target.value})}><option>AUTO</option><option>NUMBER</option><option>CODE</option><option>TEXT</option><option>BOOLEAN</option><option>NONE</option></select></label>
      <label>Sequence<input type="number" value={bindingForm.sequenceNo} onChange={e=>setBindingForm({...bindingForm,sequenceNo:e.target.value})}/></label>
      <label className="checkbox-field"><input type="checkbox" checked={bindingForm.isRequired} onChange={e=>setBindingForm({...bindingForm,isRequired:e.target.checked})}/><span>Required</span></label>
      <label className="checkbox-field"><input type="checkbox" checked={bindingForm.isActive} onChange={e=>setBindingForm({...bindingForm,isActive:e.target.checked})}/><span>Active</span></label>
    </div><div className="modal-actions"><button onClick={()=>setBindingEdit(null)}>Cancel</button><button className="primary" onClick={()=>void saveBinding()} disabled={busy}>Save Binding</button></div></div></div>}
  </>;
}
