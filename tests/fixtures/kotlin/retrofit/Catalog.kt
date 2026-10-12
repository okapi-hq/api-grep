package com.example.catalog

import com.example.catalog.BuildConfig
import com.squareup.moshi.Json
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Call
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import retrofit2.create
import retrofit2.http.*

data class Item(val id: String, @Json(name = "display_name") val name: String, val price: Long?)
data class Reason(val code: String)

interface CatalogService {
    @GET("items/{id}")
    fun item(@Path("id") id: String): Call<Item>

    @GET("/health")
    fun health(): Call<String>

    @GET("search?sort=name")
    fun search(@QueryMap filters: Map<String, String>, @Query("page") page: Int): Call<List<Item>>

    @HTTP(method = "DELETE", path = "items/{id}", hasBody = true)
    fun remove(@Path("id") id: String, @Body reason: Reason): Call<Unit>

    @GET
    fun page(@Url url: String): Call<List<Item>>

    @POST(".")
    fun add(@Body item: Item): Call<Item>

    @FormUrlEncoded
    @PUT("items/{id}/name")
    fun rename(@Path("id") id: String, @Field("display_name") name: String, @Field("notify") notify: Boolean): Call<Item>

    @Multipart
    @POST("items/{id}/image")
    fun upload(@Path("id") id: String, @Part("caption") caption: RequestBody, @Part image: MultipartBody.Part): Call<Item>

    @GET("items")
    fun list(@HeaderMap headers: Map<String, String>, @Header("Authorization") token: String): Call<List<Item>>
}

object Catalog {
    private val retrofit = Retrofit.Builder()
        .baseUrl(BuildConfig.CATALOG_URL)
        .addConverterFactory(MoshiConverterFactory.create())
        .build()

    val service: CatalogService = retrofit.create<CatalogService>()

    fun next(link: String) = service.page("https://cdn.example-catalog.com/pages/2.json")
}
