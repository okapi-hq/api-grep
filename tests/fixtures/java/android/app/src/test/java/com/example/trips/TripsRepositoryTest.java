package com.example.trips;

import okhttp3.OkHttpClient;
import okhttp3.Request;

// a test source set: out of scope
public class TripsRepositoryTest {
    public void fetchesTrips() throws Exception {
        new OkHttpClient().newCall(new Request.Builder().url("https://api.example-trips.com/v1/trips").build()).execute();
    }
}
