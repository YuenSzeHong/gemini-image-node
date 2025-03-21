import fs from 'fs';
import path from 'path';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { saveConfig } from './config.js';
import { createProxyAgent, fetchWithProxy } from './proxy.js';
import { getMimeType, imageToBase64, debug, maskBase64Content, saveFile, maskAndSaveJson } from './utils.js';

/**
 * Process Gemini API response
 * @param {Object} result - API response JSON
 * @param {string} requestId - Request identifier
 * @param {string} outputDir - Output directory
 * @param {string} jsonDir - JSON output directory
 * @returns {Object} Processing result
 */
function processGeminiResponse(result, requestId, outputDir, jsonDir) {
  // Save masked response for debugging
  const responseFilename = path.join(jsonDir, `${requestId}_response.json`);
  maskAndSaveJson(result, responseFilename);

  // Check for safety block
  if (result.candidates && 
      result.candidates.length > 0 && 
      result.candidates[0].finishReason === "IMAGE_SAFETY") {
    console.error("由于安全问题，图像生成被阻止。提示可能触发了安全过滤器。");
    return { 
      success: false, 
      error: "由于安全问题，图像生成被阻止",
      safetyBlock: true,
      responseFile: responseFilename
    };
  }
  
  // Extract and save images
  const savedImagePaths = [];
  
  try {
    // Navigate through the Gemini API response structure
    if (result.candidates && result.candidates.length > 0) {
      const candidate = result.candidates[0];
      if (candidate.content && candidate.content.parts) {
        const parts = candidate.content.parts;
        
        let imageCount = 0;
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          // Check for inlineData field (note the camelCase in the response)
          if (part.inlineData && part.inlineData.data) {
            imageCount++;
            const imageData = part.inlineData.data;
            const imageType = part.inlineData.mimeType || 'image/png';
            const ext = imageType.split("/")[1];
            
            // Save image with a unique index to prevent overwriting
            const imageFilename = path.join(outputDir, `${requestId}_generated_${imageCount}.${ext}`);
            saveFile(imageFilename, imageData, { isBase64: true });
            
            savedImagePaths.push(imageFilename);
          }
        }
        
        if (imageCount === 0) {
          console.warn("响应中未找到图像，请检查响应 JSON 文件");
        }
      } else {
        console.warn("响应结构缺少 content 或 parts 字段");
      }
    } else {
      console.warn("响应缺少 candidates 字段");
    }
  } catch (error) {
    console.error('处理响应时出错：', error);
    return { 
      success: true, 
      outputDir,
      images: savedImagePaths,
      warning: '处理响应的某些部分时出错'
    };
  }
  
  return {
    success: true,
    outputDir,
    jsonDir,
    images: savedImagePaths,
    jsonFiles: {
      response: responseFilename
    }
  };
}

/**
 * Generate images with Gemini API
 * @param {Object} options - Generation options
 * @param {Object} argv - Command line arguments
 * @returns {Promise<Object>} Generation result
 */
export async function generateImagesWithGemini(options, argv) {
  try {
    const {
      geminiKey,
      prompt,
      referenceImages = [],
      outputDir = './images',
      jsonDir = './output'
    } = options;
    
    // Save both directories for next time
    saveConfig({ 
      lastOutputDir: outputDir,
      lastJsonDir: jsonDir 
    });
    
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Create JSON directory if it doesn't exist
    if (!fs.existsSync(jsonDir)) {
      fs.mkdirSync(jsonDir, { recursive: true });
    }
    
    // Generate request ID
    const timestamp = Date.now();
    let requestId;
    
    if (referenceImages.length === 0) {
      requestId = `gemini_text_to_image_${timestamp}`;
    } else {
      const firstFileName = path.basename(referenceImages[0], path.extname(referenceImages[0]));
      if (referenceImages.length > 1) {
        requestId = `gemini_${firstFileName}_and_${referenceImages.length-1}_more_${timestamp}`;
      } else {
        requestId = `gemini_${firstFileName}_${timestamp}`;
      }
    }
    
    // Construct request data
    let requestData;
    
    if (referenceImages.length === 0) {
      // Text-to-image mode
      requestData = {
        contents: [{
          parts: [
            { text: prompt }
          ]
        }],
        generationConfig: { responseModalities: ["Text", "Image"] }
      };
    } else {
      // Image modification mode
      const parts = [{ text: prompt }];
      
      // Add all images to request
      for (const imagePath of referenceImages) {
        try {
          const base64Image = imageToBase64(imagePath);
          const mimeType = getMimeType(imagePath);
          
          parts.push({
            inline_data: {
              mime_type: mimeType,
              data: base64Image
            }
          });
        } catch (error) {
          console.error(`Error processing image ${imagePath}:`, error);
          return { success: false, error: `Failed to process image: ${imagePath}` };
        }
      }
      
      requestData = {
        contents: [{
          parts: parts
        }],
        generationConfig: { responseModalities: ["Text", "Image"] }
      };
    }
    
    // Log what we're doing
    console.log(`使用 Gemini API 生成图像${referenceImages.length > 0 ? '（带参考）' : ''}`);
    console.log('提示：', prompt);
    if (referenceImages.length > 0) {
      console.log(`使用 ${referenceImages.length} 个参考图像`);
    }
    
    // Save request for debugging (without base64 data)
    const requestFilename = path.join(jsonDir, `${requestId}_request.json`);
    maskAndSaveJson(requestData, requestFilename);
    
    // Configure API URL
    const apiDomain = process.env.GEMINI_API_DOMAIN || 'generativelanguage.googleapis.com';
    const apiUrl = `https://${apiDomain}/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${geminiKey}`;
    
    console.log(`使用 Gemini API 端点：${apiDomain}`);
    
    // Configure fetch options
    const fetchOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    };
    
    // Send request
    console.log('正在向 Gemini API 发送请求...');
    try {
      // Use the new fetchWithProxy wrapper
      const response = await fetchWithProxy(apiUrl, fetchOptions, argv, { requestId, outputDir });
      
      // Check response status
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API 返回错误：${response.status}`);
        console.error(`错误详细信息：${errorText}`);
        
        // Save error response
        const errorFilename = path.join(jsonDir, `${requestId}_error.json`);
        try {
          const errorJson = await response.json();
          saveFile(errorFilename, JSON.stringify(errorJson, null, 2));
        } catch {
          saveFile(errorFilename, errorText);
        }
        
        console.error(`错误信息已保存到：${errorFilename}`);
        return { 
          success: false, 
          error: `API 错误：${response.status}`,
          jsonFiles: {
            request: requestFilename,
            error: errorFilename
          }
        };
      }
      
      // Parse response
      const result = await response.json();
      
      // Save masked response for debugging (if debug is enabled)
      if (argv.debug) {
        const debugResponseFilename = path.join(jsonDir, `${requestId}_response_debug.json`);
        maskAndSaveJson(result, debugResponseFilename);
      }
      
      // Process response
      return processGeminiResponse(result, requestId, outputDir, jsonDir);
      
    } catch (error) {
      console.error('使用 Gemini 生成图像时出错：', error);
      return { success: false, error: error.message };
    }
  } catch (error) {
    console.error('使用 Gemini 生成图像时出错：', error);
    return { success: false, error: error.message };
  }
}
