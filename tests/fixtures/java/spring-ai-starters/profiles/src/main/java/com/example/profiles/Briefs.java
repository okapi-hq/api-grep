package com.example.profiles;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

@Service
public class Briefs {
    private final ChatClient chat;

    public Briefs(ChatClient.Builder builder) {
        this.chat = builder.build();
    }

    // the model of the active profile, the base URL of an imported file
    public String brief(String notes) {
        return chat.prompt(notes).call().content();
    }
}
