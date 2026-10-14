package com.example.atlas.config;

import com.example.atlas.http.Interceptors;
import java.util.ArrayList;
import java.util.List;
import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AtlasConfig {

    // a list filled with add, handed to a static helper with the builder
    @Bean
    public OkHttpClient mapsClient() {
        List<Interceptor> interceptors = new ArrayList<>();
        interceptors.add(new Interceptors.Timed(new Interceptors.KeyInterceptor("atlas-demo")));
        interceptors.add(chain -> chain.proceed(chain.request().newBuilder().header("Accept-Language", "fr-FR").build()));
        OkHttpClient.Builder builder = new OkHttpClient.Builder();
        Interceptors.addAll(builder, interceptors);
        return builder.build();
    }

    @Bean
    public Interceptor primaryTiles() {
        return new Interceptors.KeyInterceptor("tiles-primary");
    }

    @Bean
    public Interceptor backupTiles() {
        return new Interceptors.KeyInterceptor("tiles-backup");
    }

    // two Interceptor beans and nothing telling which: no header attached
    @Bean
    public OkHttpClient tilesClient(Interceptor tiles) {
        OkHttpClient.Builder builder = new OkHttpClient.Builder();
        Interceptors.addAll(builder, List.of(new Interceptors.Timed(tiles)));
        return builder.build();
    }
}
