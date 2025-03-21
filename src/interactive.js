import fs from 'fs';
import inquirer from 'inquirer';
import path from 'path';
import { saveConfig } from './config.js';
import { getServiceAccountKeyPath, getGeminiApiKey } from './auth.js';
import { ensureConfigDirectory } from './utils.js';
import fileTreeSelectionPrompt from 'inquirer-file-tree-selection-prompt';

// 向 inquirer 注册文件树选择提示
inquirer.registerPrompt('file-tree-selection', fileTreeSelectionPrompt);

/**
 * 运行交互模式以获取用户配置
 * @param {Object} argv - 命令行参数
 * @param {Object} config - 当前配置
 * @returns {Promise<Object>} 用户选项
 */
export async function runInteractiveMode(argv, config) {
  try {
    // 询问要使用的 API
    const { api } = await inquirer.prompt([
      {
        type: 'list',
        name: 'api',
        message: '您想使用哪个 API？',
        choices: [
          { title: 'Google Imagen 3', value: 'imagen' },
          { title: 'Google Gemini 2.0', value: 'gemini' },
        ],
        default: config.defaultApi
      }
    ]);

    // 将所选 API 存储为默认值，以备下次使用
    saveConfig({ defaultApi: api });

    let apiKey, keyFilePath, projectId;

    if (api === 'imagen') {
      // 对于 Imagen，我们需要服务账户
      keyFilePath = getServiceAccountKeyPath();

      if (!keyFilePath) {
        // 如果未找到密钥文件，请使用文件选择器询问
        const { useFilePicker } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'useFilePicker',
            message: '您想使用文件选择器来选择您的服务账户密钥文件吗？',
            default: true
          }
        ]);

        if (useFilePicker) {
          const { keyFileInput } = await inquirer.prompt([
            {
              type: 'file-tree-selection',
              name: 'keyFileInput',
              message: '选择您的 Google Cloud 服务账户 JSON 密钥文件：',
              onlyShowValid: true,
              validate: (item) => {
                return item && (!fs.lstatSync(item).isDirectory() &&
                      (path.extname(item) === '.json' || item.includes('service-account')));
              }
            }
          ]);
          keyFilePath = keyFileInput;
        } else {
          const { keyFileInput } = await inquirer.prompt([
            {
              type: 'input',
              name: 'keyFileInput',
              message: '输入您的 Google Cloud 服务账户 JSON 密钥文件的路径：',
              validate: function(value) {
                if (value.trim() === '') return '服务账户密钥文件路径是必需的';
                if (!fs.existsSync(value)) return '文件不存在';
                return true;
              }
            }
          ]);
          keyFilePath = keyFileInput;
        }

        // 询问是否应将副本保存到配置目录
        const { saveKeyFile } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'saveKeyFile',
            message: '您想保存此密钥文件的副本以备将来使用吗？',
            default: true
          }
        ]);

        if (saveKeyFile) {
          const configDir = ensureConfigDirectory();
          const destPath = path.join(configDir, 'service-account.json');
          fs.copyFileSync(keyFilePath, destPath);
          console.log('已将服务账户密钥保存到：' + destPath);
        }
      } else {
        console.log('正在使用服务账户密钥：' + keyFilePath);
      }

      try {
        const keyData = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
        projectId = argv.projectId || keyData.project_id || process.env.GOOGLE_CLOUD_PROJECT;
      } catch (error) {
        console.error('读取服务账户密钥文件时出错：', error);
        process.exit(1);
      }
    } else if (api === 'gemini') {
      // 对于 Gemini，我们需要 API 密钥
      apiKey = getGeminiApiKey();

      if (!apiKey) {
        // 如果未找到 API 密钥，请询问
        const { apiKeyInput } = await inquirer.prompt([
          {
            type: 'input',
            name: 'apiKeyInput',
            message: '输入您的 Gemini API 密钥：',
            validate: function(value) {
              return value.trim() !== '' ? true : 'API 密钥是必需的';
            }
          }
        ]);

        apiKey = apiKeyInput;

        // 询问是否应保存密钥
        const { saveApiKey } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'saveApiKey',
            message: '您想保存此 API 密钥以备将来使用吗？',
            default: true
          }
        ]);

        if (saveApiKey) {
          saveConfig({ geminiApiKey: apiKey });
          console.log('已保存 Gemini API 密钥以备将来使用');
        }
      } else {
        console.log('正在使用配置中的 Gemini API 密钥');
      }
    }

    // 询问提示
    const { prompt } = await inquirer.prompt([
      {
        type: 'input',
        name: 'prompt',
        message: '输入您的图像生成提示：',
        validate: function(value) {
          return value.trim() !== '' ? true : '提示是必需的';
        }
      }
    ]);

    let referenceImages = [];

    if (api === 'gemini') {
      // 询问用户是否要将参考图像与 Gemini 一起使用
      const { useReferenceImages } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'useReferenceImages',
          message: '您想使用参考图像吗？',
          default: false
        }
      ]);

      if (useReferenceImages) {
        // 询问他们是否要使用文件选择器
        const { useFilePicker } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'useFilePicker',
            message: '您想使用文件选择器来选择参考图像吗？',
            default: true
          }
        ]);

        // 不断询问参考图像，直到用户完成
        let addMoreImages = true;

        while (addMoreImages) {
          if (useFilePicker) {
            const { imagePath } = await inquirer.prompt([
              {
                type: 'file-tree-selection',
                name: 'imagePath',
                message: '选择参考图像：',
                onlyShowValid: true,
                validate: (item) => {
                  if (fs.lstatSync(item).isDirectory()) return false;
                  const ext = path.extname(item).toLowerCase();
                  return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
                }
              }
            ]);
            referenceImages.push(imagePath);
          } else {
            const { imagePath } = await inquirer.prompt([
              {
                type: 'input',
                name: 'imagePath',
                message: '输入参考图像的路径：',
                validate: function(value) {
                  if (value.trim() === '') return '图像路径是必需的';
                  if (!fs.existsSync(value)) return '文件不存在';
                  return true;
                }
              }
            ]);
            referenceImages.push(imagePath);
          }

          const { addAnother } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'addAnother',
              message: '再添加一张参考图像？',
              default: false
            }
          ]);

          addMoreImages = addAnother;
        }
      }
    }

    // 获取特定于 API 的选项
    let additionalOptions = {};

    if (api === 'imagen') {
      const imagenQuestions = await inquirer.prompt([
        {
          type: 'list',
          name: 'aspectRatio',
          message: '选择纵横比：',
          choices: ['1:1', '16:9', '9:16', '3:4', '4:3'],
          default: '1:1'
        },
        {
          type: 'list',
          name: 'count',
          message: '要生成的图像数量：',
          choices: [1, 2, 3, 4],
          default: 1
        },
        {
          type: 'input',
          name: 'negativePrompt',
          message: '负面提示（可选）：',
        },
        {
          type: 'confirm',
          name: 'enhance',
          message: '增强提示？',
          default: false
        },
        {
          type: 'list',
          name: 'safety',
          message: '安全设置：',
          choices: [
            { name: '不阻止', value: 'block_none' },
            { name: '阻止少数', value: 'block_few' },
            { name: '阻止部分', value: 'block_some' },
            { name: '阻止大部分', value: 'block_most' }
          ],
          default: 'block_few'
        },
        {
          type: 'list',
          name: 'personGeneration',
          message: '人物生成：',
          choices: [
            { name: '允许所有', value: 'allow_all' },
            { name: '允许成人', value: 'allow_adult' },
            { name: '不允许', value: 'dont_allow' }
          ]
        },
        {
          type: 'confirm',
          name: 'watermark',
          message: '添加水印？',
          default: false
        }
      ]);

      additionalOptions = imagenQuestions;
    }

    // 询问输出目录
    const lastOutputDir = config.lastOutputDir || './images';
    const lastJsonDir = config.lastJsonDir || './output';

    // 询问他们是否要使用目录选择器作为输出目录
    const { useDirectoryPicker } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useDirectoryPicker',
        message: '您想使用目录选择器来选择输出目录吗？',
        default: true
      }
    ]);

    let outputDir;
    if (useDirectoryPicker) {
      const { selectedDir } = await inquirer.prompt([
        {
          type: 'file-tree-selection',
          name: 'selectedDir',
          message: '选择用于保存图像的输出目录：',
          root: lastOutputDir,
          onlyShowDir: true
        }
      ]);
      outputDir = selectedDir;
    } else {
      const { selectedDir } = await inquirer.prompt([
        {
          type: 'input',
          name: 'selectedDir',
          message: '用于保存图像的输出目录：',
          default: lastOutputDir
        }
      ]);
      outputDir = selectedDir;
    }

    const { useCustomJsonDir } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useCustomJsonDir',
        message: '您是否要为 JSON 文件（请求/响应）使用自定义目录？',
        default: true
      }
    ]);

    let jsonDir;
    if (useCustomJsonDir) {
      if (useDirectoryPicker) {
        const { customJsonDir } = await inquirer.prompt([
          {
            type: 'file-tree-selection',
            name: 'customJsonDir',
            message: '选择用于保存 JSON 文件的目录：',
            root: lastJsonDir,
            onlyShowDir: true
          }
        ]);
        jsonDir = customJsonDir;
      } else {
        const { customJsonDir } = await inquirer.prompt([
          {
            type: 'input',
            name: 'customJsonDir',
            message: '用于保存 JSON 文件的目录：',
            default: lastJsonDir
          }
        ]);
        jsonDir = customJsonDir;
      }
    } else {
      jsonDir = './output';
    }

    // 返回组合选项
    return {
      api,
      keyFile: keyFilePath,
      geminiKey: apiKey,
      projectId,
      prompt,
      referenceImages,
      outputDir,
      jsonDir,
      ...additionalOptions
    };

  } catch (error) {
    console.error('交互模式出错：', error);
    process.exit(1);
  }
}
