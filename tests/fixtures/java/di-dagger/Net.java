package com.example.parcels.net;

import java.io.IOException;
import javax.inject.Inject;
import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import retrofit2.Call;
import retrofit2.http.GET;
import retrofit2.http.Path;

class KeyStore {
    @Inject
    KeyStore() {}

    String key() {
        return System.getenv("PARCELS_API_KEY");
    }
}

public class ApiKeyInterceptor implements Interceptor {
    private final KeyStore keys;

    @Inject
    public ApiKeyInterceptor(KeyStore keys) {
        this.keys = keys;
    }

    @Override
    public Response intercept(Chain chain) throws IOException {
        Request request = chain.request().newBuilder().header("X-Api-Key", keys.key()).build();
        return chain.proceed(request);
    }
}

interface TrackingApi {
    @GET("parcels/{id}")
    Call<String> parcel(@Path("id") String id);
}

class LabelsRepository {
    private final OkHttpClient client;

    @Inject
    LabelsRepository(OkHttpClient client) {
        this.client = client;
    }

    Response label(String id) throws IOException {
        return client.newCall(new Request.Builder().url("https://labels.parcels-example.com/v1/labels/" + id).build()).execute();
    }
}
