package com.example.books.network;

import com.example.books.model.Book;
import com.example.books.model.Review;
import java.util.List;
import java.util.Map;
import okhttp3.MultipartBody;
import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.DELETE;
import retrofit2.http.Field;
import retrofit2.http.FormUrlEncoded;
import retrofit2.http.GET;
import retrofit2.http.Header;
import retrofit2.http.Headers;
import retrofit2.http.Multipart;
import retrofit2.http.POST;
import retrofit2.http.Part;
import retrofit2.http.Path;
import retrofit2.http.Query;
import retrofit2.http.QueryMap;

public interface BookApi {
    @GET("books")
    Call<List<Book>> list(@Query("page") int page, @Query("size") int size);

    @GET("books/{id}")
    Call<Book> get(@Path("id") String id);

    @Headers({"Accept: application/json", "X-Client: books-app"})
    @POST("books/{id}/reviews")
    Call<Review> review(@Path("id") String id, @Body Review review, @Header("Authorization") String auth);

    @FormUrlEncoded
    @POST("oauth/token")
    Call<String> token(@Field("grant_type") String grantType, @Field("username") String user);

    @Multipart
    @POST("books/{id}/cover")
    Call<Void> cover(@Path("id") String id, @Part MultipartBody.Part image);

    @DELETE("books/{id}")
    Call<Void> delete(@Path("id") String id);

    @GET("search")
    Call<List<Book>> search(@QueryMap Map<String, String> filters);
}
