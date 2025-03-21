import os from 'os';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getConfig, saveConfig } from './config.js';
import { debug } from './utils.js';
import fs from 'fs';
import path from 'path';

// Flag to track if proxy settings have been logged
let proxySettingsLogged = false;

/**
 * Detect system proxy settings
 * @param {Object} argv - Command line arguments
 * @returns {Object} Proxy settings
 */
export function detectSystemProxy(argv) {
  const config = getConfig();
  
  // Check if we already have stored proxy settings and no force detection
  const storedProxySettings = config.proxySettings;
  if (storedProxySettings && !argv.detectProxy) {
    debug(argv, 'Using stored proxy settings');
    return storedProxySettings;
  }
  
  let httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  let httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  
  debug(argv, `Environment HTTP_PROXY: ${httpProxy || 'not set'}`);
  debug(argv, `Environment HTTPS_PROXY: ${httpsProxy || 'not set'}`);
  debug(argv, `Environment NO_PROXY: ${noProxy || 'not set'}`);
  
  // Windows-specific registry proxy detection
  if (os.platform() === 'win32' && !httpProxy && !httpsProxy) {
    debug(argv, 'Running on Windows, checking for system proxy settings');
    try {
      // For Windows, we could use a child process to execute a PowerShell command
      // This is just a placeholder - in a real implementation, you would add code to check the registry
      debug(argv, 'Would check Windows registry for proxy settings (not implemented)');
    } catch (error) {
      debug(argv, `Error detecting Windows proxy settings: ${error.message}`);
    }
  }
  
  // If HTTPS_PROXY is not set but HTTP_PROXY is, use HTTP_PROXY for HTTPS as well
  if (!httpsProxy && httpProxy) {
    httpsProxy = httpProxy;
    debug(argv, `Using HTTP_PROXY for HTTPS connections: ${httpsProxy}`);
  }
  
  const proxySettings = {
    httpProxy,
    httpsProxy,
    noProxy
  };
  
  // Store detected settings for future use
  saveConfig({ proxySettings });
  
  return proxySettings;
}

/**
 * Create proxy agent based on system settings
 * @param {Object} argv - Command line arguments
 * @returns {HttpsProxyAgent|null} Proxy agent or null if no proxy
 */
export function createProxyAgent(argv) {
  // If no-proxy flag is set, don't use a proxy
  if (argv.noProxy) {
    debug(argv, 'Proxy usage disabled with --no-proxy flag');
    return null;
  }
  
  // Prioritize explicit SYSTEM_PROXY environment variable if set
  if (process.env.SYSTEM_PROXY) {
    debug(argv, `Using explicit SYSTEM_PROXY environment variable: ${process.env.SYSTEM_PROXY}`);
    return new HttpsProxyAgent(process.env.SYSTEM_PROXY);
  }
  
  // Fall back to detecting system proxy settings
  const { httpsProxy } = detectSystemProxy(argv);
  
  if (httpsProxy) {
    debug(argv, `Creating proxy agent for detected proxy: ${httpsProxy}`);
    
    // Save detected proxy to SYSTEM_PROXY for future use if not already set
    if (!process.env.SYSTEM_PROXY) {
      // Log transition from no proxy to detected proxy
      console.log(`SYSTEM_PROXY changed: none → ${httpsProxy}`);
      process.env.SYSTEM_PROXY = httpsProxy;
      debug(argv, `Saving detected proxy to SYSTEM_PROXY: ${httpsProxy}`);
    }
    
    return new HttpsProxyAgent(httpsProxy);
  }
  
  return null;
}

/**
 * Execute fetch with proper proxy handling, including fallback
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {Object} argv - Command line arguments
 * @param {Object} [extraOptions] - Extra options for fetch wrapper
 * @param {string} [extraOptions.requestId] - Request identifier for logging
 * @param {string} [extraOptions.outputDir] - Output directory for saving responses
 * @param {string} [extraOptions.jsonDir] - JSON directory for saving debug files
 * @returns {Promise<Object>} Fetch response
 */
