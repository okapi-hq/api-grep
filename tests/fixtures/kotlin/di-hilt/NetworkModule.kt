package com.example.shelf.di

import com.example.shelf.api.CatalogApi
import com.example.shelf.api.ReviewsApi
import com.example.shelf.net.AuthInterceptor
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Named
import javax.inject.Qualifier
import javax.inject.Singleton
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.converter.protobuf.ProtoConverterFactory

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class CatalogRetrofit

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class ReviewsRetrofit

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    // the interceptor is injected: its headers apply to every call of the client
    @Provides
    @Singleton
    fun okHttp(auth: AuthInterceptor): OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(auth)
        .build()

    // a client built from the provided one, under a name
    @Provides
    @Named("uploads")
    fun uploadsClient(client: OkHttpClient): OkHttpClient = client.newBuilder()
        .addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("X-Upload-Channel", "mobile").build()) }
        .build()

    // a builder the graph provides and its users finish; the protobuf converter does not write a class of the project
    @Provides
    fun retrofitBuilder(client: OkHttpClient): Retrofit.Builder = Retrofit.Builder()
        .client(client)
        .addConverterFactory(ProtoConverterFactory.create())
        .addConverterFactory(GsonConverterFactory.create())

    @Provides
    @Singleton
    @CatalogRetrofit
    fun catalogRetrofit(builder: Retrofit.Builder): Retrofit = builder.baseUrl("https://catalog.shelf-example.com/v2/").build()

    @Provides
    @Singleton
    @ReviewsRetrofit
    fun reviewsRetrofit(builder: Retrofit.Builder): Retrofit {
        return builder.baseUrl("https://reviews.shelf-example.com/").build()
    }

    // the service type is the function's return type
    @Provides
    fun catalogApi(@CatalogRetrofit retrofit: Retrofit): CatalogApi = retrofit.create()

    @Provides
    fun reviewsApi(@ReviewsRetrofit retrofit: Retrofit): ReviewsApi = retrofit.create(ReviewsApi::class.java)
}
