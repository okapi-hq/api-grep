package com.example.alerts;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import java.io.IOException;

// firebase-admin is declared: its classes at the root of com.google.firebase are its own
public final class FirebaseSetup {
    private FirebaseSetup() {}

    public static FirebaseApp init() throws IOException {
        FirebaseOptions options = FirebaseOptions.builder().setCredentials(GoogleCredentials.getApplicationDefault()).build();
        return FirebaseApp.initializeApp(options);
    }
}
