package com.example.trips.data

import com.example.trips.BuildConfig
import com.example.trips.api.Trip
import com.example.trips.api.TripsApi
import com.posthog.PostHog
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

object Remote {
    const val WEATHER_URL = "https://api.open-meteo.com/v1/forecast"

    val trips: TripsApi = Retrofit.Builder()
        .baseUrl(BuildConfig.TRIPS_URL)
        .addConverterFactory(GsonConverterFactory.create())
        .build()
        .create(TripsApi::class.java)
}

class TripsRepository {
    fun next() = Remote.trips.upcoming(Limits.PAGE_SIZE).execute()

    fun book(trip: Trip) {
        Remote.trips.book(trip).execute()
        PostHog.capture(event = "trip_booked")
    }
}
