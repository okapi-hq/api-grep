package com.example.vertex;

import org.springframework.ai.chat.model.ChatModel;
import org.springframework.stereotype.Component;

// the Google GenAI starter with a project goes to Vertex AI: another host, not read
@Component
public class Labels {
    private final ChatModel model;

    public Labels(ChatModel model) {
        this.model = model;
    }

    public String label(String item) {
        return model.call("Label: " + item);
    }
}
