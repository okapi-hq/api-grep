import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

class JournalRepository {
  final FirebaseFirestore _db = FirebaseFirestore.instance;
  final FirebaseAuth _auth = FirebaseAuth.instance;

  Future<void> start() async {
    await Firebase.initializeApp();
    await FirebaseMessaging.instance.requestPermission();
  }

  Future<UserCredential> signIn(String email, String password) {
    return _auth.signInWithEmailAndPassword(email: email, password: password);
  }

  Future<void> resetPassword(String email) => FirebaseAuth.instance.sendPasswordResetEmail(email: email);

  Future<void> verify() async {
    await _auth.currentUser?.sendEmailVerification();
  }

  Future<DocumentSnapshot<Map<String, dynamic>>> plant(String id) => _db.collection('plants').doc(id).get();

  Future<void> water(String id, int ml) => _db.collection('plants').doc(id).update({'lastWatered': ml});

  Future<DocumentReference<Map<String, dynamic>>> addNote(String text) {
    return FirebaseFirestore.instance.collection('notes').add({'text': text});
  }

  Stream<QuerySnapshot<Map<String, dynamic>>> recent() {
    return _db.collection('notes').orderBy('createdAt').limit(20).snapshots();
  }

  Future<void> signOut() => _auth.signOut();
}
