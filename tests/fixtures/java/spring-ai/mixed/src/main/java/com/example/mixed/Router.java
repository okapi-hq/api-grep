package com.example.mixed;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.mistralai.MistralAiChatModel;
import org.springframework.ai.ollama.OllamaChatModel;
import org.springframework.ai.ollama.api.OllamaApi;
import org.springframework.ai.ollama.api.OllamaChatOptions;
import org.springframework.stereotype.Component;

@Component
public class Router {
    private final ChatClient local;
    private final ChatClient hosted;
    private final ChatModel any;
    private final OllamaChatModel gpu = OllamaChatModel.builder()
        .ollamaApi(OllamaApi.builder().baseUrl("http://gpu-box.internal:11434").build())
        .defaultOptions(OllamaChatOptions.builder().model("llama3.1:70b").build())
        .build();

    public Router(OllamaChatModel ollama, MistralAiChatModel mistral, ChatModel any) {
        this.local = ChatClient.builder(ollama).build();
        this.hosted = ChatClient.create(mistral);
        this.any = any;
    }

    public String cheap(String q) {
        return local.prompt(q).call().content();
    }

    public String smart(String q) {
        return hosted.prompt(q).call().content();
    }

    public String heavy(String q) {
        return gpu.call(q);
    }

    // two model starters: the injected ChatModel could be either
    public String unknown(String q) {
        return any.call(q);
    }
}
