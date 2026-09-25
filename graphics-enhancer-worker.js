"use strict";

self.window = self;

try {
  importScripts("vendor/xBRjs.min.umd.js?v=1");
} catch (error) {
  self.postMessage({ type: "error", message: "No se pudo cargar xBRjs: " + error.message });
}

self.onmessage = (event) => {
  const data = event.data || {};
  if (data.type !== "scale" || !data.buffer || !self.xBRjs?.xbr2x) return;

  try {
    const input = new Uint32Array(data.buffer);
    const output = self.xBRjs.xbr2x(
      input,
      data.width,
      data.height,
      {
        blendColors: false,
        scaleAlpha: false
      }
    );

    self.postMessage(
      {
        type: "frame",
        id: data.id,
        width: data.width * 2,
        height: data.height * 2,
        buffer: output.buffer
      },
      [output.buffer]
    );
  } catch (error) {
    self.postMessage({ type: "error", message: error.message || String(error) });
  }
};
