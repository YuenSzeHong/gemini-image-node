import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * 调试信息记录器
 * @param {Object} argv - 命令行参数
 * @param {String} message - 调试消息
 */
export function debug(argv, message) {
  if (argv.debug) {
    console.log(`[DEBUG] ${message}`);
  }
}

/**
 * 根据文件扩展名获取 MIME 类型的辅助函数
 * @param {String} filePath - 文件路径
 * @returns {String} MIME 类型
 */
export function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp'
  };
  return mimeTypes[ext] || 'image/jpeg';
}

/**
 * 将图像转换为 base64 的辅助函数
 * @param {String} imagePath - 图像路径
 * @returns {String} Base64 编码的图像
 */
export function imageToBase64(imagePath) {
  return fs.readFileSync(imagePath).toString('base64');
}

/**
 * 确保平台的配置目录存在
 * @returns {String} 配置目录的路径
 */
export function ensureConfigDirectory() {
  let configDir;
  
  if (os.platform() === 'win32') {
    // Windows
    configDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'imagen-gemini-cli');
  } else {
    // 类 Unix 系统
    configDir = path.join(os.homedir(), '.config', 'imagen-gemini-cli');
  }
  
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    debug({ debug: true }, `已创建配置目录：${configDir}`);
  }
  
  return configDir;
}

/**
 * 用于屏蔽任何 API 响应中 base64 内容的主函数
 * @param {Object} obj - API 响应对象
 * @returns {Object} 对象的屏蔽副本
 */
export function maskBase64Content(obj) {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }
    
    const masked = JSON.parse(JSON.stringify(obj));
    const paths = [];
    
    // 根据 API 类型识别 base64 内容的路径
    if (masked.predictions && Array.isArray(masked.predictions)) {
      // Imagen API
      paths.push(...findImagenBase64Paths(masked));
    } else if (masked.candidates && Array.isArray(masked.candidates)) {
      // Gemini API
      paths.push(...findGeminiBase64Paths(masked));
    }
    
    // Apply masking to all identified paths
    paths.forEach(path => {
      const base64Value = getValueAtPath(masked, path);
      if (typeof base64Value === 'string' && base64Value.length > 100) {
        const maskedValue = `[BASE64_DATA_MASKED: ~${Math.floor(base64Value.length / 4 * 3 / 1024)} KB]`;
        setValueAtPath(masked, path, maskedValue);
      }
    });
    
    return masked;
  }
  
  /**
   * 在 Imagen API 响应中查找所有潜在 base64 内容的路径
   * @param {Object} obj - Imagen API 响应对象
   * @returns {Array<string>} 路径字符串数组
   */
  export function findImagenBase64Paths(obj) {
    const paths = [];
    
    if (obj.predictions && Array.isArray(obj.predictions)) {
      obj.predictions.forEach((_, index) => {
        paths.push(`predictions[${index}].bytesBase64Encoded`);
      });
    }
    
    return paths;
  }
  
  /**
   * 在 Gemini API 响应中查找所有潜在 base64 内容的路径
   * @param {Object} obj - Gemini API 响应对象
   * @returns {Array<string>} 路径字符串数组
   */
  export function findGeminiBase64Paths(obj) {
    const paths = [];
    
    if (obj.candidates && Array.isArray(obj.candidates)) {
      obj.candidates.forEach((candidate, i) => {
        if (candidate.content && candidate.content.parts && Array.isArray(candidate.content.parts)) {
          candidate.content.parts.forEach((_, j) => {
            paths.push(`candidates[${i}].content.parts[${j}].inlineData.data`);
          });
        }
      });
    }
    
    return paths;
  }
  
  // 辅助函数（未导出）
  
  /**
   * 获取对象中特定路径的值
   * @param {Object} obj - 要从中检索的对象
   * @param {string} path - 值的路径
   * @returns {any} 路径处的值，如果未找到则返回 undefined
   */
  function getValueAtPath(obj, path) {
    const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current = obj;
    
    for (let i = 0; i < segments.length; i++) {
      if (current === undefined) return undefined;
      current = current[segments[i]];
    }
    
    return current;
  }
  
  /**
   * 设置对象中特定路径的值
   * @param {Object} obj - 要修改的对象
   * @param {string} path - 要设置的路径
   * @param {any} value - 要设置的值
   */
  function setValueAtPath(obj, path, value) {
    const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current = obj;
    
    for (let i = 0; i < segments.length - 1; i++) {
      if (current[segments[i]] === undefined) return;
      current = current[segments[i]];
    }
    
    current[segments[segments.length - 1]] = value;
  }

/**
 * 将数据保存到文件，确保目录存在
 * @param {String} filePath - 应保存文件的路径
 * @param {String|Buffer} data - 要保存的数据
 * @param {Object} options - 保存选项
 * @param {Boolean} options.isBase64 - 数据是否为需要转换的 base64 字符串
 * @param {Boolean} options.silent - 是否禁止日志记录
 * @returns {String} 保存文件的路径
 */
export function saveFile(filePath, data, options = {}) {
  const { isBase64 = false, silent = false } = options;
  
  // 确保目录存在
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // 如果需要，从 base64 转换
  const fileData = isBase64 ? Buffer.from(data, 'base64') : data;
  
  // 保存文件
  fs.writeFileSync(filePath, fileData);
  
  // 除非静默，否则记录日志
  if (!silent) {
    console.log(`文件已保存到：${filePath}`);
  }
  
  return filePath;
}

/**
 * 屏蔽对象中的 base64 内容并将其保存到 JSON 文件
 * @param {Object} obj - 包含潜在 base64 内容的对象
 * @param {String} filePath - 应保存屏蔽 JSON 的路径
 * @param {Object} options - 保存选项
 * @param {Boolean} options.silent - 是否禁止日志记录
 * @param {Number} options.indent - JSON 缩进（默认值：2）
 * @returns {String} 保存文件的路径
 */
export function maskAndSaveJson(obj, filePath, options = {}) {
  const { silent = false, indent = 2 } = options;
  
  // 创建屏蔽副本
  const maskedObj = maskBase64Content(obj);
  
  // 转换为 JSON 字符串
  const jsonData = JSON.stringify(maskedObj, null, indent);
  
  // 保存到文件
  return saveFile(filePath, jsonData, { silent });
}
