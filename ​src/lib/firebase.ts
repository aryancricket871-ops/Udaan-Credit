import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// .env फ़ाइल से Firebase कॉन्फ़िगरेशन ला रहे हैं
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Firebase Initialize करें
const app = initializeApp(firebaseConfig);

// Firestore और Auth को एक्सपोर्ट करें ताकि बाकी प्रोजेक्ट में इस्तेमाल हो सके
export const db = getFirestore(app);
export const auth = getAuth(app);
