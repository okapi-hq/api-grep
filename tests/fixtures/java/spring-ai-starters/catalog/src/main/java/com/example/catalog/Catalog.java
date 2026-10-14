package com.example.catalog;

import org.springframework.ai.anthropic.AnthropicChatModel;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.mistralai.MistralAiChatModel;
import org.springframework.ai.mistralai.MistralAiChatOptions;
import org.springframework.ai.mistralai.api.MistralAiApi;
import org.springframework.ai.ollama.OllamaEmbeddingModel;
import org.springframework.ai.ollama.api.OllamaEmbeddingOptions;
import org.springframework.ai.ollama.api.OllamaModel;
import org.springframework.ai.embedding.EmbeddingRequest;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class Catalog {
    private final ChatClient mistral;
    private final ChatClient anthropic;
    private final OllamaEmbeddingModel embeddings;

    public Catalog(MistralAiChatModel mistral, AnthropicChatModel anthropic, OllamaEmbeddingModel embeddings) {
        this.mistral = ChatClient.create(mistral);
        this.anthropic = ChatClient.create(anthropic);
        this.embeddings = embeddings;
    }

    // MISTRAL_SMALL changed in 2.0.1: the declared release tells which model it is
    public String describe(String item) {
        return mistral.prompt(item)
            .options(MistralAiChatOptions.builder().model(MistralAiApi.ChatModel.MISTRAL_SMALL.getValue()))
            .call()
            .content();
    }

    // a constant this table does not know stays unknown
    public String tag(String item) {
        return mistral.prompt(item)
            .options(MistralAiChatOptions.builder().model(MistralAiApi.ChatModel.FUTURE_MODEL.getValue()))
            .call()
            .content();
    }

    public float[][] index(List<String> items) {
        return embeddings.call(new EmbeddingRequest(items, OllamaEmbeddingOptions.builder().model(OllamaModel.NOMIC_EMBED_TEXT.id()).build())).getResults().stream().map(r -> r.getOutput()).toArray(float[][]::new);
    }

    // nothing configured: Anthropic's default model in that release
    public String review(String item) {
        return anthropic.prompt(item).call().content();
    }
}
