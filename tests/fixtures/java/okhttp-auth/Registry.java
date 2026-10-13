package com.example.registry;

import java.io.IOException;
import okhttp3.Credentials;
import okhttp3.OkHttpClient;
import okhttp3.Request;

public class Registry {
    private final OkHttpClient http;
    private final String user;
    private final String password;

    public Registry(String user, String password) {
        this.user = user;
        this.password = password;
        // basic auth added by an interceptor
        this.http = new OkHttpClient.Builder()
            .addInterceptor(chain -> chain.proceed(chain.request().newBuilder()
                .header("Authorization", Credentials.basic(user, password))
                .build()))
            .build();
    }

    public void catalog() throws IOException {
        http.newCall(new Request.Builder().url("https://registry.example.com/v2/_catalog").build()).execute();
    }

    public void tags(String image) throws IOException {
        Request request = new Request.Builder()
            .url("https://registry.example.com/v2/" + image + "/tags/list")
            .addHeader("Authorization", Credentials.basic(user, password))
            .build();
        new OkHttpClient().newCall(request).execute();
    }
}
