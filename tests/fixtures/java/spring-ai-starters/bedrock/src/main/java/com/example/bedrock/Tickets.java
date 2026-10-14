package com.example.bedrock;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;

@Service
public class Tickets {
    private final ChatClient chat;

    public Tickets(ChatClient.Builder builder) {
        this.chat = builder.defaultSystem("You triage support tickets.").build();
    }

    public String triage(String ticket) {
        return chat.prompt(ticket).call().content();
    }

    public Flux<String> draft(String ticket) {
        return chat.prompt(ticket).stream().content();
    }
}
