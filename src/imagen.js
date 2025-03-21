import fs from 'fs';
import path from 'path';
import { saveConfig } from './config.js';
import { getAccessToken } from './auth.js';
import { fetchWithProxy } from './proxy.js';
import { debug, maskBase64Content, saveFile, maskAndSaveJson } from './utils.js';

/**
 * Generate images with Imagen API
 * @param {Object} options - Generation options
 * @param {Object} argv - Command line arguments
 * @returns {Promise<Object>} Generation result
 */
export async function generateImagesWithImagen(options, argv) {
  try {
    const {
      keyFile,
      projectId,
      prompt,
      location = 'us-central1',
      aspectRatio = '1:1',
      count = 1,
      negativePrompt = '',
      enhance = false,
      personGeneration = 'allow_adult',
      safety = 'block_few',
      watermark = true,
      outputDir = './images',
      jsonDir = './output',
      model = 'imagen-3.0-generate-002'
    } = options;
    
    // Save both directories for next time
    saveConfig({ 
      lastOutputDir: outputDir,
      lastJsonDir: jsonDir 
    });
    
    // Get access token
    console.log('正在获取访问令牌...');
    const accessToken = await getAccessToken(keyFile, argv);
    
    // Prepare request
    const apiEndpoint = `${location}-aiplatform.googleapis.com`;
    
    const requestData = {
      endpoint: `projects/${projectId}/locations/${location}/publishers/google/models/${model}`,
      instances: [
        {
          prompt: prompt,
        }
      ],
      parameters: {
        aspectRatio: aspectRatio,
        sampleCount: count,
        negativePrompt: negativePrompt,
        enhancePrompt: enhance,
        personGeneration: personGeneration,
        safetySetting: safety,
        addWatermark: watermark,
        includeRaiReason: true,
        language: "auto",
      }
    };
    
    const requestUrl = `https://${apiEndpoint}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;
    
    console.log(`正在发送请求到：${requestUrl}`);
    console.log('使用提示生成图像：', prompt);
    
    // Configure fetch options
    const fetchOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(requestData)
    };
    
    // Generate a requestId for this request
    const requestId = `imagen_${Date.now()}`;
    
    // Make request using our fetch wrapper
    const response = await fetchWithProxy(requestUrl, fetchOptions, argv, { requestId, outputDir });
    
    if (!response.ok) {
      let errorMessage = '';
      let errorDetail = '';
      
      try {
        const errorJson = await response.json();
        
        if (errorJson.error) {
          errorMessage = errorJson.error.message || '';
          errorDetail = errorJson.error.status || '';
          
          // Check if this is a safety filter block
          if (response.status === 400 && errorMessage.includes('safety filter threshold prohibited')) {
            console.error('⚠️ 安全过滤器阻止了此提示：');
            console.error('  → ' + errorMessage);
            console.error('尝试调整您的提示或更改安全设置。');
            
            return { 
              success: false, 
              error: '安全过滤器阻止了此提示', 
              blocked: true,
              details: errorMessage,
              statusCode: response.status
            };
          }
          
          // Check if this is a person generation permission error
          if (response.status === 400 && errorMessage.includes('You have chosen the \'Allow (All ages)\' option for Person Generation, but this option is not available to you')) {
            console.error('⚠️ 人物生成权限错误：');
            console.error('  → ' + errorMessage);
            console.error('尝试使用 "allow_adult" 而不是 "allow_all_ages" 作为 personGeneration 参数。');
            
            return { 
              success: false, 
              error: '人物生成权限错误', 
              permissionIssue: true,
              details: errorMessage,
              statusCode: response.status
            };
          }
        }
      } catch (e) {
        // Fallback to text if JSON parsing fails
        errorMessage = await response.text();
      }
      
      console.error(`错误 ${response.status}: ${errorMessage}`);
      return { success: false, error: errorMessage, details: errorDetail, statusCode: response.status };
    }
    
    const result = await response.json();
    
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Create JSON directory if it doesn't exist
    if (!fs.existsSync(jsonDir)) {
      fs.mkdirSync(jsonDir, { recursive: true });
    }
    
    // Save request for debugging
    const requestFilename = path.join(jsonDir, `${requestId}_request.json`);
    saveFile(requestFilename, JSON.stringify(requestData, null, 2));
    
    // Save masked response for debugging
    const responseFilename = path.join(jsonDir, `${requestId}_response.json`);
    maskAndSaveJson(result, responseFilename);
    
    // Process and save images
    if (result && result.predictions && result.predictions.length > 0) {
      const savedImagePaths = [];
      let generatedCount = 0;
      let blockedCount = 0;
      
      // First pass: Check for RAI filtered reasons in any prediction
      for (let i = 0; i < result.predictions.length; i++) {
        const prediction = result.predictions[i];
        
        // Check if this prediction is a RAI filter message
        if (prediction.raiFilteredReason) {
          // If it indicates ALL images were filtered
          if (prediction.raiFilteredReason.includes("Unable to show generated images. All images were filtered out")) {
            console.error('⚠️ 责任人工智能过滤器阻止了所有图像：');
            console.error('  → ' + prediction.raiFilteredReason);
            console.error('尝试重新表述您的提示或调整安全设置。');
            
            return { 
              success: false, 
              error: '责任人工智能过滤了内容', 
              blocked: true,
              raiFiltered: true,
              details: prediction.raiFilteredReason
            };
          }
          
          // Extract the number of filtered images if possible
          const match = prediction.raiFilteredReason.match(/filtered out (\d+) generated images/);
          if (match && match[1]) {
            const filteredCount = parseInt(match[1], 10);
            blockedCount += filteredCount;
            console.log(`⚠️ ${filteredCount} 张图像被责任人工智能安全过滤器过滤掉。`);
            console.log('  → ' + prediction.raiFilteredReason);
          } else {
            console.log('⚠️ 某些图像被责任人工智能过滤：');
            console.log('  → ' + prediction.raiFilteredReason);
          }
        }
      }
      
      // Second pass: Process actual images
      for (let i = 0; i < result.predictions.length; i++) {
        const prediction = result.predictions[i];
        
        // Skip if this prediction is a RAI filter message
        if (prediction.raiFilteredReason) {
          continue;
        }
        
        // Handle the standard format with images array
        if (prediction.images && prediction.images.length > 0) {
          console.log(`在标准格式中找到 ${prediction.images.length} 张图像`);
          
          prediction.images.forEach((img, index) => {
            if (img.bytesBase64Encoded) {
              const filename = path.join(outputDir, `${requestId}_${i}_${index}.png`);
              
              // Decode base64 and save image
              saveFile(filename, img.bytesBase64Encoded, { isBase64: true });
              
              savedImagePaths.push(filename);
              generatedCount++;
            }
          });
        } 
        // Handle direct base64 encoded format
        else if (prediction.bytesBase64Encoded) {
          const imageType = prediction.mimeType || 'image/png';
          const ext = imageType.split('/')[1] || 'png';
          const filename = path.join(outputDir, `${requestId}_${i}.${ext}`);
          
          // Decode base64 and save image
          saveFile(filename, prediction.bytesBase64Encoded, { isBase64: true });
          
          savedImagePaths.push(filename);
          generatedCount++;
        } 
      }
      
      // Log summary message about generated images
      const totalRequested = options.count;
      const totalGenerated = generatedCount;
      const totalBlocked = blockedCount;
      
      let blockedMessage = totalBlocked > 0 ? 
        `（${totalBlocked} 张被安全过滤器阻止）` : 
        "，没有被阻止的";
      
      console.log(`生成了 ${totalGenerated} 张图像${blockedMessage}`);
      
      // Report if there's a discrepancy between requested and accounted for
      const totalAccountedFor = totalGenerated + totalBlocked;
      if (totalAccountedFor < totalRequested) {
        console.log(`注意：您请求了 ${totalRequested} 张图像，但只有 ${totalAccountedFor} 张被计算在内。`);
      }
      
      if (savedImagePaths.length > 0) {
        return {
          success: true,
          outputDir,
          images: savedImagePaths,
          generated: totalGenerated,
          blocked: totalBlocked
        };
      } else {
        console.error('没有保存任何图像。');
        return { 
          success: false, 
          error: '没有保存任何图像',
          blocked: totalBlocked > 0,
          blockedCount: totalBlocked
        };
      }
    } else {
      console.error('响应中未找到预测。');
      return { success: false, error: 'No predictions found in response', jsonFiles: { request: requestFilename, response: responseFilename } };
    }
    
  } catch (error) {
    console.error('使用 Imagen 生成图像时出错：', error);
    return { success: false, error: error.message };
  }
}
