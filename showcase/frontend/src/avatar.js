// VRM 皮套人渲染（场景设置与映射表照搬自已验证的 viewer/index.html）
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";

function bs(scoreMap, name) {
  return scoreMap.get(name) ?? 0;
}
const clamp = (v) => Math.max(0, Math.min(1, v));

export class Avatar {
  constructor(canvas) {
    this.canvas = canvas;
    this.vrm = null;
    this.ready = false;
    this._headTarget = { x: 0, y: 0, z: 0 };
    this._headCur = { x: 0, y: 0, z: 0 };

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xe0f2fe, 1); // --paper-blue，让皮套人站在「蓝图」上
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
    };
    requestAnimationFrame(tick);
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

  async load(url) {
    const loader = new GLTFLoader();
    loader.register((p) => new VRMLoaderPlugin(p));
    const gltf = await loader.loadAsync(url);
    this.vrm = gltf.userData.vrm;
    this.vrm.scene.rotation.y = Math.PI; // 面向镜头
    this.scene.add(this.vrm.scene);
    this.ready = true;
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
  setBlendshapes(cats) {
    if (!this.vrm || !cats) return;
    const E = this.vrm.expressionManager;
    if (!E) return;
    const m = new Map(cats.map((c) => [c.categoryName, c.score]));
    const blink = Math.max(bs(m, "eyeBlinkLeft"), bs(m, "eyeBlinkRight"));
    const jaw = bs(m, "jawOpen");
    const smile = Math.max(bs(m, "mouthSmileLeft"), bs(m, "mouthSmileRight"));
    const frown = Math.max(bs(m, "mouthFrownLeft"), bs(m, "mouthFrownRight"));
    const browDown = Math.max(bs(m, "browDownLeft"), bs(m, "browDownRight"));
    const browUp = Math.max(
      bs(m, "browInnerUp"), bs(m, "browOuterUpLeft"), bs(m, "browOuterUpRight")
    );
    try {
      E.setValue("blink", clamp(blink));
      E.setValue("aa", clamp(jaw));
      E.setValue("joy", clamp(smile));
      E.setValue("sorrow", clamp(frown));
      E.setValue("angry", clamp(browDown));
      E.setValue("surprise", clamp(browUp * 0.6 + jaw * 0.4));
      E.setValue("lookUp", clamp(bs(m, "eyeLookUpLeft")));
      E.setValue("lookDown", clamp(bs(m, "eyeLookDownLeft")));
      E.setValue("lookLeft", clamp(bs(m, "eyeLookOutLeft")));
      E.setValue("lookRight", clamp(bs(m, "eyeLookOutRight")));
    } catch {}
  }

  // headEuler: {x, y, z} 度（solvePnP 近似值，只做小角度跟随）
  setHeadEuler(headEuler) {
    if (!headEuler) return;
    const rad = (d) => (d * Math.PI) / 180;
    const cap = (v) => Math.max(-0.5, Math.min(0.5, v));
    this._headTarget = {
      x: cap(rad(headEuler.x) * 0.4),
      y: cap(rad(headEuler.y) * 0.5),
      z: cap(rad(headEuler.z) * 0.3),
    };
  }
}

Avatar.VIEWS = {
  // fov=30°，垂直半角 tan(15°)≈0.268；取景按「完整目标 + 少量余量」算距离
  head: { target: [0, 1.42, 0], theta: 0, phi: Math.PI / 2, radius: 0.85 },  // 含全部头发
  half: { target: [0, 1.15, 0], theta: 0, phi: Math.PI / 2, radius: 1.7 },   // 全头 + 大部分衣服
  full: { target: [0, 0.85, 0], theta: 0, phi: Math.PI / 2, radius: 3.2 },   // 从头到脚
};
