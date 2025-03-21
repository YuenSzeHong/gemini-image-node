import fs from 'fs';
import path from 'path';
import Conf from 'conf';
import { fileURLToPath } from 'url';

// 获取 ES 模块中的 __dirname 等价物
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 初始化配置存储
const configStore = new Conf({
  projectName: 'imagen-gemini-cli',
  defaults: {
    proxySettings: null, // 将存储检测到的代理设置
    lastOutputDir: './images',
    lastJsonDir: './output',
    defaultApi: process.env.DEFAULT_API || 'imagen',
    geminiApiKey: null
  }
});

/**
 * 获取当前配置
 */
export function getConfig() {
  return {
    proxySettings: configStore.get('proxySettings'),
    lastOutputDir: configStore.get('lastOutputDir'),
    lastJsonDir: configStore.get('lastJsonDir'),
    defaultApi: configStore.get('defaultApi'),
    geminiApiKey: configStore.get('geminiApiKey')
  };
}

/**
 * 保存配置值
 * @param {Object} config - 要保存的配置值
 */
export function saveConfig(config) {
  if (config.proxySettings !== undefined) {
    configStore.set('proxySettings', config.proxySettings);
  }
  
  if (config.lastOutputDir) {
    configStore.set('lastOutputDir', config.lastOutputDir);
  }
  
  if (config.defaultApi) {
    configStore.set('defaultApi', config.defaultApi);
  }
  
  if (config.geminiApiKey) {
    configStore.set('geminiApiKey', config.geminiApiKey);
  }
  
  if (config.lastJsonDir) {
    configStore.set('lastJsonDir', config.lastJsonDir);
  }
}

/**
 * 如果不存在，则创建一个示例 .env 文件
 */
export function createSampleEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  
  if (!fs.existsSync(envPath)) {
    const sampleEnv = `# Google Cloud 和 Imagen 设置
GOOGLE_APPLICATION_CREDENTIALS=path/to/your/service-account.json
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=us-central1

# Gemini API 设置
GEMINI_API_KEY=your-gemini-api-key

# 通用设置
DEFAULT_API=imagen  # 或 'gemini'

# 代理设置会自动从环境中检测
# HTTP_PROXY=http://proxy.example.com:8080
# HTTPS_PROXY=http://proxy.example.com:8080
# NO_PROXY=localhost,127.0.0.1
`;
    
    fs.writeFileSync(envPath, sampleEnv);
    console.log(`已在 ${envPath} 创建示例 .env 文件`);
  }
}
