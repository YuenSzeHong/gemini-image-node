#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
import open from 'open';

// Import modules
import { getConfig, saveConfig, createSampleEnvFile } from './src/config.js';
import { createProxyAgent, detectSystemProxy } from './src/proxy.js';
import { generateImagesWithImagen } from './src/imagen.js';
import { generateImagesWithGemini } from './src/gemini.js';
import { runInteractiveMode } from './src/interactive.js';
import { getServiceAccountKeyPath, getGeminiApiKey } from './src/auth.js';
import { debug } from './src/utils.js';

// Load environment variables from .env file
dotenv.config();

// Create sample .env file if it doesn't exist
createSampleEnvFile();

// Get configuration
const config = getConfig();

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .usage('用法: $0 [提示] [选项]')
  .positional('prompt', {
    describe: '图像生成提示',
    type: 'string'
  })
  // 核心选项
  .option('api', {
    alias: 't', // 't' 表示 API 类型
    type: 'string',
    description: '用于图像生成的 API',
    choices: ['imagen', 'gemini'],
    default: config.defaultApi
  })
  .option('model', {
    alias: 'm',
    type: 'string',
    description: '模型 ID',
    default: 'imagen-3.0-generate-002'
  })
  
  // 输入选项
  .option('reference-images', {
    alias: 'r',
    type: 'array',
    description: 'Gemini 的参考图像路径（可以提供多个）',
    demandOption: false
  })
  .option('config-file', {
    alias: 'f',
    type: 'string',
    description: '图像生成的 JSON 配置文件路径',
    demandOption: false
  })
  
  // 输出选项
  .option('output-dir', {
    alias: 'o',
    type: 'string',
    description: '保存图像的输出目录',
    default: config.lastOutputDir
  })
  .option('json-dir', {
    alias: 'j',
    type: 'string',
    description: '保存 JSON 文件（请求/响应）的目录',
    default: config.lastJsonDir
  })
  
  // 认证选项
  .option('project-id', {
    alias: 'P', // 大写的 'P' 以区别于提示
    type: 'string',
    description: 'Google Cloud 项目 ID（默认为服务账户中的项目 ID）',
    default: process.env.GOOGLE_CLOUD_PROJECT || ''
  })
  .option('key-file', {
    alias: 'k',
    type: 'string',
    description: '服务账户 JSON 密钥文件路径（覆盖 GOOGLE_APPLICATION_CREDENTIALS）',
    demandOption: false
  })
  .option('gemini-key', {
    alias: 'g',
    type: 'string',
    description: 'Gemini API 密钥（覆盖 .env 中的 GEMINI_API_KEY）',
    demandOption: false
  })
  .option('location', {
    alias: 'l',
    type: 'string',
    description: 'API 位置',
    default: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1'
  })
  
  // 图像生成设置
  .option('aspect-ratio', {
    alias: 'a',
    type: 'string',
    description: '图像纵横比（仅限 Imagen）',
    default: '1:1',
    choices: ['1:1', '16:9', '9:16', '3:4', '4:3']
  })
  .option('count', {
    alias: 'c',
    type: 'number',
    description: '要生成的图像数量（仅限 Imagen）',
    default: 1,
    choices: [1, 2, 3, 4]
  })
  .option('negative-prompt', {
    alias: 'n',
    type: 'string',
    description: '负面提示（仅限 Imagen）',
    default: ''
  })
  .option('enhance', {
    alias: 'e',
    type: 'boolean',
    description: '增强提示（仅限 Imagen）',
    default: false
  })
  .option('person-generation', {
    alias: 'b', // 'b' 表示阻止人物生成
    type: 'string',
    description: '人物生成（仅限 Imagen）',
    default: 'allow_adult',
    choices: ['block_all', 'block_children', 'allow_adult']
  })
  .option('safety', {
    alias: 's',
    type: 'string',
    description: '安全性设置（仅限 Imagen）',
    default: 'block_few',
    choices: ['block_none', 'block_few', 'block_some', 'block_most']
  })
  .option('watermark', {
    alias: 'w',
    type: 'boolean',
    description: '添加水印（仅限 Imagen）',
    default: true
  })
  
  // 运行时选项
  .option('interactive', {
    alias: 'i',
    type: 'boolean',
    description: '运行交互模式',
    default: false
  })
  .option('debug', {
    alias: 'd',
    type: 'boolean',
    description: '显示调试信息',
    default: false
  })
  .option('detect-proxy', {
    alias: 'x', // 'x' 表示代理检测
    type: 'boolean',
    description: '强制检测系统代理设置',
    default: false
  })
  .option('no-proxy', {
    alias: 'N', // 大写的 'N' 表示“不”使用代理
    type: 'boolean',
    description: '禁用代理使用',
    default: false
  })
  .help()
  .alias('help', 'h')
  .parse();

