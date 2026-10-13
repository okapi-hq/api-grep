package com.example.shelf

import com.example.vendor.VendorHeaders
import okhttp3.OkHttpClient
import okhttp3.Request
import org.springframework.cloud.openfeign.FeignClient
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestParam
import retrofit2.Retrofit
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Headers
import retrofit2.http.Query

interface ShelfApi {
    @Headers("Accept: $ACCEPT_JSON", "X-Client: ${CLIENT_NAME}-android")
    @GET("items")
    fun items(@Header(CacheControl.SAVE) save: String?, @Query(CacheControl.PAGE) page: Int, @Header(HeaderNames.TRACE) trace: String): List<String>

    // the value is only known at run time: the name is still read
    @Headers("Authorization: Bearer ${BuildConfig.SHELF_TOKEN}")
    @GET("me")
    fun me(): String

    // a name from a library's constant, not in the project: the call's headers are not all known
    @Headers("${VendorHeaders.DEVICE}: shelf")
    @GET("ping")
    fun ping(): String
}

class Shelf(private val http: OkHttpClient) {
    val api: ShelfApi = Retrofit.Builder().baseUrl("https://shelf.example.com/v1/").build().create(ShelfApi::class.java)

    fun save(id: String) {
        val request = Request.Builder()
            .url("https://shelf.example.com/v1/items/$id/save")
            .header(CacheControl.SAVE, "1")
            .addHeader(HeaderNames.TRACE, id)
            .build()
        http.newCall(request).execute()
    }
}

@FeignClient(name = "stock", url = "https://stock.example.com")
interface StockClient {
    @GetMapping("/v1/stock")
    fun stock(@RequestHeader(HeaderNames.TENANT) tenant: String, @RequestParam(CacheControl.PAGE) page: Int): String
}
