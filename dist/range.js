import * as THREE from './vendor/three.module.js';

export class TargetRange {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x111f26);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-5, 5, 3.125, -3.125, 0.1, 100);
    this.camera.position.set(0, 0, 12);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.AmbientLight(0x82a7ad, 1.5));
    const light = new THREE.DirectionalLight(0x96c0ca, 2.0);
    light.position.set(3, 5, 8); this.scene.add(light);
    const grid = new THREE.GridHelper(24, 24, 0x30484d, 0x23373e);
    grid.rotation.x = Math.PI / 2; grid.position.z = -1.2; this.scene.add(grid);
    const positions = [[0.18, 0.23], [0.82, 0.23], [0.5, 0.5], [0.18, 0.77], [0.82, 0.77]];
    this.targets = positions.map(([u, v], i) => this.makeTarget(u, v, i));
    this.raycaster = new THREE.Raycaster();
    this.meshes = this.targets.map(t => t.hitMesh);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }
  makeTarget(u, v, index) {
    const group = new THREE.Group();
    group.position.set(u * 10 - 5, 3.125 - v * 6.25, 0);
    const metal = new THREE.MeshStandardMaterial({ color: 0x3b5456, roughness: 0.7, metalness: 0.4 });
    const hitMaterial = new THREE.MeshStandardMaterial({ color: 0x557772, roughness: 0.7, emissive: 0x081414 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.49, 0.49, 0.13, 32), metal);
    base.rotation.x = Math.PI / 2; group.add(base);
    const hitMesh = new THREE.Mesh(new THREE.CircleGeometry(0.39, 32), hitMaterial);
    hitMesh.position.z = 0.08; hitMesh.userData.index = index; group.add(hitMesh);
    for (const radius of [0.13, 0.28]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.012, 6, 40),
        new THREE.MeshBasicMaterial({ color: 0x314b4b }));
      ring.position.z = 0.10; group.add(ring);
    }
    this.scene.add(group);
    return { group, hitMesh, hitMaterial, hitUntil: 0 };
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) this.renderer.setSize(rect.width, rect.height, false);
  }
  shoot(uv, now) {
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(new THREE.Vector2(uv.x * 2 - 1, 1 - uv.y * 2), this.camera);
    const intersection = this.raycaster.intersectObjects(this.meshes, false)[0];
    if (!intersection) return false;
    const target = this.targets[intersection.object.userData.index];
    target.hitUntil = now + 350;
    return true;
  }
  render(now) {
    for (const target of this.targets) {
      const active = now < target.hitUntil;
      target.hitMaterial.color.setHex(active ? 0x739d94 : 0x557772);
      target.group.scale.setScalar(active ? 1.12 : 1);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
