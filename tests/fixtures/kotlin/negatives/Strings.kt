package com.example.links

import android.util.Log

private const val TAG = "Links"

fun describe(base: String, path: String): String {
    Log.d(TAG, "resolving $base/$path")
    return buildString {
        append(base.trimEnd('/'))
        append("/")
        append(path)
    }
}
