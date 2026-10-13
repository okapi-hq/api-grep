package com.example.wallet;

import java.io.IOException;
import okhttp3.Credentials;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class Podcasts {
    private static final String SEARCH_URL = "https://api.example-podcasts.com/v1/search?q=%s";
    private final OkHttpClient http = new OkHttpClient();

    // a request made by a method of the class, with the call's argument
    public Response search(String query) throws IOException {
        return http.newCall(buildSignedRequest(String.format(SEARCH_URL, query))).execute();
    }

    private Request buildSignedRequest(String url) {
        Request.Builder builder = new Request.Builder()
            .addHeader("X-Auth-Key", System.getenv("PODCASTS_KEY"))
            .url(url);
        return builder.build();
    }

    // a copy of a request, with one more header
    public void login(String user, String password) throws IOException {
        Request request = new Request.Builder()
            .url("https://api.example-podcasts.com/v1/login")
            .post(RequestBody.create("", MediaType.get("text/plain")))
            .build();
        Request signed = request.newBuilder().header("Authorization", Credentials.basic(user, password)).build();
        http.newCall(signed).execute();
    }
}
