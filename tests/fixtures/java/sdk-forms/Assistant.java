package com.example.notices;

import java.util.List;
import com.azure.ai.openai.OpenAIClient;
import com.azure.ai.openai.OpenAIClientBuilder;
import com.azure.ai.openai.models.ChatCompletionsOptions;
import com.azure.ai.openai.models.ChatRequestMessage;
import com.azure.ai.openai.models.ChatRequestUserMessage;
import com.azure.ai.openai.models.ImageGenerationOptions;
import com.azure.ai.openai.models.ImageSize;
import com.azure.core.credential.AzureKeyCredential;

public class Assistant {
    private final OpenAIClient azure = new OpenAIClientBuilder()
        .endpoint("https://notices-ai.openai.azure.com")
        .credential(new AzureKeyCredential(System.getenv("AZURE_OPENAI_KEY")))
        .buildClient();

    public void summarize(String text, boolean creative) {
        List<ChatRequestMessage> messages = List.of(new ChatRequestUserMessage(text));
        ChatCompletionsOptions options = new ChatCompletionsOptions(messages);
        options.setMaxTokens(400);
        options.setUser("notices");
        if (creative) {
            options.setTemperature(0.9);
        }
        azure.getChatCompletions("notices-gpt-4o", options);
    }

    public void banner(String prompt) {
        azure.getImageGenerations("notices-dalle", new ImageGenerationOptions(prompt).setN(1).setSize(ImageSize.SIZE1024X1024));
    }
}
