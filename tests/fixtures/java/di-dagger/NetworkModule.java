package com.example.parcels.di;

import com.example.parcels.net.ApiKeyInterceptor;
import com.example.parcels.net.TrackingApi;
import dagger.Binds;
import dagger.Module;
import dagger.Provides;
import javax.inject.Named;
import javax.inject.Singleton;
import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import retrofit2.Retrofit;
import retrofit2.converter.jackson.JacksonConverterFactory;

@Module
public abstract class NetworkModule {

    // the interceptor bound to its interface
    @Binds
    abstract Interceptor bindInterceptor(ApiKeyInterceptor impl);

    @Provides
    @Singleton
    static OkHttpClient provideClient(Interceptor interceptor) {
        return new OkHttpClient.Builder().addInterceptor(interceptor).build();
    }

    @Provides
    @Named("tracking")
    static String provideTrackingUrl() {
        return "https://tracking.parcels-example.com/api/";
    }

    @Provides
    @Singleton
    static Retrofit provideRetrofit(OkHttpClient client, @Named("tracking") String baseUrl) {
        return new Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(client)
            .addConverterFactory(JacksonConverterFactory.create())
            .build();
    }

    @Provides
    static TrackingApi provideTrackingApi(Retrofit retrofit) {
        return retrofit.create(TrackingApi.class);
    }
}
