package com.example.core

import com.posthog.PostHog
import com.posthog.PostHogConfig

object Analytics {
    private const val HOST = "https://eu.i.posthog.com"

    fun start(apiKey: String) {
        PostHog.setup(PostHogConfig(apiKey = apiKey, host = HOST))
    }

    fun track(event: String) = PostHog.capture(event = event)
}
