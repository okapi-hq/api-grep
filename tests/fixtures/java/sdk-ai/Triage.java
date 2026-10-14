package com.example.helpdesk;

import dev.langchain4j.model.bedrock.BedrockChatModel;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.googleai.GoogleAiGeminiChatModel;
import dev.langchain4j.model.mistralai.MistralAiChatModel;
import dev.langchain4j.model.mistralai.MistralAiChatModelName;

public class Triage {
    private final ChatModel gemini = GoogleAiGeminiChatModel.builder()
        .apiKey(System.getenv("GEMINI_API_KEY"))
        .modelName("gemini-2.0-flash")
        .temperature(0.1)
        .build();

    private final ChatModel mistral = MistralAiChatModel.builder()
        .apiKey(System.getenv("MISTRAL_API_KEY"))
        .modelName(MistralAiChatModelName.MISTRAL_SMALL_LATEST)
        .build();

    private final ChatModel bedrock = BedrockChatModel.builder().modelId("anthropic.claude-3-5-haiku-20241022-v1:0").build();

    public String route(String ticket) {
        return gemini.chat("Route this ticket: " + ticket);
    }
}
