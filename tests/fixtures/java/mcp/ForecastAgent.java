package com.example.harbor;

import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.spec.McpSchema;
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest;
import java.time.Duration;
import java.util.Map;

public class ForecastAgent {
    private final McpSyncClient client;

    public ForecastAgent() {
        var transport = HttpClientStreamableHttpTransport.builder("https://tools.harbor.example.com").build();
        this.client = McpClient.sync(transport).requestTimeout(Duration.ofSeconds(10)).build();
    }

    public String forecast(String city) {
        client.initialize();
        client.listTools();
        var result = client.callTool(new CallToolRequest("get_forecast", Map.of("city", city, "days", 3)));
        client.readResource(new McpSchema.ReadResourceRequest("file:///tides/today.json"));
        client.getPrompt(new McpSchema.GetPromptRequest("daily_brief", Map.of("tone", "short")));
        return result.toString();
    }
}
