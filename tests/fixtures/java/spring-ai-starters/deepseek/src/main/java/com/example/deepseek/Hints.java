package com.example.deepseek;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class Hints {
    private final ChatClient chat;

    Hints(ChatClient.Builder builder) {
        this.chat = builder.build();
    }

    // no model in the code or the configuration: the starter's default for the declared release
    @GetMapping("/hint")
    String hint(String puzzle) {
        return chat.prompt(puzzle).call().content();
    }
}
