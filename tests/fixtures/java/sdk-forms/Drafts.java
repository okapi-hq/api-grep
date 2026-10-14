package com.example.notices;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;

public class Drafts {
    private final AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    // the defaults every draft starts from
    private MessageCreateParams.Builder base() {
        return MessageCreateParams.builder().model(Model.CLAUDE_SONNET_4_5).maxTokens(1024);
    }

    private void tone(MessageCreateParams.Builder params, boolean formal) {
        params.system("You write short notices.");
        if (formal) {
            params.temperature(0.2);
        }
    }

    public void draft(String topic) {
        client.messages().create(base().addUserMessage(topic).build());
    }

    public void formal(String topic, boolean formal) {
        MessageCreateParams.Builder params = MessageCreateParams.builder().model(Model.CLAUDE_HAIKU_4_5).maxTokens(512);
        tone(params, formal);
        params.addUserMessage(topic);
        client.messages().create(params.build());
    }
}
