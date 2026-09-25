import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

let signedInUid = null;
let signedInPromise = null;

/** Resolves with the anonymous uid for this browser, signing in if needed. */
export function ensureSignedIn() {
  if (signedInUid) return Promise.resolve(signedInUid);
  if (signedInPromise) return signedInPromise;

  signedInPromise = new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          signedInUid = user.uid;
          unsub();
          resolve(user.uid);
        }
      },
      reject
    );
    signInAnonymously(auth).catch((err) => {
      unsub();
      reject(err);
    });
  });
  return signedInPromise;
}
