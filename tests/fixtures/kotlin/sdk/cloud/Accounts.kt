package com.example.archive

import com.google.cloud.firestore.Firestore
import com.google.cloud.firestore.FirestoreOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.cloud.FirestoreClient
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.Message
import com.google.firebase.messaging.Notification

class Accounts(private val db: Firestore = FirestoreOptions.getDefaultInstance().service) {
    fun profile(uid: String) = db.collection("profiles").document(uid).get()

    fun save(uid: String, data: Map<String, Any>) = db.collection("profiles").document(uid).set(data)

    fun recent() = FirestoreClient.getFirestore().collection("events").whereEqualTo("kind", "login").limit(20).get()

    fun lookup(email: String) = FirebaseAuth.getInstance().getUserByEmail(email)

    fun notify(token: String, title: String) {
        val message = Message.builder()
            .setToken(token)
            .setNotification(Notification.builder().setTitle(title).build())
            .putData("kind", "report")
            .build()
        FirebaseMessaging.getInstance().send(message)
    }
}
