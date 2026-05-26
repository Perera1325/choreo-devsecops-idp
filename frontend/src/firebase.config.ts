import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Safe, fallback configurations. In production, these should be supplied via environment variables (.env)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "mock-api-key-devsecops",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "devsecops-idp.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "devsecops-idp",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "devsecops-idp.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1234567890",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:1234567890:web:1234567890abcdef"
};

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

console.log(`[Firebase] Initialized with Project ID: ${firebaseConfig.projectId}`);

export { db };
