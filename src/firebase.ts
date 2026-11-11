import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeFirestore,
  getFirestore,
  setLogLevel,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  Firestore,
  DocumentData
} from 'firebase/firestore';
import {
  getAuth,
  signInAnonymously,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
  Auth
} from 'firebase/auth';
import firebaseConfigJson from '../firebase-applet-config.json';

// Suppress non-fatal Firestore network transition logs (e.g. offline-mode / long-polling auto switches)
try {
  setLogLevel('silent');
} catch {}

// Firebase configuration from auto-provisioned metadata
export const firebaseConfig = {
  apiKey: firebaseConfigJson.apiKey,
  authDomain: firebaseConfigJson.authDomain,
  projectId: firebaseConfigJson.projectId,
  storageBucket: firebaseConfigJson.storageBucket,
  messagingSenderId: firebaseConfigJson.messagingSenderId,
  appId: firebaseConfigJson.appId,
};

// Initialize Firebase Client App (Singleton)
export const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Initialize Firestore with custom Database ID, auto-detect long polling and resilient fallback
let firestoreInstance: Firestore;
try {
  firestoreInstance = initializeFirestore(
    app,
    {
      experimentalAutoDetectLongPolling: true,
      experimentalForceLongPolling: true,
      ignoreUndefinedProperties: true,
    },
    firebaseConfigJson.firestoreDatabaseId || '(default)'
  );
} catch {
  firestoreInstance = getFirestore(
    app,
    firebaseConfigJson.firestoreDatabaseId || '(default)'
  );
}

export const db: Firestore = firestoreInstance;

// Initialize Firebase Auth
export const auth: Auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Seamless background anonymous authentication so Firestore queries have an active session
if (typeof window !== 'undefined') {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      signInAnonymously(auth).catch(() => {
        // Fallback for offline or local preview environments
      });
    }
  });
}

export {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  signInAnonymously,
  signInWithPopup,
  signOut,
  onAuthStateChanged
};

export type { User, DocumentData };
