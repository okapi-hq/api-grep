package com.example.reader

import com.google.firebase.remoteconfig.FirebaseRemoteConfig
import com.google.firebase.remoteconfig.FirebaseRemoteConfigSettings

object Flags {
    fun refresh() {
        val config = FirebaseRemoteConfig.getInstance()
        config.setConfigSettingsAsync(FirebaseRemoteConfigSettings.Builder().setMinimumFetchIntervalInSeconds(3600).build())
        config.fetchAndActivate()
    }
}
