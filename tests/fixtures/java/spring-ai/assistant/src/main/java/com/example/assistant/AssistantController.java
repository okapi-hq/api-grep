package com.example.assistant;

import java.util.List;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

@RestController
class AssistantController {

    private final ChatClient chatClient;
    private final ChatModel chatModel;
    private final EmbeddingModel embeddingModel;

    AssistantController(ChatClient.Builder builder, ChatModel chatModel, EmbeddingModel embeddingModel) {
        this.chatClient = builder.defaultSystem("You answer questions about recipes.").build();
        this.chatModel = chatModel;
        this.embeddingModel = embeddingModel;
    }

    @GetMapping("/ask")
    String ask(String question) {
        return chatClient.prompt().user(question).call().content();
    }

    @GetMapping("/ask/stream")
    Flux<String> stream(String question) {
        return chatClient.prompt(question).stream().content();
    }

    // the options of the prompt choose another model
    @GetMapping("/ask/precise")
    String precise(String question) {
        return chatClient.prompt()
                .user(question)
                .options(OpenAiChatOptions.builder().model("gpt-4.1").temperature(0.0).build())
                .call()
                .content();
    }

    @GetMapping("/complete")
    String complete(String text) {
        return chatModel.call(new Prompt(text, OpenAiChatOptions.builder().model("gpt-4.1-nano").build())).getResult().getOutput().getText();
    }

    @GetMapping("/embed")
    float[] embed(String text) {
        return embeddingModel.embed(text);
    }

    // reading the response is not another request
    String summary(String question) {
        ChatClient.CallResponseSpec response = chatClient.prompt(question).call();
        return response.content();
    }
}
