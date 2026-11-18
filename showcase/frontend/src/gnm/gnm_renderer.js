// GNM Phase 4：复用现有 Avatar 的 Three.js WebGLRenderer 与同一个 canvas。
// 不创建第二个 WebGL context；VRM 由 Avatar 暂停后，由本 renderer 绘制 GNM mesh。
import * as THREE from "three";

export class GnmRenderer {
  constructor(avatar) {
    if (!avatar?.renderer) throw new Error("GnmRenderer requires the shared Avatar renderer");
    this.avatar = avatar;
    this.renderer = avatar.renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.01, 10);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x667788, 1.8);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1.2, 1.8, 2.2);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.55);
    rim.position.set(-1.5, 0.8, -1.2);
    this.scene.add(hemi, key, rim);

    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.MeshStandardMaterial({
      color: 0xd8b59a,
      roughness: 0.72,
      metalness: 0.0,
      flatShading: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.scene.add(this.mesh);
    this._center = new THREE.Vector3(0, 0.24, 0.03);
    this._radius = 0.38;
  }

  setModel(model) {
    const positions = new Float32Array(model.templateVertexPositions);
    const indices = new Uint32Array(model.triangles.length);
    for (let i = 0; i < model.triangles.length; i++) indices[i] = model.triangles[i];
    this.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingBox();
    const box = this.geometry.boundingBox;
    if (box) {
      box.getCenter(this._center);
      this._radius = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
    }
    this.camera.position.set(this._center.x, this._center.y + 0.015, this._center.z + Math.max(0.55, this._radius * 2.2));
    this.camera.lookAt(this._center);
    this.resize();
  }

  setVertices(vertices) {
    const attr = this.geometry.getAttribute("position");
    if (!attr || attr.array.length !== vertices.length) return;
    attr.array.set(vertices);
    attr.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  resize() {
    const parent = this.avatar.canvas?.parentElement;
    const w = parent?.clientWidth || 1;
    const h = parent?.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.scene.clear();
  }
}
