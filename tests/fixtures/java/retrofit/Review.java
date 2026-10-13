package com.example.books.model;

import com.google.gson.annotations.SerializedName;

public class Review {
    @SerializedName("star_rating")
    private int stars;
    private String text;

    public Review(int stars, String text) {
        this.stars = stars;
        this.text = text;
    }
}
