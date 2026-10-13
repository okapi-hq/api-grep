package com.example.alerts

import com.posthog.java.PostHog
import com.slack.api.Slack
import com.slack.api.methods.MethodsClient
import com.slack.api.methods.request.chat.ChatPostMessageRequest
import com.twilio.Twilio
import com.twilio.rest.api.v2010.account.Message
import com.twilio.rest.verify.v2.service.Verification
import com.twilio.type.PhoneNumber
import io.sentry.Sentry

class Notifier(private val sender: String, private val verifyService: String) {
    private val slack = Slack.getInstance().methods(System.getenv("SLACK_TOKEN"))
    private val analytics = PostHog.Builder(System.getenv("POSTHOG_KEY")).host("https://eu.i.posthog.com").build()

    init {
        Twilio.init(System.getenv("TWILIO_SID"), System.getenv("TWILIO_TOKEN"))
    }

    fun sms(to: String, text: String) {
        try {
            Message.creator(PhoneNumber(to), PhoneNumber(sender), text).setStatusCallback("https://alerts.example.com/status").create()
        } catch (e: Exception) {
            Sentry.captureException(e)
        }
    }

    fun verify(to: String) = Verification.creator(verifyService, to, "sms").create()

    fun post(channel: String, text: String) {
        slack.chatPostMessage(ChatPostMessageRequest.builder().channel(channel).text(text).build())
        analytics.capture("system", "alert_posted", mapOf("channel" to channel))
    }

    fun reply(client: MethodsClient, channel: String, thread: String) = client.chatPostMessage { it.channel(channel).threadTs(thread).text("On it") }

    // a `Slack` given as a typed parameter, its `methods` client made on the spot
    fun team(app: Slack, token: String) = app.methods(token).teamInfo { it }
}
