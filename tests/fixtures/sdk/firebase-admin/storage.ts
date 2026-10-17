import * as admin from "firebase-admin";
import { getStorage } from "firebase-admin/storage";
import { getDatabase } from "firebase-admin/database";

export const saveScan = (path: string, data: Buffer) => admin.storage().bucket().file(path).save(data);

export const dropImage = (name: string) => getStorage().bucket("media").file(`img/${name}`).delete();

export const setRoomState = (id: string, state: object) => getDatabase().ref(`rooms/${id}`).child("state").set(state);

export const roomsOf = (owner: string) => admin.database().ref("rooms").orderByChild("owner").equalTo(owner).once("value");

export async function seed() {
  const db = admin.firestore();
  const batch = db.batch();
  batch.set(db.doc("settings/main"), { ready: true });
  return batch.commit();
}
