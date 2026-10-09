import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export async function submitLoanApplication(input: { ownerUid: string; productId: string; requestedAmount: number; consent: boolean }) {
  if (!input.consent) throw new Error('Consent is required.');
  if (!Number.isFinite(input.requestedAmount) || input.requestedAmount < 1000 || input.requestedAmount > 100000000) throw new Error('Enter a valid requested amount.');
  if (!input.productId.trim()) throw new Error('Choose a loan product.');
  const referenceId = `UC-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
  const ref = await addDoc(collection(db, 'loanApplications'), {
    ownerUid: input.ownerUid, productId: input.productId, requestedAmount: input.requestedAmount,
    consent: true, status: 'submitted', referenceId, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  return { id: ref.id, referenceId };
}
