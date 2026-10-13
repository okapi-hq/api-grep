package com.example.weather

import retrofit2.Call
import retrofit2.Retrofit
import retrofit2.converter.scalars.ScalarsConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

interface WeatherApi {
    @GET("data/2.5/weather")
    fun current(@Query("q") city: String): Call<String>
}

// the key in the base URL's query is not sent: Retrofit resolves each relative path against the base, query dropped
object WeatherClient {
    private const val BASE = "https://api.example-weather.com/?appid=0123456789abcdef"

    val api: WeatherApi = Retrofit.Builder().baseUrl(BASE).build().create(WeatherApi::class.java)
}

interface ReportsApi {
    @POST("reports")
    fun send(@Body csv: String): Call<String>
}

object ReportsClient {
    private var retrofit: Retrofit? = null

    fun getClient(): Retrofit {
        if (retrofit == null) {
            retrofit = Retrofit.Builder()
                .baseUrl("https://reports.example-weather.com/v1/")
                .addConverterFactory(ScalarsConverterFactory.create())
                .build()
        }
        return retrofit!!
    }

    val primary: ReportsApi = getClient().create(ReportsApi::class.java)

    // the same interface on a second host: one call per base URL
    val backup: ReportsApi = Retrofit.Builder()
        .baseUrl("https://backup.example-weather.com/v1/")
        .addConverterFactory(ScalarsConverterFactory.create())
        .build()
        .create(ReportsApi::class.java)
}
