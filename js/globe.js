/* ============================================================
   globe.js — Babylon scene: earth, atmosphere, graticule, coast glow
   ============================================================ */
(function (global) {
  "use strict";

  var GEO = global.GEO;
  var EARTH_R = 10;

  function Globe(canvas, opt) {
    opt = opt || {};
    this.canvas = canvas;
    this.R = EARTH_R;
    this.kmPerUnit = GEO.R_KM / EARTH_R; // km per scene unit
    this.onResize = null;
    this.destroyed = false;
    this._init(opt);
  }

  Globe.prototype._init = function (opt) {
    var engine;
    try {
      engine = new BABYLON.Engine(this.canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true,
        antialias: true,
        powerPreference: "high-performance",
        failIfMajorPerformanceCaveat: false,
      }, false);
    } catch (e) {
      throw e;
    }
    this.engine = engine;
    engine.setHardwareScalingLevel(1 / Math.min(global.devicePixelRatio || 1, 2));

    var scene = new BABYLON.Scene(engine);
    this.scene = scene;
    scene.clearColor = new BABYLON.Color4(0.008, 0.018, 0.030, 1);
    scene.ambientColor = new BABYLON.Color3(1, 1, 1);
    scene.autoClear = true;

    var cam = new BABYLON.ArcRotateCamera(
      "cam",
      -Math.PI * 0.52, 0.92, 30,
      BABYLON.Vector3.Zero(), scene
    );
    cam.minZ = 0.05;
    cam.maxZ = 800;
    cam.lowerRadiusLimit = EARTH_R * 1.35;
    cam.upperRadiusLimit = EARTH_R * 6.5;
    cam.lowerBetaLimit = 0.10;
    cam.upperBetaLimit = Math.PI - 0.10;
    cam.wheelPrecision = 26;
    cam.pinchPrecision = 46;
    cam.panningSensibility = 0;         // keep the globe centred
    cam.inertia = 0.86;
    cam.angularSensibilityX = 520;
    cam.angularSensibilityY = 520;
    cam.useNaturalPinchZoom = true;
    cam.attachControl(this.canvas, true);
    this.camera = cam;

    // Our custom shaders take the vector *toward* the sun; BABYLON's
    // DirectionalLight takes the direction light travels, which is its
    // negation. The sub-solar point sits south-west of the storm so the East
    // China Sea theatre is well lit, the terminator sweeps the Pacific, and
    // the right-hand limb catches the glow.
    var sunTo = GEO.toVec(10.0, 109.0);
    var sunDir = new BABYLON.Vector3(sunTo.x, sunTo.y, sunTo.z).normalize();
    this.sunDir = sunDir;

    var sun = new BABYLON.DirectionalLight("sun", sunDir.scale(-1), scene);
    sun.intensity = 2.15;
    sun.diffuse = new BABYLON.Color3(1.0, 0.965, 0.905);
    sun.specular = new BABYLON.Color3(0.60, 0.70, 0.82);
    this.sun = sun;

    // Night-side fill so the dark half still reads as a globe, not a hole.
    var hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(-0.3, 1, 0.25), scene);
    hemi.intensity = 0.34;
    hemi.diffuse = new BABYLON.Color3(0.30, 0.46, 0.68);
    hemi.groundColor = new BABYLON.Color3(0.03, 0.06, 0.10);
    this.hemi = hemi;

    this._buildEarth();
    this._buildAtmosphere();
    this._buildStars();
    this._framing();

    var self = this;
    this._resizeObs = function () { self.engine.resize(); if (self.onResize) self.onResize(); };
    global.addEventListener("resize", this._resizeObs);
    if (global.ResizeObserver) {
      this._ro = new ResizeObserver(this._resizeObs);
      this._ro.observe(this.canvas);
    }

    // Render loop is driven externally (app.js) so storm + HUD stay in sync.
  };

  Globe.prototype._buildEarth = function () {
    var scene = this.scene;
    var R = this.R;
    var sunDir = this.sunDir;

    var sphere = BABYLON.MeshBuilder.CreateSphere("earth", {
      diameter: R * 2, segments: 96, slice: 0.999,
    }, scene);

    /* Purpose-built surface shader.

       A stock PBR sphere gives one bright specular disc and a hard-ish
       terminator; a stock StandardMaterial flattens the map. Hand-rolling it
       lets us get the three things this scene actually needs — a soft
       day/night line, a gentle ocean-only sheen tied to the grazing angle
       instead of a hotspot, and a faint atmosphere haze that deepens toward
       the limb — for less per-pixel work than either stock material.        */
    BABYLON.Effect.ShadersStore["wdEarthVertexShader"] = [
      "precision highp float;",
      "attribute vec3 position; attribute vec3 normal; attribute vec2 uv;",
      "uniform mat4 worldViewProjection; uniform mat4 world;",
      "varying vec2 vUV; varying vec3 vN; varying vec3 vW;",
      "void main(void){",
      " vUV = uv;",
      " vec4 wp = world*vec4(position,1.0);",
      " vW = wp.xyz;",
      " vN = normalize(mat3(world)*normal);",
      " gl_Position = worldViewProjection*vec4(position,1.0);",
      "}",
    ].join("\n");

    BABYLON.Effect.ShadersStore["wdEarthFragmentShader"] = [
      "precision highp float;",
      "varying vec2 vUV; varying vec3 vN; varying vec3 vW;",
      "uniform sampler2D uMap; uniform sampler2D uMask;",
      "uniform vec3 uCam; uniform vec3 uSunDir;",
      "uniform float uNight; uniform float uHaze; uniform float uExposure;",
      "void main(void){",
      " vec3 V = normalize(uCam - vW);",
      " vec3 N = normalize(vN);",
      " vec3 base = texture2D(uMap, vUV).rgb;",
      // uMask: bright over ocean, dark over land (same source as the old
      // specular map) — reused here to separate water from rock
      " float ocean = texture2D(uMask, vUV).r;",
      " float ndl = dot(N, normalize(uSunDir));",
      // wide, soft terminator so the night side falls away gradually
      " float day = smoothstep(-0.22, 0.42, ndl);",
      " float grazing = pow(1.0 - clamp(dot(V, N), 0.0, 1.0), 2.4);",
      // ocean sheen: strongest where the view grazes water, never a hotspot
      " float sheen = ocean * grazing * (0.10 + 0.42*day);",
      " vec3 sunCol = vec3(1.0, 0.975, 0.93);",
      " vec3 lit = base * sunCol * (0.16 + 0.98*day);",
      // a cool bounce keeps the night side from going pure black
      " lit += base * vec3(0.16,0.24,0.42) * uNight;",
      " lit += vec3(0.16,0.30,0.44) * sheen;",
      // limb haze
      " lit += vec3(0.10,0.22,0.38) * grazing * uHaze * (0.30 + 0.70*day);",
      " gl_FragColor = vec4(lit * uExposure, 1.0);",
      "}",
    ].join("\n");

    var mat = new BABYLON.ShaderMaterial("earthMat", scene, {
      vertex: "wdEarth", fragment: "wdEarth",
    }, {
      attributes: ["position", "normal", "uv"],
      uniforms: ["world", "worldViewProjection", "uCam", "uSunDir",
        "uNight", "uHaze", "uExposure"],
      samplers: ["uMap", "uMask"],
    });
    var map = new BABYLON.Texture("assets/globe_color.jpg", scene, false, false,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    map.anisotropicFilteringLevel = 8;
    var mask = new BABYLON.Texture("assets/globe_spec.png", scene, false, false,
      BABYLON.Texture.BILINEAR_SAMPLINGMODE);
    mat.setTexture("uMap", map);
    mat.setTexture("uMask", mask);
    mat.setVector3("uSunDir", sunDir);
    mat.setFloat("uNight", 0.42);
    mat.setFloat("uHaze", 0.62);
    mat.setFloat("uExposure", 1.06);
    mat.backFaceCulling = true;
    sphere.material = mat;
    sphere.isPickable = true;
    sphere.metadata = { kind: "earth" };
    this.earth = sphere;
    this._earthMat = mat;

    // Dedicated ocean-sheen: a second slightly larger sphere whose alpha is
    // driven by a view-dependent fresnel so the limb catches the sun.
    // Fresnel limb: a thin additive shell whose brightness peaks where the
    // view grazes the surface. Rendered only on the near side.
    BABYLON.Effect.ShadersStore["wdRimVertexShader"] = [
      "precision highp float;",
      "attribute vec3 position; attribute vec3 normal;",
      "uniform mat4 worldViewProjection; uniform mat4 world;",
      "varying vec3 vN; varying vec3 vW;",
      "void main(void){",
      " vec4 wp = world*vec4(position,1.0);",
      " vW = wp.xyz; vN = normalize(mat3(world)*normal);",
      " gl_Position = worldViewProjection*vec4(position,1.0);",
      "}",
    ].join("\n");
    BABYLON.Effect.ShadersStore["wdRimFragmentShader"] = [
      "precision highp float;",
      "varying vec3 vN; varying vec3 vW;",
      "uniform vec3 uCam; uniform vec3 uColor; uniform vec3 uSunDir;",
      "uniform float uPower; uniform float uStrength;",
      "void main(void){",
      " vec3 V = normalize(uCam - vW);",
      " vec3 N = normalize(vN);",
      " float f = 1.0 - clamp(dot(V,N), 0.0, 1.0);",
      " f = pow(f, uPower);",
      " float lit = clamp(dot(N, normalize(uSunDir))*0.5 + 0.5, 0.0, 1.0);",
      " lit = smoothstep(0.15, 0.95, lit);",
      " float a = f * uStrength * (0.25 + 0.95*lit);",
      " gl_FragColor = vec4(uColor*a, a);",
      "}",
    ].join("\n");

    var atmo = BABYLON.MeshBuilder.CreateSphere("earthRim", {
      diameter: R * 2 * 1.0015, segments: 128,
    }, scene);
    var rimMat = new BABYLON.ShaderMaterial("rimMat", scene, {
      vertex: "wdRim", fragment: "wdRim",
    }, {
      attributes: ["position", "normal"],
      uniforms: ["world", "worldViewProjection", "uCam", "uColor", "uSunDir",
        "uPower", "uStrength"],
      needAlphaBlending: true,
    });
    rimMat.backFaceCulling = true;
    rimMat.alphaMode = BABYLON.Engine.ALPHA_ADD;
    rimMat.disableDepthWrite = true;
    rimMat.setColor3("uColor", new BABYLON.Color3(0.34, 0.62, 0.88));
    rimMat.setVector3("uSunDir", this.sunDir);
    rimMat.setFloat("uPower", 3.6);
    rimMat.setFloat("uStrength", 0.55);
    atmo.material = rimMat;
    atmo.isPickable = false;
    atmo.alphaIndex = 3;
    this.earthRim = atmo;
    this._rimMat = rimMat;
  };

  Globe.prototype._buildAtmosphere = function () {
    var scene = this.scene;
    var R = this.R;
    var sunDir = this.sunDir;

    // Back-side shell: the halo seen against space around the silhouette.
    // Drawn with the back faces only and additive blending so it never tints
    // the globe itself.
    BABYLON.Effect.ShadersStore["wdHaloVertexShader"] = [
      "precision highp float;",
      "attribute vec3 position; attribute vec3 normal;",
      "uniform mat4 worldViewProjection; uniform mat4 world;",
      "varying vec3 vN; varying vec3 vW;",
      "void main(void){",
      " vec4 wp = world*vec4(position,1.0);",
      " vW = wp.xyz; vN = normalize(mat3(world)*normal);",
      " gl_Position = worldViewProjection*vec4(position,1.0);",
      "}",
    ].join("\n");
    BABYLON.Effect.ShadersStore["wdHaloFragmentShader"] = [
      "precision highp float;",
      "varying vec3 vN; varying vec3 vW;",
      "uniform vec3 uCam; uniform vec3 uSunDir; uniform float uPlanetR;",
      "uniform float uShell; uniform float uFalloff; uniform float uGain;",
      "uniform float uInner;",
      "void main(void){",
      " vec3 V = normalize(uCam - vW);",
      " vec3 N = normalize(vN);",
      // Ray from the camera through this fragment. Its distance from the planet
      // centre tells us both whether we are past the silhouette and how high
      // up the shell we sit — one shell can then carry both the tight inner
      // glow and the broad outer halo.
      " float t = dot(-vW, V);",
      " vec3 closest = vW + V*t;",
      " float impact = length(closest);",
      " float outside = smoothstep(uPlanetR*0.997, uPlanetR*1.06, impact);",
      " float h = clamp((impact - uPlanetR) / max(1.0, (uShell - uPlanetR)), 0.0, 1.0);",
      " float broad = pow(1.0 - h, uFalloff) * 0.55;",
      " float tight = pow(1.0 - h, uInner) * 0.30;",
      " float fall = broad*0.60 + tight;",
      " float lit = clamp(dot(N, normalize(uSunDir))*0.5 + 0.5, 0.0, 1.0);",
      " float side = smoothstep(0.06, 0.92, lit);",
      " vec3 col = mix(vec3(0.07,0.20,0.44), vec3(0.30,0.52,0.80), side);",
      " float a = outside * fall * uGain * (0.05 + 0.95*side);",
      " gl_FragColor = vec4(col*a, a);",
      "}",
    ].join("\n");

    // A single shell carries the whole halo. Cheaper tessellation and one
    // full-screen-ish additive pass instead of two is a large saving on weak
    // GPUs, and the two-term falloff above keeps the layered look.
    var atmo = BABYLON.MeshBuilder.CreateSphere("atmo", {
      diameter: this.R * 2 * 1.135, segments: 32,
    }, scene);
    var m = new BABYLON.ShaderMaterial("atmoMat", scene, {
      vertex: "wdHalo", fragment: "wdHalo",
    }, {
      attributes: ["position", "normal"],
      uniforms: ["world", "worldViewProjection", "uCam", "uSunDir", "uPlanetR",
        "uShell", "uFalloff", "uGain", "uInner"],
      needAlphaBlending: true,
    });
    m.backFaceCulling = false;
    m.alphaMode = BABYLON.Engine.ALPHA_ADD;
    m.disableDepthWrite = true;
    m.setVector3("uSunDir", sunDir);
    m.setFloat("uPlanetR", this.R);
    m.setFloat("uShell", this.R * 1.135);
    m.setFloat("uFalloff", 4.6);
    m.setFloat("uInner", 14.0);
    m.setFloat("uGain", 0.85);
    atmo.material = m;
    atmo.isPickable = false;
    atmo.alphaIndex = 1;
    atmo.doNotSyncBoundingInfo = true;
    this.atmo = atmo;
    this._atmoMat = m;
    this.atmo2 = null;
    this._atmo2Mat = null;
  };

  Globe.prototype._buildStars = function () {
    var scene = this.scene;
    var sky = BABYLON.MeshBuilder.CreateSphere("sky", {
      diameter: 520, segments: 40, sideOrientation: BABYLON.Mesh.BACKSIDE,
    }, scene);
    var m = new BABYLON.StandardMaterial("skyMat", scene);
    m.emissiveTexture = new BABYLON.Texture("assets/stars.jpg", scene, false, false,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    m.emissiveColor = new BABYLON.Color3(0.72, 0.78, 1.0);
    m.diffuseColor = BABYLON.Color3.Black();
    m.specularColor = BABYLON.Color3.Black();
    m.disableLighting = true;
    m.backFaceCulling = false;
    m.alpha = 1.0;
    sky.material = m;
    sky.isPickable = false;
    sky.infiniteDistance = true;
    this.sky = sky;
  };

  /* ------------------------------------------------------------ surfaces */
  Globe.prototype.surfacePoint = function (lat, lon, lift) {
    var v = GEO.toVec(lat, lon);
    var k = this.R + (lift || 0);
    return new BABYLON.Vector3(v.x * k, v.y * k, v.z * k);
  };

  /* ------------------------------------------------------------ camera */
  /* ArcRotateCamera position = r·(cosα·sinβ, cosβ, sinα·sinβ).
     Our toVec(lat,lon) = (cos φ·sin λ, sin φ, cos φ·cos λ), so the camera
     sits over (lat, lon) when  β = π/2 − φ  and  α = π/2 − λ.            */
  Globe.prototype.flyTo = function (lat, lon, radius, beta, ms) {
    var cam = this.camera;
    var anims = [];
    var targetAlpha = Math.PI / 2 - lon * GEO.D2R;
    var cur = cam.alpha;
    var twoPi = Math.PI * 2;
    while (targetAlpha - cur > Math.PI) targetAlpha -= twoPi;
    while (targetAlpha - cur < -Math.PI) targetAlpha += twoPi;

    var tb = typeof beta === "number" ? beta : Math.PI / 2 - lat * GEO.D2R;
    tb = GEO.clamp(tb, cam.lowerBetaLimit + 0.02, cam.upperBetaLimit - 0.02);

    var frame = ms || 1100;
    var ease = new BABYLON.CubicEase();
    ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);
    var steps = Math.max(2, Math.round(frame / 16.7));

    anims.push(BABYLON.Animation.CreateAndStartAnimation(
      "camA", cam, "alpha", 60, steps,
      cam.alpha, targetAlpha, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT, ease));
    anims.push(BABYLON.Animation.CreateAndStartAnimation(
      "camB", cam, "beta", 60, steps,
      cam.beta, tb, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT, ease));
    anims.push(BABYLON.Animation.CreateAndStartAnimation(
      "camR", cam, "radius", 60, steps,
      cam.radius, radius, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT, ease));
    for (var i = 0; i < anims.length; i++) anims[i].enableBlending = false;
    this._flyAnims = anims;
  };

  Globe.prototype._framing = function () {
    // start over the Philippine Sea / East China Sea theatre
    var cam = this.camera;
    var lat = 25.6, lon = 124.4;
    cam.beta = Math.PI / 2 - lat * GEO.D2R;
    cam.alpha = Math.PI / 2 - lon * GEO.D2R;
    cam.radius = 16.6;
    this.homeView = { alpha: cam.alpha, beta: cam.beta, radius: cam.radius, lat: lat, lon: lon };
  };

  Globe.prototype.update = function (dt) {
    // per-frame camera-driven uniforms for the custom shells
    var cam = this.camera.position;
    this._rimMat.setVector3("uCam", cam);
    this._atmoMat.setVector3("uCam", cam);
    this._earthMat.setVector3("uCam", cam);
    if (this.sky) this.sky.rotation.y += dt * 0.0016;
  };

  Globe.prototype.resetView = function () {
    var h = this.homeView;
    this.flyTo(h.lat, h.lon, h.radius, h.beta, 900);
  };

  Globe.prototype.dispose = function () {
    this.destroyed = true;
    global.removeEventListener("resize", this._resizeObs);
    if (this._ro) this._ro.disconnect();
    this.scene.dispose();
    this.engine.dispose();
  };

  global.Globe = Globe;
})(window);
