package com.example.trips.api;

import java.util.List;
import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.GET;
import retrofit2.http.POST;
import retrofit2.http.Query;

// declared in Java, created and called from Kotlin
public interface TripsApi {
    @GET("trips")
    Call<List<Trip>> upcoming(@Query("limit") int limit);

    @POST("trips")
    Call<Trip> book(@Body Trip trip);
}
