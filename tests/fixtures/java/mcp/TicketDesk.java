package com.example.harbor;

import io.modelcontextprotocol.client.McpAsyncClient;
import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.transport.HttpClientSseClientTransport;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.spec.McpSchema;
import java.util.Map;

public class TicketDesk {
    public void search(String query) {
        var transport = HttpClientSseClientTransport.builder(System.getenv("HELPDESK_MCP_URL")).sseEndpoint("/v2/events").build();
        McpAsyncClient desk = McpClient.async(transport).build();
        desk.initialize().block();
        desk.callTool(McpSchema.CallToolRequest.builder().name("search_tickets").arguments(Map.of("query", query)).build()).block();
        desk.listPrompts().block();
    }

    public void legacy() {
        var transport = new HttpClientSseClientTransport("http://localhost:7070");
        var client = McpClient.sync(transport).build();
        client.ping();
    }

    public void scoped() {
        var transport = HttpClientStreamableHttpTransport.builder("https://gateway.harbor.example.com/teams/ops/").endpoint("rpc").build();
        var client = McpClient.sync(transport).build();
        client.callTool(McpSchema.CallToolRequest.builder("close_ticket").arguments(Map.of("id", 42)).build());
    }
}
