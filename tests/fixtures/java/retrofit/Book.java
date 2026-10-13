package com.example.books.model;

import com.google.gson.annotations.SerializedName;

public class Book {
    @SerializedName("book_id")
    private String id;
    private String title;
    private transient boolean cached;
}
