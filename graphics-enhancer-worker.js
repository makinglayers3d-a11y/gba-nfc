"use strict";

self.window = self;

try {
  importScripts("vendor/xBRjs.min.umd.js?v=2");
} catch (error) {
  self.postMessage({ type: "error", message: "No se pudo cargar xBRjs: " + error.message });
}

self.onmessage = (event) => {
  const data = event.data || {};
  if (data.type !== "scale" || !data.buffer || !self.xBRjs) return;

  try {
    const factor = data.factor === 4 ? 4 : 2;
    const blendColors = data.blendColors === true;
    const scaler = factor === 4 ? self.xBRjs.xbr4x : self.xBRjs.xbr2x;

    if (typeof scaler !== "function") {
      throw new Error("xBR " + factor + "x no está disponible.");
    }

    const input = new Uint32Array(data.buffer);
    const output = scaler(
      input,
      data.width,
      data.height,
      {
        blendColors,
        scaleAlpha: false
      }
    );

    self.postMessage(
      {
        type: "frame",
        id: data.id,
        factor,
        mode: data.mode,
        width: data.width * factor,
        height: data.height * factor,
        buffer: output.buffer
      },
      [output.buffer]
    );
  } catch (error) {
    self.postMessage({ type: "error", message: error.message || String(error) });
  }
};
