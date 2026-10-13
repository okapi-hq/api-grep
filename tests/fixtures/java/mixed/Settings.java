package com.example.notes;

import java.io.IOException;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public class Settings {
    // read from Kotlin (`Settings.DEFAULT_FOLDER`)
    public static final String DEFAULT_FOLDER = "inbox";

    private final OkHttpClient http = new OkHttpClient();

    // a Java class reading a Kotlin object's constant
    public Response status() throws IOException {
        return http.newCall(new Request.Builder().url(Endpoints.STATUS_URL).build()).execute();
    }
}
