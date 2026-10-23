package com.example.atlas;

import com.google.cloud.vertexai.VertexAI;
import com.google.cloud.vertexai.api.GenerateContentResponse;
import com.google.cloud.vertexai.api.GenerationConfig;
import com.google.cloud.vertexai.generativeai.ChatSession;
import com.google.cloud.vertexai.generativeai.GenerativeModel;
import com.google.cloud.vertexai.generativeai.ResponseHandler;

public class Summarizer {
    private final VertexAI vertexAi = new VertexAI("atlas-notes-prod", "europe-west4");

    public String summarize(String text) throws Exception {
        GenerativeModel model = new GenerativeModel("gemini-2.0-flash", vertexAi);
        GenerateContentResponse response = model.generateContent("Summarize: " + text);
        return ResponseHandler.getText(response);
    }

    public void stream(String text) throws Exception {
        GenerativeModel model = new GenerativeModel.Builder()
            .setModelName("gemini-2.5-pro")
            .setVertexAi(vertexAi)
            .build();
        model.generateContentStream(text).stream().forEach(System.out::println);
        model.countTokens(text);
    }

    public String chat(String question) throws Exception {
        GenerativeModel model = new GenerativeModel("gemini-2.0-flash-lite", vertexAi)
            .withGenerationConfig(GenerationConfig.newBuilder().setTemperature(0.2f).build());
        ChatSession chat = model.startChat();
        return ResponseHandler.getText(chat.sendMessage(question));
    }
}
