package com.example.profiles

import dagger.Module
import dagger.Provides
import retrofit2.Call
import retrofit2.Retrofit
import retrofit2.http.GET
import retrofit2.http.Path

interface ProfilesApi {
    @GET("profiles/{id}")
    fun profile(@Path("id") id: String): Call<String>
}

// the Retrofit is injected: with several builders in the project, which one is not known (#46)
@Module
object ProfilesModule {
    @Provides
    fun profiles(retrofit: Retrofit): ProfilesApi = retrofit.create(ProfilesApi::class.java)
}
