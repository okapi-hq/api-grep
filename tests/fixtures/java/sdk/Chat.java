package com.example.assistant;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.openai.client.OpenAIClient;
import com.openai.client.okhttp.OpenAIOkHttpClient;
import com.openai.models.ChatModel;
import com.openai.models.chat.completions.ChatCompletion;
import com.openai.models.chat.completions.ChatCompletionCreateParams;

public class Chat {
    private final OpenAIClient openai = OpenAIOkHttpClient.fromEnv();
    private final AnthropicClient claude = AnthropicOkHttpClient.builder().apiKey(System.getenv("ANTHROPIC_API_KEY")).build();

    public ChatCompletion complete(String question) {
        ChatCompletionCreateParams params = ChatCompletionCreateParams.builder()
            .model(ChatModel.GPT_4_1_MINI)
            .addSystemMessage("Answer briefly.")
            .addUserMessage(question)
            .maxCompletionTokens(300)
            .build();
        return openai.chat().completions().create(params);
    }

    public Message ask(String question) {
        return claude.messages().create(MessageCreateParams.builder()
            .model(Model.CLAUDE_SONNET_4_5)
            .maxTokens(1024L)
            .addUserMessage(question)
            .build());
    }
}
