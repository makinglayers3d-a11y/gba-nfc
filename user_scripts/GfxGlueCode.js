"use strict";
/*
 Copyright (C) 2010-2016 Grant Galitz

 Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
function GfxGlueCode(width, height) {
    this.graphicsFound = false;
    this.gfxCallback = null;
    this.doSmoothing = true;
    this.offscreenWidth = width;
    this.offscreenHeight = height;
    this.offscreenRGBCount = this.offscreenWidth * this.offscreenHeight * 3;
    this.offscreenRGBACount = this.offscreenWidth * this.offscreenHeight * 4;
    this.initializeVSync();
    this.initializeBuffers();
}
GfxGlueCode.prototype.initializeVSync = function () {
    window.requestAnimationFrame = window.requestAnimationFrame || window.mozRequestAnimationFrame ||
    window.webkitRequestAnimationFrame || window.msRequestAnimationFrame;
    var parentObj = this;
    if (!window.requestAnimationFrame) {
        setInterval(function () { parentObj.vsync(); }, 16);
    }
    else {
        window.requestAnimationFrame(function () { parentObj.vsync(); parentObj.rAFKeepAlive(); })
    }
}
GfxGlueCode.prototype.rAFKeepAlive = function () {
    var parentObj = this;
    window.requestAnimationFrame(function () { parentObj.vsync(); parentObj.rAFKeepAlive(); });
}
GfxGlueCode.prototype.attachCanvas = function (canvas) { this.canvas = canvas; this.graphicsFound = this.initializeCanvasTarget(); }
GfxGlueCode.prototype.detachCanvas = function () { this.canvas = null; }
GfxGlueCode.prototype.attachGfxCallback = function (gfxCallback) { if (typeof gfxCallback == "function") this.gfxCallback = gfxCallback; }
GfxGlueCode.prototype.attachGfxPostCallback = function (gfxPostCallback) { if (typeof gfxPostCallback == "function") this.gfxPostCallback = gfxPostCallback; }
GfxGlueCode.prototype.vsync = function () { if (this.graphicsFound) { if (typeof this.gfxCallback == "function") this.gfxCallback(); this.requestDraw(); } }
GfxGlueCode.prototype.initializeBuffers = function () { this.swizzledFrameFree = [getUint8Array(this.offscreenRGBCount), getUint8Array(this.offscreenRGBCount)]; this.swizzledFrameReady = []; }
GfxGlueCode.prototype.recomputeDimension = function () {
    this.canvasLastWidth = this.canvas.clientWidth; this.canvasLastHeight = this.canvas.clientHeight;
    if ((navigator.userAgent.toLowerCase().indexOf("gecko") != -1 && navigator.userAgent.toLowerCase().indexOf("like gecko") == -1)) { this.onscreenWidth = this.canvas.width = this.offscreenWidth; this.onscreenHeight = this.canvas.height = this.offscreenHeight; }
    else { this.onscreenWidth = this.canvas.width = this.canvas.clientWidth; this.onscreenHeight = this.canvas.height = this.canvas.clientHeight; }
}
GfxGlueCode.prototype.initializeCanvasTarget = function () { try { this.recomputeDimension(); this.canvasOffscreen = document.createElement("canvas"); this.canvasOffscreen.width = this.offscreenWidth; this.canvasOffscreen.height = this.offscreenHeight; this.drawContextOffscreen = this.canvasOffscreen.getContext("2d"); this.drawContextOnscreen = this.canvas.getContext("2d"); this.initializeCanvasBuffer(); return true; } catch (error) { return false; } }
GfxGlueCode.prototype.initializeCanvasBuffer = function () { this.canvasBuffer = this.getBuffer(this.drawContextOffscreen, this.offscreenWidth, this.offscreenHeight); this.initializeAlpha(this.canvasBuffer.data); }
GfxGlueCode.prototype.initializeAlpha = function (canvasData) { var length = canvasData.length; for (var indexGFXIterate = 3; indexGFXIterate < length; indexGFXIterate += 4) canvasData[indexGFXIterate] = 0xFF; }
GfxGlueCode.prototype.getBuffer = function (canvasContext, width, height) { var buffer = null; try { buffer = this.drawContextOffscreen.createImageData(width, height); } catch (error) { buffer = this.drawContextOffscreen.getImageData(0, 0, width, height); } return buffer; }
if (__VIEWS_SUPPORTED__) { GfxGlueCode.prototype.copyBuffer = function (buffer) { if (this.graphicsFound) { if (this.swizzledFrameFree.length == 0) this.swizzledFrameFree.push(this.swizzledFrameReady.shift()); var swizzledFrame = this.swizzledFrameFree.shift(); swizzledFrame.set(buffer); this.swizzledFrameReady.push(swizzledFrame); } } }
else { GfxGlueCode.prototype.copyBuffer = function (buffer) { if (this.graphicsFound) { if (this.swizzledFrameFree.length == 0) this.swizzledFrameFree.push(this.swizzledFrameReady.shift()); var swizzledFrame = this.swizzledFrameFree.shift(); for (var bufferIndex = 0; bufferIndex < this.offscreenRGBCount; bufferIndex++) swizzledFrame[bufferIndex] = buffer[bufferIndex]; this.swizzledFrameReady.push(swizzledFrame); } } }
GfxGlueCode.prototype.requestDraw = function () { if (this.swizzledFrameReady.length > 0) { var canvasData = this.canvasBuffer.data; var swizzledFrame = this.swizzledFrameReady.shift(); for (var canvasIndex = 0, bufferIndex = 0; canvasIndex < this.offscreenRGBACount; ++canvasIndex) { canvasData[canvasIndex++] = swizzledFrame[bufferIndex++]; canvasData[canvasIndex++] = swizzledFrame[bufferIndex++]; canvasData[canvasIndex++] = swizzledFrame[bufferIndex++]; } this.swizzledFrameFree.push(swizzledFrame); this.graphicsBlit(); if (typeof this.gfxPostCallback == "function") this.gfxPostCallback(); } }
GfxGlueCode.prototype.graphicsBlit = function () { if (this.canvasLastWidth != this.canvas.clientWidth || this.canvasLastHeight != this.canvas.clientHeight) { this.recomputeDimension(); this.processSmoothing(); } if (this.offscreenWidth == this.onscreenWidth && this.offscreenHeight == this.onscreenHeight) this.drawContextOnscreen.putImageData(this.canvasBuffer, 0, 0); else { this.drawContextOffscreen.putImageData(this.canvasBuffer, 0, 0); this.drawContextOnscreen.drawImage(this.canvasOffscreen, 0, 0, this.onscreenWidth, this.onscreenHeight); } }
GfxGlueCode.prototype.setSmoothScaling = function (doSmoothing) { this.doSmoothing = !!doSmoothing; this.processSmoothing(); }
GfxGlueCode.prototype.processSmoothing = function () { if (this.graphicsFound) { this.canvas.className = (this.doSmoothing) ? "textureSmooth" : "texturePixelated"; this.drawContextOnscreen.mozImageSmoothingEnabled = this.doSmoothing; this.drawContextOnscreen.webkitImageSmoothingEnabled = this.doSmoothing; this.drawContextOnscreen.imageSmoothingEnabled = this.doSmoothing; } }
