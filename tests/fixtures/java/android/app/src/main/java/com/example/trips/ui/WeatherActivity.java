package com.example.trips.ui;

import com.example.trips.data.Remote;
import com.posthog.PostHog;
import java.io.IOException;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public class WeatherActivity {
    private final OkHttpClient client = new OkHttpClient();

    // a Java class reading a Kotlin object's constant
    public Response forecast(double lat, double lon) throws IOException {
        HttpUrl url = HttpUrl.get(Remote.WEATHER_URL).newBuilder()
            .addQueryParameter("latitude", String.valueOf(lat))
            .addQueryParameter("longitude", String.valueOf(lon))
            .build();
        PostHog.capture("forecast_viewed");
        return client.newCall(new Request.Builder().url(url).build()).execute();
    }
}
