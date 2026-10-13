package com.example.recipes

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.functions.Functions
import io.github.jan.supabase.functions.functions
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.storage.Storage
import io.github.jan.supabase.storage.storage

val supabase = createSupabaseClient(supabaseUrl = "https://recipes-demo.supabase.co", supabaseKey = System.getenv("SUPABASE_KEY")) {
    install(Postgrest)
    install(Auth)
    install(Storage)
    install(Functions)
}

class Recipes(private val client: SupabaseClient) {
    suspend fun all() = supabase.from("recipes").select()

    suspend fun add(recipe: Map<String, String>) = supabase.from("recipes").insert(recipe)

    suspend fun drop(id: Long) = client.from("recipes").delete { filter { eq("id", id) } }

    suspend fun popular() = supabase.postgrest.rpc("popular_recipes")

    suspend fun login(mail: String, secret: String) = supabase.auth.signInWith(Email) {
        email = mail
        password = secret
    }

    suspend fun upload(name: String, bytes: ByteArray) = supabase.storage.from("photos").upload("recipes/$name.jpg", bytes)

    // a URL built locally
    fun photoUrl(name: String) = supabase.storage.from("photos").publicUrl("recipes/$name.jpg")

    suspend fun translate(id: Long) = client.functions.invoke("translate-recipe", mapOf("id" to id))

    // an injected plugin and its `get` operator
    suspend fun tagged(db: Postgrest, tag: String) = db["tags"].select { filter { eq("name", tag) } }
}
