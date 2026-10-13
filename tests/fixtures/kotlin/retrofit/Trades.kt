package com.example.trading

import com.google.gson.annotations.SerializedName
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Headers
import retrofit2.http.POST
import retrofit2.http.Query

data class Trade(val price: String?, @SerializedName("create_time_ms") val createdAt: String?)
data class NewOrder(@SerializedName("currency_pair") val pair: String, val amount: String, val side: String)
data class Order(val id: String)

private interface TradesApi {
    @GET("api/v4/spot/trades")
    suspend fun trades(
        @Query("currency_pair") pair: String,
        @Query("limit") limit: Int,
    ): List<Trade>

    @POST("api/v4/orders")
    @Headers("Content-Type: application/json", "Accept: application/json")
    suspend fun order(@Header("KEY") key: String, @Body order: NewOrder): Order
}

private val httpClient = OkHttpClient.Builder()
    .addInterceptor { chain ->
        chain.proceed(chain.request().newBuilder().header("X-Client", "example-app").build())
    }
    .build()

object TradesClient {
    private val api: TradesApi by lazy {
        Retrofit.Builder()
            .baseUrl("https://api.example-exchange.com/")
            .client(httpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(TradesApi::class.java)
    }

    suspend fun recent() = api.trades("BTC_USDT", 100)
}
