import { FormEvent, useRef, useState } from 'react';
import { RecaptchaVerifier, signInWithPhoneNumber, ConfirmationResult } from 'firebase/auth';
import { auth } from '../lib/firebase';

export default function PhoneLogin({ onDone }: { onDone: () => void }) {
  const [phone,setPhone] = useState('+91'); const [otp,setOtp] = useState(''); const [stage,setStage] = useState<'phone'|'otp'>('phone');
  const [busy,setBusy] = useState(false); const [error,setError] = useState('');
  const confirmation = useRef<ConfirmationResult | null>(null); const recaptcha = useRef<RecaptchaVerifier | null>(null);
  async function send(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try {
    if (!recaptcha.current) recaptcha.current = new RecaptchaVerifier(auth, 'recaptcha-container', { size:'normal' });
    confirmation.current = await signInWithPhoneNumber(auth, phone.trim(), recaptcha.current); setStage('otp');
  } catch(err) { setError(err instanceof Error ? err.message : 'Could not send OTP. Check Firebase Phone Auth settings.'); recaptcha.current?.clear(); recaptcha.current=null; } finally { setBusy(false); } }
  async function verify(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { if(!confirmation.current) throw new Error('Request an OTP first.'); await confirmation.current.confirm(otp.trim()); onDone(); } catch(err) { setError(err instanceof Error ? err.message : 'OTP verification failed.'); } finally { setBusy(false); } }
  return <div className="login-card"><h2>Customer {stage==='phone'?'login':'OTP verification'}</h2><p className="muted">Use your own mobile number. Never share an OTP with anyone.</p>
    {stage==='phone' ? <form onSubmit={send}><label>Mobile number in international format</label><input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+91XXXXXXXXXX" autoComplete="tel" required/><div id="recaptcha-container"/><button disabled={busy} className="btn primary">{busy?'Sending…':'Send OTP'}</button></form> : <form onSubmit={verify}><label>6-digit OTP</label><input value={otp} onChange={e=>setOtp(e.target.value)} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required/><button disabled={busy} className="btn primary">{busy?'Verifying…':'Verify and sign in'}</button><button type="button" className="btn quiet" onClick={()=>{setStage('phone');setOtp('');}}>Change number</button></form>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