export async function fetchWithProxy(url, options, argv, extraOptions = {}) {
  const { requestId, outputDir } = extraOptions;
  
  // Create proxy agent (now prioritizes SYSTEM_PROXY)
  let proxyAgent = createProxyAgent(argv);
  
  // Configure fetch options with proxy
  const fetchOptions = {
    ...options,
    agent: proxyAgent
  };
  
  // Only log proxy settings once when SYSTEM_PROXY is set
  if (!proxySettingsLogged && process.env.SYSTEM_PROXY) {
    const proxyUrl = proxyAgent && proxyAgent.proxy && typeof proxyAgent.proxy === 'object' && proxyAgent.proxy.href 
      ? proxyAgent.proxy.href 
      : (proxyAgent && proxyAgent.proxy) || process.env.SYSTEM_PROXY;
    console.log('Using proxy settings:', proxyUrl);
    proxySettingsLogged = true;
  }
  
  try {
    // Send request
    const response = await fetch(url, fetchOptions);
    
    // If debug is enabled and we have a request ID, save the request details
    if (argv.debug && extraOptions.requestId) {
      const debugDir = extraOptions.jsonDir || 
                      (extraOptions.outputDir ? path.join(extraOptions.outputDir, 'json') : './debug');
      
      // Ensure debug directory exists
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      
      const debugFile = path.join(debugDir, `${extraOptions.requestId}_debug.json`);
      const debugData = {
        url,
        options: { ...options, body: options.body ? '[BODY_CONTENT]' : undefined },
        timestamp: new Date().toISOString(),
        proxyUsed: !!proxyAgent
      };
      
      fs.writeFileSync(debugFile, JSON.stringify(debugData, null, 2));
    }
    
    return response;
  } catch (error) {
    console.error(`Network error when making API request: ${error.message}`);
    console.error('Error details:', error);
    console.error('This might be a proxy configuration issue. Check your proxy settings.');
    
    // Debug network settings
    try {
      const originalHttpProxy = process.env.HTTP_PROXY;
      const originalHttpsProxy = process.env.HTTPS_PROXY;
      
      console.log('Current environment proxy settings:');
      console.log(`HTTP_PROXY: ${originalHttpProxy || 'not set'}`);
      console.log(`HTTPS_PROXY: ${originalHttpsProxy || 'not set'}`);
      console.log(`SYSTEM_PROXY: ${process.env.SYSTEM_PROXY || 'not set'}`);
      
      if (proxyAgent) {
        console.log('Using proxy agent:', proxyAgent.proxy);
      }
      
      // Try fallback to environment SYSTEM_PROXY if not already used
      if (process.env.SYSTEM_PROXY && (!proxyAgent || error.code === 'ETIMEDOUT')) {
        console.log('Initial request failed. Ensuring proxy is properly configured...');
        
        // Only set these if we're not already using the SYSTEM_PROXY
        if (!proxyAgent || proxyAgent.proxy !== process.env.SYSTEM_PROXY) {
          process.env.HTTPS_PROXY = process.env.SYSTEM_PROXY;
          process.env.HTTP_PROXY = process.env.SYSTEM_PROXY;
          
          console.log(`Temporarily set HTTP_PROXY and HTTPS_PROXY to: ${process.env.SYSTEM_PROXY}`);
          
          // Create direct https proxy agent
          const directProxyAgent = new HttpsProxyAgent(process.env.SYSTEM_PROXY);
          
          // Update fetch options with new proxy
          fetchOptions.agent = directProxyAgent;
        }
        
        console.log('Retrying request with direct proxy agent...');
        
        try {
          return await fetch(url, fetchOptions);
        } catch (retryError) {
          console.error('Retry also failed:', retryError.message);
          throw retryError; // Re-throw the error after trying fallback
        } finally {
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
        }
      }
    } catch (debugError) {
      console.error('Error during proxy debugging:', debugError);
    }
    
    // If we got here, both original request and retry failed
    throw error;
  }
}