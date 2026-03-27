import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TOOL_MESSAGE_TYPES } from '@/common/message-types';

const withSessionMock = vi.fn(async (_tabId: number, _owner: string, fn: () => Promise<unknown>) => {
  return await fn();
});
const sendCommandMock = vi.fn();

vi.mock('@/utils/cdp-session-manager', () => ({
  cdpSessionManager: {
    withSession: withSessionMock,
    sendCommand: sendCommandMock,
  },
}));

import { screenshotTool } from '@/entrypoints/background/tools/browser/screenshot';

describe('screenshotTool', () => {
  const chromeMock = globalThis.chrome as typeof globalThis.chrome & {
    scripting: {
      executeScript: ReturnType<typeof vi.fn>;
    };
    downloads: {
      download: ReturnType<typeof vi.fn>;
      search: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();

    chromeMock.tabs.get = vi.fn().mockResolvedValue({
      id: 12,
      windowId: 34,
      url: 'https://example.com/page',
    });
    chromeMock.tabs.query = vi.fn().mockResolvedValue([]);
    chromeMock.tabs.captureVisibleTab = vi
      .fn()
      .mockRejectedValue(new Error('Failed to capture tab: image readback failed'));
    chromeMock.tabs.sendMessage = vi.fn().mockImplementation(async (_tabId: number, message: any) => {
      if (typeof message?.action === 'string' && message.action.endsWith('_ping')) {
        throw new Error('not injected');
      }
      if (message?.action === TOOL_MESSAGE_TYPES.SCREENSHOT_PREPARE_PAGE_FOR_CAPTURE) {
        return { success: true };
      }
      if (message?.action === TOOL_MESSAGE_TYPES.SCREENSHOT_GET_PAGE_DETAILS) {
        return {
          totalWidth: 1280,
          totalHeight: 2400,
          viewportWidth: 1280,
          viewportHeight: 720,
          devicePixelRatio: 2,
          currentScrollX: 0,
          currentScrollY: 0,
        };
      }
      if (message?.action === TOOL_MESSAGE_TYPES.SCREENSHOT_RESET_PAGE_AFTER_CAPTURE) {
        return { success: true };
      }
      throw new Error(`Unexpected message: ${String(message?.action)}`);
    });

    chromeMock.scripting = {
      executeScript: vi.fn().mockResolvedValue(undefined),
    };
    chromeMock.downloads = {
      download: vi.fn().mockResolvedValue(1),
      search: vi.fn().mockResolvedValue([]),
    };

    sendCommandMock.mockResolvedValue({ data: 'cdp-fallback-base64' });
  });

  it('falls back to CDP after repeated image readback failures', async () => {
    const result = await screenshotTool.execute({
      tabId: 12,
      savePng: false,
      storeBase64: false,
    });

    expect(result.isError).toBe(false);
    expect(chromeMock.tabs.captureVisibleTab).toHaveBeenCalledTimes(3);
    expect(chromeMock.tabs.captureVisibleTab).toHaveBeenNthCalledWith(1, 34, { format: 'png' });
    expect(chromeMock.tabs.captureVisibleTab).toHaveBeenNthCalledWith(2, 34, { format: 'png' });
    expect(chromeMock.tabs.captureVisibleTab).toHaveBeenNthCalledWith(3, 34, { format: 'png' });
    expect(withSessionMock).toHaveBeenCalledWith(
      12,
      'screenshot-readback-fallback',
      expect.any(Function),
    );
    expect(sendCommandMock).toHaveBeenCalledWith(12, 'Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
  });
});
