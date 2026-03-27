#!/usr/bin/env node

interface CliOptions {
  baseUrl: string;
  targetUrlContains: string;
  invalidTabId: number;
}

interface JsonRpcEnvelope {
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
  id?: number | string | null;
}

interface McpResponse {
  status: number;
  sessionId: string | null;
  envelope: JsonRpcEnvelope | null;
  rawBody: string;
}

interface ToolCallResult {
  data: unknown;
  isError: boolean;
  rawText: string;
}

interface WindowsAndTabsPayload {
  windowCount: number;
  tabCount: number;
  windows: Array<{
    windowId: number;
    tabs: Array<{
      tabId: number;
      url?: string;
      title?: string;
      active?: boolean;
    }>;
  }>;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    baseUrl: 'http://127.0.0.1:12306/mcp',
    targetUrlContains: 'switchMyBank.html',
    invalidTabId: 999999999,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--base-url' && next) {
      options.baseUrl = next;
      index += 1;
      continue;
    }

    if (arg === '--target-url-contains' && next) {
      options.targetUrlContains = next;
      index += 1;
      continue;
    }

    if (arg === '--invalid-tab-id' && next) {
      options.invalidTabId = Number.parseInt(next, 10);
      index += 1;
    }
  }

  return options;
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractJsonRpcFromSse(rawBody: string): JsonRpcEnvelope | null {
  const lines = rawBody.split(/\r?\n/);
  const dataLines = lines.filter((line) => line.startsWith('data: '));
  if (dataLines.length === 0) {
    return null;
  }

  const joined = dataLines.map((line) => line.slice(6)).join('\n');
  return JSON.parse(joined) as JsonRpcEnvelope;
}

async function sendMcpRequest(
  baseUrl: string,
  init: {
    method: 'POST' | 'DELETE';
    sessionId?: string;
    body?: Record<string, unknown>;
  },
): Promise<McpResponse> {
  const response = await fetch(baseUrl, {
    method: init.method,
    headers: {
      Accept: 'application/json, text/event-stream',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.sessionId ? { 'mcp-session-id': init.sessionId } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const rawBody = await response.text();
  return {
    status: response.status,
    sessionId: response.headers.get('mcp-session-id'),
    envelope: rawBody ? extractJsonRpcFromSse(rawBody) : null,
    rawBody,
  };
}

async function initializeSession(baseUrl: string, clientName: string): Promise<string> {
  const response = await sendMcpRequest(baseUrl, {
    method: 'POST',
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: clientName,
          version: '1.0.0',
        },
      },
    },
  });

  assertCondition(response.status === 200, `initialize failed with status ${response.status}`);
  assertCondition(response.sessionId, 'initialize did not return mcp-session-id');
  assertCondition(!response.envelope?.error, `initialize returned error: ${response.rawBody}`);

  const initialized = await sendMcpRequest(baseUrl, {
    method: 'POST',
    sessionId: response.sessionId,
    body: {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    },
  });

  assertCondition(
    initialized.status === 202,
    `notifications/initialized failed with status ${initialized.status}`,
  );

  return response.sessionId;
}

async function callTool(
  baseUrl: string,
  sessionId: string,
  id: number,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const response = await sendMcpRequest(baseUrl, {
    method: 'POST',
    sessionId,
    body: {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    },
  });

  assertCondition(response.status === 200, `${name} failed with status ${response.status}`);
  assertCondition(!response.envelope?.error, `${name} returned JSON-RPC error: ${response.rawBody}`);

  const result = response.envelope?.result as
    | {
        content?: Array<{ type?: string; text?: string }>;
        isError?: boolean;
      }
    | undefined;

  const rawText = result?.content?.[0]?.text ?? '';
  let data: unknown = rawText;

  try {
    data = rawText ? JSON.parse(rawText) : rawText;
  } catch {
    data = rawText;
  }

  return {
    data,
    isError: result?.isError === true,
    rawText,
  };
}

function findTargetTabs(
  payload: WindowsAndTabsPayload,
  targetUrlContains: string,
): Array<{
  tabId: number;
  url: string;
}> {
  const matches: Array<{ tabId: number; url: string }> = [];

  for (const windowInfo of payload.windows) {
    for (const tab of windowInfo.tabs) {
      if (typeof tab.url === 'string' && tab.url.includes(targetUrlContains)) {
        matches.push({
          tabId: tab.tabId,
          url: tab.url,
        });
      }
    }
  }

  if (matches.length === 0) {
    throw new Error(`No tab found with URL containing "${targetUrlContains}"`);
  }

  return matches;
}

