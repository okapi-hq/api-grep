package com.example.books;

import com.example.books.model.Book;
import com.example.books.network.ApiClient;
import com.example.books.network.BookApi;
import java.util.List;
import retrofit2.Call;

public class BookRepository {
    private final BookApi api = ApiClient.books();

    public Call<List<Book>> firstPage() {
        return api.list(1, 20);
    }

    public Call<Book> book(String id) {
        return api.get(id);
    }
}
