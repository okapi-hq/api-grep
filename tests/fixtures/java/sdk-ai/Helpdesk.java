package com.example.helpdesk;

import java.util.List;
import com.azure.ai.openai.OpenAIClient;
import com.azure.ai.openai.OpenAIClientBuilder;
import com.azure.ai.openai.models.ChatCompletionsOptions;
import com.azure.ai.openai.models.ChatRequestUserMessage;
import com.azure.ai.openai.models.EmbeddingsOptions;
import com.azure.core.credential.AzureKeyCredential;

public class Helpdesk {
    private static final String DEPLOYMENT = "support-gpt-4o";

    private final OpenAIClient azure = new OpenAIClientBuilder()
        .endpoint("https://contoso-support.openai.azure.com")
        .credential(new AzureKeyCredential(System.getenv("AZURE_OPENAI_KEY")))
        .buildClient();

    public void answer(String question) {
        azure.getChatCompletions(DEPLOYMENT, new ChatCompletionsOptions(List.of(new ChatRequestUserMessage(question))).setMaxTokens(300));
    }

    public void index(String text) {
        azure.getEmbeddings("support-embeddings", new EmbeddingsOptions(List.of(text)));
    }
}
