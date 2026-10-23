package com.example.harbor;

import io.modelcontextprotocol.client.McpSyncClient;
import java.util.List;

public class ToolRouter {
    private final McpSyncClient client;

    public ToolRouter(McpSyncClient client) {
        this.client = client;
    }

    public int count() {
        return client.listTools().tools().size();
    }
}
