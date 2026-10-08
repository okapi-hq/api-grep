import { GoogleAuthProvider, signInAnonymously, signInWithEmailAndPassword, signInWithPopup, signOut } from "firebase/auth";
import { auth } from "./firebase";

export const google = () => signInWithPopup(auth, new GoogleAuthProvider());

export const guest = () => signInAnonymously(auth);

export const login = (email: string, password: string) => signInWithEmailAndPassword(auth, email, password);

export const logout = () => signOut(auth);
