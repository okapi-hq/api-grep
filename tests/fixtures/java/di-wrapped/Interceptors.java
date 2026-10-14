package com.example.atlas.http;

import java.io.IOException;
import java.util.List;
import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Response;

public final class Interceptors {
    private Interceptors() {
    }

    // a static helper given the builder: not an extension, a function of the project
    public static void addAll(OkHttpClient.Builder builder, List<Interceptor> interceptors) {
        for (Interceptor interceptor : interceptors) {
            builder.addInterceptor(interceptor);
        }
    }

    public static final class KeyInterceptor implements Interceptor {
        private final String key;

        public KeyInterceptor(String key) {
            this.key = key;
        }

        @Override
        public Response intercept(Chain chain) throws IOException {
            return chain.proceed(chain.request().newBuilder().header("X-Atlas-Key", key).build());
        }
    }

    // times the interceptor it wraps and adds nothing itself
    public static final class Timed implements Interceptor {
        private final Interceptor inner;

        public Timed(Interceptor inner) {
            this.inner = inner;
        }

        @Override
        public Response intercept(Chain chain) throws IOException {
            long start = System.nanoTime();
            Response response = inner.intercept(chain);
            System.out.println(System.nanoTime() - start);
            return response;
        }
    }
}
