#!/usr/bin/env node

/**
 * MCP Server for Mastra Agents
 * This server exposes all Mastra agents as MCP tools for Claude Desktop
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// This process speaks JSON-RPC over stdout, so anything else written there
// corrupts the stream and the client fails to connect. These must be set
// before Mastra is loaded and its logger is constructed - and `import` is
// hoisted above assignments, so the agents are pulled in dynamically below.
process.env.NO_COLOR = '1';
process.env.FORCE_COLOR = '0';
process.env.MCP_MODE = '1';

const { mastra } = await import('./src/mastra/index.js');

// Initialize MCP Server
const server = new Server(
  {
    name: 'demo-mastra',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List all available tools (agents)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const agents = mastra.getAgents();
  
  const tools = Object.entries(agents).map(([name, agent]) => ({
    name: name,
    description: agent.instructions || `Mastra agent: ${name}`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The prompt or task for the agent to process',
        },
        context: {
          type: 'object',
          description: 'Additional context or parameters for the agent',
        },
      },
      required: ['prompt'],
    },
  }));

  return { tools };
});

// Handle tool calls (agent execution)
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    const agents = mastra.getAgents();
    // `name` is whatever the MCP client sent, so widen the keyed lookup.
    const agent = (agents as Record<string, (typeof agents)[keyof typeof agents]>)[name];

    if (!agent) {
      throw new Error(`Agent '${name}' not found`);
    }

    const { prompt, context } = args as {
      prompt: string;
      context?: Record<string, unknown>;
    };
    
    // Execute the agent
    const result = await agent.generate(prompt, {
      ...(context || {}),
    });

    return {
      content: [
        {
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error executing agent '${name}': ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Server for Mastra agents is running');
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
