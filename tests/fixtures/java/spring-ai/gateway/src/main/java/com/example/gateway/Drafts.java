package com.example.gateway;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.image.ImageModel;
import org.springframework.ai.image.ImagePrompt;
import org.springframework.stereotype.Service;

@Service
public class Drafts {
    private final ChatClient chat;
    private final ImageModel images;

    public Drafts(ChatModel model, ImageModel images) {
        this.chat = ChatClient.create(model);
        this.images = images;
    }

    public String title(String text) {
        return chat.prompt().system("Write a title.").user(text).call().content();
    }

    public String cover(String text) {
        return images.call(new ImagePrompt(text)).getResult().getOutput().getUrl();
    }
}
