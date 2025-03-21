# imagen-gemini-cli

## 描述
`imagen-gemini-cli` 是一个命令行工具，用于使用 Google 的 Imagen 3 和 Gemini 2.0 API 生成图像。该工具支持多种配置选项，并提供交互模式以便用户更方便地生成图像。

## 安装
1. 确保你已经安装了 Node.js。
2. 克隆仓库：
   ```sh
   git clone https://github.com/your-repo/imagen-gemini-cli.git
   cd imagen-gemini-cli
   ```
3. 安装依赖：
   ```sh
   npm install
   ```

## 使用方法
### 基本用法
```sh
npx imagen-cli "美丽的风景"
```

### 全局安装后直接使用
```sh
npm install -g
imagen-cli "美丽的风景"
```

### 交互模式
```sh
imagen-cli --interactive
```

## 示例
### 使用 Imagen API 生成图像
```sh
imagen-cli "美丽的风景" --api imagen --model imagen-3.0-generate-002 --output-dir ./output_images
```

### 使用 Gemini API 生成图像
```sh
imagen-cli "美丽的风景" --api gemini --reference-images ./path/to/image1.jpg ./path/to/image2.jpg --output-dir ./output_images
```

### 使用配置文件
创建一个 JSON 配置文件 `config.json`：
```json
{
  "prompt": "美丽的风景",
  "api": "imagen",
  "model": "imagen-3.0-generate-002",
  "output-dir": "./output_images",
  "json-dir": "./json_output"
}
```
然后运行：
```sh
imagen-cli --config-file config.json
```

## 选项
### 核心选项
- `--api, -t`: 用于图像生成的 API (`imagen` 或 `gemini`)。默认值：`imagen`
- `--model, -m`: 模型 ID。默认值：`imagen-3.0-generate-002`

### 输入选项
- `--reference-images, -r`: Gemini 的参考图像路径（可以提供多个）
- `--config-file, -f`: 图像生成的 JSON 配置文件路径

### 输出选项
- `--output-dir, -o`: 保存图像的输出目录。默认值：上次使用的目录
- `--json-dir, -j`: 保存 JSON 文件（请求/响应）的目录。默认值：上次使用的目录

### 认证选项
- `--project-id, -P`: Google Cloud 项目 ID（默认为服务账户中的项目 ID）
- `--key-file, -k`: 服务账户 JSON 密钥文件路径（覆盖 `GOOGLE_APPLICATION_CREDENTIALS`）
- `--gemini-key, -g`: Gemini API 密钥（覆盖 `.env` 中的 `GEMINI_API_KEY`）
- `--location, -l`: API 位置。默认值：`us-central1`

### 图像生成设置（仅限 Imagen）
- `--aspect-ratio, -a`: 图像纵横比。默认值：`1:1`。选项：`1:1`, `16:9`, `9:16`, `3:4`, `4:3`
- `--count, -c`: 要生成的图像数量。默认值：`1`。选项：`1`, `2`, `3`, `4`
- `--negative-prompt, -n`: 负面提示
- `--enhance, -e`: 增强提示。默认值：`false`
- `--person-generation, -b`: 人物生成。默认值：`allow_adult`。选项：`block_all`, `block_children`, `allow_adult`
- `--safety, -s`: 安全性设置。默认值：`block_few`。选项：`block_none`, `block_few`, `block_some`, `block_most`
- `--watermark, -w`: 添加水印。默认值：`true`

### 运行时选项
- `--interactive, -i`: 运行交互模式。默认值：`false`
- `--debug, -d`: 显示调试信息。默认值：`false`
- `--detect-proxy, -x`: 强制检测系统代理设置。默认值：`false`
- `--no-proxy, -N`: 禁用代理使用。默认值：`false`

## 许可证
MIT
