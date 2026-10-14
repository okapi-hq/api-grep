package com.example.genai;

import org.springframework.ai.chat.model.ChatModel;
import org.springframework.stereotype.Component;

@Component
public class Captions {
    private final ChatModel model;

    public Captions(ChatModel model) {
        this.model = model;
    }

    public String caption(String scene) {
        return model.call("Write a caption for: " + scene);
    }
}
