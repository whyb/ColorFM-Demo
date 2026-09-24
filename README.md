# ColorFM Demo

English | [简体中文](README.cn.md)

**Live Demo:** <https://whyb.github.io/ColorFM-Demo/>

ColorFM Demo is an unofficial, browser-only web interface for image and video color transfer with [ColorFM](https://github.com/cszn/ColorFM). It runs the exported ONNX model locally in the browser, so Content, Style, and generated results are not uploaded to a server.

The demo supports:

- Image or video Content input and image Style input.
- Drag-and-drop, click-to-select, and built-in `content.jpg` / `style.jpg` examples.
- An interactive split-view comparison between the original Content and the transferred Output.
- Real-time migration strength control from `0%` to `100%`.
- Adjustable inference long edge, with `2048 px` as the default and an original-resolution option.
- Video playback, pause, stop, timeline seeking, previous/next frame controls, and configurable frame stepping.
- Current-frame PNG export.
- Complete video export to a silent H.264 MP4 using WebCodecs and `mp4-muxer`.
- A progress modal during video export with frame count, percentage, elapsed time, estimated remaining time, and a stop button.

## How It Works

The demo performs the complete workflow in the browser:

1. Content and Style are decoded with the browser's native image/video APIs.
2. Inputs are normalized and converted to NCHW RGB float tensors.
3. The exported ColorFM-L ONNX model runs with ONNX Runtime Web.
4. The model output is converted back to an image and blended with the Content frame according to the selected strength.
5. The comparison view is composited with a WebGL shader.
6. Video frames are processed one at a time and encoded into H.264 MP4 with WebCodecs.

No backend inference service is required.

## Inference Backends

ONNX Runtime Web 1.30.0 is used with automatic backend fallback:

1. `WebGPU`
2. `WebGL`
3. `WASM Threads + SIMD`
4. `WASM SIMD`

WebGPU is usually the fastest option when available. WebGL is attempted next, although some model operators such as `int64` may not be supported by the WebGL execution provider, in which case the demo continues with WASM.

The preview renderer is separate from the inference backend and uses WebGL when available for fast split-view composition and strength blending.

## Video Processing

For video Content, the video is decoded by the browser's native `<video>` element. The demo seeks to the selected timestamp, transfers that frame, and displays the result in the comparison view.

Playback is driven by inference completion:

- The current frame is inferred.
- The Output is rendered.
- The player advances to the next timestamp.
- The next frame is inferred.

As a result, video playback speed follows the actual inference speed instead of silently dropping Output frames.

## Full Video Export

The `Export Complete Video` button exports the video frame by frame:

- Uses the selected frame rate from the `Frame step / Export FPS` control.
- Reuses the current migration strength.
- Writes timestamps based on the original video timeline.
- Encodes H.264 with WebCodecs `VideoEncoder`.
- Packages the result as MP4 with `mp4-muxer`.
- Does not use real-time screen recording, so slow inference does not turn the exported video into slow motion.

The exported MP4 currently has no audio track because the browser-side pipeline does not demux and re-encode the source audio.

Export requires a Chromium-based browser with WebCodecs and an available H.264 encoder. During export, a modal window locks resource replacement and displays progress. The export can be stopped from the modal.

## Local Development

The project is a static website and does not require npm, a bundler, or a build step.

From the repository root, start any HTTP server:

```bash
python -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/
```

Do not open `index.html` directly with `file://`. Browsers require an HTTP origin to load the ONNX model and WebAssembly assets correctly.

### WASM Multithreading

WASM threads require cross-origin isolation headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

A normal `python -m http.server` does not set these headers, so the demo may fall back to single-threaded WASM. WebGPU inference does not depend on those headers.

GitHub Pages is suitable for hosting the demo, but it cannot configure the two headers above. Users with WebGPU or single-threaded WASM support can still run the site normally.

## Project Structure

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

## Browser Support

Desktop Chrome and Edge are recommended.

| Capability | Requirement |
| --- | --- |
| WebGPU inference | A WebGPU-capable browser and GPU |
| WebGL inference | WebGL support; not all ColorFM operators are guaranteed to be WebGL-compatible |
| WASM inference | WebAssembly SIMD; threads additionally require cross-origin isolation |
| MP4 export | WebCodecs `VideoEncoder` and an available H.264 encoder |
| Video input | A codec supported by the browser and operating system |

Firefox and Safari may run parts of the demo, but the exact backend and video-export support depends on the installed browser version and platform codecs.

## Model and First Load

The ONNX model and runtime assets are served as static files. The first page load can download tens of megabytes, depending on browser caching and the selected execution backend. Subsequent loads should be faster when those assets remain cached.

All inference and media processing happen locally in the browser.

## Limitations

- Full video export is video-only and does not include the original audio track.
- Export uses the selected export FPS and does not automatically inspect the source frame rate.
- Browser-native video decoding means supported input formats depend on the browser and operating system.
- Very large videos and the original-resolution inference setting can require substantial GPU/CPU memory.
- WebGL is attempted as an inference backend, but an operator may force fallback to WASM.
- GitHub Pages cannot enable cross-origin isolation for WASM multi-threading.

## Acknowledgements

This demo would not be possible without the original research and implementation:

- Original project: [cszn/ColorFM](https://github.com/cszn/ColorFM)
- Authors: [Yuhang He](https://github.com/heyh31) and [Kai Zhang](https://github.com/cszn)

Special thanks to Yuhang He and Kai Zhang for releasing ColorFM and making the research available to the community. This repository is an unofficial browser demonstration and is not the official ColorFM project.

The web demo also relies on:

- [ONNX Runtime Web](https://onnxruntime.ai/)
- [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html)
- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer)

## License

The source code in this repository is released under the license in [LICENSE](LICENSE). The original ColorFM project and its model are distributed under their own upstream license; please consult the upstream repository before redistributing the model or derived assets.

## Links

- [Live Demo](https://whyb.github.io/ColorFM-Demo/)
- [Original ColorFM Project](https://github.com/cszn/ColorFM)
- [Yuhang He](https://github.com/heyh31)
- [Kai Zhang](https://github.com/cszn)
- [简体中文 README](README.cn.md)