// 主函数
async function main() {
  try {
    // 如果启用了调试，则记录代理设置
    if (argv.debug) {
      const proxySettings = detectSystemProxy(argv);
      debug(argv, '系统代理设置:');
      debug(argv, `  HTTP_PROXY: ${proxySettings.httpProxy || '未设置'}`);
      debug(argv, `  HTTPS_PROXY: ${proxySettings.httpsProxy || '未设置'}`);
      debug(argv, `  NO_PROXY: ${proxySettings.noProxy || '未设置'}`);
    }
    
    let options = { ...argv };
    
    // 从位置参数获取提示（如果提供）
    if (argv._.length > 0) {
      options.prompt = argv._[0];
    }
    
    // 从 JSON 文件加载配置（如果提供）
    if (options.configFile) {
      try {
        const configFilePath = path.resolve(options.configFile);
        if (!fs.existsSync(configFilePath)) {
          console.error(`错误: 配置文件未在以下路径找到 ${configFilePath}`);
          process.exit(1);
        }
        
        const fileContent = fs.readFileSync(configFilePath, 'utf8');
        const fileConfig = JSON.parse(fileContent);
        
        // 合并文件配置与 CLI 选项，优先考虑显式 CLI 参数
        // （显式提供的 CLI 参数覆盖文件配置）
        const explicitCliArgs = Object.keys(argv).filter(key => 
          argv.hasOwnProperty(key) && 
          !['_', '$0'].includes(key) && 
          yargs(hideBin(process.argv)).parsed.argv.hasOwnProperty(key)
        );
        
        options = {
          ...options,
          ...fileConfig,
        };
        
        // 恢复显式 CLI 参数以保持其优先级
        explicitCliArgs.forEach(key => {
          if (argv[key] !== undefined) {
            options[key] = argv[key];
          }
        });
        
        // 确保位置参数优先
        if (argv._.length > 0) {
          options.prompt = argv._[0];
        }
        
        debug(argv, `从 ${configFilePath} 加载配置`);
      } catch (error) {
        console.error(`加载配置文件时出错: ${error.message}`);
        process.exit(1);
      }
    }
    
    // 如果请求交互模式，则从提示获取选项
    if (options.interactive) {
      options = await runInteractiveMode(argv, config);
    }
    
    // 如果未显式提供 JSON 目录，则使用默认值
    if (!options.jsonDir) {
      options.jsonDir = config.lastJsonDir || './output';
    }
    
    // 如果未显式提供图像输出目录，则使用默认值
    if (!options.outputDir) {
      options.outputDir = config.lastOutputDir || './images';
    }
    
    // 确定要使用的 API
    const api = options.api || process.env.DEFAULT_API || 'imagen';
    
    // 验证每个 API 的必需参数
    if (api === 'imagen') {
      const keyFilePath = options.keyFile || getServiceAccountKeyPath();
      
      if (!keyFilePath) {
        console.error('错误: Imagen API 需要服务账户密钥文件。');
        console.error('请通过以下方式之一提供:');
        console.error('  1. --key-file 参数');
        console.error('  2. GOOGLE_APPLICATION_CREDENTIALS 环境变量');
        console.error('  3. 当前目录下的 .service-account.json 文件');
        process.exit(1);
      }
      
      if (!options.prompt) {
        console.error('错误: 提示是必需的。请作为第一个参数提供或使用交互模式。');
        process.exit(1);
      }
      
      console.log(`使用服务账户密钥文件: ${keyFilePath}`);
      
      if (!fs.existsSync(keyFilePath)) {
        console.error(`错误: 密钥文件未在以下路径找到 ${keyFilePath}`);
        process.exit(1);
      }
      
      const keyFileContent = fs.readFileSync(keyFilePath, 'utf8');
      let keyData;
      
      try {
        keyData = JSON.parse(keyFileContent);
      } catch (error) {
        console.error('解析服务账户密钥文件时出错:', error);
        process.exit(1);
      }
      
      // 使用提供的项目 ID 或服务账户中的项目 ID 或环境变量中的项目 ID
      const projectId = options.projectId || keyData.project_id || process.env.GOOGLE_CLOUD_PROJECT;
      
      if (!projectId) {
        console.error('错误: 项目 ID 在服务账户中未找到且未作为参数或环境变量提供');
        process.exit(1);
      }
      
      console.log(`使用项目 ID: ${projectId}`);
      
      const result = await generateImagesWithImagen({
        ...options,
        keyFile: keyFilePath,
        projectId
      }, argv);
      
      if (result.success) {
        console.log('图像生成成功！');
        // 打开输出目录
        if (result.outputDir && result.images && result.images.length > 0) {
          try {
            await open(result.outputDir);
          } catch (error) {
            console.warn('无法自动打开输出目录');
          }
        }
        
        // 保存两个目录以备下次使用
        saveConfig({ 
          lastOutputDir: options.outputDir,
          lastJsonDir: options.jsonDir 
        });
      }
      
    } else if (api === 'gemini') {
      const geminiKey = options.geminiKey || getGeminiApiKey();
      
      if (!geminiKey) {
        console.error('错误: Gemini API 需要 Gemini API 密钥。');
        console.error('请通过以下方式之一提供:');
        console.error('  1. --gemini-key 参数');
        console.error('  2. GEMINI_API_KEY 环境变量');
        console.error('  3. 上次运行的配置');
        process.exit(1);
      }
      
      if (!options.prompt) {
        console.error('错误: 提示是必需的。请作为第一个参数提供或使用交互模式。');
        process.exit(1);
      }
      
      const result = await generateImagesWithGemini({
        ...options,
        geminiKey
      }, argv);
      
      if (result.success) {
        console.log('图像生成成功！');
        // 打开输出目录
        if (result.outputDir) {
          try {
            await open(result.outputDir);
          } catch (error) {
            console.warn('无法自动打开输出目录');
          }
        }
        
        // 保存两个目录以备下次使用
        saveConfig({ 
          lastOutputDir: options.outputDir,
          lastJsonDir: options.jsonDir 
        });
      }
    } else {
      console.error(`错误: 未知 API: ${options.api}`);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('错误:', error);
    process.exit(1);
  }
}

// 执行
main();
