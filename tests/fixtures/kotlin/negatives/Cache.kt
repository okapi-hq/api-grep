package com.example.links

class Cache { private val entries = HashMap<String, String>() }

class Thumbnails(private val cache: MutableMap<String, ByteArray>) {
    companion object { const val PLACEHOLDER = "https://cdn.example.org/placeholder.png" }

    fun cached(url: String): ByteArray? = cache.get(url) ?: cache[PLACEHOLDER]

    fun remember(url: String, bytes: ByteArray) { cache.put(url, bytes) }
}
