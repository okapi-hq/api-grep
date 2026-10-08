import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const app = initializeApp({ apiKey: "demo-key", projectId: "demo-project" });

export const db = getFirestore(app);
export const auth = getAuth(app);
