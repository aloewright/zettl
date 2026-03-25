/**
 * Composio MCP remote server communication.
 * Single source of truth for all MCP JSON-RPC calls.
 *
 * The MCP server returns Server-Sent Events (SSE) format, not plain JSON.
 */

const MCP_URL = 'https://connect.composio.dev/mcp'
const MCP_API_KEY = 'ck_E31ySYYQVEKY5hUVYrCP'

const MCP_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
  'x-consumer-api-key': MCP_API_KEY,
}

let mcpRequestId = 0

/** Parse SSE response from Composio MCP server. */
async function parseSseResponse(res: Response): Promise<unknown> {
  const text = await res.text()

  // SSE format: "event: message\ndata: {...}\n\n"
  const lines = text.split('\n')
  let jsonData: string | null = null
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      jsonData = line.slice(6)
    }
  }

  if (!jsonData) {
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`MCP: No parseable response. Raw: ${text.slice(0, 200)}`)
    }
  }

  return JSON.parse(jsonData)
}

/** Send a JSON-RPC request to the Composio MCP server. */
export async function mcpCall(method: string, params?: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++mcpRequestId,
      method,
      params: params ?? {},
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`MCP ${method} failed (${res.status}): ${text}`)
  }

  const data = await parseSseResponse(res) as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean }
    error?: { message?: string }
  }

  if (data.error) {
    throw new Error(`MCP ${method} error: ${data.error.message ?? JSON.stringify(data.error)}`)
  }

  // MCP tools/call wraps the result in content[].text as a JSON string
  if (data.result?.content?.[0]?.text) {
    try {
      return JSON.parse(data.result.content[0].text)
    } catch {
      return data.result.content[0].text
    }
  }

  return data.result
}

export interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

/** List all available MCP tools. */
export async function listMcpTools(): Promise<McpTool[]> {
  const result = await mcpCall('tools/list') as { tools?: McpTool[] }
  return result?.tools ?? []
}

/** Execute an MCP tool by name. */
export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  return mcpCall('tools/call', { name, arguments: args })
}

/** Convert MCP tools to OpenAI function-calling format. */
export function mcpToolsToOpenAI(tools: McpTool[]): Array<{
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}> {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.inputSchema ?? { type: 'object', properties: {} },
    },
  }))
}
