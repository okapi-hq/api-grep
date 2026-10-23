package com.example.harbor;

import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.transport.ServerParameters;
import io.modelcontextprotocol.client.transport.StdioClientTransport;

public class LocalTools {
    public void run() {
        var params = ServerParameters.builder("npx").args("-y", "@example/files-server").build();
        var client = McpClient.sync(new StdioClientTransport(params)).build();
        client.initialize();
        client.listTools();
    }
}
