# ColorFM Demo

[English](README.md) | 简体中文

**在线 Demo：** <https://whyb.github.io/ColorFM-Demo/>

ColorFM Demo 是一个基于 [ColorFM](https://github.com/cszn/ColorFM) 的非官方浏览器演示项目，用于图片和视频的色彩迁移。导出的 ONNX 模型直接在浏览器本地推理，Content、Style 和生成结果不需要上传到服务器。

主要功能：

- Content 支持图片或视频，Style 支持图片。
- 支持拖拽上传、点击选择，并默认加载 `content.jpg` 和 `style.jpg`。
- 提供 Content 与 Output 的可拖动分割线对比预览。
- 支持 `0%～100%` 的迁移强度实时调节。
- 推理长边可调，默认 `2048 px`，并保留原始尺寸选项。
- 视频模式支持播放、暂停、停止、进度 seek、上一帧、下一帧和逐帧步长设置。
- 支持保存当前帧 PNG。
- 支持使用 WebCodecs 和 `mp4-muxer` 导出完整的无音轨 H.264 MP4。
- 视频导出时会弹出模态窗口，显示帧数、百分比、已用时间、预计剩余时间和停止导出按钮。

## 工作原理

整个流程都在浏览器中完成：

1. 使用浏览器原生图片/视频接口解码 Content 和 Style。
2. 将输入转换为 NCHW RGB float 张量。
3. 使用 ONNX Runtime Web 运行导出的 ColorFM-L ONNX 模型。
4. 将模型输出恢复为图片，并根据迁移强度与 Content 帧混合。
5. 使用 WebGL shader 合成 Content / Output 对比预览。
6. 视频导出时逐帧处理，并使用 WebCodecs 编码为 H.264 MP4。

项目不需要后端推理服务。

## 推理后端

项目使用 ONNX Runtime Web 1.30.0，并会自动尝试以下后端：

1. `WebGPU`
2. `WebGL`
3. `WASM Threads + SIMD`
4. `WASM SIMD`

浏览器支持 WebGPU 时通常会获得最佳速度。WebGL 会作为第二选择尝试，但部分模型算子（例如 `int64`）可能无法由 WebGL Execution Provider 执行，此时会自动回退到 WASM。

预览渲染和后端推理是两个独立部分。浏览器支持 WebGL 时，对比分割、迁移强度混合和视频帧显示会由 WebGL 完成。

## 视频处理

视频 Content 由浏览器原生 `<video>` 元素解码。页面会定位到当前时间点，对当前帧执行色彩迁移，再将结果显示到对比区域。

视频播放由实际推理速度驱动：

- 推理当前帧。
- 显示当前 Output。
- 定位到下一帧时间点。
- 继续推理下一帧。

因此，播放速度会跟随实际推理速度变化，而不会默默丢弃 Output 帧。

## 完整视频导出

点击 `导出完整视频` 后会逐帧处理视频：

- 使用 `逐帧 / 导出 FPS` 中选择的帧率。
- 使用当前迁移强度。
- 按原视频时间轴写入每帧时间戳。
- 使用 WebCodecs `VideoEncoder` 编码 H.264。
- 使用 `mp4-muxer` 封装 MP4。
- 不使用实时录屏，因此推理较慢不会导致导出视频变成慢动作。

目前导出的 MP4 不包含音轨，因为浏览器端流程尚未对源视频音频进行解复用和重新编码。

完整视频导出需要基于 Chromium 的浏览器，并要求 WebCodecs 与可用的 H.264 编码器。导出期间模态窗口会锁定资源替换操作，并显示实时进度。也可以随时结束导出。

## 本地运行

项目是纯静态网站，不需要 npm、打包工具或构建步骤。

在仓库根目录启动任意 HTTP 服务器：

```bash
python -m http.server 8000
```

然后访问：

```text
http://127.0.0.1:8000/
```

不要直接使用 `file://` 打开 `index.html`。浏览器需要通过 HTTP 环境读取 ONNX 模型和 WebAssembly 资源。

### WASM 多线程

WASM 多线程需要以下跨源隔离响应头：

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

普通的 `python -m http.server` 不会发送这些响应头，因此可能会回退到单线程 WASM。WebGPU 推理不依赖这些响应头。

GitHub Pages 可以托管这个 Demo，但无法配置上述响应头。支持 WebGPU 或单线程 WASM 的浏览器仍可正常运行页面。

## 项目结构

```text
ColorFM-Demo/
├── index.html
├── app.js
├── css/
│   └── style.css
├── js/
│   ├── onnxruntime.min.js
│   ├── ort-wasm-simd-threaded.mjs
│   ├── ort-wasm-simd-threaded.wasm
│   ├── ort-wasm-simd-threaded.jsep.mjs
│   ├── ort-wasm-simd-threaded.jsep.wasm
│   ├── ort-wasm-simd-threaded.asyncify.mjs
│   ├── ort-wasm-simd-threaded.asyncify.wasm
│   ├── opencv.min.js
│   ├── utils.js
│   └── mp4-muxer.js
├── content.jpg
├── style.jpg
├── model.onnx
├── LICENSE
├── README.md
└── README.cn.md
```

## 浏览器支持

推荐使用桌面版 Chrome 或 Edge。

| 能力 | 要求 |
| --- | --- |
| WebGPU 推理 | 浏览器和 GPU 支持 WebGPU |
| WebGL 推理 | 浏览器支持 WebGL；ColorFM 的部分算子不保证兼容 WebGL |
| WASM 推理 | WebAssembly SIMD；多线程还需要跨源隔离 |
| MP4 导出 | WebCodecs `VideoEncoder` 和可用的 H.264 编码器 |
| 视频输入 | 浏览器和操作系统支持对应视频编码格式 |

Firefox 和 Safari 也可能运行部分功能，但最终使用的推理后端以及视频导出能力取决于浏览器版本和系统编解码器。

## 模型与首次加载

ONNX 模型和运行时资源都作为静态文件提供。首次打开页面可能需要下载几十 MB 资源，具体取决于浏览器缓存和实际使用的执行后端。缓存命中后，后续加载通常会更快。

所有推理和媒体处理均在浏览器本地完成。

## 已知限制

- 完整视频导出不包含原视频音轨。
- 导出使用页面选择的导出 FPS，不会自动分析源视频帧率。
- 视频输入格式取决于浏览器和操作系统的原生解码能力。
- 大视频和原始尺寸推理可能占用大量 GPU/CPU 内存。
- WebGL 推理后端可能因部分算子不支持而回退到 WASM。
- GitHub Pages 无法开启 WASM 多线程所需的跨源隔离。

## 致谢

本 Demo 的实现离不开原项目的研究和开源代码：

- 原项目：[cszn/ColorFM](https://github.com/cszn/ColorFM)
- 作者：[Yuhang He](https://github.com/heyh31) 和 [Kai Zhang](https://github.com/cszn)

特别感谢 Yuhang He 和 Kai Zhang 开源 ColorFM，使相关研究能够被更广泛地使用和验证。本仓库是非官方浏览器 Demo，并非 ColorFM 官方项目。

同时感谢以下开源项目：

- [ONNX Runtime Web](https://onnxruntime.ai/)
- [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html)
- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer)

## 许可证

本仓库源代码使用 [LICENSE](LICENSE) 中的许可证。原 ColorFM 项目及其模型遵循各自的上游许可证；在重新分发模型或派生资源前，请先查阅上游仓库的授权说明。

## 相关链接

- [在线 Demo](https://whyb.github.io/ColorFM-Demo/)
- [ColorFM 原项目](https://github.com/cszn/ColorFM)
- [Yuhang He](https://github.com/heyh31)
- [Kai Zhang](https://github.com/cszn)
- [English README](README.md)
