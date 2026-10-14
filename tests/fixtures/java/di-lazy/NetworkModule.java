package com.example.parking.net;

import dagger.Lazy;
import dagger.Module;
import dagger.Provides;
import dagger.multibindings.IntoSet;
import java.util.Set;
import javax.inject.Named;
import javax.inject.Singleton;
import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import retrofit2.Retrofit;

@Module
public class NetworkModule {
    @Provides
    @IntoSet
    static Interceptor zoneHeader() {
        return chain -> chain.proceed(chain.request().newBuilder().header("X-Zone", "north").build());
    }

    @Provides
    @Singleton
    @Named("metered")
    static OkHttpClient meteredClient(Set<Interceptor> interceptors) {
        OkHttpClient.Builder builder = new OkHttpClient.Builder();
        interceptors.forEach(i -> builder.addInterceptor(i));
        return builder.build();
    }

    @Provides
    @Singleton
    static Retrofit retrofit(@Named("metered") Lazy<OkHttpClient> client) {
        return new Retrofit.Builder()
            .baseUrl("https://api.parking-example.com/v1/")
            .callFactory(request -> client.get().newCall(request))
            .build();
    }

    @Provides
    static MetersApi metersApi(Retrofit retrofit) {
        return retrofit.create(MetersApi.class);
    }
}
