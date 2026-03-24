import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { HOST_NAME } from './constant';

export enum BrowserType {
  CHROME_BETA = 'chrome-beta',
}

export interface BrowserConfig {
  type: BrowserType;
  displayName: string;
  userManifestPath: string;
  systemManifestPath: string;
  registryKey?: string; // Windows only
  systemRegistryKey?: string; // Windows only
}

/**
 * Get the user-level manifest path for a specific browser
 */
function getUserManifestPathForBrowser(browser: BrowserType): string {
  const platform = os.platform();

  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    switch (browser) {
      case BrowserType.CHROME_BETA:
        return path.join(
          appData,
          'Google',
          'Chrome Beta',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
      default:
        return path.join(
          appData,
          'Google',
          'Chrome Beta',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
    }
  } else if (platform === 'darwin') {
    const home = os.homedir();
    switch (browser) {
      case BrowserType.CHROME_BETA:
        return path.join(
          home,
          'Library',
          'Application Support',
          'Google',
          'Chrome Beta',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
      default:
        return path.join(
          home,
          'Library',
          'Application Support',
          'Google',
          'Chrome Beta',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
    }
  } else {
    // Linux
    const home = os.homedir();
    switch (browser) {
      case BrowserType.CHROME_BETA:
        return path.join(
          home,
          '.config',
          'google-chrome-beta',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
      default:
        return path.join(
          home,
          '.config',
          'google-chrome-beta',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
    }
  }
}

/**
 * Get the system-level manifest path for a specific browser
 */
function getSystemManifestPathForBrowser(browser: BrowserType): string {
  const platform = os.platform();

  if (platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    switch (browser) {
      case BrowserType.CHROME_BETA:
        return path.join(
          programFiles,
          'Google',
          'Chrome Beta',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
      default:
        return path.join(
          programFiles,
          'Google',
          'Chrome Beta',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
    }
  } else if (platform === 'darwin') {
    switch (browser) {
      case BrowserType.CHROME_BETA:
        return path.join(
          '/Library',
          'Google',
          'Chrome Beta',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
      default:
        return path.join(
          '/Library',
          'Google',
          'Chrome Beta',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
    }
  } else {
    // Linux
    switch (browser) {
      case BrowserType.CHROME_BETA:
        return path.join(
          '/etc',
          'opt',
          'chrome-beta',
          'native-messaging-hosts',
          `${HOST_NAME}.json`,
        );
      default:
        return path.join(
          '/etc',
          'opt',
          'chrome-beta',
          'native-messaging-hosts',
          `${HOST_NAME}.json`,
        );
    }
  }
}

/**
 * Get Windows registry keys for a browser
 */
function getRegistryKeys(browser: BrowserType): { user: string; system: string } | undefined {
  if (os.platform() !== 'win32') return undefined;

  const browserPaths: Record<BrowserType, { user: string; system: string }> = {
    [BrowserType.CHROME_BETA]: {
      user: `HKCU\\Software\\Google\\Chrome Beta\\NativeMessagingHosts\\${HOST_NAME}`,
      system: `HKLM\\Software\\Google\\Chrome Beta\\NativeMessagingHosts\\${HOST_NAME}`,
    },
  };

  return browserPaths[browser];
}

/**
 * Get browser configuration
 */
export function getBrowserConfig(browser: BrowserType): BrowserConfig {
  const registryKeys = getRegistryKeys(browser);

  const displayNames: Record<BrowserType, string> = {
    [BrowserType.CHROME_BETA]: 'Chrome Beta',
  };

  return {
    type: browser,
    displayName: displayNames[browser],
    userManifestPath: getUserManifestPathForBrowser(browser),
    systemManifestPath: getSystemManifestPathForBrowser(browser),
    registryKey: registryKeys?.user,
    systemRegistryKey: registryKeys?.system,
  };
}

/**
 * Detect installed browsers on the system
 */
export function detectInstalledBrowsers(): BrowserType[] {
  const detectedBrowsers: BrowserType[] = [];
  const platform = os.platform();

  if (platform === 'win32') {
    // Check Windows registry for installed browsers
    const browsers: Array<{ type: BrowserType; registryPath: string }> = [
      { type: BrowserType.CHROME_BETA, registryPath: 'HKLM\\SOFTWARE\\Google\\Chrome Beta' },
    ];

    for (const browser of browsers) {
      try {
        execSync(`reg query "${browser.registryPath}" 2>nul`, { stdio: 'pipe' });
        detectedBrowsers.push(browser.type);
      } catch {
        // Browser not installed
      }
    }
  } else if (platform === 'darwin') {
    // Check macOS Applications folder
    const browsers: Array<{ type: BrowserType; appPath: string }> = [
      { type: BrowserType.CHROME_BETA, appPath: '/Applications/Google Chrome Beta.app' },
    ];

    for (const browser of browsers) {
      if (fs.existsSync(browser.appPath)) {
        detectedBrowsers.push(browser.type);
      }
    }
  } else {
    // Check Linux paths using which command
    const browsers: Array<{ type: BrowserType; commands: string[] }> = [
      { type: BrowserType.CHROME_BETA, commands: ['google-chrome-beta'] },
    ];

    for (const browser of browsers) {
      for (const cmd of browser.commands) {
        try {
          execSync(`which ${cmd} 2>/dev/null`, { stdio: 'pipe' });
          detectedBrowsers.push(browser.type);
          break; // Found one command, no need to check others
        } catch {
          // Command not found
        }
      }
    }
  }

  return detectedBrowsers;
}

/**
 * Get all supported browser configs
 */
export function getAllBrowserConfigs(): BrowserConfig[] {
  return Object.values(BrowserType).map((browser) => getBrowserConfig(browser));
}

/**
 * Parse browser type from string
 */
export function parseBrowserType(browserStr: string): BrowserType | undefined {
  const normalized = browserStr.toLowerCase();
  return Object.values(BrowserType).find((type) => type === normalized);
}
