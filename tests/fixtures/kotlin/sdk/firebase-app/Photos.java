package com.example.journal;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.storage.FirebaseStorage;
import com.google.firebase.storage.StorageReference;

public class Photos {
    private final StorageReference root = FirebaseStorage.getInstance().getReference();

    public void download(String name) {
        root.child("photos/" + name).getBytes(1024 * 1024);
    }

    public void forgot(String email) {
        FirebaseAuth.getInstance().sendPasswordResetEmail(email);
    }

    public void token() {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        user.getIdToken(true);
    }
}
