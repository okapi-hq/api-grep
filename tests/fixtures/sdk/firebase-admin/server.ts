import * as admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

admin.initializeApp();
const db = admin.firestore();

export async function loadProfile(uid: string) {
  const snap = await db.collection("profiles").doc(uid).get();
  return snap.data();
}

export async function saveOrder(order: { total: number; userId: string }) {
  const orders = getFirestore().collection("orders");
  return orders.add({ total: order.total, userId: order.userId });
}

export const renameProfile = (uid: string, name: string) => db.collection("profiles").doc(uid).update({ name });

export const recentOrders = (userId: string) => db.collection("orders").where("userId", "==", userId).orderBy("createdAt").limit(20).get();

export const userRecord = (uid: string) => admin.auth().getUser(uid);

export const promote = (uid: string) => getAuth().setCustomUserClaims(uid, { role: "admin" });

export const notify = (token: string, title: string) => getMessaging().send({ token, notification: { title } });

export const broadcast = (topic: string, body: string) => admin.messaging().send({ topic, notification: { body } });

// verifying a session token is local (public keys aside): no call is listed
export const whoIs = (idToken: string) => admin.auth().verifyIdToken(idToken);
