package com.example.picked;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

@Service
public class Answers {
    private final ChatClient chat;

    public Answers(ChatClient.Builder builder) {
        this.chat = builder.build();
    }

    // spring.ai.model.chat keeps one of the two chat starters
    public String answer(String question) {
        return chat.prompt(question).call().content();
    }
}
