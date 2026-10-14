package com.example.atlas;

import java.io.IOException;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.springframework.stereotype.Service;

@Service
public class Places {
    private final OkHttpClient mapsClient;
    private final OkHttpClient tilesClient;

    public Places(OkHttpClient mapsClient, OkHttpClient tilesClient) {
        this.mapsClient = mapsClient;
        this.tilesClient = tilesClient;
    }

    public Response search(String q) throws IOException {
        return mapsClient.newCall(new Request.Builder().url("https://maps.atlas-example.com/v1/search?q=" + q).build()).execute();
    }

    public Response tile(int z) throws IOException {
        return tilesClient.newCall(new Request.Builder().url("https://tiles.atlas-example.com/v1/tiles/" + z).build()).execute();
    }
}
