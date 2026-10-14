package com.example.pair;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

@Service
public class Reviewer {
    private final ChatClient critic;
    private final ChatModel openAiChatModel;
    private final ChatClient.Builder builder;
    private final EmbeddingModel embeddings;

    public Reviewer(@Qualifier("anthropicChatModel") ChatModel critic, ChatModel openAiChatModel, ChatClient.Builder builder, EmbeddingModel embeddings) {
        this.critic = ChatClient.builder(critic).build();
        this.openAiChatModel = openAiChatModel;
        this.builder = builder;
        this.embeddings = embeddings;
    }

    // the qualifier names Anthropic's model bean
    public String critique(String draft) {
        return critic.prompt(draft).call().content();
    }

    // no qualifier: Spring falls back to the bean named like the parameter
    public String rewrite(String draft) {
        return openAiChatModel.call(draft);
    }

    // two chat starters and nothing tying the builder to one: no call
    public String either(String draft) {
        return builder.build().prompt(draft).call().content();
    }

    // only the OpenAI starter has an embedding model
    public float[] vector(String draft) {
        return embeddings.embed(draft);
    }
}
