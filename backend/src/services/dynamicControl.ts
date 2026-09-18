type QueryExecutor={query:(sql:string,params?:any[])=>Promise<{rows:any[]}>};

export type DynamicControlContext={
  groupCode:string;
  companyCode?:string|null;
  plantCode?:string|null;
  workCenterCode?:string|null;
  operationCode?:string|null;
  materialCode?:string|null;
  productGroup?:string|null;
  usageContext?:'ANY'|'PLANNING'|'PRODUCTION'|'QUALITY';
  onDate?:string|null;
  actualNumber?:number|null;
  actualCode?:string|null;
  actualText?:string|null;
  actualBoolean?:boolean|null;
};

export class DynamicControlError extends Error{
  status=409;
  code='DYNAMIC_CONTROL_BLOCK';
  validation:any;
  constructor(validation:any){
    super(validation?.result_message||'Transaction blocked by dynamic business control.');
    this.validation=validation;
  }
}

/**
 * Resolve and validate a Group Code inside the SAME database transaction that
 * will post the Planning / Production / Quality document.
 *
 * This is the backend enforcement point. Frontend validation is only UX;
 * transaction routes must call this before posting so users cannot bypass the
 * master rule by calling the API directly.
 */
export async function validateDynamicControl(executor:QueryExecutor,input:DynamicControlContext){
  const r=await executor.query(
    `SELECT * FROM mes.validate_group_control($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      input.groupCode,
      input.companyCode||null,
      input.plantCode||null,
      input.workCenterCode||null,
      input.operationCode||null,
      input.materialCode||null,
      input.productGroup||null,
      input.usageContext||'ANY',
      input.onDate||null,
      input.actualNumber??null,
      input.actualCode||null,
      input.actualText||null,
      input.actualBoolean??null
    ]
  );
  return r.rows[0]||null;
}

export async function enforceDynamicControl(executor:QueryExecutor,input:DynamicControlContext){
  const validation=await validateDynamicControl(executor,input);
  if(!validation||validation.blocks_transaction)throw new DynamicControlError(validation);
  return validation;
}

/** Fetch every dynamic control bound to a screen in a single DB round trip. */
export async function resolveBoundScreenControls(executor:QueryExecutor,screenCode:string,ctx:Omit<DynamicControlContext,'groupCode'>){
  const r=await executor.query(
    `SELECT * FROM mes.resolve_screen_controls($1,$2,$3,$4,$5,$6,$7,$8)`,
    [screenCode,ctx.companyCode||null,ctx.plantCode||null,ctx.workCenterCode||null,ctx.operationCode||null,ctx.materialCode||null,ctx.productGroup||null,ctx.onDate||null]
  );
  return r.rows;
}
