package com.example.loop

import retrofit2.Retrofit
import retrofit2.http.GET

interface LoopApi {
    @GET("loop")
    fun loop(): String
}

val retrofit = Retrofit.Builder().baseUrl("https://api.example-loop.com/").build()
// values made from themselves: following them must stop, never overflow the stack
val api = retrofit.create(api)
val other = retrofit.create(other.create(other))

fun make(x: Any): Any = retrofit.create(make(x))

fun use() {
    api.loop()
    other.loop()
    make(1).loop()
    var a = retrofit.create(LoopApi::class.java)
    a = a.create(a)
    a.loop()
}
