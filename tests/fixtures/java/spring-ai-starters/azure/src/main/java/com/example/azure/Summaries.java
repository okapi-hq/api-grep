package com.example.azure;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.stereotype.Service;

@Service
public class Summaries {
    private final ChatClient chat;
    private final EmbeddingModel embeddings;

    public Summaries(ChatClient.Builder builder, EmbeddingModel embeddings) {
        this.chat = builder.build();
        this.embeddings = embeddings;
    }

    public String summarize(String text) {
        return chat.prompt().user(text).call().content();
    }

    public float[] vector(String text) {
        return embeddings.embed(text);
    }
}
