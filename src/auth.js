import fs from 'fs';
import path from 'path';
import os from 'os';
import { GoogleAuth } from 'google-auth-library';
import { getConfig } from './config.js';
import { createProxyAgent, detectSystemProxy } from './proxy.js';

/**
 * Get Google Cloud service account key file path
 * @returns {String|null} Path to key file or null if not found
 */
export function getServiceAccountKeyPath() {
  // Command line arg takes precedence
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  
  // Check for platform-specific locations
  const platform = os.platform();
  
  if (platform === 'win32') {
    // Windows: Check in AppData folder
    const appDataPath = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const winKeyPath = path.join(appDataPath, 'imagen-gemini-cli', 'service-account.json');
    if (fs.existsSync(winKeyPath)) {
      return winKeyPath;
    }
  } else {
    // Unix-like systems: Check in ~/.config
    const unixKeyPath = path.join(os.homedir(), '.config', 'imagen-gemini-cli', 'service-account.json');
    if (fs.existsSync(unixKeyPath)) {
      return unixKeyPath;
    }
  }
  
  // Then check for a .service-account.json file in the current directory
  const localKeyPath = path.join(process.cwd(), '.service-account.json');
  if (fs.existsSync(localKeyPath)) {
    return localKeyPath;
  }
  
  return null;
}

/**
 * Get Gemini API key
 * @returns {String|null} API key or null if not found
 */
export function getGeminiApiKey() {
  // Environment variable takes precedence
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  
  // Check for stored key in config
  const config = getConfig();
  const storedKey = config.geminiApiKey;
  if (storedKey) {
    return storedKey;
  }
  
  return null;
}

/**
 * Get access token for Google Cloud API with proxy support
 * @param {String} keyFilePath - Path to service account key file
 * @param {Object} argv - Command line arguments for proxy configuration
 * @returns {Promise<String>} Access token
 */
export async function getAccessToken(keyFilePath, argv) {
  try {
    console.log('正在检查代理设置...');
    const proxySettings = detectSystemProxy(argv);
    
    // Apply proxy settings to environment if provided
    const originalHttpProxy = process.env.HTTP_PROXY;
    const originalHttpsProxy = process.env.HTTPS_PROXY;
    
    if (proxySettings.httpsProxy) {
      console.log(`使用代理进行身份验证：${proxySettings.httpsProxy}`);
      process.env.HTTPS_PROXY = proxySettings.httpsProxy;
      process.env.HTTP_PROXY = proxySettings.httpProxy || proxySettings.httpsProxy;
    } else if (process.env.SYSTEM_PROXY) {
      console.log(`使用系统指定的代理：${process.env.SYSTEM_PROXY}`);
      process.env.HTTPS_PROXY = process.env.SYSTEM_PROXY;
      process.env.HTTP_PROXY = process.env.SYSTEM_PROXY;
    } else {
      console.log('没有为身份验证配置代理');
    }
    
    // Configure GoogleAuth to use our proxy settings
    const auth = new GoogleAuth({
      keyFile: keyFilePath,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    
    // Get client and token
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    
    // Restore original proxy settings
    if (originalHttpsProxy) {
      process.env.HTTPS_PROXY = originalHttpsProxy;
    } else {
      delete process.env.HTTPS_PROXY;
    }
    
    if (originalHttpProxy) {
      process.env.HTTP_PROXY = originalHttpProxy;
    } else {
      delete process.env.HTTP_PROXY;
    }
    
    return token.token;
  } catch (error) {
    console.error('获取访问令牌时出错：', error);
    throw error;
  }
}