function findActiveTab(payload: WindowsAndTabsPayload): { tabId: number; url: string } {
  for (const windowInfo of payload.windows) {
    for (const tab of windowInfo.tabs) {
      if (tab.active && typeof tab.url === 'string') {
        return {
          tabId: tab.tabId,
          url: tab.url,
        };
      }
    }
  }

  throw new Error('No active tab found');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  console.log(`[smoke:mcp] Base URL: ${options.baseUrl}`);
  console.log(`[smoke:mcp] Target URL contains: ${options.targetUrlContains}`);

  const reconnectSession1 = await initializeSession(options.baseUrl, 'smoke-reconnect-1');
  const deleteResponse = await sendMcpRequest(options.baseUrl, {
    method: 'DELETE',
    sessionId: reconnectSession1,
  });
  assertCondition(
    deleteResponse.status === 200 || deleteResponse.status === 204,
    `DELETE /mcp failed with status ${deleteResponse.status}`,
  );

  const reconnectSession2 = await initializeSession(options.baseUrl, 'smoke-reconnect-2');
  assertCondition(
    reconnectSession1 !== reconnectSession2,
    'MCP reconnect reused the same session id',
  );

  console.log(
    `[smoke:mcp] Reconnect OK: ${reconnectSession1} -> ${reconnectSession2} (delete ${deleteResponse.status})`,
  );

  const sessionId = await initializeSession(options.baseUrl, 'smoke-tool-check');
  const windowsResult = await callTool(options.baseUrl, sessionId, 10, 'get_windows_and_tabs', {});
  assertCondition(!windowsResult.isError, 'get_windows_and_tabs returned isError=true');

  const windowsPayload = windowsResult.data as WindowsAndTabsPayload;
  const targetCandidates = findTargetTabs(windowsPayload, options.targetUrlContains);
  const activeTab = findActiveTab(windowsPayload);
  let explicitPayload: { url?: string } | null = null;
  let explicitTarget: { tabId: number; url: string } | null = null;
  const explicitErrors: string[] = [];

  for (const candidate of targetCandidates) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const explicitContent = await callTool(
        options.baseUrl,
        sessionId,
        11 + explicitErrors.length + attempt,
        'chrome_get_web_content',
        {
          tabId: candidate.tabId,
          background: true,
        },
      );

      if (!explicitContent.isError) {
        const payload = explicitContent.data as { url?: string };
        if (payload.url === candidate.url) {
          explicitPayload = payload;
          explicitTarget = candidate;
          break;
        }
        explicitErrors.push(
          `tab ${candidate.tabId} returned unexpected URL ${String(payload.url)} (expected ${candidate.url})`,
        );
      } else {
        explicitErrors.push(`tab ${candidate.tabId} failed: ${explicitContent.rawText}`);
      }

      await sleep(300);
    }

    if (explicitPayload && explicitTarget) {
      break;
    }
  }

  assertCondition(
    explicitPayload && explicitTarget,
    `chrome_get_web_content(tabId=...) could not verify any target tab: ${explicitErrors.join(' | ')}`,
  );

  const activeContent = await callTool(options.baseUrl, sessionId, 30, 'chrome_get_web_content', {
    background: true,
  });
  const activePayload = activeContent.data as { url?: string };

  if (!activeContent.isError && activeTab.tabId !== explicitTarget.tabId) {
    assertCondition(
      activePayload.url === activeTab.url,
      `Active tab fetch returned unexpected URL: ${activePayload.url} !== ${activeTab.url}`,
    );
    assertCondition(
      explicitPayload.url !== activePayload.url,
      'Explicit tab fetch unexpectedly matched active tab URL',
    );
  }

  const invalidReadPage = await callTool(options.baseUrl, sessionId, 13, 'chrome_read_page', {
    tabId: options.invalidTabId,
    depth: 1,
  });
  assertCondition(invalidReadPage.isError, 'chrome_read_page(invalid tabId) should fail');
  assertCondition(
    invalidReadPage.rawText.includes('not found'),
    `chrome_read_page(invalid tabId) returned unexpected error: ${invalidReadPage.rawText}`,
  );

  console.log(
    `[smoke:mcp] Explicit tab OK: target ${explicitTarget.tabId} -> ${explicitPayload.url}`,
  );
  if (!activeContent.isError) {
    console.log(`[smoke:mcp] Active tab observed: ${activeTab.tabId} -> ${activePayload.url}`);
  } else {
    console.log(`[smoke:mcp] Active tab comparison skipped: ${activeContent.rawText}`);
  }
  console.log(
    `[smoke:mcp] Invalid tab OK: chrome_read_page(${options.invalidTabId}) -> ${invalidReadPage.rawText}`,
  );
  console.log('[smoke:mcp] PASS');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[smoke:mcp] FAIL: ${message}`);
  process.exitCode = 1;
});
