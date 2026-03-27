import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { listMarkersForUrl } from '@/entrypoints/background/element-marker/element-marker-storage';
import { readPageTool } from '@/entrypoints/background/tools/browser/read-page';
import { webFetcherTool } from '@/entrypoints/background/tools/browser/web-fetcher';

vi.mock('@/entrypoints/background/element-marker/element-marker-storage', () => ({
  listMarkersForUrl: vi.fn().mockResolvedValue([]),
}));

describe('browser tools tab targeting', () => {
  const chromeMock = globalThis.chrome as typeof globalThis.chrome & {
    scripting: {
      executeScript: ReturnType<typeof vi.fn>;
    };
    windows: {
      update: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    vi.mocked(listMarkersForUrl).mockResolvedValue([]);
    chromeMock.tabs.get = vi.fn();
    chromeMock.tabs.query = vi.fn();
    chromeMock.tabs.sendMessage = vi.fn();
    chromeMock.tabs.update = vi.fn().mockResolvedValue(undefined);
    chromeMock.scripting = {
      executeScript: vi.fn().mockResolvedValue(undefined),
    };
    chromeMock.windows = {
      update: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('read_page should not fall back to the active tab when explicit tabId is missing', async () => {
    chromeMock.tabs.get.mockRejectedValue(new Error('No tab with id: 123'));
    chromeMock.tabs.query.mockResolvedValue([{ id: 999, url: 'https://active.example/' }]);

    const result = await readPageTool.execute({ tabId: 123 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Tab 123 not found');
    expect(chromeMock.tabs.query).not.toHaveBeenCalled();
  });

  it('read_page should use the explicit tabId when provided', async () => {
    chromeMock.tabs.get.mockResolvedValue({
      id: 321,
      windowId: 7,
      url: 'https://target.example/',
    });
    chromeMock.tabs.sendMessage
      .mockRejectedValueOnce(new Error('content script not ready'))
      .mockResolvedValueOnce({
        success: true,
        pageContent: '- generic "Target page"',
        viewport: { width: 390, height: 844, dpr: 2 },
        stats: { processed: 1, included: 1, durationMs: 1 },
        refMap: [],
      });

    const result = await readPageTool.execute({ tabId: 321, depth: 1 });
    const payload = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(false);
    expect(payload.success).toBe(true);
    expect(payload.pageContent).toContain('Target page');
    expect(chromeMock.tabs.query).not.toHaveBeenCalled();
    expect(chromeMock.tabs.sendMessage).toHaveBeenLastCalledWith(
      321,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.GENERATE_ACCESSIBILITY_TREE,
        depth: 1,
      }),
    );
  });

  it('chrome_get_web_content should fetch from the explicit tabId instead of the active tab', async () => {
    chromeMock.tabs.get.mockResolvedValue({
      id: 456,
      windowId: 11,
      url: 'https://target.example/',
      title: 'Target Title',
    });
    chromeMock.tabs.sendMessage
      .mockRejectedValueOnce(new Error('content script not ready'))
      .mockResolvedValueOnce({
        success: true,
        textContent: 'Target content',
        article: { title: 'Target article' },
        metadata: { title: 'Target Title' },
      });

    const result = await webFetcherTool.execute({ tabId: 456, background: true });
    const payload = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(false);
    expect(payload.success).toBe(true);
    expect(payload.url).toBe('https://target.example/');
    expect(payload.textContent).toBe('Target content');
    expect(chromeMock.tabs.query).not.toHaveBeenCalled();
    expect(chromeMock.tabs.sendMessage).toHaveBeenLastCalledWith(
      456,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.WEB_FETCHER_GET_TEXT_CONTENT,
      }),
    );
  });
});
