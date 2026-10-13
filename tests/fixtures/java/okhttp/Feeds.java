package com.example.feeds;

import java.io.IOException;
import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;

class Feeds {
    static final String CACHE_KEY = "X-Cache-Key";
    private final OkHttpClient client = createClient();

    // the client is made by a method of the class
    private OkHttpClient createClient() {
        return new OkHttpClient.Builder()
            .addInterceptor(new ClientHeaders())
            .addNetworkInterceptor(new CacheHeaders())
            .addInterceptor(new OfflineFallback())
            .build();
    }

    Response latest() throws IOException {
        return client.newCall(new Request.Builder().url("https://api.example-feeds.com/v1/latest").build()).execute();
    }

    static class ClientHeaders implements Interceptor {
        @Override
        public Response intercept(Interceptor.Chain chain) throws IOException {
            Request request = chain.request().newBuilder().header("X-Client", "feeds-app").build();
            return chain.proceed(request);
        }
    }

    // reads a request header and changes the response: adds nothing to the request
    static class CacheHeaders implements Interceptor {
        @Override
        public Response intercept(Interceptor.Chain chain) throws IOException {
            String key = chain.request().header(CACHE_KEY);
            Response response = chain.proceed(chain.request());
            return response.newBuilder().header("Cache-Control", "max-age=60").build();
        }
    }

    // makes a response of its own when the network fails
    static class OfflineFallback implements Interceptor {
        @Override
        public Response intercept(Interceptor.Chain chain) throws IOException {
            try {
                return chain.proceed(chain.request());
            } catch (IOException e) {
                Response.Builder builder = new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200);
                builder.header("X-Offline", "true");
                return builder.build();
            }
        }
    }
}
