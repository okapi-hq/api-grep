package com.example.harbor;

import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpSyncServer;
import io.modelcontextprotocol.server.transport.HttpServletStreamableServerTransportProvider;

public class ToolServer {
    public McpSyncServer start(HttpServletStreamableServerTransportProvider provider) {
        McpSyncServer server = McpServer.sync(provider).serverInfo("harbor-tools", "1.0.0").build();
        server.notifyToolsListChanged();
        server.closeGracefully();
        return server;
    }
}
