package com.example.trips.api;

import com.google.gson.annotations.SerializedName;

public class Trip {
    @SerializedName("destination_code")
    public String destination;
    public int nights;
}
