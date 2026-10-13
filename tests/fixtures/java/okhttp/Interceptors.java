package com.example.wallet;

import java.io.IOException;
import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

class TokenInterceptor implements Interceptor {
    private final String token;

    TokenInterceptor(String token) {
        this.token = token;
    }

    @Override
    public Response intercept(Chain chain) throws IOException {
        Request request = chain.request().newBuilder()
            .header("Authorization", "Bearer " + token)
            .build();
        return chain.proceed(request);
    }
}

public class Interceptors {
    private static final String KEY = System.getenv("WEATHER_KEY");

    // every request of this client goes through the interceptor
    private final OkHttpClient client = new OkHttpClient.Builder()
        .addInterceptor(chain -> {
            Request original = chain.request();
            return chain.proceed(original.newBuilder().url(original.url().newBuilder().addQueryParameter("apikey", KEY).build()).build());
        })
        .build();

    public String forecast(String city) throws IOException {
        Request req = new Request.Builder().url("https://api.open-meteo.com/v1/forecast?city=" + city).build();
        return client.newCall(req).execute().body().string();
    }

    public Response repos(String token) throws IOException {
        OkHttpClient http = new OkHttpClient.Builder().addInterceptor(new TokenInterceptor(token)).build();
        return http.newCall(new Request.Builder().url("https://api.github.com/user/repos").get().build()).execute();
    }

    public void star(String owner, String repo) throws IOException {
        OkHttpClient versioned = client.newBuilder().addNetworkInterceptor(new Interceptor() {
            @Override
            public Response intercept(Chain chain) throws IOException {
                return chain.proceed(chain.request().newBuilder().addHeader("X-GitHub-Api-Version", "2022-11-28").build());
            }
        }).build();
        versioned.newCall(new Request.Builder().url(String.format("https://api.github.com/user/starred/%s/%s", owner, repo)).delete().build()).execute();
    }
}
