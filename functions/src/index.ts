import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';

initializeApp();
const db = getFirestore();
const bootstrapSecret = defineSecret('UCMF_BOOTSTRAP_SECRET');

function requireAuth(request: { auth?: { uid: string; token: Record<string, unknown> } | null }) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  return request.auth;
}
function requirePermission(auth: { uid:string; token:Record<string,unknown> }, permission:string) {
  const permissions = Array.isArray(auth.token.permissions) ? auth.token.permissions : [];
  if (auth.token.role !== 'super_admin' && !permissions.includes(permission)) throw new HttpsError('permission-denied', 'You do not have permission for this action.');
}
async function audit(actorUid:string, action:string, targetType:string, targetId:string, reason:string, before?:unknown, after?:unknown) {
  await db.collection('auditLogs').add({ actorUid, action, targetType, targetId, reason, before:before ?? null, after:after ?? null, createdAt:FieldValue.serverTimestamp() });
}

// One-time bootstrap. Set the secret using `firebase functions:secrets:set UCMF_BOOTSTRAP_SECRET`.
// This endpoint must only be called by the verified identity designated by deployment operations.
export const bootstrapSuperAdmin = onCall({ secrets:[bootstrapSecret], enforceAppCheck:true }, async (request) => {
  const auth = requireAuth(request);
  const supplied = String(request.data?.setupSecret ?? '');
  if (!supplied || supplied !== bootstrapSecret.value()) throw new HttpsError('permission-denied','Invalid setup authorization.');
  if (auth.token.email_verified !== true || typeof auth.token.email !== 'string') throw new HttpsError('failed-precondition','A verified admin email identity is required.');
  const stateRef = db.doc('system/bootstrap');
  const result = await db.runTransaction(async tx => {
    const state = await tx.get(stateRef);
    if (state.exists && state.data()?.completed === true) throw new HttpsError('already-exists','Super Admin bootstrap has already completed.');
    const userRef = db.doc(`staff/${auth.uid}`);
    tx.set(stateRef,{completed:true,completedAt:FieldValue.serverTimestamp(),completedBy:auth.uid});
    tx.set(userRef,{uid:auth.uid,email:auth.token.email,role:'super_admin',permissions:['*'],active:true,createdAt:FieldValue.serverTimestamp()});
    return {uid:auth.uid};
  });
  await getAuth().setCustomUserClaims(auth.uid,{role:'super_admin',permissions:['*']});
  await audit(auth.uid,'bootstrap_super_admin','staff',auth.uid,'Initial one-time bootstrap');
  return {ok:true,...result, message:'Sign out and back in to refresh custom claims.'};
});

// Server-side workload assignment with a transaction; only eligible staff with room are considered.
export const assignEnquiry = onCall({ enforceAppCheck:true }, async request => {
  const auth = requireAuth(request); requirePermission(auth,'enquiries.assign');
  const enquiryId = String(request.data?.enquiryId ?? ''); if (!enquiryId) throw new HttpsError('invalid-argument','enquiryId is required.');
  const enquiryRef = db.doc(`enquiries/${enquiryId}`);
  return db.runTransaction(async tx => {
    const enquiry = await tx.get(enquiryRef); if (!enquiry.exists) throw new HttpsError('not-found','Enquiry not found.');
    if (enquiry.data()?.assignedTo) throw new HttpsError('already-exists','Enquiry is already assigned.');
    const staffSnap = await tx.get(db.collection('staff').where('active','==',true));
    const eligible = staffSnap.docs.map(d=>({id:d.id,...d.data()})).filter(s=>Array.isArray(s.permissions) && (s.permissions as unknown[]).includes('enquiries.manage') && Number(s.maxOpenEnquiries ?? 100) > 0);
    if (!eligible.length) { tx.update(enquiryRef,{assignmentStatus:'unassigned',assignmentReason:'No eligible staff available',updatedAt:FieldValue.serverTimestamp()}); return {assigned:false,reason:'No eligible staff available'}; }
    // Workload counters are maintained transactionally on staff documents by this function.
    const counts = await Promise.all(eligible.map(async s=>({staff:s,count:Number(s.openEnquiryCount ?? 0),limit:Number(s.maxOpenEnquiries ?? 100)})));
    counts.sort((a,b)=>a.count-b.count || a.staff.id.localeCompare(b.staff.id));
    const chosen = counts.find(x=>x.count<x.limit);
    if (!chosen) { tx.update(enquiryRef,{assignmentStatus:'unassigned',assignmentReason:'All eligible staff reached workload limit',updatedAt:FieldValue.serverTimestamp()}); return {assigned:false,reason:'All eligible staff reached workload limit'}; }
    tx.update(enquiryRef,{assignedTo:chosen.staff.id,assignmentStatus:'assigned',assignedAt:FieldValue.serverTimestamp(),assignedBy:auth.uid,updatedAt:FieldValue.serverTimestamp()});
    tx.update(db.doc(`staff/${chosen.staff.id}`),{openEnquiryCount:chosen.count+1,updatedAt:FieldValue.serverTimestamp()});
    tx.set(db.collection('auditLogs').doc(),{actorUid:auth.uid,action:'auto_assign_enquiry',targetType:'enquiry',targetId:enquiryId,reason:'Lowest eligible open workload',after:{assignedTo:chosen.staff.id},createdAt:FieldValue.serverTimestamp()});
    return {assigned:true,assignedTo:chosen.staff.id};
  });
});

