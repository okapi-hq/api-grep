package com.example.parking.net;

import javax.inject.Inject;
import javax.inject.Named;
import javax.inject.Provider;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import retrofit2.Call;
import retrofit2.http.GET;
import retrofit2.http.Path;

interface MetersApi {
    @GET("meters/{id}")
    Call<String> meter(@Path("id") String id);
}

class ReceiptsRepository {
    private final Provider<OkHttpClient> clients;

    @Inject
    ReceiptsRepository(@Named("metered") Provider<OkHttpClient> clients) {
        this.clients = clients;
    }

    Response receipt(String id) throws java.io.IOException {
        return clients.get().newCall(new Request.Builder().url("https://receipts.parking-example.com/v1/" + id).build()).execute();
    }
}
