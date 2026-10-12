package com.example.links

import android.content.Context
import android.content.Intent
import android.net.Uri

/** URLs the app shows or hands to other apps: none of them is requested by this code. */
object Links {
    const val PRIVACY = "https://example.org/privacy"
    const val STORE = "https://play.google.com/store/apps/details?id=com.example.links"
    val SUPPORT = mapOf("en" to "https://example.org/help", "fr" to "https://example.org/aide")

    fun open(context: Context, url: String) {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }

    fun share(context: Context) {
        val text = "Get the app: $STORE"
        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_TEXT, text), null))
    }
}
