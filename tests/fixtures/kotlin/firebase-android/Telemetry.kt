package com.example.reader

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.analytics.FirebaseAnalytics
import com.google.firebase.crashlytics.FirebaseCrashlytics
import com.google.firebase.perf.trace

class Telemetry(private val context: Context) {
    fun start() {
        FirebaseApp.initializeApp(context)
        FirebaseCrashlytics.getInstance().setCrashlyticsCollectionEnabled(true)
    }

    fun opened(screen: String) = trace("open_$screen") {
        FirebaseAnalytics.getInstance(context).logEvent("screen_view", null)
    }
}
