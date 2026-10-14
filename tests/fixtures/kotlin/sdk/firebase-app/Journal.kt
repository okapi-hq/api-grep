package com.example.journal

import android.net.Uri
import com.google.firebase.Firebase
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.auth
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.functions.functions
import com.google.firebase.storage.storage

class Journal {
    private val auth = FirebaseAuth.getInstance()
    private val entries = FirebaseDatabase.getInstance().getReference("entries")

    fun login(email: String, password: String) = auth.signInWithEmailAndPassword(email, password)

    fun register(email: String, password: String) = Firebase.auth.createUserWithEmailAndPassword(email, password)

    fun verify() = auth.currentUser?.sendEmailVerification()

    // signing out clears the local session only
    fun logout() = auth.signOut()

    fun save(id: String, text: String) = entries.child(id).setValue(mapOf("text" to text))

    fun add(text: String) = entries.push().setValue(mapOf("text" to text))

    fun remove(id: String) = entries.child(id).removeValue()

    fun attach(id: String, photo: Uri) = Firebase.storage.reference.child("photos/$id.jpg").putFile(photo)

    fun summarize(id: String) = Firebase.functions.getHttpsCallable("summarizeEntry").call(mapOf("id" to id))
}
