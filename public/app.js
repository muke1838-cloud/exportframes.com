(() => {
  "use strict";

  const MAX_FILE_BYTES = 200 * 1024 * 1024;
  const MAX_STILLS = 300;
  const THUMB_W = 240;
  const SEEK_TIMEOUT_MS = 8000;

  const $ = (id) => document.getElementById(id);
  const drop = $("drop");
  const fileInput = $("file");
  const dropEmpty = $("drop-empty");
  const dropFile = $("drop-file");
  const fileNameEl = $("file-name");
  const fileSubEl = $("file-sub");
  const statusEl = $("status");
  const workspace = $("workspace");
  const player = $("player");
  const metaEl = $("meta");
  const intervalPanel = $("interval-panel");
  const timelinePanel = $("timeline-panel");
  const estimateEl = $("estimate");
  const scrub = $("scrub");
  const scrubTime = $("scrub-time");
  const jpgQuality = $("jpg-quality");
  const quality = $("quality");
  const qualityVal = $("quality-val");
  const extractBtn = $("extract");
  const cancelBtn = $("cancel");
  const captureBtn = $("capture");
  const replaceBtn = $("replace");
  const progressWrap = $("progress-wrap");
  const progress = $("progress");
  const progressText = $("progress-text");
  const results = $("results");
  const grid = $("grid");
  const selectAll = $("select-all");
  const selCount = $("sel-count");
  const zipBtn = $("zip");
  const clearFramesBtn = $("clear-frames");

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  const thumbCanvas = document.createElement("canvas");
  const thumbCtx = thumbCanvas.getContext("2d");

  const state = {
    file: null,
    url: "",
    meta: null,
    frames: [],
    extracting: false,
    cancelled: false,
    frameSeq: 0,
  };

  function setStatus(text, kind) {
    statusEl.textContent = text || "";
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function fmtTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "—";
    const ms = Math.round(seconds * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const milli = ms % 1000;
    const core = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") + "." + String(milli).padStart(3, "0");
    return h > 0 ? String(h) + ":" + core : core;
  }

  function fmtBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function fourcc(dv, offset) {
    return String.fromCharCode(dv.getUint8(offset), dv.getUint8(offset + 1), dv.getUint8(offset + 2), dv.getUint8(offset + 3));
  }

  function yieldUi() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    });
  }

  function mode() {
    const el = document.querySelector('input[name="mode"]:checked');
    return el ? el.value : "interval";
  }

  function intervalSec() {
    const el = document.querySelector('input[name="interval"]:checked');
    return el ? Number(el.value) : 1;
  }

  function mime() {
    const el = document.querySelector('input[name="format"]:checked');
    return el ? el.value : "image/png";
  }

  function jpgQ() {
    return Number(quality.value);
  }

  function extFor(m) {
    return m === "image/jpeg" ? "jpg" : "png";
  }

  function stepDelta() {
    const fps = state.meta && state.meta.fps;
    return fps && fps > 0 ? 1 / fps : 1 / 30;
  }

  async function readSlice(file, start, size) {
    const end = Math.min(file.size, start + size);
    if (end <= start) return new DataView(new ArrayBuffer(0));
    const buf = await file.slice(start, end).arrayBuffer();
    return new DataView(buf);
  }

  async function parseMp4Meta(file) {
    let offset = 0;
    let moov = null;
    while (offset + 8 <= file.size) {
      const head = await readSlice(file, offset, 16);
      if (head.byteLength < 8) break;
      let size = head.getUint32(0);
      const type = fourcc(head, 4);
      let header = 8;
      if (size === 1) {
        if (head.byteLength < 16) break;
        const hi = head.getUint32(8);
        const lo = head.getUint32(12);
        size = hi * 0x100000000 + lo;
        header = 16;
      } else if (size === 0) {
        size = file.size - offset;
      }
      if (size < header) break;
      if (type === "moov") {
        if (size > 32 * 1024 * 1024) {
          return { source: "mp4", note: "moov box larger than 32 MB; skipped" };
        }
        const body = await file.slice(offset, offset + size).arrayBuffer();
        moov = new DataView(body);
        break;
      }
      offset += size;
    }
    if (!moov) return null;

    function walk(dv, start, end, onBox) {
      let i = start;
      while (i + 8 <= end) {
        let size = dv.getUint32(i);
        const type = fourcc(dv, i + 4);
        let header = 8;
        if (size === 1) {
          if (i + 16 > end) break;
          const hi = dv.getUint32(i + 8);
          const lo = dv.getUint32(i + 12);
          size = hi * 0x100000000 + lo;
          header = 16;
        } else if (size === 0) {
          size = end - i;
        }
        if (size < header || i + size > end) break;
        onBox(type, i + header, i + size, header);
        i += size;
      }
    }

    let video = null;
    walk(moov, 8, moov.byteLength, (type, s, e) => {
      if (type !== "trak") return;
      let handler = "";
      let timescale = 0;
      let duration = 0;
      let sampleCount = 0;
      let sampleDelta = 0;
      let uniform = true;
      walk(moov, s, e, (t2, s2, e2) => {
        if (t2 === "mdia") {
          walk(moov, s2, e2, (t3, s3, e3) => {
            if (t3 === "hdlr" && e3 - s3 >= 12) {
              handler = fourcc(moov, s3 + 8);
            }
            if (t3 === "mdhd" && e3 - s3 >= 16) {
              const ver = moov.getUint8(s3);
              if (ver === 1 && e3 - s3 >= 32) {
                timescale = moov.getUint32(s3 + 20);
                const hi = moov.getUint32(s3 + 24);
                const lo = moov.getUint32(s3 + 28);
                duration = hi * 0x100000000 + lo;
              } else if (ver === 0) {
                timescale = moov.getUint32(s3 + 12);
                duration = moov.getUint32(s3 + 16);
              }
            }
            if (t3 === "minf") {
              walk(moov, s3, e3, (t4, s4, e4) => {
                if (t4 !== "stbl") return;
                walk(moov, s4, e4, (t5, s5, e5) => {
                  if (t5 !== "stts" || e5 - s5 < 8) return;
                  const count = moov.getUint32(s5 + 4);
                  let samples = 0;
                  let firstDelta = null;
                  let allSame = true;
                  for (let k = 0; k < count; k++) {
                    const off = s5 + 8 + k * 8;
                    if (off + 8 > e5) break;
                    const sc = moov.getUint32(off);
                    const sd = moov.getUint32(off + 4);
                    samples += sc;
                    if (firstDelta === null) firstDelta = sd;
                    else if (sd !== firstDelta) allSame = false;
                  }
                  sampleCount = samples;
                  sampleDelta = firstDelta || 0;
                  uniform = allSame && firstDelta > 0;
                });
              });
            }
          });
        }
      });
      if (handler === "vide" && !video) {
        video = { timescale, duration, sampleCount, sampleDelta, uniform };
      }
    });
    if (!video) return { source: "mp4" };
    const fps = video.uniform && video.timescale && video.sampleDelta
      ? video.timescale / video.sampleDelta
      : null;
    return {
      source: "mp4",
      fps: fps && Number.isFinite(fps) ? fps : null,
      frameCount: video.sampleCount || null,
      mediaDuration: video.timescale ? video.duration / video.timescale : null,
    };
  }

  function readVint(u8, i) {
    if (i >= u8.length) return null;
    const first = u8[i];
    let width = 1;
    let mask = 0x80;
    while (width <= 8 && (first & mask) === 0) {
      width += 1;
      mask >>= 1;
    }
    if (width > 8 || i + width > u8.length) return null;
    let value = first & (mask - 1);
    for (let k = 1; k < width; k++) value = value * 256 + u8[i + k];
    return { value, width };
  }

  async function parseEbmlMeta(file) {
    const take = Math.min(file.size, 8 * 1024 * 1024);
    const buf = await file.slice(0, take).arrayBuffer();
    const u8 = new Uint8Array(buf);
    if (u8.length < 4) return null;
    if (!(u8[0] === 0x1a && u8[1] === 0x45 && u8[2] === 0xdf && u8[3] === 0xa3)) return null;

    const info = { source: "ebml", fps: null, frameCount: null, pixelW: null, pixelH: null, durationSec: null };
    let timestampScale = 1000000;
    let durationRaw = null;
    let inVideoTrack = false;
    let trackType = 0;
    let defaultDuration = null;
    let frameRate = null;

    function walk(start, end, depth) {
      let i = start;
      while (i < end) {
        const id = readVint(u8, i);
        if (!id) break;
        const sz = readVint(u8, i + id.width);
        if (!sz) break;
        const hdr = id.width + sz.width;
        const unknown = sz.width === 8 && sz.value === 0x00ffffffffffffff;
        const size = unknown ? end - (i + hdr) : sz.value;
        const s = i + hdr;
        const e = Math.min(end, s + size);
        if (s > end) break;

        if (id.value === 0x2ad7b1 && e - s >= 1) {
          timestampScale = 0;
          for (let k = s; k < e; k++) timestampScale = timestampScale * 256 + u8[k];
        } else if (id.value === 0x4489 && e - s >= 4) {
          const view = new DataView(u8.buffer, u8.byteOffset + s, e - s);
          durationRaw = e - s === 8 ? view.getFloat64(0) : view.getFloat32(0);
        } else if (id.value === 0x83 && e - s >= 1) {
          trackType = u8[s];
        } else if (id.value === 0x23e383 && e - s >= 1) {
          let v = 0;
          for (let k = s; k < e; k++) v = v * 256 + u8[k];
          defaultDuration = v;
        } else if (id.value === 0x23314f && e - s >= 4) {
          const view = new DataView(u8.buffer, u8.byteOffset + s, e - s);
          frameRate = e - s === 8 ? view.getFloat64(0) : view.getFloat32(0);
        } else if (id.value === 0xb0 && e - s >= 1) {
          let v = 0;
          for (let k = s; k < e; k++) v = v * 256 + u8[k];
          if (trackType === 1 || inVideoTrack) info.pixelW = v;
        } else if (id.value === 0xba && e - s >= 1) {
          let v = 0;
          for (let k = s; k < e; k++) v = v * 256 + u8[k];
          if (trackType === 1 || inVideoTrack) info.pixelH = v;
        }

        const nested = id.value === 0x18538067 || id.value === 0x1549a966 || id.value === 0x1654ae6b ||
          id.value === 0xae || id.value === 0xe0 || id.value === 0x1a45dfa3;
        if (id.value === 0x1f43b675) {
          i = e;
          continue;
        }
        if (id.value === 0xe0) inVideoTrack = true;
        if (nested && depth < 8) walk(s, e, depth + 1);
        if (id.value === 0xe0) inVideoTrack = false;
        if (id.value === 0xae) {
          if (trackType === 1) {
            if (frameRate && Number.isFinite(frameRate)) info.fps = frameRate;
            else if (defaultDuration > 0) info.fps = 1e9 / defaultDuration;
          }
          trackType = 0;
          defaultDuration = null;
          frameRate = null;
        }
        i = e;
      }
    }

    walk(0, u8.length, 0);
    if (durationRaw != null && timestampScale > 0) {
      info.durationSec = (durationRaw * timestampScale) / 1e9;
    }
    if (info.fps && info.durationSec) {
      info.frameCount = Math.round(info.fps * info.durationSec);
    }
    return info;
  }

  async function parseAviMeta(file) {
    const head = await readSlice(file, 0, 12);
    if (head.byteLength < 12) return null;
    if (fourcc(head, 0) !== "RIFF" || fourcc(head, 8) !== "AVI ") return null;
    const take = Math.min(file.size, 512 * 1024);
    const buf = await file.slice(0, take).arrayBuffer();
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    const needle = [0x61, 0x76, 0x69, 0x68]; // avih
    for (let i = 0; i + 8 + 40 <= u8.length; i++) {
      if (u8[i] === needle[0] && u8[i + 1] === needle[1] && u8[i + 2] === needle[2] && u8[i + 3] === needle[3]) {
        const size = dv.getUint32(i + 4, true);
        if (size < 40) continue;
        const s = i + 8;
        const usec = dv.getUint32(s, true);
        const total = dv.getUint32(s + 16, true);
        const w = dv.getUint32(s + 32, true);
        const h = dv.getUint32(s + 36, true);
        return {
          source: "avi",
          fps: usec > 0 ? 1000000 / usec : null,
          frameCount: total || null,
          pixelW: w || null,
          pixelH: h || null,
        };
      }
    }
    return { source: "avi" };
  }

  async function parseContainer(file) {
    const name = (file.name || "").toLowerCase();
    const mp4 = await parseMp4Meta(file).catch(() => null);
    if (mp4 && (mp4.fps || mp4.frameCount || mp4.source === "mp4")) return mp4;
    const ebml = await parseEbmlMeta(file).catch(() => null);
    if (ebml) return ebml;
    const avi = await parseAviMeta(file).catch(() => null);
    if (avi) return avi;
    if (/\.(mp4|m4v|mov)$/.test(name)) return { source: "mp4", note: "No moov sample table found" };
    if (/\.(webm|mkv)$/.test(name)) return { source: "ebml", note: "No track metadata in the first 8 MB" };
    if (/\.avi$/.test(name)) return { source: "avi", note: "AVI header not found in the first 512 KB" };
    return { source: "unknown" };
  }

  function waitEvent(el, ok, err, timeout) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for the video element"));
      }, timeout);
      const cleanup = () => {
        clearTimeout(t);
        el.removeEventListener(ok, onOk);
        el.removeEventListener(err, onErr);
      };
      const onOk = () => { cleanup(); resolve(); };
      const onErr = () => {
        cleanup();
        const mediaErr = el.error;
        const map = { 1: "aborted", 2: "network", 3: "decode", 4: "src not supported" };
        const why = mediaErr ? (map[mediaErr.code] || "error " + mediaErr.code) : "error";
        reject(new Error("This browser cannot play this file (" + why + ")."));
      };
      el.addEventListener(ok, onOk);
      el.addEventListener(err, onErr);
    });
  }

  async function loadVideo(file) {
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(file);
    player.pause();
    player.removeAttribute("src");
    player.load();
    player.src = state.url;
    await waitEvent(player, "loadedmetadata", "error", 12000);
    if (!player.videoWidth || !player.duration || !Number.isFinite(player.duration)) {
      throw new Error("This browser opened the file but found no decodable video track.");
    }
    try {
      await waitEvent(player, "loadeddata", "error", 12000);
    } catch (err) {
      throw err;
    }
    if (player.readyState < 2) {
      throw new Error("This browser could not decode a first frame.");
    }
  }

  function renderMeta() {
    const m = state.meta || {};
    const rows = [
      ["Resolution", m.width && m.height ? m.width + " × " + m.height : "Not decoded"],
      ["Duration", fmtTime(m.duration)],
      ["Frame rate", m.fps ? (Number.isInteger(m.fps) ? String(m.fps) : m.fps.toFixed(3)) + " fps (" + m.fpsSource + ")" : "Not in file metadata"],
      ["Frame count", m.frameCount ? String(m.frameCount) + " (" + m.fpsSource + ")" : "Not in file metadata"],
      ["File", fmtBytes(m.size) + (m.type ? " · " + m.type : "")],
    ];
    metaEl.replaceChildren();
    for (const [dt, dd] of rows) {
      const wrap = document.createElement("div");
      const dtEl = document.createElement("dt");
      const ddEl = document.createElement("dd");
      dtEl.textContent = dt;
      ddEl.textContent = dd;
      wrap.append(dtEl, ddEl);
      metaEl.append(wrap);
    }
  }

  function plannedTimes() {
    const duration = state.meta ? state.meta.duration : 0;
    const step = intervalSec();
    if (!duration || !step) return [];
    const last = Math.max(0, duration - 0.001);
    const times = [];
    for (let t = 0; t <= last + 1e-9 && times.length < MAX_STILLS; t += step) {
      times.push(Math.min(t, last));
    }
    return times;
  }

  function updateEstimate() {
    if (!state.meta) {
      estimateEl.textContent = "";
      return;
    }
    const times = plannedTimes();
    const uncapped = (() => {
      const duration = state.meta.duration;
      const step = intervalSec();
      if (!duration || !step) return 0;
      return Math.floor(Math.max(0, duration - 0.001) / step) + 1;
    })();
    if (uncapped > MAX_STILLS) {
      estimateEl.textContent = "Every " + intervalSec() + " s over " + fmtTime(state.meta.duration) +
        " would be about " + uncapped + " stills. This page stops at " + MAX_STILLS + ". Choose a longer interval.";
      extractBtn.disabled = true;
    } else {
      estimateEl.textContent = times.length + " stills · every " + intervalSec() + " s · " + fmtTime(state.meta.duration);
      extractBtn.disabled = state.extracting;
    }
  }

  function syncMode() {
    const timeline = mode() === "timeline";
    intervalPanel.hidden = timeline;
    timelinePanel.hidden = !timeline;
    extractBtn.hidden = timeline;
    if (timeline) updateScrubFromVideo();
  }

  function syncFormat() {
    jpgQuality.hidden = mime() !== "image/jpeg";
    qualityVal.textContent = jpgQ().toFixed(2);
  }

  function updateScrubFromVideo() {
    if (!state.meta) return;
    const t = player.currentTime || 0;
    scrub.max = String(Math.max(0, state.meta.duration));
    if (document.activeElement !== scrub) scrub.value = String(t);
    scrubTime.textContent = fmtTime(t);
  }

  function seekTo(time) {
    const duration = state.meta ? state.meta.duration : 0;
    const fps = (state.meta && state.meta.fps) || 25;
    const pad = Math.min(0.08, 1 / fps);
    const target = Math.min(Math.max(0, time), Math.max(0, duration - pad));
    return new Promise((resolve, reject) => {
      if (!Number.isFinite(target)) {
        reject(new Error("Invalid seek time"));
        return;
      }
      if (Math.abs((player.currentTime || 0) - target) < 0.0008 && !player.seeking) {
        resolve(target);
        return;
      }
      let done = false;
      const finish = (fn) => () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        player.removeEventListener("seeked", onSeeked);
        player.removeEventListener("error", onErr);
        fn();
      };
      const timer = setTimeout(() => {
        if (player.readyState >= 2) finish(() => resolve(target))();
        else finish(() => reject(new Error("Seek timed out at " + fmtTime(target))))();
      }, SEEK_TIMEOUT_MS);
      const onSeeked = finish(() => resolve(target));
      const onErr = finish(() => reject(new Error("Seek failed at " + fmtTime(target))));
      player.addEventListener("seeked", onSeeked);
      player.addEventListener("error", onErr);
      try {
        player.currentTime = target;
      } catch (err) {
        finish(() => reject(err))();
      }
    });
  }

  function nextVideoFrame() {
    return new Promise((resolve) => {
      if (typeof player.requestVideoFrameCallback === "function") {
        const id = player.requestVideoFrameCallback(() => resolve());
        setTimeout(() => {
          if (player.cancelVideoFrameCallback) player.cancelVideoFrameCallback(id);
          resolve();
        }, 120);
      } else {
        requestAnimationFrame(() => resolve());
      }
    });
  }

  function canvasToBlob(c, type, q) {
    return new Promise((resolve, reject) => {
      c.toBlob((blob) => {
        if (!blob) reject(new Error("canvas.toBlob returned empty. The frame may be too large for this browser."));
        else resolve(blob);
      }, type, type === "image/jpeg" ? q : undefined);
    });
  }

  async function grabStill(time) {
    player.pause();
    await seekTo(time);
    await nextVideoFrame();
    const w = player.videoWidth;
    const h = player.videoHeight;
    if (!w || !h) throw new Error("No decoded picture at " + fmtTime(time) + ".");
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(player, 0, 0, w, h);
    const type = mime();
    const blob = await canvasToBlob(canvas, type, jpgQ());
    const scale = Math.min(1, THUMB_W / w);
    thumbCanvas.width = Math.max(1, Math.round(w * scale));
    thumbCanvas.height = Math.max(1, Math.round(h * scale));
    thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const thumbBlob = await canvasToBlob(thumbCanvas, "image/jpeg", 0.7);
    const actual = player.currentTime;
    return { time: actual, blob, thumbBlob, type };
  }

  function stillName(time, type, index) {
    const base = (state.file && state.file.name ? state.file.name.replace(/\.[^.]+$/, "") : "video")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 40) || "video";
    const n = String(index).padStart(4, "0");
    const stamp = fmtTime(time).replace(/:/g, "-");
    return base + "-f" + n + "-" + stamp + "." + extFor(type);
  }

  function addFrame(still) {
    state.frameSeq += 1;
    const item = {
      id: state.frameSeq,
      time: still.time,
      blob: still.blob,
      type: still.type,
      name: stillName(still.time, still.type, state.frameSeq),
      thumbUrl: URL.createObjectURL(still.thumbBlob),
      fileUrl: URL.createObjectURL(still.blob),
      selected: true,
    };
    state.frames.push(item);
    return item;
  }

  function clearFrames() {
    for (const f of state.frames) {
      URL.revokeObjectURL(f.thumbUrl);
      URL.revokeObjectURL(f.fileUrl);
    }
    state.frames = [];
    grid.replaceChildren();
    results.hidden = true;
  }

  function renderFrameCard(item) {
    const fig = document.createElement("figure");
    fig.className = "card";
    fig.dataset.id = String(item.id);
    const wrap = document.createElement("div");
    wrap.className = "thumb-wrap";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = item.selected;
    cb.setAttribute("aria-label", "Select frame at " + fmtTime(item.time));
    cb.addEventListener("change", () => {
      item.selected = cb.checked;
      updateSelectionUi();
    });
    const img = document.createElement("img");
    img.alt = "Frame at " + fmtTime(item.time);
    img.src = item.thumbUrl;
    img.loading = "lazy";
    wrap.append(cb, img);
    const cap = document.createElement("figcaption");
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = fmtTime(item.time);
    const a = document.createElement("a");
    a.href = item.fileUrl;
    a.download = item.name;
    a.textContent = "Download";
    cap.append(t, a);
    fig.append(wrap, cap);
    grid.append(fig);
  }

  function updateSelectionUi() {
    const n = state.frames.length;
    const s = state.frames.filter((f) => f.selected).length;
    selCount.textContent = s + " of " + n + " selected";
    selectAll.checked = n > 0 && s === n;
    selectAll.indeterminate = s > 0 && s < n;
    zipBtn.disabled = s === 0;
    results.hidden = n === 0;
  }

  function showProgress(on, value, max, text) {
    progressWrap.hidden = !on;
    progress.max = max || 1;
    progress.value = value || 0;
    progressText.textContent = text || "";
  }

  async function extractInterval() {
    if (!state.meta || state.extracting) return;
    const times = plannedTimes();
    if (!times.length) {
      setStatus("Nothing to extract at this interval.", "err");
      return;
    }
    if (times.length > MAX_STILLS) {
      setStatus("This interval exceeds the " + MAX_STILLS + " still cap.", "err");
      return;
    }
    state.extracting = true;
    state.cancelled = false;
    extractBtn.disabled = true;
    captureBtn.disabled = true;
    cancelBtn.hidden = false;
    clearFrames();
    setStatus("Extracting " + times.length + " stills…");
    showProgress(true, 0, times.length, "0 / " + times.length);
    let failed = null;
    try {
      for (let i = 0; i < times.length; i++) {
        if (state.cancelled) break;
        const still = await grabStill(times[i]);
        const item = addFrame(still);
        renderFrameCard(item);
        updateSelectionUi();
        showProgress(true, i + 1, times.length, (i + 1) + " / " + times.length);
        await yieldUi();
      }
    } catch (err) {
      failed = err;
    }
    state.extracting = false;
    cancelBtn.hidden = true;
    extractBtn.disabled = false;
    captureBtn.disabled = false;
    updateEstimate();
    updateSelectionUi();
    if (failed) {
      showProgress(false);
      setStatus(failed.message || String(failed), "err");
      return;
    }
    if (state.cancelled) {
      setStatus("Stopped after " + state.frames.length + " stills.", "ok");
    } else {
      showProgress(false);
      setStatus("Extracted " + state.frames.length + " stills. Tick the ones to keep.", "ok");
    }
  }

  async function captureOne() {
    if (!state.meta || state.extracting) return;
    captureBtn.disabled = true;
    try {
      const still = await grabStill(player.currentTime || 0);
      const item = addFrame(still);
      renderFrameCard(item);
      updateSelectionUi();
      setStatus("Captured frame at " + fmtTime(item.time) + ".", "ok");
    } catch (err) {
      setStatus(err.message || String(err), "err");
    }
    captureBtn.disabled = false;
  }

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u32(n, le) {
    const b = new Uint8Array(4);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, n >>> 0, le);
    return b;
  }
  function u16(n, le) {
    const b = new Uint8Array(2);
    const dv = new DataView(b.buffer);
    dv.setUint16(0, n & 0xffff, le);
    return b;
  }

  async function buildZip(items) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const item of items) {
      const nameBytes = new TextEncoder().encode(item.name);
      const data = new Uint8Array(await item.blob.arrayBuffer());
      const crc = crc32(data);
      const payload = data;
      const method = 0;
      const local = [
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        u16(20, true),
        u16(0, true),
        u16(method, true),
        u16(0, true),
        u16(0, true),
        u32(crc, true),
        u32(payload.length, true),
        u32(data.length, true),
        u16(nameBytes.length, true),
        u16(0, true),
        nameBytes,
        payload,
      ];
      const localSize = local.reduce((n, p) => n + p.length, 0);
      locals.push(local);
      const central = [
        new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
        u16(20, true),
        u16(20, true),
        u16(0, true),
        u16(method, true),
        u16(0, true),
        u16(0, true),
        u32(crc, true),
        u32(payload.length, true),
        u32(data.length, true),
        u16(nameBytes.length, true),
        u16(0, true),
        u16(0, true),
        u16(0, true),
        u16(0, true),
        u32(0, true),
        u32(offset, true),
        nameBytes,
      ];
      centrals.push(central);
      offset += localSize;
      await yieldUi();
    }
    const centralSize = centrals.reduce((n, parts) => n + parts.reduce((m, p) => m + p.length, 0), 0);
    const end = [
      new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
      u16(0, true),
      u16(0, true),
      u16(items.length, true),
      u16(items.length, true),
      u32(centralSize, true),
      u32(offset, true),
      u16(0, true),
    ];
    const blobs = [];
    for (const parts of locals) blobs.push(...parts);
    for (const parts of centrals) blobs.push(...parts);
    blobs.push(...end);
    return new Blob(blobs, { type: "application/zip" });
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function downloadZip() {
    const items = state.frames.filter((f) => f.selected);
    if (!items.length) return;
    zipBtn.disabled = true;
    setStatus("Building ZIP of " + items.length + " stills…");
    try {
      const zip = await buildZip(items);
      const base = (state.file && state.file.name ? state.file.name.replace(/\.[^.]+$/, "") : "frames")
        .replace(/[^\w.-]+/g, "_")
        .slice(0, 40) || "frames";
      downloadBlob(zip, base + "-frames.zip");
      setStatus("ZIP download started (" + items.length + " files, " + fmtBytes(zip.size) + ").", "ok");
    } catch (err) {
      setStatus(err.message || String(err), "err");
    }
    zipBtn.disabled = false;
    updateSelectionUi();
  }

  function resetMedia() {
    player.pause();
    player.removeAttribute("src");
    player.load();
    if (state.url) {
      URL.revokeObjectURL(state.url);
      state.url = "";
    }
    state.file = null;
    state.meta = null;
    workspace.hidden = true;
    drop.classList.remove("has-file");
    dropEmpty.hidden = false;
    dropFile.hidden = true;
    fileInput.value = "";
    showProgress(false);
  }

  async function ingestFile(file) {
    if (!file) return;
    if (state.extracting) {
      setStatus("Wait for the current extract to finish, or cancel it.", "err");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setStatus("This page refuses files larger than 200 MB (this file is " + fmtBytes(file.size) + ").", "err");
      return;
    }
    clearFrames();
    resetMedia();
    state.file = file;
    drop.classList.add("has-file");
    dropEmpty.hidden = true;
    dropFile.hidden = false;
    fileNameEl.textContent = file.name || "untitled";
    fileSubEl.textContent = fmtBytes(file.size) + (file.type ? " · " + file.type : " · type not reported");
    setStatus("Reading container metadata…");
    let container = { source: "unknown" };
    try {
      container = await parseContainer(file);
    } catch {
      container = { source: "unknown", note: "Metadata parse failed" };
    }
    try {
      await loadVideo(file);
    } catch (err) {
      const extra = [];
      if (container.fps) extra.push("container frame rate " + container.fps.toFixed(3) + " fps");
      if (container.frameCount) extra.push("container frame count " + container.frameCount);
      if (container.pixelW && container.pixelH) extra.push("header " + container.pixelW + "×" + container.pixelH);
      setStatus(
        (err.message || "Cannot decode this file.") +
        (extra.length ? " File header still parsed: " + extra.join(", ") + "." : "") +
        " This page will not substitute another format.",
        "err"
      );
      workspace.hidden = true;
      return;
    }
    const duration = player.duration;
    const fps = container.fps && Number.isFinite(container.fps) ? container.fps : null;
    const fpsSource = fps
      ? (container.source === "mp4" ? "MP4 sample table" : container.source === "avi" ? "AVI header" : "WebM/MKV track")
      : "";
    state.meta = {
      width: player.videoWidth,
      height: player.videoHeight,
      duration,
      size: file.size,
      type: file.type || "",
      fps,
      fpsSource,
      frameCount: container.frameCount || null,
    };
    workspace.hidden = false;
    scrub.min = "0";
    scrub.max = String(duration);
    scrub.value = "0";
    renderMeta();
    updateEstimate();
    syncMode();
    player.currentTime = 0;
    setStatus("Ready. The file is only in this tab.", "ok");
  }

  function onFiles(files) {
    if (!files || !files.length) return;
    if (files.length > 1) {
      setStatus("This page handles one video at a time. Using the first file.", "");
    }
    ingestFile(files[0]);
  }

  drop.addEventListener("click", (e) => {
    if (e.target === fileInput) return;
    fileInput.click();
  });
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () => onFiles(fileInput.files));
  ["dragenter", "dragover"].forEach((ev) => {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("drag");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("drag");
    });
  });
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    onFiles(e.dataTransfer && e.dataTransfer.files);
  });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => e.preventDefault());

  document.querySelectorAll('input[name="mode"]').forEach((el) => el.addEventListener("change", syncMode));
  document.querySelectorAll('input[name="interval"]').forEach((el) => el.addEventListener("change", updateEstimate));
  document.querySelectorAll('input[name="format"]').forEach((el) => el.addEventListener("change", syncFormat));
  quality.addEventListener("input", syncFormat);

  extractBtn.addEventListener("click", extractInterval);
  cancelBtn.addEventListener("click", () => {
    state.cancelled = true;
    setStatus("Stopping…");
  });
  captureBtn.addEventListener("click", captureOne);
  replaceBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (state.extracting) {
      state.cancelled = true;
    }
    clearFrames();
    resetMedia();
    setStatus("Choose a video.");
    fileInput.click();
  });

  $("step-back").addEventListener("click", async () => {
    if (!state.meta) return;
    try {
      await seekTo((player.currentTime || 0) - stepDelta());
      updateScrubFromVideo();
    } catch (err) {
      setStatus(err.message || String(err), "err");
    }
  });
  $("step-fwd").addEventListener("click", async () => {
    if (!state.meta) return;
    try {
      await seekTo((player.currentTime || 0) + stepDelta());
      updateScrubFromVideo();
    } catch (err) {
      setStatus(err.message || String(err), "err");
    }
  });
  scrub.addEventListener("input", () => {
    if (!state.meta) return;
    player.currentTime = Number(scrub.value);
    scrubTime.textContent = fmtTime(Number(scrub.value));
  });
  player.addEventListener("timeupdate", updateScrubFromVideo);
  player.addEventListener("seeked", updateScrubFromVideo);

  selectAll.addEventListener("change", () => {
    const on = selectAll.checked;
    for (const f of state.frames) f.selected = on;
    grid.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = on; });
    updateSelectionUi();
  });
  zipBtn.addEventListener("click", downloadZip);
  clearFramesBtn.addEventListener("click", () => {
    clearFrames();
    setStatus("Stills cleared. The video is still loaded.");
  });

  syncFormat();
  syncMode();
})();
