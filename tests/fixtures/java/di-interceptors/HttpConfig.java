package com.example.ledger.config;

import java.util.List;
import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class HttpConfig {

    // every Interceptor bean, added in a loop
    @Bean
    public OkHttpClient ledgerClient(List<Interceptor> interceptors) {
        OkHttpClient.Builder builder = new OkHttpClient.Builder();
        for (Interceptor interceptor : interceptors) {
            builder.addInterceptor(interceptor);
        }
        return builder.build();
    }

    // every Interceptor bean, through a method reference on the builder
    @Bean
    public OkHttpClient reportsClient(ObjectProvider<Interceptor> interceptors) {
        OkHttpClient.Builder builder = new OkHttpClient.Builder();
        interceptors.orderedStream().forEach(builder::addInterceptor);
        return builder.build();
    }

    // a provider of the whole list
    @Bean
    public OkHttpClient auditClient(ObjectProvider<List<Interceptor>> interceptors) {
        OkHttpClient.Builder builder = new OkHttpClient.Builder();
        interceptors.getObject().forEach(builder::addNetworkInterceptor);
        return builder.build();
    }

    // a loop variable reassigned in the loop is not the element any more
    @Bean
    public OkHttpClient exportsClient(List<Interceptor> interceptors, Interceptor fallback) {
        OkHttpClient.Builder builder = new OkHttpClient.Builder();
        for (Interceptor interceptor : interceptors) {
            interceptor = fallback;
            builder.addInterceptor(interceptor);
        }
        return builder.build();
    }
}
