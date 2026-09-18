import { config } from '../config';
import { pool } from '../db';

export async function resolveGroupEmails(client:any, groupCode:string, plantCode:string):Promise<string[]> {
  const r=await client.query(`
    SELECT DISTINCT lower(trim(u.email)) AS email
      FROM mes.app_access_group g
      JOIN mes.app_user_access_group uag ON uag.access_group_id=g.access_group_id
      JOIN mes.app_user u ON u.user_id=uag.user_id
      JOIN mes.app_access_group_plant gp ON gp.access_group_id=g.access_group_id AND gp.plant_code=$2
     WHERE g.group_code=$1 AND g.is_active=true AND uag.is_active=true AND u.is_active=true
       AND u.email IS NOT NULL AND trim(u.email)<>''
       AND (uag.valid_from IS NULL OR uag.valid_from<=current_date)
       AND (uag.valid_to IS NULL OR uag.valid_to>=current_date)
       AND (u.valid_from IS NULL OR u.valid_from<=current_date)
       AND (u.valid_to IS NULL OR u.valid_to>=current_date)
     ORDER BY 1`,[groupCode,plantCode]);
  return r.rows.map((x:any)=>String(x.email)).filter(Boolean);
}

export async function queueTdcEmail(client:any,args:{
  tdcVersionId?:string|null; approvalId?:string|null; eventCode:string;
  intendedEmails?:string[]; subject:string; htmlBody:string;
}){
  const intended=(args.intendedEmails||[]).filter(Boolean).join(',');
  const actual=(config.tdcEmailOverride||'').trim() || intended;
  if(!actual){
    return client.query(`INSERT INTO mes.tdc_email_outbox(tdc_version_id,approval_id,event_code,intended_to_email,to_email,subject,html_body,email_status,last_error)
      VALUES($1,$2,$3,$4,'UNRESOLVED',$5,$6,'FAILED','No active e-mail recipient is maintained for this approval group.') RETURNING email_id`,
      [args.tdcVersionId??null,args.approvalId??null,args.eventCode,intended||null,args.subject,args.htmlBody]);
  }
  return client.query(`INSERT INTO mes.tdc_email_outbox(tdc_version_id,approval_id,event_code,intended_to_email,to_email,subject,html_body,email_status)
    VALUES($1,$2,$3,$4,$5,$6,$7,'QUEUED') RETURNING email_id`,
    [args.tdcVersionId??null,args.approvalId??null,args.eventCode,intended||null,actual,args.subject,args.htmlBody]);
}

export function approvalEmailHtml(args:{tdcNo:string;versionLabel:string;customerName:string;stage:string;actor?:string;remarks?:string;action?:string}){
  const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]||m));
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#17233a;background:#f5f7fb;padding:24px">
  <div style="max-width:680px;margin:auto;background:#fff;border:1px solid #dfe6ef;border-radius:14px;overflow:hidden">
    <div style="background:#173a6a;color:#fff;padding:16px 20px"><b>COLORSHINE MES</b><div style="font-size:12px;opacity:.85;margin-top:4px">Technical Delivery Condition Workflow</div></div>
    <div style="padding:20px">
      <h2 style="margin:0 0 16px;font-size:20px">${esc(args.tdcNo)} · ${esc(args.versionLabel)}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="padding:8px;border-bottom:1px solid #edf1f5;color:#66758b">Customer</td><td style="padding:8px;border-bottom:1px solid #edf1f5"><b>${esc(args.customerName)}</b></td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #edf1f5;color:#66758b">Workflow Stage</td><td style="padding:8px;border-bottom:1px solid #edf1f5"><b>${esc(args.stage)}</b></td></tr>
        ${args.action?`<tr><td style="padding:8px;border-bottom:1px solid #edf1f5;color:#66758b">Action</td><td style="padding:8px;border-bottom:1px solid #edf1f5"><b>${esc(args.action)}</b></td></tr>`:''}
        ${args.actor?`<tr><td style="padding:8px;border-bottom:1px solid #edf1f5;color:#66758b">Action By</td><td style="padding:8px;border-bottom:1px solid #edf1f5">${esc(args.actor)}</td></tr>`:''}
        ${args.remarks?`<tr><td style="padding:8px;border-bottom:1px solid #edf1f5;color:#66758b">Remarks</td><td style="padding:8px;border-bottom:1px solid #edf1f5">${esc(args.remarks)}</td></tr>`:''}
      </table>
      <p style="font-size:12px;color:#66758b;margin:18px 0 0">Open Colorshine MES → Quality → TDC Approval to review the document.</p>
    </div>
  </div></body></html>`;
}

export async function flushTdcEmailOutbox(limit=20){
  if(!config.smtpHost || !config.smtpUser || !config.smtpPass){
    await pool.query(`UPDATE mes.tdc_email_outbox SET email_status='WAITING_SMTP',updated_at=now(),last_error='SMTP is not configured in backend/.env.' WHERE email_status='QUEUED'`);
    return {sent:0,waiting:true};
  }
  let nodemailer:any;
  try{ nodemailer=require('nodemailer'); }
  catch{
    await pool.query(`UPDATE mes.tdc_email_outbox SET email_status='WAITING_SMTP',updated_at=now(),last_error='nodemailer dependency is not installed. Run npm install in backend.' WHERE email_status='QUEUED'`);
    return {sent:0,waiting:true};
  }
  const transporter=nodemailer.createTransport({host:config.smtpHost,port:config.smtpPort,secure:config.smtpSecure,auth:{user:config.smtpUser,pass:config.smtpPass}});
  const pending=await pool.query(`SELECT * FROM mes.tdc_email_outbox WHERE email_status IN ('QUEUED','WAITING_SMTP') ORDER BY queued_at LIMIT $1`,[limit]);
  let sent=0;
  for(const row of pending.rows){
    try{
      await pool.query(`UPDATE mes.tdc_email_outbox SET email_status='SENDING',attempt_count=attempt_count+1,updated_at=now() WHERE email_id=$1`,[row.email_id]);
      await transporter.sendMail({from:config.smtpFrom||config.smtpUser,to:row.to_email,subject:row.subject,html:row.html_body});
      await pool.query(`UPDATE mes.tdc_email_outbox SET email_status='SENT',sent_at=now(),updated_at=now(),last_error=NULL WHERE email_id=$1`,[row.email_id]);
      if(row.approval_id) await pool.query(`UPDATE mes.tdc_workflow_approval SET email_status='SENT',actual_email=$2,updated_at=now() WHERE approval_id=$1`,[row.approval_id,row.to_email]);
      sent++;
    }catch(e:any){
      await pool.query(`UPDATE mes.tdc_email_outbox SET email_status='FAILED',last_error=$2,updated_at=now() WHERE email_id=$1`,[row.email_id,String(e?.message||e).slice(0,1900)]);
      if(row.approval_id) await pool.query(`UPDATE mes.tdc_workflow_approval SET email_status='FAILED',actual_email=$2,updated_at=now() WHERE approval_id=$1`,[row.approval_id,row.to_email]);
    }
  }
  return {sent,waiting:false};
}
