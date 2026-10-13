package com.example.links

import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.RemoteMessage

/** The Android firebase-messaging has firebase-admin's class names, not its server calls. */
class Push(private val messaging: FirebaseMessaging) {
    fun follow(topic: String) = messaging.subscribeToTopic(topic)

    fun unfollow(topic: String) = FirebaseMessaging.getInstance().unsubscribeFromTopic(topic)

    fun upstream(to: String) = FirebaseMessaging.getInstance().send(RemoteMessage.Builder(to).build())
}