// Commission amounts are computed only on trusted backend and require a verified qualifying event.
export const createCommissionForQualifyingEvent = onCall({ enforceAppCheck:true }, async request => {
  const auth = requireAuth(request); requirePermission(auth,'commissions.manage');
  const referralId = String(request.data?.referralId ?? ''); const ruleId = String(request.data?.ruleId ?? ''); const reason = String(request.data?.reason ?? '').trim();
  if (!referralId || !ruleId || reason.length < 8) throw new HttpsError('invalid-argument','Referral, rule and audit reason are required.');
  return db.runTransaction(async tx=>{
    const referralRef=db.doc(`referrals/${referralId}`), ruleRef=db.doc(`commissionRules/${ruleId}`);
    const [referralSnap,ruleSnap]=await Promise.all([tx.get(referralRef),tx.get(ruleRef)]);
    if(!referralSnap.exists||!ruleSnap.exists) throw new HttpsError('not-found','Referral or commission rule not found.');
    const referral=referralSnap.data()!, rule=ruleSnap.data()!;
    if(referral.qualifyingEventVerified!==true || !referral.qualifyingEventAt) throw new HttpsError('failed-precondition','A verified qualifying event is required.');
    if(rule.active!==true) throw new HttpsError('failed-precondition','Commission rule is not active.');
    const base=Number(referral.eligibleBaseAmount); const rateType=rule.type;
    if(!Number.isFinite(base)||base<0) throw new HttpsError('failed-precondition','Verified eligible base amount is missing.');
    let amount:number;
    if(rateType==='fixed') amount=Number(rule.fixedAmount);
    else if(rateType==='percentage') amount=base*Number(rule.percentage)/100;
    else throw new HttpsError('failed-precondition','Unknown commission rule type.');
    if(!Number.isFinite(amount)||amount<0) throw new HttpsError('failed-precondition','Commission calculation invalid.');
    amount=Math.min(amount,Number(rule.maxAmount ?? amount)); amount=Math.max(amount,Number(rule.minAmount ?? 0)); amount=Math.round(amount*100)/100;
    const existing=await tx.get(db.collection('commissionLedger').where('referralId','==',referralId).where('ruleId','==',ruleId).limit(1));
    if(!existing.empty) throw new HttpsError('already-exists','Commission already exists for this referral and rule.');
    const ledgerRef=db.collection('commissionLedger').doc(); tx.create(ledgerRef,{partnerUid:referral.partnerUid,referralId,ruleId,calculation:{type:rateType,baseAmount:base,rate:rateType==='fixed'?rule.fixedAmount:rule.percentage,amount},amount,currency:'INR',status:'pending_verification',createdBy:auth.uid,reason,createdAt:FieldValue.serverTimestamp()});
    tx.set(db.collection('auditLogs').doc(),{actorUid:auth.uid,action:'create_commission',targetType:'commissionLedger',targetId:ledgerRef.id,reason,after:{amount,ruleId,referralId},createdAt:FieldValue.serverTimestamp()});
    return {id:ledgerRef.id,amount,status:'pending_verification'};
  });
});

// A payout request is not a payment. Only authorized staff can record a confirmed manual transfer.
export const recordConfirmedPayout = onCall({ enforceAppCheck:true }, async request=>{
  const auth=requireAuth(request); requirePermission(auth,'payouts.manage');
  const payoutId=String(request.data?.payoutId??''); const paymentReference=String(request.data?.paymentReference??'').trim(); const reason=String(request.data?.reason??'').trim();
  if(!payoutId||paymentReference.length<4||reason.length<8) throw new HttpsError('invalid-argument','Payout ID, confirmed payment reference and reason are required.');
  const ref=db.doc(`payoutRequests/${payoutId}`);
  await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(!snap.exists)throw new HttpsError('not-found','Payout not found.');if(snap.data()?.status!=='approved')throw new HttpsError('failed-precondition','Only approved payouts can be marked paid.');tx.update(ref,{status:'paid',paymentReference,paidAt:FieldValue.serverTimestamp(),paidBy:auth.uid,updatedAt:FieldValue.serverTimestamp()});tx.set(db.collection('auditLogs').doc(),{actorUid:auth.uid,action:'record_confirmed_payout',targetType:'payoutRequest',targetId:payoutId,reason,after:{status:'paid',paymentReference},createdAt:FieldValue.serverTimestamp()});});
  return {ok:true,status:'paid'};
});

// Public content reads are controlled by Firestore Rules; never place secrets in this collection.
export const stampNewEnquiry = onDocumentCreated('enquiries/{enquiryId}', async event=>{
  const snap=event.data;if(!snap)return;await snap.ref.set({createdAt: snap.get('createdAt') ?? FieldValue.serverTimestamp(),status:snap.get('status')??'new',assignmentStatus:snap.get('assignmentStatus')??'pending'},{merge:true});
});
