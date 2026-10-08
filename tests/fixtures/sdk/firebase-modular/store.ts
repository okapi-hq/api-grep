import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where, type DocumentReference } from "firebase/firestore";
import { db } from "./firebase";

export const loadProfile = (uid: string) => getDoc(doc(db, "profiles", uid));

export async function openOrders() {
  const q = query(collection(db, "orders"), where("status", "==", "open"));
  return getDocs(q);
}

export async function saveProfile(uid: string, profile: { name: string; city: string }) {
  await setDoc(doc(db, "profiles", uid), profile);
}

export async function addComment(orderId: string, text: string) {
  const comments = collection(db, "orders", orderId, "comments");
  return addDoc(comments, { text, createdAt: Date.now() });
}

export const rename = (ref: DocumentReference, name: string) => updateDoc(ref, { name });

export const removeOrder = (orderId: string) => deleteDoc(doc(db, `orders/${orderId}`));

export const watchOrders = (cb: () => void) => onSnapshot(collection(db, "orders"), cb);
