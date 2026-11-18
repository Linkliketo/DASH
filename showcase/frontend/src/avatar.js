// VRM 数字虚拟人渲染（场景设置与映射表照搬自已验证的 viewer/index.html）
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, VRMExpression, VRMExpressionMorphTargetBind } from "@pixiv/three-vrm";
import { Rig } from "./rig.js?v=26";
import { mapHeadEuler } from "./mirror.js?v=26";
import { buildProfile, FaceMapper } from "./vrm_face/facemap.mjs?v=26";
import { buildCustomProfile, CustomFaceMapper, groupBindsByMesh } from "./vrm_face/morphscan.mjs?v=26";

export class Avatar {
  constructor(canvas) {
    this.canvas = canvas;
    this.vrm = null;
    this.ready = false;
    this._headTarget = { x: 0, y: 0, z: 0 };
    this._headCur = { x: 0, y: 0, z: 0 };
    this._lastCats = null;
    this._lastHeadEuler = null;
    this._lastMirror = false;
    this._lastSnap = false;
    this._lastBlendAt = 0;
    this.faceProfile = null;
    this.faceMapper = null;
    this.snapMapper = null;
    this.customProfile = null;
    this.customMapper = null;
    this.customSnapMapper = null;
    this.faceMode = "preset";
    this.lastMapping = null;
    // 性能埋点：渲染循环的真实耗时（benchmark 读取）
    this.lastTiming = { rigMs: 0, renderMs: 0, mappingMs: 0, totalMs: 0 };
    this.lastMappingMs = 0;
    this.renderedFrames = 0;
    this.renderingEnabled = true;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xe0f2fe, 1); // --paper-blue，让数字虚拟人站在「蓝图」上
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.8));
    const dl = new THREE.DirectionalLight(0xffffff, 1.4);
    dl.position.set(2, 3, 3);
    scene.add(dl);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    // 轨道相机状态：围绕 target 的球坐标（theta 偏航 / phi 俯仰 / radius 距离）
    // 默认值 = 半身预设
    this._orbit = {
      theta: 0,
      phi: Math.PI / 2,
      radius: 1.7,
      target: new THREE.Vector3(0, 1.15, 0),
    };
    this._bindOrbitControls(canvas);

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(canvas.parentElement);
    this._resize();

    const tick = (t) => {
      requestAnimationFrame(tick);
      if (!this.renderingEnabled) return;
      const t0 = performance.now();
      if (this.vrm) {
        // 头部跟随：指数平滑后应用欧拉角
        const k = 0.18;
        for (const axis of ["x", "y", "z"]) {
          this._headCur[axis] += (this._headTarget[axis] - this._headCur[axis]) * k;
        }
        const head = this.vrm.humanoid?.getNormalizedBoneNode("head");
        if (head) {
          head.rotation.set(this._headCur.x, this._headCur.y, this._headCur.z);
        }
        this.vrm.update(t / 1000);
      }
      const t1 = performance.now();
      // 每帧由轨道状态计算相机位姿（拖拽 / 滚轮 / 预设统一走这里）
      const o = this._orbit;
      const sp = Math.sin(o.phi);
      this.camera.position.set(
        o.target.x + o.radius * sp * Math.sin(o.theta),
        o.target.y + o.radius * Math.cos(o.phi),
        o.target.z + o.radius * sp * Math.cos(o.theta)
      );
      this.camera.lookAt(o.target);
      renderer.render(scene, this.camera);
      const t2 = performance.now();
      this.lastTiming = {
        rigMs: t1 - t0,
        renderMs: t2 - t1,
        mappingMs: this.lastMappingMs,
        totalMs: t2 - t0,
      };
      this.renderedFrames++;
    };
    requestAnimationFrame(tick);
  }

  setRenderingEnabled(enabled) {
    this.renderingEnabled = !!enabled;
  }

  _resize() {
    const el = this.canvas.parentElement;
    if (!el) return;
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // 直接按 URL 加载（manifest 不可用时的兜底）
  async load(url) {
    const resp = await fetch(url, { cache: "no-cache" });
    if (!resp.ok) throw new Error(`VRM 下载失败：HTTP ${resp.status}`);
    return this.loadFromBlob(await resp.blob());
  }

  // 从 Blob 解析 VRM；新模型解析成功后才替换旧模型，失败时旧模型保持可用
  async loadFromBlob(blob) {
    const buffer = await blob.arrayBuffer();
    const loader = new GLTFLoader();
    loader.register((p) => new VRMLoaderPlugin(p));
    const gltf = await loader.parseAsync(buffer, "");
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error("不是有效的 VRM 文件");
    VRMUtils.rotateVRM0(vrm); // VRM 0.x 面向镜头；VRM 1.0 保持原朝向
    this._patchMorphTargetNames(gltf);

    const old = this.vrm;
    this.vrm = vrm;
    this.scene.add(vrm.scene);
    this.rig = new Rig(vrm);
    this._buildFaceMappers(vrm);
    this.ready = true;
    this._headTarget = { x: 0, y: 0, z: 0 };
    this._headCur = { x: 0, y: 0, z: 0 };
    if (this._lastCats) this.setBlendshapes(this._lastCats, { mirror: this._lastMirror, snap: this._lastSnap });
    if (this._lastHeadEuler) this.setHeadEuler(this._lastHeadEuler, { mirror: this._lastMirror });

    if (old) {
      this.scene.remove(old.scene);
      try {
        VRMUtils.deepDispose(old.scene);
      } catch {}
    }
    return vrm;
  }

  // VRM 0.x 把 targetNames 放在 primitive.extras 上，而 three.js GLTFLoader
  // 只读 mesh.extras.targetNames，导致 morphTargetDictionary 全是数字键。
  // 这里按 parser.associations 把 primitive 的名称补进字典，custom 扫描才能命中。
  _patchMorphTargetNames(gltf) {
    const parser = gltf?.parser;
    if (!parser?.associations || !parser?.json) return;
    gltf.scene.traverse((object) => {
      if (!object.isMesh || !object.morphTargetDictionary) return;
      const assoc = parser.associations.get(object);
      if (!assoc || assoc.meshes == null || assoc.primitives == null) return;
      const prim = parser.json.meshes?.[assoc.meshes]?.primitives?.[assoc.primitives];
      const names = prim?.extras?.targetNames;
      if (!Array.isArray(names)) return;
      const count = Object.keys(object.morphTargetDictionary).length;
      if (names.length !== count) return;
      names.forEach((name, i) => {
        if (typeof name === "string" && name) object.morphTargetDictionary[name] = i;
      });
    });
  }

  // 按当前 VRM 的运行时能力建立 preset 映射器。
  // faceMapper：摄像头连续帧，带 30 帧中性校准与非对称平滑。
  // snapMapper：照片 / 视频稀疏帧，不做校准与平滑，直接得到当前帧表情。
  _buildFaceMappers(vrm) {
    const morphTargets = [];
    vrm.scene.traverse((object) => {
      if (object.isMesh && object.morphTargetDictionary) {
        for (const name of Object.keys(object.morphTargetDictionary)) morphTargets.push(name);
      }
    });
    const expressions = Object.keys(vrm.expressionManager?.expressionMap ?? {});
    // three-vrm 3.5 的 applier.type 是静态属性（实例上没有），必须读 constructor.type。
    // 没有骨骼 lookAt 的模型交给 buildProfile("auto")，有 look* expression 时回退到 expression。
    const lookAtType = vrm.lookAt
      ? (vrm.lookAt.applier?.constructor?.type ?? "none")
      : "auto";
    const format = vrm.meta?.metaVersion === "1" ? "VRM1" : "VRM0";
    this.faceProfile = buildProfile({ expressions, morphTargets, lookAtType, format });
    this.faceMapper = new FaceMapper(this.faceProfile);
    this.snapMapper = new FaceMapper(this.faceProfile, {
      calibrationFrames: 0,
      smoothing: false,
    });

    this.customProfile = buildCustomProfile({ morphTargets, expressions, lookAtType, format });
    this.customMapper = new CustomFaceMapper(this.customProfile);
    this.customSnapMapper = new CustomFaceMapper(this.customProfile, {
      calibrationFrames: 0,
      smoothing: false,
    });
    this._injectCustomExpressions(vrm, this.customProfile);

    if (vrm.lookAt) vrm.lookAt.autoUpdate = false;
    this.lastMapping = null;
  }

  // 把 custom profile 注册成 three-vrm expression；每个 target 只绑定一次。
  _injectCustomExpressions(vrm, profile) {
    const E = vrm.expressionManager;
    if (!E || !profile) return;
    const meshes = [];
    vrm.scene.traverse((object) => {
      if (object.isMesh && object.morphTargetDictionary) meshes.push(object);
    });
    for (const { def, groups } of groupBindsByMesh(meshes, profile)) {
      if (!groups.length) continue;
      if (E.getExpression(def.name)) continue;
      try {
        const expression = new VRMExpression(def.name);
        for (const group of groups) {
          expression.addBind(new VRMExpressionMorphTargetBind({
            primitives: group.primitives,
            index: group.index,
            weight: group.weight,
          }));
        }
        expression.overrideBlink = def.overrideBlink;
        expression.overrideMouth = def.overrideMouth;
        vrm.scene.add(expression);
        E.registerExpression(expression);
      } catch {}
    }
  }

  // poseImage / poseWorld: flat 33×4；hands: {left, right} flat 21×3
  setPose(poseImage, poseWorld) {
    if (this.rig) this.rig.applyPose(poseImage, poseWorld);
  }

  setHands(hands) {
    if (this.rig) this.rig.applyHands(hands);
  }

  // 鼠标拖拽旋转 + 滚轮缩放（手动视角变换）
  _bindOrbitControls(canvas) {
    let dragging = false;
    let px = 0;
    let py = 0;
    canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      px = e.clientX;
      py = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const o = this._orbit;
      o.theta -= (e.clientX - px) * 0.006;
      o.phi = Math.max(0.15, Math.min(Math.PI - 0.15, o.phi - (e.clientY - py) * 0.006));
      px = e.clientX;
      py = e.clientY;
    });
    const end = () => {
      dragging = false;
      canvas.style.cursor = "grab";
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const o = this._orbit;
        o.radius = Math.max(0.3, Math.min(4.5, o.radius * (1 + e.deltaY * 0.001)));
      },
      { passive: false }
    );
  }

  // 视角预设：仅头部 / 半身 / 全身（GSAP 平滑运镜）
  setView(name) {
    const v = Avatar.VIEWS[name];
    if (!v) return;
    const o = this._orbit;
    if (window.gsap) {
      gsap.to(o, { theta: v.theta, phi: v.phi, radius: v.radius, duration: 0.5, ease: "power3.out" });
      gsap.to(o.target, { x: v.target[0], y: v.target[1], z: v.target[2], duration: 0.5, ease: "power3.out" });
    } else {
      o.theta = v.theta;
      o.phi = v.phi;
      o.radius = v.radius;
      o.target.set(...v.target);
    }
  }

  // cats: [{categoryName, score}]（后端契约原样）
  // mirror: 摄像头预览是镜像的；snap: 照片/视频单帧，跳过校准与平滑
  setBlendshapes(cats, { mirror = false, snap = false } = {}) {
    if (!cats) return;
    this._lastCats = cats;
    this._lastMirror = mirror;
    this._lastSnap = snap;
    if (!this.vrm) return;
    const E = this.vrm.expressionManager;
    if (!E) return;
    const mapper = this.faceMode === "custom"
      ? (snap ? this.customSnapMapper : this.customMapper)
      : (snap ? this.snapMapper : this.faceMapper);
    if (!mapper) return;

    const mappingStart = performance.now();
    const now = performance.now();
    const dt = this._lastBlendAt
      ? Math.min(0.25, Math.max(1 / 240, (now - this._lastBlendAt) / 1000))
      : 1 / 30;
    this._lastBlendAt = now;

    let out;
    try {
      out = mapper.update(cats, { dt, mirror });
    } catch {
      return;
    }

    for (const [name, weight] of Object.entries(out.expressions ?? {})) {
      try {
        E.setValue(name, weight);
      } catch {}
    }
    if (out.lookAt?.mode === "bone" && this.vrm.lookAt) {
      this.vrm.lookAt.autoUpdate = false;
      this.vrm.lookAt.yaw = out.lookAt.yaw;
      this.vrm.lookAt.pitch = out.lookAt.pitch;
    }
    this.lastMapping = out.meta;
    this.lastMappingMs = performance.now() - mappingStart;
  }

  // 切换 preset / custom。先清零所有 expression，避免两套映射叠加。
  setFaceMode(mode, { reapply = true } = {}) {
    if (mode !== "preset" && mode !== "custom") return;
    if (this.faceMode === mode) return;
    this.faceMode = mode;
    const E = this.vrm?.expressionManager;
    try {
      E?.resetValues();
    } catch {}
    try {
      this.vrm?.lookAt?.reset();
    } catch {}
    this.faceMapper?.reset();
    this.snapMapper?.reset();
    this.customMapper?.reset();
    this.customSnapMapper?.reset();
    this._lastBlendAt = 0;
    if (reapply && this._lastCats) {
      this.setBlendshapes(this._lastCats, { mirror: this._lastMirror, snap: this._lastSnap });
    }
  }

  // headEuler: {x, y, z} 度（facialTransformationMatrix 提取值，只做小角度跟随）
  // mapHeadEuler 修正 pitch 符号；mirror 时再翻转 yaw / roll
  setHeadEuler(headEuler, { mirror = false } = {}) {
    if (!headEuler) return;
    this._lastHeadEuler = headEuler;
    this._lastMirror = mirror;
    const e = mapHeadEuler(headEuler, { mirror });
    const rad = (d) => (d * Math.PI) / 180;
    const cap = (v) => Math.max(-0.5, Math.min(0.5, v));
    this._headTarget = {
      x: cap(rad(e.x) * 0.4),
      y: cap(rad(e.y) * 0.5),
      z: cap(rad(e.z) * 0.3),
    };
  }

  // 复位：骨骼回标准姿态、表情清零、视线复位、头部跟随复位（停止演示时调用）
  resetPose() {
    if (!this.vrm) return;
    try {
      this.vrm.humanoid.resetNormalizedPose();
    } catch {}
    this.vrm.scene.position.set(0, 0, 0);
    try {
      this.vrm.expressionManager?.resetValues();
    } catch {}
    this.faceMapper?.reset();
    this.snapMapper?.reset();
    this.customMapper?.reset();
    this.customSnapMapper?.reset();
    try {
      this.vrm.lookAt?.reset();
    } catch {}
    this._headTarget = { x: 0, y: 0, z: 0 };
    this._headCur = { x: 0, y: 0, z: 0 };
    this._lastHeadEuler = null;
    this._lastMirror = false;
    this._lastCats = null;
    this._lastSnap = false;
    this._lastBlendAt = 0;
    this.lastMapping = null;
    this.lastMappingMs = 0;
  }
}

Avatar.VIEWS = {
  // fov=30°，垂直半角 tan(15°)≈0.268；取景按「完整目标 + 少量余量」算距离
  head: { target: [0, 1.42, 0], theta: 0, phi: Math.PI / 2, radius: 0.85 },  // 含全部头发
  half: { target: [0, 1.15, 0], theta: 0, phi: Math.PI / 2, radius: 1.7 },   // 全头 + 大部分衣服
  full: { target: [0, 0.85, 0], theta: 0, phi: Math.PI / 2, radius: 3.2 },   // 从头到脚
};
