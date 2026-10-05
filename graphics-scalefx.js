
(() => {
  "use strict";

  // ScaleFX by Sp00kyFox, 2016-2017, permissive MIT-style license.
  // Embedded shader sources come from libretro/glsl-shaders.
  // See vendor/scalefx-LICENSE.txt.
  const SHADERS = {"p0":"/*\n\tScaleFX - Pass 0\n\tby Sp00kyFox, 2017-03-01\n\nFilter:\tNearest\nScale:\t1x\n\nScaleFX is an edge interpolation algorithm specialized in pixel art. It was\noriginally intended as an improvement upon Scale3x but became a new filter in\nits own right.\nScaleFX interpolates edges up to level 6 and makes smooth transitions between\ndifferent slopes. The filtered picture will only consist of colours present\nin the original.\n\nPass 0 prepares metric data for the next pass.\n\n\n\nCopyright (c) 2016 Sp00kyFox - ScaleFX@web.de\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\nTHE SOFTWARE.\n\n*/\n\n#if defined(VERTEX)\n\n#if __VERSION__ >= 130\n#define COMPAT_VARYING out\n#define COMPAT_ATTRIBUTE in\n#define COMPAT_TEXTURE texture\n#else\n#define COMPAT_VARYING varying \n#define COMPAT_ATTRIBUTE attribute \n#define COMPAT_TEXTURE texture2D\n#endif\n\n#ifdef GL_ES\n#define COMPAT_PRECISION mediump\n#else\n#define COMPAT_PRECISION\n#endif\n\nCOMPAT_ATTRIBUTE vec4 VertexCoord;\nCOMPAT_ATTRIBUTE vec4 COLOR;\nCOMPAT_ATTRIBUTE vec4 TexCoord;\nCOMPAT_VARYING vec4 COL0;\nCOMPAT_VARYING vec4 TEX0;\nCOMPAT_VARYING vec4 t1;\nCOMPAT_VARYING vec4 t2;\n\nuniform mat4 MVPMatrix;\nuniform COMPAT_PRECISION int FrameDirection;\nuniform COMPAT_PRECISION int FrameCount;\nuniform COMPAT_PRECISION vec2 OutputSize;\nuniform COMPAT_PRECISION vec2 TextureSize;\nuniform COMPAT_PRECISION vec2 InputSize;\n\n// vertex compatibility #defines\n#define vTexCoord TEX0.xy\n#define SourceSize vec4(TextureSize, 1.0 / TextureSize) //either TextureSize or InputSize\n#define outsize vec4(OutputSize, 1.0 / OutputSize)\n\nvoid main()\n{\n    gl_Position = MVPMatrix * VertexCoord;\n    COL0 = COLOR;\n    TEX0.xy = TexCoord.xy;\n\tfloat dx = SourceSize.z, dy = SourceSize.w;\n\n\tt1 = TEX0.xxxy + vec4(-dx, 0., dx, -dy);\t// A, B, C\n\tt2 = TEX0.xxxy + vec4(-dx, 0., dx,   0.);\t// D, E, F\n}\n\n#elif defined(FRAGMENT)\n\n#ifdef GL_ES\n#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n#define COMPAT_PRECISION mediump\n#else\n#define COMPAT_PRECISION\n#endif\n\n#if __VERSION__ >= 130\n#define COMPAT_VARYING in\n#define COMPAT_TEXTURE texture\nout COMPAT_PRECISION vec4 FragColor;\n#else\n#define COMPAT_VARYING varying\n#define FragColor gl_FragColor\n#define COMPAT_TEXTURE texture2D\n#endif\n\nuniform COMPAT_PRECISION int FrameDirection;\nuniform COMPAT_PRECISION int FrameCount;\nuniform COMPAT_PRECISION vec2 OutputSize;\nuniform COMPAT_PRECISION vec2 TextureSize;\nuniform COMPAT_PRECISION vec2 InputSize;\nuniform sampler2D Texture;\nCOMPAT_VARYING vec4 TEX0;\nCOMPAT_VARYING vec4 t1;\nCOMPAT_VARYING vec4 t2;\n\n// fragment compatibility #defines\n#define Source Texture\n#define vTexCoord TEX0.xy\n\n#define SourceSize vec4(TextureSize, 1.0 / TextureSize) //either TextureSize or InputSize\n#define outsize vec4(OutputSize, 1.0 / OutputSize)\n\n// Reference: http://www.compuphase.com/cmetric.htm\nfloat dist(vec3 A, vec3 B)\n{\n\tfloat r = 0.5 * (A.r + B.r);\n\tvec3 d = A - B;\n\tvec3 c = vec3(2. + r, 4., 3. - r);\n\n\treturn sqrt(dot(c*d, d)) / 3.;\n}\n\nvoid main()\n{\n\t/*\tgrid\t\tmetric\n\n\t\tA B C\t\tx y z\n\t\t  E F\t\t  o w\n\t*/\n\n#ifdef GL_ES\n#define TEX(x) COMPAT_TEXTURE(Source, x)\n// read texels\n\tvec3 A = TEX(t1.xw).rgb;\n\tvec3 B = TEX(t1.yw).rgb;\n\tvec3 C = TEX(t1.zw).rgb;\n\tvec3 E = TEX(t2.yw).rgb;\n\tvec3 F = TEX(t2.zw).rgb;\n#else\n#define TEX(x, y) textureOffset(Source, vTexCoord, ivec2(x, y)).rgb\n\t// read texels\n\tvec3 A = TEX(-1,-1);\n\tvec3 B = TEX( 0,-1);\n\tvec3 C = TEX( 1,-1);\n\tvec3 E = TEX( 0, 0);\n\tvec3 F = TEX( 1, 0);\n#endif\n\t// output\n\tFragColor = vec4(dist(E,A), dist(E,B), dist(E,C), dist(E,F));\n} \n#endif\n","p1":"/*\n\tScaleFX - Pass 1\n\tby Sp00kyFox, 2017-03-01\n\nFilter:\tNearest\nScale:\t1x\n\nScaleFX is an edge interpolation algorithm specialized in pixel art. It was\noriginally intended as an improvement upon Scale3x but became a new filter in\nits own right.\nScaleFX interpolates edges up to level 6 and makes smooth transitions between\ndifferent slopes. The filtered picture will only consist of colours present\nin the original.\n\nPass 1 calculates the strength of interpolation candidates.\n\n\n\nCopyright (c) 2016 Sp00kyFox - ScaleFX@web.de\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\nTHE SOFTWARE.\n\n*/\n\n// Parameter lines go here:\n#pragma parameter SFX_CLR \"ScaleFX Threshold\" 0.50 0.01 1.00 0.01\n#pragma parameter SFX_SAA \"ScaleFX Filter AA\" 1.00 0.00 1.00 1.00\n\n#if defined(VERTEX)\n\n#if __VERSION__ >= 130\n#define COMPAT_VARYING out\n#define COMPAT_ATTRIBUTE in\n#define COMPAT_TEXTURE texture\n#else\n#define COMPAT_VARYING varying \n#define COMPAT_ATTRIBUTE attribute \n#define COMPAT_TEXTURE texture2D\n#endif\n\n#ifdef GL_ES\n#define COMPAT_PRECISION mediump\n#else\n#define COMPAT_PRECISION\n#endif\n\nCOMPAT_ATTRIBUTE vec4 VertexCoord;\nCOMPAT_ATTRIBUTE vec4 COLOR;\nCOMPAT_ATTRIBUTE vec4 TexCoord;\nCOMPAT_VARYING vec4 COL0;\nCOMPAT_VARYING vec4 TEX0;\nCOMPAT_VARYING vec4 t1;\nCOMPAT_VARYING vec4 t2;\nCOMPAT_VARYING vec4 t3;\n\nuniform mat4 MVPMatrix;\nuniform COMPAT_PRECISION int FrameDirection;\nuniform COMPAT_PRECISION int FrameCount;\nuniform COMPAT_PRECISION vec2 OutputSize;\nuniform COMPAT_PRECISION vec2 TextureSize;\nuniform COMPAT_PRECISION vec2 InputSize;\n\n// vertex compatibility #defines\n#define vTexCoord TEX0.xy\n#define SourceSize vec4(TextureSize, 1.0 / TextureSize) //either TextureSize or InputSize\n#define outsize vec4(OutputSize, 1.0 / OutputSize)\n\nvoid main()\n{\n\tgl_Position = MVPMatrix * VertexCoord;\n\tCOL0 = COLOR;\n\tTEX0.xy = TexCoord.xy;\n\tfloat dx = SourceSize.z, dy = SourceSize.w;\n    \n\tt1 = TEX0.xxxy + vec4(  -dx,   0., dx,  -dy);\t// A, B, C\n\tt2 = TEX0.xxxy + vec4(  -dx,   0., dx,    0.);\t// D, E, F\n\tt3 = TEX0.xxxy + vec4(  -dx,   0., dx,   dy);\t// G, H, I\n}\n\n#elif defined(FRAGMENT)\n\n#ifdef GL_ES\n#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n#define COMPAT_PRECISION mediump\n#else\n#define COMPAT_PRECISION\n#endif\n\n#if __VERSION__ >= 130\n#define COMPAT_VARYING in\n#define COMPAT_TEXTURE texture\nout COMPAT_PRECISION vec4 FragColor;\n#else\n#define COMPAT_VARYING varying\n#define FragColor gl_FragColor\n#define COMPAT_TEXTURE texture2D\n#endif\n\nuniform COMPAT_PRECISION int FrameDirection;\nuniform COMPAT_PRECISION int FrameCount;\nuniform COMPAT_PRECISION vec2 OutputSize;\nuniform COMPAT_PRECISION vec2 TextureSize;\nuniform COMPAT_PRECISION vec2 InputSize;\nuniform sampler2D Texture;\nCOMPAT_VARYING vec4 TEX0;\nCOMPAT_VARYING vec4 t1;\nCOMPAT_VARYING vec4 t2;\nCOMPAT_VARYING vec4 t3;\n\n// fragment compatibility #defines\n#define Source Texture\n#define vTexCoord TEX0.xy\n\n#define SourceSize vec4(TextureSize, 1.0 / TextureSize) //either TextureSize or InputSize\n#define outsize vec4(OutputSize, 1.0 / OutputSize)\n\n#ifdef PARAMETER_UNIFORM\nuniform COMPAT_PRECISION float SFX_CLR;\nuniform COMPAT_PRECISION float SFX_SAA;\n#else\n#define SFX_CLR 0.5\n#define SFX_SAA 1.0\n#endif\n\n// corner strength\nfloat str(float d, vec2 a, vec2 b){\n\tfloat diff = a.x - a.y;\n\tfloat wght1 = max(SFX_CLR - d, 0.) / SFX_CLR;\n\tfloat wght2 = clamp((1.-d) + (min(a.x, b.x) + a.x > min(a.y, b.y) + a.y ? diff : -diff), 0., 1.);\n\treturn (SFX_SAA == 1. || 2.*d < a.x + a.y) ? (wght1 * wght2) * (a.x * a.y) : 0.;\n}\n\nvoid main()\n{\n\t/*\tgrid\t\tmetric\t\tpattern\n\n\t\tA B\t\tx y z\t\tx y\n\t\tD E F\t\t  o w\t\tw z\n\t\tG H I\n\t*/\n\n#ifdef GL_ES\n#define TEX(x) COMPAT_TEXTURE(Source, x)\n\n\t// metric data\n\tvec4 A = TEX(t1.xw), B = TEX(t1.yw);\n\tvec4 D = TEX(t2.xw), E = TEX(t2.yw), F = TEX(t2.zw);\n\tvec4 G = TEX(t3.xw), H = TEX(t3.yw), I = TEX(t3.zw);\n#else\n#define TEX(x, y) textureOffset(Source, vTexCoord, ivec2(x, y))\n\n\t// metric data\n\tvec4 A = TEX(-1,-1), B = TEX( 0,-1);\n\tvec4 D = TEX(-1, 0), E = TEX( 0, 0), F = TEX( 1, 0);\n\tvec4 G = TEX(-1, 1), H = TEX( 0, 1), I = TEX( 1, 1);\n#endif\n\n\t// corner strength\n\tvec4 res;\n\tres.x = str(D.z, vec2(D.w, E.y), vec2(A.w, D.y));\n\tres.y = str(F.x, vec2(E.w, E.y), vec2(B.w, F.y));\n\tres.z = str(H.z, vec2(E.w, H.y), vec2(H.w, I.y));\n\tres.w = str(H.x, vec2(D.w, H.y), vec2(G.w, G.y));\n\t\t\n\tFragColor = res;\n} \n#endif\n","p2":"/*\n\tScaleFX - Pass 2\n\tby Sp00kyFox, 2017-03-01\n\nFilter:\tNearest\nScale:\t1x\n\nScaleFX is an edge interpolation algorithm specialized in pixel art. It was\noriginally intended as an improvement upon Scale3x but became a new filter in\nits own right.\nScaleFX interpolates edges up to level 6 and makes smooth transitions between\ndifferent slopes. The filtered picture will only consist of colours present\nin the original.\n\nPass 2 resolves ambiguous configurations of corner candidates at pixel junctions.\n\n\n\nCopyright (c) 2016 Sp00kyFox - ScaleFX@web.de\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\nTHE SOFTWARE.\n\n*/\n\n#if defined(VERTEX)\n\n#if __VERSION__ >= 130\n#define COMPAT_VARYING out\n#define COMPAT_ATTRIBUTE in\n#define COMPAT_TEXTURE texture\n#else\n#define COMPAT_VARYING varying \n#define COMPAT_ATTRIBUTE attribute \n#define COMPAT_TEXTURE texture2D\n#endif\n\n#ifdef GL_ES\n#define COMPAT_PRECISION mediump\n#else\n#define COMPAT_PRECISION\n#endif\n\nCOMPAT_ATTRIBUTE vec4 VertexCoord;\nCOMPAT_ATTRIBUTE vec4 COLOR;\nCOMPAT_ATTRIBUTE vec4 TexCoord;\nCOMPAT_VARYING vec4 COL0;\nCOMPAT_VARYING vec4 TEX0;\n\nuniform mat4 MVPMatrix;\nuniform COMPAT_PRECISION int FrameDirection;\nuniform COMPAT_PRECISION int FrameCount;\nuniform COMPAT_PRECISION vec2 OutputSize;\nuniform COMPAT_PRECISION vec2 TextureSize;\nuniform COMPAT_PRECISION vec2 InputSize;\nCOMPAT_VARYING vec4 t1;\nCOMPAT_VARYING vec4 t2;\nCOMPAT_VARYING vec4 t3;\n\n// vertex compatibility #defines\n#define vTexCoord TEX0.xy\n#define SourceSize vec4(TextureSize, 1.0 / TextureSize) //either TextureSize or InputSize\n#define outsize vec4(OutputSize, 1.0 / OutputSize)\n\nvoid main()\n{\n    gl_Position = MVPMatrix * VertexCoord;\n    COL0 = COLOR;\n    TEX0.xy = TexCoord.xy;\n\tfloat dx = SourceSize.z, dy = SourceSize.w;\n\t\n\tt1 = TEX0.xxxy + vec4(  -dx,   0., dx,  -dy);\t// A, B, C\n\tt2 = TEX0.xxxy + vec4(  -dx,   0., dx,    0.);\t// D, E, F\n\tt3 = TEX0.xxxy + vec4(  -dx,   0., dx,   dy);\t// G, H, I\n}\n\n#elif defined(FRAGMENT)\n\n#ifdef GL_ES\n#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n#define COMPAT_PRECISION mediump\n#else\n#define COMPAT_PRECISION\n#endif\n\n#if __VERSION__ >= 130\n#define COMPAT_VARYING in\n#define COMPAT_TEXTURE texture\nout COMPAT_PRECISION vec4 FragColor;\n#else\n#define COMPAT_VARYING varying\n#define FragColor gl_FragColor\n#define COMPAT_TEXTURE texture2D\n#endif\n\nuniform COMPAT_PRECISION int FrameDirection;\nuniform COMPAT_PRECISION int FrameCount;\nuniform COMPAT_PRECISION vec2 OutputSize;\nuniform COMPAT_PRECISION vec2 TextureSize;\nuniform COMPAT_PRECISION vec2 InputSize;\nuniform sampler2D Texture;\nuniform sampler2D PassPrev2Texture;\nCOMPAT_VARYING vec4 TEX0;\nCOMPAT_VARYING vec4 t1;\nCOMPAT_VARYING vec4 t2;\nCOMPAT_VARYING vec4 t3;\n\n// fragment compatibility #defines\n#define Source Texture\n#define vTexCoord TEX0.xy\n\n#define SourceSize vec4(TextureSize, 1.0 / TextureSize) //either TextureSize or InputSize\n#define outsize vec4(OutputSize, 1.0 / OutputSize)\n\n#define PassOutput0 PassPrev2Texture\n\n#define LE(x, y) (1. - step(y, x))\n#define GE(x, y) (1. - step(x, y))\n#define LEQ(x, y) step(x, y)\n#define GEQ(x, y) step(y, x)\n#define NOT(x) (1. - (x))\n\n// corner dominance at junctions\nvec4 dom(vec3 x, vec3 y, vec3 z, vec3 w){\n\treturn 2. * vec4(x.y, y.y, z.y, w.y) - (vec4(x.x, y.x, z.x, w.x) + vec4(x.z, y.z, z.z, w.z));\n}\n\n// necessary but not sufficient junction condition for orthogonal edges\nfloat clear(vec2 crn, vec2 a, vec2 b){\n\treturn (crn.x >= max(min(a.x, a.y), min(b.x, b.y))) && (crn.y >= max(min(a.x, b.y), min(b.x, a.y))) ? 1. : 0.;\n}\n\nvoid main()\n{\n\t/*\tgrid\t\tmetric\t\tpattern\n\n\t\tA B C\t\tx y z\t\tx y\n\t\tD E F\t\t  o w\t\tw z\n\t\tG H I\n\t*/\n\n#ifdef GL_ES\n\t#define TEXm(x) COMPAT_TEXTURE(PassOutput0, x)\n\t#define TEXs(x) COMPAT_TEXTURE(Source, x)\n\n\t// metric data\n\tvec4 A = TEXm(t1.xw), B = TEXm(t1.yw);\n\tvec4 D = TEXm(t2.xw), E = TEXm(t2.yw), F = TEXm(t2.zw);\n\tvec4 G = TEXm(t3.xw), H = TEXm(t3.yw), I = TEXm(t3.zw);\n\t\n\t// strength data\n\tvec4 As = TEXs(t1.xw), Bs = TEXs(t1.yw), Cs = TEXs(t1.zw);\n\tvec4 Ds = TEXs(t2.xw), Es = TEXs(t2.yw), Fs = TEXs(t2.zw);\n\tvec4 Gs = TEXs(t3.xw), Hs = TEXs(t3.yw), Is = TEXs(t3.zw);\n#else\n\t#define TEXm(x, y) textureOffset(PassOutput0, vTexCoord, ivec2(x, y))\n\t#define TEXs(x, y) textureOffset(Source, vTexCoord, ivec2(x, y))\n\n\t// metric data\n\tvec4 A = TEXm(-1,-1), B = TEXm( 0,-1);\n\tvec4 D = TEXm(-1, 0), E = TEXm( 0, 0), F = TEXm( 1, 0);\n\tvec4 G = TEXm(-1, 1), H = TEXm( 0, 1), I = TEXm( 1, 1);\t\n\n\t// strength data\n\tvec4 As = TEXs(-1,-1), Bs = TEXs( 0,-1), Cs = TEXs( 1,-1);\n\tvec4 Ds = TEXs(-1, 0), Es = TEXs( 0, 0), Fs = TEXs( 1, 0);\n\tvec4 Gs = TEXs(-1, 1), Hs = TEXs( 0, 1), Is = TEXs( 1, 1);\n#endif\n\n\t// strength & dominance junctions\n\tvec4 jSx = vec4(As.z, Bs.w, Es.x, Ds.y), jDx = dom(As.yzw, Bs.zwx, Es.wxy, Ds.xyz);\n\tvec4 jSy = vec4(Bs.z, Cs.w, Fs.x, Es.y), jDy = dom(Bs.yzw, Cs.zwx, Fs.wxy, Es.xyz);\n\tvec4 jSz = vec4(Es.z, Fs.w, Is.x, Hs.y), jDz = dom(Es.yzw, Fs.zwx, Is.wxy, Hs.xyz);\n\tvec4 jSw = vec4(Ds.z, Es.w, Hs.x, Gs.y), jDw = dom(Ds.yzw, Es.zwx, Hs.wxy, Gs.xyz);\n\n\n\t// majority vote for ambiguous dominance junctions\n\tvec4 zero4 = vec4(0.);\n\tvec4 jx = min(GE(jDx, zero4) * (LEQ(jDx.yzwx, zero4) * LEQ(jDx.wxyz, zero4) + GE(jDx + jDx.zwxy, jDx.yzwx + jDx.wxyz)), 1.);\n\tvec4 jy = min(GE(jDy, zero4) * (LEQ(jDy.yzwx, zero4) * LEQ(jDy.wxyz, zero4) + GE(jDy + jDy.zwxy, jDy.yzwx + jDy.wxyz)), 1.);\n\tvec4 jz = min(GE(jDz, zero4) * (LEQ(jDz.yzwx, zero4) * LEQ(jDz.wxyz, zero4) + GE(jDz + jDz.zwxy, jDz.yzwx + jDz.wxyz)), 1.);\n\tvec4 jw = min(GE(jDw, zero4) * (LEQ(jDw.yzwx, zero4) * LEQ(jDw.wxyz, zero4) + GE(jDw + jDw.zwxy, jDw.yzwx + jDw.wxyz)), 1.);\n\n\n\t// inject strength without creating new contradictions\n\tvec4 res;\n\tres.x = min(jx.z + NOT(jx.y) * NOT(jx.w) * GE(jSx.z, 0.) * (jx.x + GE(jSx.x + jSx.z, jSx.y + jSx.w)), 1.);\n\tres.y = min(jy.w + NOT(jy.z) * NOT(jy.x) * GE(jSy.w, 0.) * (jy.y + GE(jSy.y + jSy.w, jSy.x + jSy.z)), 1.);\n\tres.z = min(jz.x + NOT(jz.w) * NOT(jz.y) * GE(jSz.x, 0.) * (jz.z + GE(jSz.x + jSz.z, jSz.y + jSz.w)), 1.);\n\tres.w = min(jw.y + NOT(jw.x) * NOT(jw.z) * GE(jSw.y, 0.) * (jw.w + GE(jSw.y + jSw.w, jSw.x + jSw.z)), 1.);\t\n\n\n\t// single pixel & end of line detection\n\tres = min(res * (vec4(jx.z, jy.w, jz.x, jw.y) + NOT(res.wxyz * res.yzwx)), 1.);\n\n\n\t// output\n\n\tvec4 clr;\n\tclr.x = clear(vec2(D.z, E.x), vec2(D.w, E.y), vec2(A.w, D.y));\n\tclr.y = clear(vec2(F.x, E.z), vec2(E.w, E.y), vec2(B.w, F.y));\n\tclr.z = clear(vec2(H.z, I.x), vec2(E.w, H.y), vec2(H.w, I.y));\n\tclr.w = clear(vec2(H.x, G.z), vec2(D.w, H.y), vec2(G.w, G.y));\n\n\tvec4 h = vec4(min(D.w, A.w), min(E.w, B.w), min(E.w, H.w), min(D.w, G.w));\n\tvec4 v = vec4(min(E.y, D.y), min(E.y, F.y), min(H.y, I.y), min(H.y, G.y));\n\n\tvec4 or   = GE(h + vec4(D.w, E.w, E.w, D.w), v + vec4(E.y, E.y, H.y, H.y));\t// orientation\n\tvec4 hori = LE(h, v) * clr;\t// horizontal edges\n\tvec4 vert = GE(h, v) * clr;\t// vertical edges\n\n\tFragColor = (res + 2. * hori + 4. * vert + 8. * or) / 15.;\n} \n#endif\n","p3":"/*\n\tScaleFX - Pass 3\n\tby Sp00kyFox, 2017-03-01\n\nFilter:\tNearest\nScale:\t1x\n\nScaleFX is an edge interpolation algorithm specialized in pixel art. It was\noriginally intended as an improvement upon Scale3x but became a new filter in\nits own right.\nScaleFX interpolates edges up to level 6 and makes smooth transitions between\ndifferent slopes. The filtered picture will only consist of colours present\nin the original.\n\nPass 3 determines which edge level is present and prepares tags for subpixel\noutput in the final pass.\n\n\n\nCopyright (c) 2016 Sp00kyFox - ScaleFX@web.de\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\nTHE SOFTWARE.\n\n*/\n\n// Parameter lines go here:\n#pragma parameter SFX_SCN \"ScaleFX Filter Corners\" 1.0 0.0 1.0 1.0\n\n#if defined(VERTEX)\n\n#if __VERSION__ >= 130\n#define COMPAT_VARYING out\n#define COMPAT_ATTRIBUTE in\n#define COMPAT_TEXTURE texture\n#else\n#define COMPAT_VARYING varying \n#define COMPAT_ATTRIBUTE attribute \n#define COMPAT_TEXTURE texture2D\n#endif\n\n#ifdef GL_ES\n#define COMPAT_PRECISION mediump\n#else\n#define COMPAT_PRECISION\n#endif\n\nCOMPAT_ATTRIBUTE vec4 VertexCoord;\nCOMPAT_ATTRIBUTE vec4 COLOR;\nCOMPAT_ATTRIBUTE vec4 TexCoord;\nCOMPAT_VARYING vec4 COL0;\nCOMPAT_VARYING vec4 TEX0;\nCOMPAT_VARYING vec4 t1;\nCOMPAT_VARYING vec4 t2;\nCOMPAT_VARYING vec4 t3;\nCOMPAT_VARYING vec4 t4;\n\nuniform mat4 MVPMatrix;\nuniform COMPAT_PRECISION int FrameDirection;\nuniform COMPAT_PRECISION int FrameCount;\nuniform COMPAT_PRECISION vec2 OutputSize;\nuniform COMPAT_PRECISION vec2 TextureSize;\nuniform COMPAT_PRECISION vec2 InputSize;\n\n// vertex compatibility #defines\n#define vTexCoord TEX0.xy\n#define SourceSize vec4(TextureSize, 1.0 / TextureSize) //either TextureSize or InputSize\n#define outsize vec4(OutputSize, 1.0 / OutputSize)\n\nvoid main()\n{\n    gl_Position = MVPMatrix * VertexCoord;\n    COL0 = COLOR;\n    TEX0.xy = TexCoord.xy;\n\tfloat dx = SourceSize.z, dy = SourceSize.w;\n    \n    t1 = TEX0.xxxy + vec4(-dx, -2.*dx, -3.*dx,     0.);\t// D, D0, D1\n\tt2 = TEX0.xxxy + vec4( dx,  2.*dx,  3.*dx,     0.);\t// F, F0, F1\n\tt3 = TEX0.xyyy + vec4(  0.,   -dy, -2.*dy, -3.*dy);\t// B, B0, B1\n\tt4 = TEX0.xyyy + vec4(  0.,    dy,  2.*dy,  3.*dy);\t// H, H0, H1\n}\n\n#elif defined(FRAGMENT)\n\n#ifdef GL_ES\n#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n#define COMPAT_PRECISION mediump\n#else\n#define COMPAT_PRECISION\n#endif\n\n#if __VERSION__ >= 130\n#define COMPAT_VARYING in\n#define COMPAT_TEXTURE texture\nout COMPAT_PRECISION vec4 FragColor;\n#else\n#define COMPAT_VARYING varying\n#define FragColor gl_FragColor\n#define COMPAT_TEXTURE texture2D\n#endif\n\nuniform COMPAT_PRECISION int FrameDirection;\nuniform COMPAT_PRECISION int FrameCount;\nuniform COMPAT_PRECISION vec2 OutputSize;\nuniform COMPAT_PRECISION vec2 TextureSize;\nuniform COMPAT_PRECISION vec2 InputSize;\nuniform sampler2D Texture;\nCOMPAT_VARYING vec4 TEX0;\nCOMPAT_VARYING vec4 t1;\nCOMPAT_VARYING vec4 t2;\nCOMPAT_VARYING vec4 t3;\nCOMPAT_VARYING vec4 t4;\n\n// fragment compatibility #defines\n#define Source Texture\n#define vTexCoord TEX0.xy\n\n#define SourceSize vec4(TextureSize, 1.0 / TextureSize) //either TextureSize or InputSize\n#define outsize vec4(OutputSize, 1.0 / OutputSize)\n\n#ifdef PARAMETER_UNIFORM\nuniform COMPAT_PRECISION float SFX_SCN;\n#else\n#define SFX_SCN 1.0\n#endif\n\n// extract first bool4 from float4 - corners\nbvec4 loadCorn(vec4 x){\n\treturn bvec4(floor(mod(x*15. + 0.5, 2.)));\n}\n\n// extract second bool4 from float4 - horizontal edges\nbvec4 loadHori(vec4 x){\n\treturn bvec4(floor(mod(x*7.5 + 0.25, 2.)));\n}\n\n// extract third bool4 from float4 - vertical edges\nbvec4 loadVert(vec4 x){\n\treturn bvec4(floor(mod(x*3.75 + 0.125, 2.)));\n}\n\n// extract fourth bool4 from float4 - orientation\nbvec4 loadOr(vec4 x){\n\treturn bvec4(floor(mod(x*1.875 + 0.0625, 2.)));\n}\n\nvoid main()\n{\n\t/*\tgrid\t\tcorners\t\tmids\t\t\n\n\t\t  B\t\tx   y\t  \t  x\n\t\tD E F\t\t\t\tw   y\n\t\t  H\t\tw   z\t  \t  z\n\t*/\n#ifdef GL_ES\n#define TEX(x) COMPAT_TEXTURE(Source, x)\n\n\t// read data\n\tvec4 E = TEX(vTexCoord);\n\tvec4 D = TEX(t1.xw), D0 = TEX(t1.yw), D1 = TEX(t1.zw);\n\tvec4 F = TEX(t2.xw), F0 = TEX(t2.yw), F1 = TEX(t2.zw);\n\tvec4 B = TEX(t3.xy), B0 = TEX(t3.xz), B1 = TEX(t3.xw);\n\tvec4 H = TEX(t4.xy), H0 = TEX(t4.xz), H1 = TEX(t4.xw);\n#else\n#define TEX(x, y) textureOffset(Source, vTexCoord, ivec2(x, y))\n\n\t// read data\n\tvec4 E = TEX( 0, 0);\n\tvec4 D = TEX(-1, 0), D0 = TEX(-2, 0), D1 = TEX(-3, 0);\n\tvec4 F = TEX( 1, 0), F0 = TEX( 2, 0), F1 = TEX( 3, 0);\n\tvec4 B = TEX( 0,-1), B0 = TEX( 0,-2), B1 = TEX( 0,-3);\n\tvec4 H = TEX( 0, 1), H0 = TEX( 0, 2), H1 = TEX( 0, 3);\n#endif\n\t// extract data\n\tbvec4 Ec = loadCorn(E), Eh = loadHori(E), Ev = loadVert(E), Eo = loadOr(E);\n\tbvec4 Dc = loadCorn(D),\tDh = loadHori(D), Do = loadOr(D), D0c = loadCorn(D0), D0h = loadHori(D0), D1h = loadHori(D1);\n\tbvec4 Fc = loadCorn(F),\tFh = loadHori(F), Fo = loadOr(F), F0c = loadCorn(F0), F0h = loadHori(F0), F1h = loadHori(F1);\n\tbvec4 Bc = loadCorn(B),\tBv = loadVert(B), Bo = loadOr(B), B0c = loadCorn(B0), B0v = loadVert(B0), B1v = loadVert(B1);\n\tbvec4 Hc = loadCorn(H),\tHv = loadVert(H), Ho = loadOr(H), H0c = loadCorn(H0), H0v = loadVert(H0), H1v = loadVert(H1);\n\n\t\n\t// lvl1 corners (hori, vert)\n\tbool lvl1x = Ec.x && (Dc.z || Bc.z || SFX_SCN == 1.);\n\tbool lvl1y = Ec.y && (Fc.w || Bc.w || SFX_SCN == 1.);\n\tbool lvl1z = Ec.z && (Fc.x || Hc.x || SFX_SCN == 1.);\n\tbool lvl1w = Ec.w && (Dc.y || Hc.y || SFX_SCN == 1.);\n\n\t// lvl2 mid (left, right / up, down)\n\tbvec2 lvl2x = bvec2((Ec.x && Eh.y) && Dc.z, (Ec.y && Eh.x) && Fc.w);\n\tbvec2 lvl2y = bvec2((Ec.y && Ev.z) && Bc.w, (Ec.z && Ev.y) && Hc.x);\n\tbvec2 lvl2z = bvec2((Ec.w && Eh.z) && Dc.y, (Ec.z && Eh.w) && Fc.x);\n\tbvec2 lvl2w = bvec2((Ec.x && Ev.w) && Bc.z, (Ec.w && Ev.x) && Hc.y);\n\n\t// lvl3 corners (hori, vert)\n\tbvec2 lvl3x = bvec2(lvl2x.y && (Dh.y && Dh.x) && Fh.z, lvl2w.y && (Bv.w && Bv.x) && Hv.z);\n\tbvec2 lvl3y = bvec2(lvl2x.x && (Fh.x && Fh.y) && Dh.w, lvl2y.y && (Bv.z && Bv.y) && Hv.w);\n\tbvec2 lvl3z = bvec2(lvl2z.x && (Fh.w && Fh.z) && Dh.x, lvl2y.x && (Hv.y && Hv.z) && Bv.x);\n\tbvec2 lvl3w = bvec2(lvl2z.y && (Dh.z && Dh.w) && Fh.y, lvl2w.x && (Hv.x && Hv.w) && Bv.y);\n\n\t// lvl4 corners (hori, vert)\n\tbvec2 lvl4x = bvec2((Dc.x && Dh.y && Eh.x && Eh.y && Fh.x && Fh.y) && (D0c.z && D0h.w), (Bc.x && Bv.w && Ev.x && Ev.w && Hv.x && Hv.w) && (B0c.z && B0v.y));\n\tbvec2 lvl4y = bvec2((Fc.y && Fh.x && Eh.y && Eh.x && Dh.y && Dh.x) && (F0c.w && F0h.z), (Bc.y && Bv.z && Ev.y && Ev.z && Hv.y && Hv.z) && (B0c.w && B0v.x));\n\tbvec2 lvl4z = bvec2((Fc.z && Fh.w && Eh.z && Eh.w && Dh.z && Dh.w) && (F0c.x && F0h.y), (Hc.z && Hv.y && Ev.z && Ev.y && Bv.z && Bv.y) && (H0c.x && H0v.w));\n\tbvec2 lvl4w = bvec2((Dc.w && Dh.z && Eh.w && Eh.z && Fh.w && Fh.z) && (D0c.y && D0h.x), (Hc.w && Hv.x && Ev.w && Ev.x && Bv.w && Bv.x) && (H0c.y && H0v.z));\n\n\t// lvl5 mid (left, right / up, down)\n\tbvec2 lvl5x = bvec2(lvl4x.x && (F0h.x && F0h.y) && (D1h.z && D1h.w), lvl4y.x && (D0h.y && D0h.x) && (F1h.w && F1h.z));\n\tbvec2 lvl5y = bvec2(lvl4y.y && (H0v.y && H0v.z) && (B1v.w && B1v.x), lvl4z.y && (B0v.z && B0v.y) && (H1v.x && H1v.w));\n\tbvec2 lvl5z = bvec2(lvl4w.x && (F0h.w && F0h.z) && (D1h.y && D1h.x), lvl4z.x && (D0h.z && D0h.w) && (F1h.x && F1h.y));\n\tbvec2 lvl5w = bvec2(lvl4x.y && (H0v.x && H0v.w) && (B1v.z && B1v.y), lvl4w.y && (B0v.w && B0v.x) && (H1v.y && H1v.z));\n\n\t// lvl6 corners (hori, vert)\n\tbvec2 lvl6x = bvec2(lvl5x.y && (D1h.y && D1h.x), lvl5w.y && (B1v.w && B1v.x));\n\tbvec2 lvl6y = bvec2(lvl5x.x && (F1h.x && F1h.y), lvl5y.y && (B1v.z && B1v.y));\n\tbvec2 lvl6z = bvec2(lvl5z.x && (F1h.w && F1h.z), lvl5y.x && (H1v.y && H1v.z));\n\tbvec2 lvl6w = bvec2(lvl5z.y && (D1h.z && D1h.w), lvl5w.x && (H1v.x && H1v.w));\n\n\t\n\t// subpixels - 0 = E, 1 = D, 2 = D0, 3 = F, 4 = F0, 5 = B, 6 = B0, 7 = H, 8 = H0\n\n\tvec4 crn;\n\tcrn.x = (lvl1x && Eo.x || lvl3x.x && Eo.y || lvl4x.x && Do.x || lvl6x.x && Fo.y) ? 5. : (lvl1x || lvl3x.y && !Eo.w || lvl4x.y && !Bo.x || lvl6x.y && !Ho.w) ? 1. : lvl3x.x ? 3. : lvl3x.y ? 7. : lvl4x.x ? 2. : lvl4x.y ? 6. : lvl6x.x ? 4. : lvl6x.y ? 8. : 0.;\n\tcrn.y = (lvl1y && Eo.y || lvl3y.x && Eo.x || lvl4y.x && Fo.y || lvl6y.x && Do.x) ? 5. : (lvl1y || lvl3y.y && !Eo.z || lvl4y.y && !Bo.y || lvl6y.y && !Ho.z) ? 3. : lvl3y.x ? 1. : lvl3y.y ? 7. : lvl4y.x ? 4. : lvl4y.y ? 6. : lvl6y.x ? 2. : lvl6y.y ? 8. : 0.;\n\tcrn.z = (lvl1z && Eo.z || lvl3z.x && Eo.w || lvl4z.x && Fo.z || lvl6z.x && Do.w) ? 7. : (lvl1z || lvl3z.y && !Eo.y || lvl4z.y && !Ho.z || lvl6z.y && !Bo.y) ? 3. : lvl3z.x ? 1. : lvl3z.y ? 5. : lvl4z.x ? 4. : lvl4z.y ? 8. : lvl6z.x ? 2. : lvl6z.y ? 6. : 0.;\n\tcrn.w = (lvl1w && Eo.w || lvl3w.x && Eo.z || lvl4w.x && Do.w || lvl6w.x && Fo.z) ? 7. : (lvl1w || lvl3w.y && !Eo.x || lvl4w.y && !Ho.w || lvl6w.y && !Bo.x) ? 1. : lvl3w.x ? 3. : lvl3w.y ? 5. : lvl4w.x ? 2. : lvl4w.y ? 8. : lvl6w.x ? 4. : lvl6w.y ? 6. : 0.;\n\n\tvec4 mid;\n\tmid.x = (lvl2x.x &&  Eo.x || lvl2x.y &&  Eo.y || lvl5x.x &&  Do.x || lvl5x.y &&  Fo.y) ? 5. : lvl2x.x ? 1. : lvl2x.y ? 3. : lvl5x.x ? 2. : lvl5x.y ? 4. : (Ec.x && Dc.z && Ec.y && Fc.w) ? ( Eo.x ?  Eo.y ? 5. : 3. : 1.) : 0.;\n\tmid.y = (lvl2y.x && !Eo.y || lvl2y.y && !Eo.z || lvl5y.x && !Bo.y || lvl5y.y && !Ho.z) ? 3. : lvl2y.x ? 5. : lvl2y.y ? 7. : lvl5y.x ? 6. : lvl5y.y ? 8. : (Ec.y && Bc.w && Ec.z && Hc.x) ? (!Eo.y ? !Eo.z ? 3. : 7. : 5.) : 0.;\n\tmid.z = (lvl2z.x &&  Eo.w || lvl2z.y &&  Eo.z || lvl5z.x &&  Do.w || lvl5z.y &&  Fo.z) ? 7. : lvl2z.x ? 1. : lvl2z.y ? 3. : lvl5z.x ? 2. : lvl5z.y ? 4. : (Ec.z && Fc.x && Ec.w && Dc.y) ? ( Eo.z ?  Eo.w ? 7. : 1. : 3.) : 0.;\n\tmid.w = (lvl2w.x && !Eo.x || lvl2w.y && !Eo.w || lvl5w.x && !Bo.x || lvl5w.y && !Ho.w) ? 1. : lvl2w.x ? 5. : lvl2w.y ? 7. : lvl5w.x ? 6. : lvl5w.y ? 8. : (Ec.w && Hc.y && Ec.x && Bc.z) ? (!Eo.w ? !Eo.x ? 1. : 5. : 7.) : 0.;\n\n\n\t// ouput\n\tFragColor = (crn + 9. * mid) / 80.;\n} \n#endif\n","p4":"/*\n\tScaleFX - Pass 4\n\tby Sp00kyFox, 2017-03-01\n\nFilter:\tNearest\nScale:\t3x\n\nScaleFX is an edge interpolation algorithm specialized in pixel art. It was\noriginally intended as an improvement upon Scale3x but became a new filter in\nits own right.\nScaleFX interpolates edges up to level 6 and makes smooth transitions between\ndifferent slopes. The filtered picture will only consist of colours present\nin the original.\n\nPass 4 outputs subpixels based on previously calculated tags.\n\n\nCopyright (c) 2016 Sp00kyFox - ScaleFX@web.de\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\nTHE SOFTWARE.\n\n*/\n\n#if defined(VERTEX)\n\n#if __VERSION__ >= 130\n#define COMPAT_VARYING out\n#define COMPAT_ATTRIBUTE in\n#define COMPAT_TEXTURE texture\n#else\n#define COMPAT_VARYING varying \n#define COMPAT_ATTRIBUTE attribute \n#define COMPAT_TEXTURE texture2D\n#endif\n\n#ifdef GL_ES\n#define COMPAT_PRECISION mediump\n#else\n#define COMPAT_PRECISION\n#endif\n\nCOMPAT_ATTRIBUTE vec4 VertexCoord;\nCOMPAT_ATTRIBUTE vec4 COLOR;\nCOMPAT_ATTRIBUTE vec4 TexCoord;\nCOMPAT_VARYING vec4 COL0;\nCOMPAT_VARYING vec4 TEX0;\n\nuniform mat4 MVPMatrix;\nuniform COMPAT_PRECISION int FrameDirection;\nuniform COMPAT_PRECISION int FrameCount;\nuniform COMPAT_PRECISION vec2 OutputSize;\nuniform COMPAT_PRECISION vec2 TextureSize;\nuniform COMPAT_PRECISION vec2 InputSize;\nuniform COMPAT_PRECISION vec2 PassPrev5TextureSize;\nuniform COMPAT_PRECISION vec2 PassPrev5InputSize;\nCOMPAT_VARYING vec4 t1;\nCOMPAT_VARYING vec4 t2;\nCOMPAT_VARYING vec4 t3;\nCOMPAT_VARYING vec4 t4;\n\n// vertex compatibility #defines\n#define vTexCoord TEX0.xy\n#define SourceSize vec4(TextureSize, 1.0 / TextureSize) //either TextureSize or InputSize\n#define outsize vec4(OutputSize, 1.0 / OutputSize)\n\nvoid main()\n{\n    gl_Position = MVPMatrix * VertexCoord;\n    COL0 = COLOR;\n    TEX0.xy = TexCoord.xy;\n\t\n\tvec2 ps = 1.0/PassPrev5TextureSize;\n\tfloat dx = ps.x, dy = ps.y;\n\n\tt1 = TEX0.xxxy + vec4( 0., -dx, -2.*dx,     0.);\t// E, D, D0\n\tt2 = TEX0.xyxy + vec4(dx,   0,  2.*dx,     0.);\t// F, F0\n\tt3 = TEX0.xyxy + vec4( 0., -dy,     0., -2.*dy);\t// B, B0\n\tt4 = TEX0.xyxy + vec4( 0.,  dy,     0.,  2.*dy);\t// H, H0\n}\n\n#elif defined(FRAGMENT)\n\n#ifdef GL_ES\n#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n#define COMPAT_PRECISION mediump\n#else\n#define COMPAT_PRECISION\n#endif\n\n#if __VERSION__ >= 130\n#define COMPAT_VARYING in\n#define COMPAT_TEXTURE texture\nout COMPAT_PRECISION vec4 FragColor;\n#else\n#define COMPAT_VARYING varying\n#define FragColor gl_FragColor\n#define COMPAT_TEXTURE texture2D\n#endif\n\nuniform COMPAT_PRECISION int FrameDirection;\nuniform COMPAT_PRECISION int FrameCount;\nuniform COMPAT_PRECISION vec2 OutputSize;\nuniform COMPAT_PRECISION vec2 TextureSize;\nuniform COMPAT_PRECISION vec2 InputSize;\nuniform sampler2D Texture;\nuniform sampler2D PassPrev5Texture;\nCOMPAT_VARYING vec4 TEX0;\nCOMPAT_VARYING vec4 t1;\nCOMPAT_VARYING vec4 t2;\nCOMPAT_VARYING vec4 t3;\nCOMPAT_VARYING vec4 t4;\n\n// fragment compatibility #defines\n#define Source Texture\n#define vTexCoord TEX0.xy\n\n#define SourceSize vec4(TextureSize, 1.0 / TextureSize) //either TextureSize or InputSize\n#define outsize vec4(OutputSize, 1.0 / OutputSize)\n\n// extract corners\nvec4 loadCrn(vec4 x){\n\treturn floor(mod(x*80. + 0.5, 9.));\n}\n\n// extract mids\nvec4 loadMid(vec4 x){\n\treturn floor(mod(x*8.888888 + 0.055555, 9.));\n}\n\nvoid main()\n{\n\t/*\tgrid\t\tcorners\t\tmids\n\n\t\t  B\t\tx   y\t  \t  x\n\t\tD E F\t\t\t\tw   y\n\t\t  H\t\tw   z\t  \t  z\n\t*/\n\n\n\t// read data\n\tvec4 E = COMPAT_TEXTURE(Source, vTexCoord);\n\n\t// extract data\n\tvec4 crn = loadCrn(E);\n\tvec4 mid = loadMid(E);\n\n\t// determine subpixel\n\tvec2 fp = floor(3.0 * fract(vTexCoord * SourceSize.xy));\n\tfloat sp = fp.y == 0. ? (fp.x == 0. ? crn.x : fp.x == 1. ? mid.x : crn.y) : (fp.y == 1. ? (fp.x == 0. ? mid.w : fp.x == 1. ? 0. : mid.y) : (fp.x == 0. ? crn.w : fp.x == 1. ? mid.z : crn.z));\n\n\t// output coordinate - 0 = E, 1 = D, 2 = D0, 3 = F, 4 = F0, 5 = B, 6 = B0, 7 = H, 8 = H0\n\tvec2 res = sp == 0. ? vec2(0.,0.) : sp == 1. ? vec2(-1.,0.) : sp == 2. ? vec2(-2.,0.) : sp == 3. ? vec2(1.,0.) : sp == 4. ? vec2(2.,0.) : sp == 5. ? vec2(0,-1) : sp == 6. ? vec2(0.,-2.) : sp == 7. ? vec2(0.,1.) : vec2(0.,2.);\n\n\t// ouput\n\tFragColor = COMPAT_TEXTURE(PassPrev5Texture, vTexCoord + res / SourceSize.xy);\n} \n#endif\n"};

  const IDENTITY = new Float32Array([
    1,0,0,0,
    0,1,0,0,
    0,0,1,0,
    0,0,0,1
  ]);

  function compile(gl, type, source, define) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, "#define " + define + " 1\n" + source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const msg = gl.getShaderInfoLog(shader) || "ScaleFX shader compile error";
      gl.deleteShader(shader);
      throw new Error(msg);
    }
    return shader;
  }

  function link(gl, source) {
    const vs = compile(gl, gl.VERTEX_SHADER, source, "VERTEX");
    const fs = compile(gl, gl.FRAGMENT_SHADER, source, "FRAGMENT");
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const msg = gl.getProgramInfoLog(program) || "ScaleFX program link error";
      gl.deleteProgram(program);
      throw new Error(msg);
    }
    return program;
  }

  function makeBlitProgram(gl) {
    const vs = `
      attribute vec2 aPosition;
      attribute vec2 aTexCoord;
      varying highp vec2 vTexCoord;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
        vTexCoord = aTexCoord;
      }
    `;
    const fs = `
      precision mediump float;
      varying highp vec2 vTexCoord;
      uniform sampler2D uTexture;
      void main() {
        gl_FragColor = texture2D(uTexture, vTexCoord);
      }
    `;
    const v = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(v, vs); gl.compileShader(v);
    if (!gl.getShaderParameter(v, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(v));
    const f = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(f, fs); gl.compileShader(f);
    if (!gl.getShaderParameter(f, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(f));
    const p = gl.createProgram();
    gl.attachShader(p,v); gl.attachShader(p,f); gl.linkProgram(p);
    gl.deleteShader(v); gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  function createTexture(gl, width, height, type) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0,
      gl.RGBA, type, null
    );
    return texture;
  }

  function createTarget(gl, width, height, type) {
    const texture = createTexture(gl, width, height, type);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, texture, 0
    );
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      return null;
    }
    return { texture, framebuffer, width, height, type };
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance"
      });
      if (!this.gl) throw new Error("WebGL no disponible para ScaleFX");

      const gl = this.gl;
      this.floatType = gl.UNSIGNED_BYTE;
      const floatTex = gl.getExtension("OES_texture_float");
      const floatRT = gl.getExtension("WEBGL_color_buffer_float");
      if (floatTex && floatRT) this.floatType = gl.FLOAT;

      this.programs = [
        link(gl, SHADERS.p0),
        link(gl, SHADERS.p1),
        link(gl, SHADERS.p2),
        link(gl, SHADERS.p3),
        link(gl, SHADERS.p4)
      ];
      this.blitProgram = makeBlitProgram(gl);

      this.posBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1,-1,  1,-1, -1,1,  1,1
      ]), gl.STATIC_DRAW);

      this.texBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0,0,  1,0,  0,1,  1,1
      ]), gl.STATIC_DRAW);

      this.sourceTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.targets = [];
      this.width = 0;
      this.height = 0;
      this.frame = 0;
      this.lastError = null;

      canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        this.lastError = new Error("ScaleFX WebGL context lost");
      });
    }

    destroyTargets() {
      const gl = this.gl;
      for (const t of this.targets) {
        if (!t) continue;
        gl.deleteFramebuffer(t.framebuffer);
        gl.deleteTexture(t.texture);
      }
      this.targets = [];
    }

    ensureTargets(width, height) {
      if (this.width === width && this.height === height && this.targets.length === 5) return;
      const gl = this.gl;
      this.destroyTargets();

      let t0 = createTarget(gl, width, height, this.floatType);
      let t1 = createTarget(gl, width, height, this.floatType);

      if ((!t0 || !t1) && this.floatType !== gl.UNSIGNED_BYTE) {
        if (t0) { gl.deleteFramebuffer(t0.framebuffer); gl.deleteTexture(t0.texture); }
        if (t1) { gl.deleteFramebuffer(t1.framebuffer); gl.deleteTexture(t1.texture); }
        this.floatType = gl.UNSIGNED_BYTE;
        t0 = createTarget(gl, width, height, gl.UNSIGNED_BYTE);
        t1 = createTarget(gl, width, height, gl.UNSIGNED_BYTE);
      }

      const t2 = createTarget(gl, width, height, gl.UNSIGNED_BYTE);
      const t3 = createTarget(gl, width, height, gl.UNSIGNED_BYTE);
      const t4 = createTarget(gl, width * 3, height * 3, gl.UNSIGNED_BYTE);

      if (!t0 || !t1 || !t2 || !t3 || !t4) {
        throw new Error("ScaleFX framebuffer no disponible");
      }

      this.targets = [t0,t1,t2,t3,t4];
      this.width = width;
      this.height = height;
    }

    bindGeometry(program) {
      const gl = this.gl;
      const pos = gl.getAttribLocation(program, "VertexCoord");
      const tex = gl.getAttribLocation(program, "TexCoord");
      const color = Math.max(
        gl.getAttribLocation(program, "COLOR"),
        gl.getAttribLocation(program, "Color")
      );

      if (pos >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
        gl.enableVertexAttribArray(pos);
        gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
      }
      if (tex >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuffer);
        gl.enableVertexAttribArray(tex);
        gl.vertexAttribPointer(tex, 2, gl.FLOAT, false, 0, 0);
      }
      if (color >= 0) {
        gl.disableVertexAttribArray(color);
        gl.vertexAttrib4f(color, 1,1,1,1);
      }
    }

    setCommon(program, outputW, outputH, textureW, textureH, inputW, inputH) {
      const gl = this.gl;
      const set2 = (name,a,b) => {
        const loc = gl.getUniformLocation(program,name);
        if (loc) gl.uniform2f(loc,a,b);
      };
      const set1i = (name,v) => {
        const loc = gl.getUniformLocation(program,name);
        if (loc) gl.uniform1i(loc,v);
      };
      const mvp = gl.getUniformLocation(program,"MVPMatrix");
      if (mvp) gl.uniformMatrix4fv(mvp,false,IDENTITY);
      set1i("FrameDirection",1);
      set1i("FrameCount",this.frame);
      set2("OutputSize",outputW,outputH);
      set2("TextureSize",textureW,textureH);
      set2("InputSize",inputW,inputH);
    }

    bindSampler(program, name, texture, unit) {
      const gl = this.gl;
      const loc = gl.getUniformLocation(program,name);
      if (loc === null) return;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.uniform1i(loc,unit);
    }

    drawPass(index, target, primaryTexture, width, height, extra) {
      const gl = this.gl;
      const program = this.programs[index];
      gl.bindFramebuffer(gl.FRAMEBUFFER,target.framebuffer);
      gl.viewport(0,0,target.width,target.height);
      gl.useProgram(program);
      this.bindGeometry(program);
      this.setCommon(program,target.width,target.height,width,height,width,height);
      this.bindSampler(program,"Texture",primaryTexture,0);

      if (extra) {
        let unit=1;
        for (const [name,texture] of Object.entries(extra.samplers || {})) {
          this.bindSampler(program,name,texture,unit++);
        }
        for (const [name,size] of Object.entries(extra.sizes || {})) {
          const loc=gl.getUniformLocation(program,name);
          if (loc) gl.uniform2f(loc,size[0],size[1]);
        }
      }

      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }

    uploadSource(inputCanvas, width, height) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D,this.sourceTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);

      if (this.sourceW !== width || this.sourceH !== height) {
        gl.texImage2D(
          gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,inputCanvas
        );
        this.sourceW=width;
        this.sourceH=height;
      } else {
        gl.texSubImage2D(
          gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,inputCanvas
        );
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    }

    blit(texture, outW, outH) {
      const gl=this.gl;
      if (this.canvas.width !== outW) this.canvas.width=outW;
      if (this.canvas.height !== outH) this.canvas.height=outH;

      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      gl.viewport(0,0,outW,outH);
      gl.useProgram(this.blitProgram);

      const pos=gl.getAttribLocation(this.blitProgram,"aPosition");
      const tex=gl.getAttribLocation(this.blitProgram,"aTexCoord");
      gl.bindBuffer(gl.ARRAY_BUFFER,this.posBuffer);
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.texBuffer);
      gl.enableVertexAttribArray(tex);
      gl.vertexAttribPointer(tex,2,gl.FLOAT,false,0,0);

      const loc=gl.getUniformLocation(this.blitProgram,"uTexture");
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.uniform1i(loc,0);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }

    render(inputCanvas, width, height, outW, outH) {
      if (this.lastError) throw this.lastError;
      this.ensureTargets(width,height);
      this.uploadSource(inputCanvas,width,height);
      this.frame++;

      const [t0,t1,t2,t3,t4]=this.targets;

      // Official ScaleFX chain: metric -> strengths -> junction resolution
      // -> edge levels -> 3x subpixel output.
      this.drawPass(0,t0,this.sourceTexture,width,height);
      this.drawPass(1,t1,t0.texture,width,height);
      this.drawPass(2,t2,t1.texture,width,height,{
        samplers:{PassPrev2Texture:t0.texture}
      });
      this.drawPass(3,t3,t2.texture,width,height);
      this.drawPass(4,t4,t3.texture,width,height,{
        samplers:{PassPrev5Texture:this.sourceTexture},
        sizes:{
          PassPrev5TextureSize:[width,height],
          PassPrev5InputSize:[width,height]
        }
      });

      this.blit(t4.texture,outW,outH);
      return true;
    }
  }

  const renderers = new WeakMap();

  function getRenderer(canvas) {
    let renderer=renderers.get(canvas);
    if (!renderer) {
      renderer=new Renderer(canvas);
      renderers.set(canvas,renderer);
    }
    return renderer;
  }

  window.ML3DScaleFX = {
    render({ outputCanvas, inputCanvas, width, height, targetWidth, targetHeight }) {
      try {
        return getRenderer(outputCanvas).render(
          inputCanvas,width,height,targetWidth,targetHeight
        );
      } catch (error) {
        console.warn("ML3D ScaleFX:", error);
        return false;
      }
    },
    name:"ScaleFX",
    scale:3,
    source:"libretro/glsl-shaders"
  };
})();
