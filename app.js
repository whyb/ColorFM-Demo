(() => {
  "use strict";

  const ORT_VERSION = "1.30.0";
  const CDN_ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist`;
  const MODEL_URL = "./model.onnx";
  const LOCAL_ORT_CANDIDATES = ["./js/onnxruntime.min.js", "./js/ort.min.js"];

  const elements = {
    runtimeBadge: document.getElementById("runtimeBadge"),
    runtimeText: document.getElementById("runtimeText"),
    contentCard: document.getElementById("contentCard"),
    contentInput: document.getElementById("contentInput"),
    contentDropZone: document.getElementById("contentDropZone"),
    contentPreview: document.getElementById("contentPreview"),
    contentVideoPreview: document.getElementById("contentVideoPreview"),
    contentMeta: document.getElementById("contentMeta"),
    contentName: document.getElementById("contentName"),
    contentSize: document.getElementById("contentSize"),
    styleCard: document.getElementById("styleCard"),
    styleInput: document.getElementById("styleInput"),
    styleDropZone: document.getElementById("styleDropZone"),
    stylePreview: document.getElementById("stylePreview"),
    styleMeta: document.getElementById("styleMeta"),
    styleName: document.getElementById("styleName"),
    styleSize: document.getElementById("styleSize"),
    strengthRange: document.getElementById("strengthRange"),
    strengthValue: document.getElementById("strengthValue"),
    maxEdgeSelect: document.getElementById("maxEdgeSelect"),
    runButton: document.getElementById("runButton"),
    runButtonText: document.getElementById("runButtonText"),
    statusBar: document.getElementById("statusBar"),
    statusText: document.getElementById("statusText"),
    statusProgress: document.getElementById("statusProgress"),
    errorMessage: document.getElementById("errorMessage"),
    resultPanel: document.getElementById("resultPanel"),
    comparisonStage: document.getElementById("comparisonStage"),
    comparisonFrame: document.getElementById("comparisonFrame"),
    beforeLayer: document.getElementById("beforeLayer"),
    outputCanvas: document.getElementById("outputCanvas"),
    contentCanvas: document.getElementById("contentCanvas"),
    compareDivider: document.getElementById("compareDivider"),
    compareLeftLabel: document.getElementById("compareLeftLabel"),
    compareRightLabel: document.getElementById("compareRightLabel"),
    resultTitle: document.getElementById("resultTitle"),
    resultDescription: document.getElementById("resultDescription"),
    splitRange: document.getElementById("splitRange"),
    resultDimensions: document.getElementById("resultDimensions"),
    resultElapsed: document.getElementById("resultElapsed"),
    downloadButton: document.getElementById("downloadButton"),
    exportVideoButton: document.getElementById("exportVideoButton"),
    exportVideoButtonText: document.getElementById("exportVideoButtonText"),
    videoController: document.getElementById("videoController"),
    videoStopButton: document.getElementById("videoStopButton"),
    videoStepBackButton: document.getElementById("videoStepBackButton"),
    videoPlayButton: document.getElementById("videoPlayButton"),
    videoStepForwardButton: document.getElementById("videoStepForwardButton"),
    videoSeekRange: document.getElementById("videoSeekRange"),
    videoCurrentTime: document.getElementById("videoCurrentTime"),
    videoDuration: document.getElementById("videoDuration"),
    videoFpsSelect: document.getElementById("videoFpsSelect"),
    videoPlaybackState: document.getElementById("videoPlaybackState"),
  };

  const state = {
    inputs: { content: null, style: null },
    runtimeSource: null,
    session: null,
    cvReady: false,
    modelLoading: false,
    busy: false,
    result: null,
    splitPercent: 50,
    providerLabel: "初始化中",
    draggingSplit: false,
    styleCache: null,
    videoExport: {
      active: false,
      abort: false,
      encoder: null,
    },
    video: {
      playing: false,
      processing: false,
      stopped: true,
      fps: 30,
      generation: 0,
      playbackToken: 0,
      pendingSeekId: 0,
      draggingVideoSeek: false,
    },
  };

  let strengthFrame = 0;

  function setRuntimeBadge(status, text) {
    elements.runtimeBadge.dataset.state = status;
    elements.runtimeText.textContent = text;
  }

  function setStatus(status, text, progress = "") {
    elements.statusBar.dataset.state = status;
    elements.statusText.textContent = text;
    elements.statusProgress.textContent = progress;
  }

  function showError(message) {
    elements.errorMessage.textContent = message;
    elements.errorMessage.hidden = false;
  }

  function clearError() {
    elements.errorMessage.textContent = "";
    elements.errorMessage.hidden = true;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** index);
    return `${value.toFixed(index === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
  }

  function formatDuration(milliseconds) {
    if (typeof formatMs === "function") return formatMs(milliseconds);
    return milliseconds < 1000
      ? `${Math.round(milliseconds)} ms`
      : `${(milliseconds / 1000).toFixed(2)} s`;
  }

  function formatTimecode(seconds, includeMilliseconds = true) {
    const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const totalMilliseconds = Math.floor(safeSeconds * 1000);
    const milliseconds = totalMilliseconds % 1000;
    const totalSeconds = Math.floor(totalMilliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    const base = hours > 0
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    return includeMilliseconds ? `${base}.${String(milliseconds).padStart(3, "0")}` : base;
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function isVideoInput(input = state.inputs.content) {
    return input?.type === "video";
  }

  function updateActionState() {
    const hasInputs = Boolean(state.inputs.content && state.inputs.style);
    const modelReady = Boolean(state.session);
    elements.runButton.disabled = state.busy || !hasInputs || !modelReady;
    elements.runButton.classList.toggle("is-busy", state.busy);

    if (state.busy) {
      elements.runButtonText.textContent = "正在推理...";
    } else if (!modelReady) {
      elements.runButtonText.textContent = state.modelLoading ? "模型加载中..." : "模型未就绪";
    } else if (isVideoInput()) {
      elements.runButtonText.textContent = state.result ? "从当前时间重新推理" : "开始视频推理";
    } else {
      elements.runButtonText.textContent = "开始色彩迁移";
    }
  }

  function createCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function createWebGLComparisonRenderer(canvas) {
    const options = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    };
    const gl = canvas.getContext("webgl2", options) || canvas.getContext("webgl", options);
    if (!gl) return null;

    const compileShader = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`WebGL shader compile failed: ${message}`);
      }
      return shader;
    };

    let program;
    try {
      const vertexShader = compileShader(gl.VERTEX_SHADER, `
        attribute vec2 a_position;
        varying vec2 v_uv;
        void main() {
          v_uv = a_position * 0.5 + 0.5;
          gl_Position = vec4(a_position, 0.0, 1.0);
        }
      `);
      const fragmentShader = compileShader(gl.FRAGMENT_SHADER, `
        precision highp float;
        varying vec2 v_uv;
        uniform sampler2D u_content;
        uniform sampler2D u_output;
        uniform float u_has_output;
        uniform float u_split;
        uniform float u_strength;

        void main() {
          vec4 content = texture2D(u_content, v_uv);
          vec4 transferred = texture2D(u_output, vec2(v_uv.x, 1.0 - v_uv.y));
          vec3 mixed = mix(content.rgb, transferred.rgb, u_strength);
          vec3 color = v_uv.x <= u_split ? content.rgb : mixed;
          if (u_has_output < 0.5) {
            color = v_uv.x <= u_split ? content.rgb : vec3(0.025, 0.045, 0.04);
          }
          gl_FragColor = vec4(color, 1.0);
        }
      `);
      program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`WebGL program link failed: ${gl.getProgramInfoLog(program)}`);
      }
    } catch (error) {
      console.warn(error);
      return null;
    }

    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    const positionLocation = gl.getAttribLocation(program, "a_position");
    const contentTexture = gl.createTexture();
    const outputTexture = gl.createTexture();
    const splitLocation = gl.getUniformLocation(program, "u_split");
    const strengthLocation = gl.getUniformLocation(program, "u_strength");
    const hasOutputLocation = gl.getUniformLocation(program, "u_has_output");
    let hasContent = false;
    let hasOutput = false;
    let split = 0.5;
    let strength = 1;

    const configureTexture = (texture) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    };
    configureTexture(contentTexture);
    configureTexture(outputTexture);

    function draw() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.02, 0.04, 0.035, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);

      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, contentTexture);
      gl.uniform1i(gl.getUniformLocation(program, "u_content"), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, outputTexture);
      gl.uniform1i(gl.getUniformLocation(program, "u_output"), 1);

      gl.uniform1f(splitLocation, split);
      gl.uniform1f(strengthLocation, strength);
      gl.uniform1f(hasOutputLocation, hasOutput ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.flush();
    }

    return {
      draw,
      setSplit(value) {
        split = Math.max(0, Math.min(1, value));
      },
      setStrength(value) {
        strength = Math.max(0, Math.min(1, value));
      },
      updateContent(source, width, height) {
        if (!source || !width || !height) return;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.bindTexture(gl.TEXTURE_2D, contentTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        hasContent = true;
      },
      updateOutput(imageData) {
        if (!imageData) return;
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.bindTexture(gl.TEXTURE_2D, outputTexture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          imageData.width,
          imageData.height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          imageData.data
        );
        hasOutput = true;
      },
      clearOutput() {
        hasOutput = false;
      },
      get hasContent() {
        return hasContent;
      },
      get active() {
        return true;
      },
    };
  }

  const webglRenderer = createWebGLComparisonRenderer(elements.outputCanvas);
  if (webglRenderer) {
    elements.beforeLayer.hidden = true;
  }

  function imageFileToImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        resolve({
          type: "image",
          file,
          url,
          image,
          element: image,
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`无法解码图片：${file.name}`));
      };
      image.src = url;
    });
  }

  function videoFileToVideo(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      let settled = false;

      const fail = (message) => {
        if (settled) return;
        settled = true;
        video.pause();
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
        reject(new Error(message));
      };

      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      video.controls = false;
      video.onloadeddata = () => {
        if (settled) return;
        if (!video.videoWidth || !video.videoHeight) {
          fail(`无法读取视频尺寸：${file.name}`);
          return;
        }
        settled = true;
        resolve({
          type: "video",
          file,
          url,
          image: video,
          element: video,
          width: video.videoWidth,
          height: video.videoHeight,
          duration: Number.isFinite(video.duration) ? video.duration : 0,
        });
      };
      video.onerror = () => fail(`浏览器无法解码该视频：${file.name}`);
      video.src = url;
      video.load();
    });
  }

  function releaseInput(input) {
    if (!input) return;
    if (input.type === "video") {
      input.element.pause();
      input.element.removeAttribute("src");
      input.element.load();
    }
    if (input.url) URL.revokeObjectURL(input.url);
  }

  function isVideoFileName(file) {
    return /\.(mp4|webm|mov|m4v|ogv|ogg|avi|mkv)$/i.test(file.name || "");
  }

  async function setInput(kind, file) {
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/") || isVideoFileName(file);

    if (kind === "style" && !isImage) {
      showError(`Style 只支持图片文件：“${file.name}”不是可识别的图片。`);
      return;
    }
    if (kind === "content" && !isImage && !isVideo) {
      showError(`“${file.name}”不是可识别的图片或视频文件。`);
      return;
    }

    clearError();
    try {
      const loaded = kind === "content" && isVideo && !isImage
        ? await videoFileToVideo(file)
        : await imageFileToImage(file);
      const previous = state.inputs[kind];
      releaseInput(previous);
      state.inputs[kind] = loaded;

      if (kind === "content" || kind === "style") {
        resetVideoSession({ hideResult: true });
      }

      const card = elements[`${kind}Card`];
      const meta = elements[`${kind}Meta`];
      const name = elements[`${kind}Name`];
      const size = elements[`${kind}Size`];
      card.classList.add("has-image");
      card.classList.toggle("has-video", loaded.type === "video");

      if (kind === "content") {
        if (loaded.type === "video") {
          elements.contentPreview.hidden = true;
          elements.contentPreview.removeAttribute("src");
          elements.contentVideoPreview.hidden = false;
          elements.contentVideoPreview.src = loaded.url;
          size.textContent = `${loaded.width} × ${loaded.height} · ${formatTimecode(loaded.duration, false)} · ${formatBytes(file.size)}`;
        } else {
          elements.contentVideoPreview.pause();
          elements.contentVideoPreview.hidden = true;
          elements.contentVideoPreview.removeAttribute("src");
          elements.contentPreview.hidden = false;
          elements.contentPreview.src = loaded.url;
          size.textContent = `${loaded.width} × ${loaded.height} · ${formatBytes(file.size)}`;
        }
      } else {
        elements[`${kind}Preview`].src = loaded.url;
        size.textContent = `${loaded.width} × ${loaded.height} · ${formatBytes(file.size)}`;
      }

      name.textContent = file.name;
      meta.hidden = false;
      updateActionState();
    } catch (error) {
      showError(error.message || String(error));
    }
  }

  function bindDropZone(kind) {
    const zone = elements[`${kind}DropZone`];
    const input = elements[`${kind}Input`];
    const card = elements[`${kind}Card`];

    zone.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      await setInput(kind, input.files?.[0]);
      input.value = "";
    });

    ["dragenter", "dragover"].forEach((eventName) => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        card.classList.add("drag-over");
        zone.classList.add("active");
      });
    });

    zone.addEventListener("dragleave", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!zone.contains(event.relatedTarget)) {
        card.classList.remove("drag-over");
        zone.classList.remove("active");
      }
    });

    zone.addEventListener("drop", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      card.classList.remove("drag-over");
      zone.classList.remove("active");
      const files = Array.from(event.dataTransfer?.files || []);
      const supportedFile = files.find((file) => {
        const isImage = file.type.startsWith("image/");
        const isVideo = kind === "content"
          && (file.type.startsWith("video/") || isVideoFileName(file));
        return isImage || isVideo;
      });
      if (!supportedFile) {
        showError(kind === "content"
          ? "拖入的内容中没有可识别的图片或视频。"
          : "拖入的内容中没有可识别的图片。");
        return;
      }
      await setInput(kind, supportedFile);
    });
  }

  async function waitForOpenCV(timeoutMs = 15000) {
    if (window.cv && window.cv.Mat) {
      state.cvReady = true;
      return true;
    }

    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      if (window.cv && window.cv.Mat) {
        state.cvReady = true;
        return true;
      }
      await sleep(100);
    }
    return false;
  }

  function loadClassicScript(source, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        script.remove();
        reject(new Error(`脚本加载超时：${source}`));
      }, timeoutMs);

      script.src = source;
      script.async = true;
      script.onload = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve();
      };
      script.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        script.remove();
        reject(new Error(`脚本加载失败：${source}`));
      };
      document.head.appendChild(script);
    });
  }

  function configureOrt(source) {
    window.ort.env.logLevel = "fatal";
    window.ort.env.wasm.simd = true;
    window.ort.env.wasm.numThreads = window.crossOriginIsolated
      ? Math.max(1, Math.min(8, navigator.hardwareConcurrency || 1))
      : 1;

    if (source === "cdn") {
      window.ort.env.wasm.wasmPaths = `${CDN_ORT_BASE}/`;
    } else {
      window.ort.env.wasm.wasmPaths = new URL("./js/", document.baseURI).href;
    }
  }

  async function ensureOrtRuntime() {
    if (window.ort?.InferenceSession) return state.runtimeSource || "cdn";

    for (const source of LOCAL_ORT_CANDIDATES) {
      try {
        await loadClassicScript(source);
        if (window.ort?.InferenceSession) {
          state.runtimeSource = "local";
          configureOrt("local");
          return "local";
        }
      } catch (error) {
        console.debug(error.message);
      }
    }

    setStatus("loading", "本地 ONNX Runtime 未找到，正在加载 CDN 版本...");
    await loadClassicScript(`${CDN_ORT_BASE}/ort.min.js`, 45000);
    if (!window.ort?.InferenceSession) {
      throw new Error("ONNX Runtime 已加载，但未暴露 ort.InferenceSession。请检查 onnxruntime.min.js 版本。");
    }
    state.runtimeSource = "cdn";
    configureOrt("cdn");
    return "cdn";
  }

  function providerLabelFromSession(session, fallback = "") {
    const providers = (session.getProviders?.() || []).map((name) => String(name).toLowerCase());
    if (providers.some((name) => name.includes("webgpu"))) return "WebGPU";
    if (providers.some((name) => name.includes("webgl"))) return "WebGL";
    if (providers.some((name) => name.includes("wasm"))) {
      return window.crossOriginIsolated ? "WASM Threads + SIMD" : "WASM SIMD";
    }
    return fallback || providers.join(" + ") || "WASM";
  }

  async function validateSession(session) {
    const size = 64;
    const input = new Float32Array(size * size * 3);
    const content = new window.ort.Tensor("float32", input, [1, 3, size, size]);
    const style = new window.ort.Tensor("float32", input.slice(), [1, 3, size, size]);
    let output = null;
    try {
      const outputs = await session.run({ content, style });
      output = outputs.result || outputs[session.outputNames[0]];
      if (!output) throw new Error("provider warmup did not return result");
    } finally {
      content.dispose?.();
      style.dispose?.();
      output?.dispose?.();
    }
  }

  async function createSessionWithProvider(candidate) {
    const options = {
      executionProviders: candidate.executionProviders,
      executionMode: "sequential",
      graphOptimizationLevel: "all",
    };

    try {
      return await window.ort.InferenceSession.create(MODEL_URL, options);
    } catch (error) {
      const errorText = String(error?.message || error);
      if (candidate.isWasm && state.runtimeSource === "local" && /wasm|WebAssembly|fetch|404/i.test(errorText)) {
        console.warn("Local WASM assets failed; retrying with matching CDN WASM files.", error);
        window.ort.env.wasm.wasmPaths = `${CDN_ORT_BASE}/`;
        return window.ort.InferenceSession.create(MODEL_URL, options);
      }
      throw error;
    }
  }

  async function createSession() {
    const candidates = [];
    if (navigator.gpu) {
      candidates.push({ id: "webgpu", label: "WebGPU", executionProviders: ["webgpu", "wasm"] });
    } else {
      console.info("WebGPU is not available in this browser.");
    }
    if (webglRenderer) {
      candidates.push({ id: "webgl", label: "WebGL", executionProviders: ["webgl", "wasm"] });
    } else {
      console.info("WebGL is not available in this browser.");
    }
    candidates.push({ id: "wasm", label: window.crossOriginIsolated ? "WASM Threads + SIMD" : "WASM SIMD", executionProviders: ["wasm"], isWasm: true });

    const failures = [];
    for (const candidate of candidates) {
      setStatus("loading", `正在尝试 ${candidate.label} 推理后端...`);
      let session = null;
      try {
        session = await createSessionWithProvider(candidate);
        const actualProviders = (session.getProviders?.() || []).map((name) => String(name).toLowerCase());
        if (
          candidate.id !== "wasm"
          && actualProviders.length > 0
          && !actualProviders.some((name) => name.includes(candidate.id))
        ) {
          session.release?.();
          throw new Error(`${candidate.label} 未成为实际执行后端，实际为 ${actualProviders.join(", ")}`);
        }
        await validateSession(session);
        state.providerLabel = providerLabelFromSession(session, candidate.label);
        console.info(`ONNX Runtime provider selected: ${state.providerLabel}`, actualProviders);
        return session;
      } catch (error) {
        session?.release?.();
        const message = `${candidate.label}: ${error?.message || String(error)}`;
        failures.push(message);
        console.warn(`ONNX Runtime provider unavailable: ${message}`);
      }
    }

    throw new Error(`没有可用的 ONNX Runtime 推理后端。${failures.join(" | ")}`);
  }

  async function initializeModel() {
    if (state.session || state.modelLoading) return;
    state.modelLoading = true;
    updateActionState();
    clearError();

    try {
      if (location.protocol === "file:") {
        throw new Error("浏览器禁止以 file:// 方式读取 ONNX 模型。请通过本地 HTTP 服务器打开此页面。");
      }

      await ensureOrtRuntime();
      setRuntimeBadge("working", `ONNX Runtime ${ORT_VERSION} 已加载`);
      setStatus("loading", "正在下载并解析 model.onnx（约 118 MB）...");
      state.session = await createSession();
      setStatus("ready", `模型已就绪，推理后端：${state.providerLabel}，预览渲染：${webglRenderer ? "WebGL" : "Canvas 2D"}。Content 可选用图片或视频。`);
      setRuntimeBadge("ready", `模型已就绪 · ${state.providerLabel}`);
    } catch (error) {
      state.session = null;
      const message = error?.message || String(error);
      setStatus("error", "模型加载失败。");
      setRuntimeBadge("error", "运行环境不可用");
      showError(`模型加载失败：${message}`);
      console.error(error);
    } finally {
      state.modelLoading = false;
      updateActionState();
    }
  }

  function targetDimensions(width, height, maxEdge) {
    if (!maxEdge || maxEdge <= 0 || Math.max(width, height) <= maxEdge) {
      return { width, height };
    }
    const scale = maxEdge / Math.max(width, height);
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }

  function resizeRgbWithOpenCV(imageData, targetWidth, targetHeight) {
    let source = null;
    let rgb = null;
    let resized = null;
    try {
      source = window.cv.matFromImageData(imageData);
      rgb = new window.cv.Mat();
      window.cv.cvtColor(source, rgb, window.cv.COLOR_RGBA2RGB);

      if (targetWidth === imageData.width && targetHeight === imageData.height) {
        return new Uint8Array(rgb.data);
      }

      resized = new window.cv.Mat();
      const upscaling = targetWidth > imageData.width || targetHeight > imageData.height;
      const interpolation = upscaling ? window.cv.INTER_CUBIC : window.cv.INTER_AREA;
      window.cv.resize(
        rgb,
        resized,
        new window.cv.Size(targetWidth, targetHeight),
        0,
        0,
        interpolation
      );
      return new Uint8Array(resized.data);
    } finally {
      source?.delete();
      rgb?.delete();
      resized?.delete();
    }
  }

  function resizeRgbWithCanvas(image, targetWidth, targetHeight) {
    const canvas = createCanvas(targetWidth, targetHeight);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
    const rgb = imageDataToRGB(imageData);
    canvas.width = 1;
    canvas.height = 1;
    return rgb;
  }

  function mediaDimensions(media) {
    return {
      width: Number(media.videoWidth || media.naturalWidth || media.width || 0),
      height: Number(media.videoHeight || media.naturalHeight || media.height || 0),
    };
  }

  function makeTensorFromImage(image, maxEdge) {
    const sourceSize = mediaDimensions(image);
    if (!sourceSize.width || !sourceSize.height) {
      throw new Error("当前媒体帧尚未准备好，无法读取尺寸。");
    }
    const target = targetDimensions(sourceSize.width, sourceSize.height, maxEdge);
    let sourceImageData = null;
    let rgb = null;

    if (state.cvReady && !(image instanceof HTMLVideoElement)) {
      const sourceCanvas = createCanvas(sourceSize.width, sourceSize.height);
      const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
      sourceContext.drawImage(image, 0, 0, sourceSize.width, sourceSize.height);
      sourceImageData = sourceContext.getImageData(0, 0, sourceSize.width, sourceSize.height);
      rgb = resizeRgbWithOpenCV(sourceImageData, target.width, target.height);
      sourceCanvas.width = 1;
      sourceCanvas.height = 1;
    } else {
      rgb = resizeRgbWithCanvas(image, target.width, target.height);
    }

    const floatData = new Float32Array(target.width * target.height * 3);
    hwc2chw(rgb, floatData, 3, target.width, target.height, 1 / 255);
    const tensor = new window.ort.Tensor(
      "float32",
      floatData,
      [1, 3, target.height, target.width]
    );

    return { tensor, width: target.width, height: target.height };
  }

  function clearStyleTensorCache() {
    state.styleCache?.tensor?.dispose?.();
    state.styleCache = null;
  }

  function getStylePrepared(maxEdge) {
    const styleInput = state.inputs.style;
    if (!styleInput) throw new Error("Style 图片尚未加载。");
    if (state.styleCache?.input === styleInput && state.styleCache?.maxEdge === maxEdge) {
      return state.styleCache.prepared;
    }
    clearStyleTensorCache();
    const prepared = makeTensorFromImage(styleInput.element, maxEdge);
    state.styleCache = { input: styleInput, maxEdge, prepared };
    return prepared;
  }

  function tensorToImageData(tensor) {
    const dimensions = tensor.dims;
    const height = Number(dimensions[2]);
    const width = Number(dimensions[3]);
    const expectedLength = width * height * 3;
    if (!width || !height || tensor.data.length !== expectedLength) {
      throw new Error(`模型输出尺寸无效：${dimensions.join(" × ")}`);
    }

    const rgb = new Uint8Array(expectedLength);
    chw2hwc(tensor.data, rgb, 3, width, height, 255);

    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      rgba[index * 4] = rgb[index * 3];
      rgba[index * 4 + 1] = rgb[index * 3 + 1];
      rgba[index * 4 + 2] = rgb[index * 3 + 2];
      rgba[index * 4 + 3] = 255;
    }
    return new ImageData(rgba, width, height);
  }

  function resultFromTensor(tensor, contentInput, elapsedMs, processWidth, processHeight) {
    const outputImageData = tensorToImageData(tensor);
    return {
      width: contentInput.width,
      height: contentInput.height,
      processWidth,
      processHeight,
      elapsedMs,
      outputImageData,
      contentElement: contentInput.element || contentInput.image,
    };
  }

  function renderFallbackFrame(result, refreshSource) {
    const contentCanvas = elements.contentCanvas;
    const outputCanvas = elements.outputCanvas;
    const source = result?.contentElement || getVideoElement();
    if (!source) return;

    const width = result?.width || source.videoWidth || source.naturalWidth;
    const height = result?.height || source.videoHeight || source.naturalHeight;
    if (contentCanvas.width !== width || contentCanvas.height !== height) {
      contentCanvas.width = width;
      contentCanvas.height = height;
    }
    if (outputCanvas.width !== width || outputCanvas.height !== height) {
      outputCanvas.width = width;
      outputCanvas.height = height;
    }

    if (refreshSource) {
      const contentContext = contentCanvas.getContext("2d", { willReadFrequently: true });
      contentContext.clearRect(0, 0, width, height);
      contentContext.drawImage(source, 0, 0, width, height);

      const outputContext = outputCanvas.getContext("2d", { willReadFrequently: true });
      outputContext.clearRect(0, 0, width, height);
      if (result?.outputImageData) {
        const processedCanvas = createCanvas(result.outputImageData.width, result.outputImageData.height);
        processedCanvas.getContext("2d").putImageData(result.outputImageData, 0, 0);
        outputContext.imageSmoothingEnabled = true;
        outputContext.imageSmoothingQuality = "high";
        outputContext.drawImage(processedCanvas, 0, 0, width, height);
        result.contentImageData = contentContext.getImageData(0, 0, width, height);
        result.transferredImageData = outputContext.getImageData(0, 0, width, height);
        processedCanvas.width = 1;
        processedCanvas.height = 1;
      }
    }

    applyStrengthFallback();
  }

  function applyStrengthFallback() {
    const result = state.result;
    if (!result?.contentImageData || !result?.transferredImageData) return;
    const { width, height, contentImageData, transferredImageData } = result;
    const outputContext = elements.outputCanvas.getContext("2d", { willReadFrequently: true });
    const strength = Number(elements.strengthRange.value) / 100;

    if (strength >= 0.999999) {
      outputContext.putImageData(transferredImageData, 0, 0);
      return;
    }

    const content = contentImageData.data;
    const transferred = transferredImageData.data;
    const output = new ImageData(width, height);
    const outputData = output.data;
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      const contentR = content[offset] / 255;
      const contentG = content[offset + 1] / 255;
      const contentB = content[offset + 2] / 255;
      outputData[offset] = Math.round(255 * (contentR + (transferred[offset] / 255 - contentR) * strength));
      outputData[offset + 1] = Math.round(255 * (contentG + (transferred[offset + 1] / 255 - contentG) * strength));
      outputData[offset + 2] = Math.round(255 * (contentB + (transferred[offset + 2] / 255 - contentB) * strength));
      outputData[offset + 3] = 255;
    }
    outputContext.putImageData(output, 0, 0);
  }

  function renderCurrentComparison({ refreshSource = false, refreshOutput = false } = {}) {
    const result = state.result;
    const video = getVideoElement();
    const source = result?.contentElement || video;
    const width = result?.width || video?.videoWidth || 0;
    const height = result?.height || video?.videoHeight || 0;
    if (!source || !width || !height) return;

    const strength = Number(elements.strengthRange.value) / 100;
    if (webglRenderer) {
      elements.beforeLayer.hidden = true;
      if (refreshSource || !webglRenderer.hasContent) {
        webglRenderer.updateContent(source, width, height);
      }
      if (refreshOutput && result?.outputImageData) {
        webglRenderer.updateOutput(result.outputImageData);
      } else if (!result?.outputImageData) {
        webglRenderer.clearOutput();
      }
      webglRenderer.setSplit(state.splitPercent / 100);
      webglRenderer.setStrength(strength);
      webglRenderer.draw();
      return;
    }

    elements.beforeLayer.hidden = false;
    renderFallbackFrame(result, refreshSource || !result?.contentImageData);
  }

  function clearRenderedOutput() {
    if (webglRenderer) {
      webglRenderer.clearOutput();
      webglRenderer.draw();
    } else {
      const context = elements.outputCanvas.getContext("2d");
      context?.clearRect(0, 0, elements.outputCanvas.width, elements.outputCanvas.height);
    }
  }

  function scheduleStrengthRender() {
    if (strengthFrame) return;
    strengthFrame = requestAnimationFrame(() => {
      strengthFrame = 0;
      applyStrength();
    });
  }

  function applyStrength() {
    if (!state.result) return;
    const strength = Number(elements.strengthRange.value) / 100;
    if (webglRenderer) {
      webglRenderer.setStrength(strength);
      webglRenderer.draw();
    } else {
      applyStrengthFallback();
    }
  }

  function updateComparisonFrameSize() {
    if (!state.result) return;
    const ratio = state.result.width / state.result.height;
    const widthLimitedByViewport = Math.max(280, window.innerHeight * 0.68 * ratio);
    elements.comparisonFrame.style.aspectRatio = `${state.result.width} / ${state.result.height}`;
    elements.comparisonFrame.style.width = `min(100%, ${Math.round(widthLimitedByViewport)}px)`;
  }

  function setSplitPercent(percent) {
    const value = Math.max(0, Math.min(100, percent));
    state.splitPercent = value;
    elements.comparisonFrame.style.setProperty("--split-position", `${value}%`);
    elements.splitRange.value = String(value);
    if (webglRenderer) {
      webglRenderer.setSplit(value / 100);
      webglRenderer.draw();
    }
  }

  function createOutputFrameCanvas(result = state.result, targetWidth, targetHeight) {
    if (!result?.outputImageData) return null;
    const width = Math.max(2, Math.round(targetWidth || result.width));
    const height = Math.max(2, Math.round(targetHeight || result.height));
    const outputCanvas = createCanvas(width, height);
    const outputContext = outputCanvas.getContext("2d", { willReadFrequently: true });
    const processedCanvas = createCanvas(result.outputImageData.width, result.outputImageData.height);
    processedCanvas.getContext("2d").putImageData(result.outputImageData, 0, 0);
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = "high";
    outputContext.drawImage(processedCanvas, 0, 0, width, height);

    const strength = Number(elements.strengthRange.value) / 100;
    if (strength < 0.999999) {
      const contentCanvas = createCanvas(width, height);
      const contentContext = contentCanvas.getContext("2d", { willReadFrequently: true });
      contentContext.drawImage(result.contentElement, 0, 0, width, height);
      const content = contentContext.getImageData(0, 0, width, height);
      const transferred = outputContext.getImageData(0, 0, width, height);
      const blended = new ImageData(width, height);
      for (let index = 0; index < width * height; index += 1) {
        const offset = index * 4;
        blended.data[offset] = Math.round(content.data[offset] + (transferred.data[offset] - content.data[offset]) * strength);
        blended.data[offset + 1] = Math.round(content.data[offset + 1] + (transferred.data[offset + 1] - content.data[offset + 1]) * strength);
        blended.data[offset + 2] = Math.round(content.data[offset + 2] + (transferred.data[offset + 2] - content.data[offset + 2]) * strength);
        blended.data[offset + 3] = 255;
      }
      outputContext.putImageData(blended, 0, 0);
      processedCanvas.width = 1;
      processedCanvas.height = 1;
      contentCanvas.width = 1;
      contentCanvas.height = 1;
    }
    return outputCanvas;
  }

  function triggerDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function cancelVideoExport() {
    if (!state.videoExport.active) return;
    state.videoExport.abort = true;
    try {
      state.videoExport.encoder?.close?.();
    } catch (error) {
      console.debug("Video encoder already closed.", error);
    }
    state.videoExport.encoder = null;
    state.videoExport.active = false;
    elements.exportVideoButton.classList.remove("is-busy");
    elements.exportVideoButtonText.textContent = "导出完整视频";
    updateVideoControls();
  }

  async function findH264EncoderConfig(width, height, fps) {
    if (typeof window.VideoEncoder === "undefined") return null;
    const bitrate = Math.round(Math.max(2_000_000, Math.min(14_000_000, width * height * fps * 0.08)));
    const codecs = [
      "avc1.640028",
      "avc1.4d0028",
      "avc1.42001f",
      "avc1.420028",
      "avc1.420034",
    ];
    for (const codec of codecs) {
      const config = {
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
        hardwareAcceleration: "prefer-hardware",
        latencyMode: "quality",
        avc: { format: "avc" },
      };
      try {
        const support = await window.VideoEncoder.isConfigSupported(config);
        if (support.supported) return config;
      } catch (error) {
        console.debug(`H.264 config unavailable: ${codec}`, error);
      }
    }
    return null;
  }

  async function waitForEncoderQueue(encoder, maximumQueueSize = 4) {
    while (!state.videoExport.abort && encoder.encodeQueueSize > maximumQueueSize) {
      await sleep(10);
    }
  }

  async function exportFullVideo() {
    const video = getVideoElement();
    if (!video || !state.session || !state.inputs.style) return;
    if (state.videoExport.active) {
      cancelVideoExport();
      return;
    }
    if (typeof window.VideoEncoder === "undefined") {
      showError("当前浏览器不支持 WebCodecs VideoEncoder，无法导出完整视频。请使用最新版 Chrome 或 Edge。");
      return;
    }
    if (typeof window.Mp4Muxer === "undefined") {
      showError("MP4 封装库未加载，无法导出完整视频。");
      return;
    }

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0) {
      showError("无法获取视频时长，不能导出完整视频。");
      return;
    }

    const fps = Number(elements.videoFpsSelect.value) || state.video.fps || 30;
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const exportWidth = Math.max(2, sourceWidth - (sourceWidth % 2));
    const exportHeight = Math.max(2, sourceHeight - (sourceHeight % 2));
    const totalFrames = Math.max(1, Math.ceil(duration * fps - 1e-6));
    const originalTime = video.currentTime;
    const config = await findH264EncoderConfig(exportWidth, exportHeight, fps);
    if (!config) {
      showError("当前浏览器没有可用的 H.264 视频编码器，无法导出 MP4。");
      return;
    }

    state.video.playing = false;
    state.video.playbackToken += 1;
    video.pause();
    state.videoExport.active = true;
    state.videoExport.abort = false;
    state.busy = true;
    elements.strengthRange.disabled = true;
    elements.maxEdgeSelect.disabled = true;
    elements.exportVideoButton.classList.add("is-busy");
    elements.exportVideoButtonText.textContent = "取消导出";
    updateActionState();
    updateVideoControls();

    let encoder = null;
    let muxer = null;
    let encoderError = null;

    try {
      const target = new window.Mp4Muxer.ArrayBufferTarget();
      muxer = new window.Mp4Muxer.Muxer({
        target,
        video: {
          codec: "avc",
          width: exportWidth,
          height: exportHeight,
          frameRate: fps,
        },
        fastStart: "in-memory",
      });

      encoder = new window.VideoEncoder({
        output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
        error: (error) => {
          encoderError = error;
        },
      });
      encoder.configure(config);
      state.videoExport.encoder = encoder;

      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
        if (state.videoExport.abort) break;
        if (encoderError) throw encoderError;

        const frameTime = Math.min(duration - 0.0005, frameIndex / fps);
        await seekVideoTo(frameTime);

        const result = await inferFrameCore(video, sourceWidth, sourceHeight);
        if (state.videoExport.abort) break;
        result.mode = "video";
        result.time = frameTime;
        state.result = result;
        renderCurrentComparison({ refreshSource: true, refreshOutput: true });

        const frameCanvas = createOutputFrameCanvas(result, exportWidth, exportHeight);
        const timestamp = Math.round((frameIndex * 1_000_000) / fps);
        const frameDuration = Math.round(1_000_000 / fps);
        const videoFrame = new window.VideoFrame(frameCanvas, {
          timestamp,
          duration: frameDuration,
        });
        encoder.encode(videoFrame, {
          keyFrame: frameIndex % Math.max(1, Math.round(fps * 2)) === 0,
        });
        videoFrame.close();
        await waitForEncoderQueue(encoder);

        const completed = frameIndex + 1;
        const percent = Math.min(100, Math.round((completed / totalFrames) * 100));
        elements.exportVideoButtonText.textContent = `导出中 ${percent}%`;
        setStatus("working", `正在导出完整视频：${completed} / ${totalFrames} 帧`, `${percent}%`);
      }

      if (state.videoExport.abort) {
        setStatus("ready", "视频导出已取消。");
        return;
      }

      setStatus("working", "正在完成 MP4 视频编码...", "100%");
      await encoder.flush();
      if (encoderError) throw encoderError;
      encoder.close();
      muxer.finalize();

      const blob = new Blob([target.buffer], { type: "video/mp4" });
      const contentName = state.inputs.content?.file?.name?.replace(/\.[^.]+$/, "") || "content";
      triggerDownload(blob, `${contentName}_colorfm_output.mp4`);
      setStatus("ready", `完整视频已导出：${totalFrames} 帧，${fps} fps。`);
    } catch (error) {
      if (!state.videoExport.abort) {
        const message = error?.message || String(error);
        setStatus("error", "完整视频导出失败。");
        showError(`完整视频导出失败：${message}`);
        console.error(error);
      }
    } finally {
      try {
        if (encoder && encoder.state !== "closed") encoder.close();
      } catch (error) {
        console.debug("Video encoder cleanup skipped.", error);
      }
      state.videoExport.encoder = null;
      state.videoExport.active = false;
      state.videoExport.abort = false;
      elements.exportVideoButton.classList.remove("is-busy");
      elements.exportVideoButtonText.textContent = "导出完整视频";
      try {
        await seekVideoTo(originalTime);
        await processVideoFrame();
      } catch (error) {
        console.debug("Unable to restore preview frame after export.", error);
      }
      state.busy = false;
      elements.strengthRange.disabled = false;
      elements.maxEdgeSelect.disabled = false;
      updateActionState();
      updateVideoControls();
    }
  }

  function bindComparisonInteraction() {
    elements.splitRange.addEventListener("input", (event) => {
      setSplitPercent(Number(event.target.value));
    });

    elements.comparisonFrame.addEventListener("pointerdown", (event) => {
      state.draggingSplit = true;
      elements.comparisonFrame.setPointerCapture(event.pointerId);
      const rect = elements.comparisonFrame.getBoundingClientRect();
      setSplitPercent(((event.clientX - rect.left) / rect.width) * 100);
      event.preventDefault();
    });

    elements.comparisonFrame.addEventListener("pointermove", (event) => {
      if (!state.draggingSplit) return;
      const rect = elements.comparisonFrame.getBoundingClientRect();
      setSplitPercent(((event.clientX - rect.left) / rect.width) * 100);
    });

    const stopDragging = (event) => {
      state.draggingSplit = false;
      if (elements.comparisonFrame.hasPointerCapture?.(event.pointerId)) {
        elements.comparisonFrame.releasePointerCapture(event.pointerId);
      }
    };
    elements.comparisonFrame.addEventListener("pointerup", stopDragging);
    elements.comparisonFrame.addEventListener("pointercancel", stopDragging);

    window.addEventListener("resize", updateComparisonFrameSize);
  }

  function getVideoElement() {
    return state.inputs.content?.type === "video" ? state.inputs.content.element : null;
  }

  function setVideoResultMode(enabled) {
    elements.videoController.hidden = !enabled;
    elements.resultTitle.textContent = enabled ? "视频帧 Content 与 Output 对比" : "Content 与 Output 对比";
    elements.resultDescription.textContent = enabled
      ? "播放速度由实际推理速度决定；可暂停、逐帧查看或拖动进度条。完整视频导出为无音轨 H.264 MP4。"
      : "拖动中间分割线查看原图与迁移结果；推理完成后仍可调整迁移强度。";
    elements.compareLeftLabel.textContent = enabled ? "Content Frame" : "Content";
    elements.compareRightLabel.textContent = enabled ? "Output Frame" : "Output";
    elements.downloadButton.textContent = enabled ? "保存当前帧 PNG" : "下载 Output PNG";
    elements.exportVideoButton.hidden = !enabled;
    elements.exportVideoButton.disabled = false;
  }

  function resetVideoSession({ hideResult = true } = {}) {
    cancelVideoExport();
    clearStyleTensorCache();
    const video = getVideoElement();
    state.video.generation += 1;
    state.video.playbackToken += 1;
    state.video.playing = false;
    state.video.processing = false;
    state.video.stopped = true;
    state.busy = false;
    if (video) video.pause();

    if (hideResult) {
      state.result = null;
      elements.resultPanel.hidden = true;
      elements.videoController.hidden = true;
    }
    updateVideoControls();
  }

  function updateVideoTimeline() {
    const video = getVideoElement();
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : (state.inputs.content?.duration || 0);
    const maxTime = Math.max(0, duration - 0.001);
    const currentTime = Math.max(0, Math.min(video.currentTime || 0, maxTime));
    elements.videoSeekRange.max = String(maxTime);
    elements.videoSeekRange.step = String(1 / state.video.fps);
    if (!state.video.draggingVideoSeek) elements.videoSeekRange.value = String(currentTime);
    elements.videoCurrentTime.textContent = formatTimecode(currentTime);
    elements.videoDuration.textContent = formatTimecode(duration);
    updateVideoControls();
  }

  function updateVideoControls() {
    const video = getVideoElement();
    const hasVideo = Boolean(video);
    if (!hasVideo) {
      elements.videoController.hidden = true;
      return;
    }

    elements.videoController.hidden = false;
    const exportBusy = state.videoExport.active;
    elements.videoPlayButton.dataset.state = state.video.playing ? "playing" : "paused";
    elements.videoPlayButton.setAttribute("aria-label", state.video.playing ? "暂停" : "播放");
    elements.videoPlayButton.title = state.video.playing ? "暂停" : "播放";
    elements.videoPlayButton.disabled = exportBusy || state.video.processing || !state.session;
    elements.videoStopButton.disabled = exportBusy || state.video.processing || !state.session;
    elements.videoStepBackButton.disabled = exportBusy || state.video.processing || !state.session;
    elements.videoStepForwardButton.disabled = exportBusy || state.video.processing || !state.session;
    elements.videoSeekRange.disabled = exportBusy || state.video.processing || !state.session;
    elements.videoFpsSelect.disabled = exportBusy || state.video.processing;

    if (state.video.processing) {
      elements.videoPlaybackState.dataset.state = "processing";
      elements.videoPlaybackState.textContent = "推理中";
    } else if (state.video.playing) {
      elements.videoPlaybackState.dataset.state = "playing";
      elements.videoPlaybackState.textContent = "播放中";
    } else if (state.video.stopped) {
      elements.videoPlaybackState.dataset.state = "stopped";
      elements.videoPlaybackState.textContent = "已停止";
    } else {
      elements.videoPlaybackState.dataset.state = "paused";
      elements.videoPlaybackState.textContent = "暂停";
    }
  }

  function drawVideoFrameToCanvas() {
    renderCurrentComparison({ refreshSource: true });
  }

  function seekVideoTo(seconds) {
    const video = getVideoElement();
    if (!video) return Promise.resolve();
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const target = Math.max(0, Math.min(seconds, Math.max(0, duration - 0.001)));

    if (Math.abs(video.currentTime - target) < 0.0005 && video.readyState >= 2) {
      drawVideoFrameToCanvas();
      updateVideoTimeline();
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        drawVideoFrameToCanvas();
        updateVideoTimeline();
        resolve();
      };
      const timer = window.setTimeout(finish, 5000);
      video.addEventListener("seeked", finish, { once: true });
      video.currentTime = target;
    });
  }

  async function inferFrameCore(contentElement, contentWidth, contentHeight) {
    const maxEdge = Number(elements.maxEdgeSelect.value) || 0;
    let contentTensor = null;
    let styleTensor = null;
    let outputTensor = null;

    try {
      const contentPrepared = makeTensorFromImage(contentElement, maxEdge);
      const stylePrepared = getStylePrepared(maxEdge);
      contentTensor = contentPrepared.tensor;
      styleTensor = stylePrepared.tensor;

      const startedAt = performance.now();
      const outputs = await state.session.run({
        content: contentTensor,
        style: styleTensor,
      });
      const elapsedMs = performance.now() - startedAt;
      outputTensor = outputs.result || outputs[state.session.outputNames[0]];
      if (!outputTensor) {
        throw new Error(`未找到 result 输出：${state.session.outputNames.join(", ")}`);
      }

      const result = resultFromTensor(
        outputTensor,
        { width: contentWidth, height: contentHeight, image: contentElement },
        elapsedMs,
        contentPrepared.width,
        contentPrepared.height
      );
      result.mode = contentElement instanceof HTMLVideoElement ? "video" : "image";
      return result;
    } finally {
      contentTensor?.dispose?.();
      outputTensor?.dispose?.();
    }
  }

  async function processVideoFrame() {
    const video = getVideoElement();
    if (!video || !state.session || !state.inputs.style || state.video.processing) return false;

    const generation = state.video.generation;
    const sampledTime = video.currentTime;
    state.video.processing = true;
    state.video.stopped = false;
    state.busy = true;
    updateActionState();
    updateVideoControls();
    drawVideoFrameToCanvas();
    setStatus("working", `正在推理视频帧 ${formatTimecode(sampledTime)}...`);

    try {
      const result = await inferFrameCore(video, video.videoWidth, video.videoHeight);
      if (generation !== state.video.generation) return false;
      result.time = sampledTime;
      state.result = result;
      elements.resultPanel.hidden = false;
      setVideoResultMode(true);
      elements.resultDimensions.textContent =
        `${result.width} × ${result.height} px · 推理 ${result.processWidth} × ${result.processHeight} · ${formatTimecode(sampledTime)}`;
      elements.resultElapsed.textContent = `本帧耗时 ${formatDuration(result.elapsedMs)}`;
      updateComparisonFrameSize();
      renderCurrentComparison({ refreshSource: true, refreshOutput: true });
      updateVideoTimeline();
      setStatus("ready", `视频帧 ${formatTimecode(sampledTime)} 推理完成。`);
      return true;
    } catch (error) {
      if (generation === state.video.generation) {
        state.video.playing = false;
        state.video.stopped = true;
        setStatus("error", "视频帧推理失败。");
        showError(`视频帧推理失败：${error?.message || String(error)}`);
        console.error(error);
      }
      return false;
    } finally {
      if (generation === state.video.generation) {
        state.video.processing = false;
        state.busy = false;
        updateActionState();
        updateVideoControls();
      }
    }
  }

  async function startVideoInference() {
    const video = getVideoElement();
    if (!video || !state.session || !state.inputs.style) return;
    state.video.playbackToken += 1;
    state.video.playing = false;
    state.video.stopped = false;
    state.busy = false;
    setVideoResultMode(true);
    elements.resultPanel.hidden = false;
    updateVideoTimeline();
    drawVideoFrameToCanvas();
    updateComparisonFrameSizeFromVideo();
    await processVideoFrame();
    if (state.result?.mode === "video") {
      elements.resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function updateComparisonFrameSizeFromVideo() {
    const video = getVideoElement();
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const ratio = video.videoWidth / video.videoHeight;
    const widthLimitedByViewport = Math.max(280, window.innerHeight * 0.68 * ratio);
    elements.comparisonFrame.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    elements.comparisonFrame.style.width = `min(100%, ${Math.round(widthLimitedByViewport)}px)`;
  }

  async function toggleVideoPlayback() {
    const video = getVideoElement();
    if (!video || !state.session) return;

    if (state.video.playing) {
      state.video.playing = false;
      state.video.playbackToken += 1;
      updateVideoControls();
      return;
    }

    if (!state.result || state.result.mode !== "video") {
      await startVideoInference();
    }
    if (!state.result || !state.session) return;

    state.video.playing = true;
    state.video.stopped = false;
    const token = ++state.video.playbackToken;
    updateVideoControls();

    while (state.video.playing && token === state.video.playbackToken) {
      const success = await processVideoFrame();
      if (!success || state.video.playing === false || token !== state.video.playbackToken) break;

      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const nextTime = video.currentTime + 1 / state.video.fps;
      if (nextTime >= duration - 0.001) {
        state.video.playing = false;
        state.video.stopped = true;
        setStatus("ready", "视频已播放到结尾。");
        break;
      }
      await seekVideoTo(nextTime);
    }

    if (token === state.video.playbackToken) {
      state.video.playing = false;
      updateVideoControls();
    }
  }

  async function stepVideoFrame(direction) {
    const video = getVideoElement();
    if (!video || state.video.processing) return;
    state.video.playing = false;
    state.video.playbackToken += 1;
    const target = video.currentTime + direction / state.video.fps;
    await seekVideoTo(target);
    await processVideoFrame();
  }

  async function stopVideoAndRewind() {
    const video = getVideoElement();
    if (!video || state.video.processing) return;
    state.video.playing = false;
    state.video.playbackToken += 1;
    state.video.stopped = true;
    await seekVideoTo(0);
    await processVideoFrame();
    state.video.stopped = true;
    updateVideoControls();
  }

  function seekVideoPreview(seconds) {
    const video = getVideoElement();
    if (!video || state.video.processing) return;
    state.video.playing = false;
    state.video.stopped = false;
    state.video.playbackToken += 1;
    const seekId = ++state.video.pendingSeekId;
    clearRenderedOutput();
    setStatus("ready", `已定位到 ${formatTimecode(seconds)}，松开进度条后开始推理。`);
    updateVideoControls();
    seekVideoTo(seconds).then(() => {
      if (seekId === state.video.pendingSeekId) updateVideoTimeline();
    });
  }

  async function commitVideoSeek(seconds) {
    if (state.video.processing) return;
    await seekVideoTo(seconds);
    await processVideoFrame();
  }

  async function runInference() {
    if (isVideoInput()) {
      await startVideoInference();
      return;
    }
    if (state.busy || !state.session || !state.inputs.content || !state.inputs.style) return;

    state.busy = true;
    clearError();
    updateActionState();
    setStatus("working", "正在预处理图片并执行 ONNX 推理...");

    let contentTensor = null;
    let styleTensor = null;
    let outputTensor = null;

    try {
      const maxEdge = Number(elements.maxEdgeSelect.value) || 0;
      const contentInput = state.inputs.content;
      const styleInput = state.inputs.style;

      const contentPrepared = makeTensorFromImage(contentInput.image, maxEdge);
      const stylePrepared = getStylePrepared(maxEdge);
      contentTensor = contentPrepared.tensor;
      styleTensor = stylePrepared.tensor;

      setStatus(
        "working",
        `正在推理：Content ${contentPrepared.width} × ${contentPrepared.height}，Style ${stylePrepared.width} × ${stylePrepared.height}`,
        "请稍候"
      );

      const startedAt = performance.now();
      const outputs = await state.session.run({
        content: contentTensor,
        style: styleTensor,
      });
      const elapsedMs = performance.now() - startedAt;
      outputTensor = outputs.result || outputs[state.session.outputNames[0]];

      if (!outputTensor) {
        throw new Error(`未找到 result 输出：${state.session.outputNames.join(", ")}`);
      }

      state.result = resultFromTensor(
        outputTensor,
        contentInput,
        elapsedMs,
        contentPrepared.width,
        contentPrepared.height
      );
      state.result.mode = "image";
      setVideoResultMode(false);
      elements.resultDimensions.textContent =
        `${state.result.width} × ${state.result.height} px · 推理 ${state.result.processWidth} × ${state.result.processHeight}`;
      elements.resultElapsed.textContent = `耗时 ${formatDuration(elapsedMs)}`;
      elements.resultPanel.hidden = false;
      setSplitPercent(50);
      updateComparisonFrameSize();
      renderCurrentComparison({ refreshSource: true, refreshOutput: true });
      setStatus("ready", "推理完成。可拖动下方分割线或调整迁移强度查看结果。");
      elements.resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      const message = error?.message || String(error);
      setStatus("error", "推理失败。");
      showError(`推理失败：${message}`);
      console.error(error);
    } finally {
      contentTensor?.dispose?.();
      outputTensor?.dispose?.();
      state.busy = false;
      updateActionState();
    }
  }

  function downloadResult() {
    const frameCanvas = createOutputFrameCanvas();
    if (!frameCanvas) return;
    frameCanvas.toBlob((blob) => {
      if (!blob) {
        showError("无法生成下载文件。");
        return;
      }
      const contentName = state.inputs.content?.file?.name?.replace(/\.[^.]+$/, "") || "content";
      const frameSuffix = state.result?.mode === "video"
        ? `_${formatTimecode(state.result.time, false).replace(/[:.]/g, "-")}`
        : "";
      triggerDownload(blob, `${contentName}_colorfm_output${frameSuffix}.png`);
    }, "image/png");
  }

  function bindControls() {
    bindDropZone("content");
    bindDropZone("style");

    elements.strengthRange.addEventListener("input", () => {
      elements.strengthValue.textContent = `${elements.strengthRange.value}%`;
      scheduleStrengthRender();
    });

    elements.runButton.addEventListener("click", runInference);
    elements.downloadButton.addEventListener("click", downloadResult);
    elements.exportVideoButton.addEventListener("click", exportFullVideo);
    elements.videoPlayButton.addEventListener("click", toggleVideoPlayback);
    elements.videoStopButton.addEventListener("click", stopVideoAndRewind);
    elements.videoStepBackButton.addEventListener("click", () => stepVideoFrame(-1));
    elements.videoStepForwardButton.addEventListener("click", () => stepVideoFrame(1));

    elements.videoFpsSelect.addEventListener("change", () => {
      state.video.fps = Number(elements.videoFpsSelect.value) || 30;
      elements.videoSeekRange.step = String(1 / state.video.fps);
      updateVideoTimeline();
    });

    elements.videoSeekRange.addEventListener("pointerdown", () => {
      state.video.draggingVideoSeek = true;
    });
    elements.videoSeekRange.addEventListener("input", (event) => {
      seekVideoPreview(Number(event.target.value));
    });
    elements.videoSeekRange.addEventListener("change", async (event) => {
      state.video.draggingVideoSeek = false;
      await commitVideoSeek(Number(event.target.value));
    });

    elements.maxEdgeSelect.addEventListener("change", () => {
      if (isVideoInput() && state.result?.mode === "video") {
        resetVideoSession({ hideResult: true });
        setStatus("ready", "推理尺寸已更改，请重新开始视频推理。");
      }
    });

    window.addEventListener("dragover", (event) => event.preventDefault());
    window.addEventListener("drop", (event) => event.preventDefault());
    bindComparisonInteraction();
  }

  async function loadDefaultInput(kind, url, fileName) {
    try {
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: blob.type || "image/jpeg" });
      await setInput(kind, file);
    } catch (error) {
      console.warn(`默认 ${kind} 资源加载失败：${url}`, error);
    }
  }

  async function loadDefaultInputs() {
    await Promise.all([
      loadDefaultInput("content", "./content.jpg", "content.jpg"),
      loadDefaultInput("style", "./style.jpg", "style.jpg"),
    ]);
  }

  async function initialize() {
    bindControls();
    updateActionState();
    setRuntimeBadge("working", "正在初始化运行环境");

    const openCvPromise = waitForOpenCV().then((ready) => {
      if (!ready) {
        console.warn("OpenCV.js 未能及时初始化，将使用 Canvas 兼容模式。");
      }
      return ready;
    });

    await Promise.allSettled([openCvPromise, initializeModel(), loadDefaultInputs()]);
  }

  initialize();
})();
