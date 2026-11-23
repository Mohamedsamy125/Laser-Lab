import {Quaternion, Vector3} from './vendor/three.module.js';

const BODY = [
  ['Hips', 'Spine', .15], ['Spine', 'Spine1', .15], ['Spine1', 'Spine2', .16],
  ['Spine2', 'Neck', .18], ['Neck', 'Head', .10], ['Head', 'HeadTop_End', .13], ['HeadTop_End', null, .10],
];
const SIDE = [
  ['Shoulder', 'Arm', .10], ['Arm', 'ForeArm', .10], ['ForeArm', 'Hand', .09], ['Hand', null, .09],
  ['UpLeg', 'Leg', .12], ['Leg', 'Foot', .10], ['Foot', 'ToeBase', .08], ['ToeBase', null, .06],
];

export const CORPSE_LIFETIME = 2.1;

export class RobotFall {
  constructor(model, impulse, floorY, navigation) {
    this.floorY = floorY;
    this.navigation = navigation;
    this.nodes = [];
    this.links = [];
    this.remaining = 0;
    this.scratch = new Vector3();
    this.direction = new Vector3();
    this.parentRotation = new Quaternion();
    this.swing = new Quaternion();

    model.updateWorldMatrix(true, true);
    const list = [...BODY];
    for (const side of ['Left', 'Right']) {
      list.push(...SIDE.map(([bone, child, radius]) => [side + bone, child && side + child, radius]));
    }
    const bones = new Map();
    model.traverse(bone => {
      if (bone.isBone) bones.set(bone.name.replace(/^mixamorig:?/, ''), bone);
    });
    const joints = new Map();
    for (const [name, child, radius] of list) {
      const bone = bones.get(name);
      if (!bone) continue;
      const position = bone.getWorldPosition(new Vector3());
      const height = Math.max(0, position.y - floorY);
      const previous = position.clone().addScaledVector(impulse, -(0.23 + height * .48) / 60);
      const joint = {name, bone, child, radius, position, previous, rotation: bone.quaternion.clone()};
      joints.set(name, joint);
      this.nodes.push(joint);
    }
    this.hips = joints.get('Hips');
    if (!this.hips) return;

    const addLink = (a, b, stiffness = 1) => {
      if (!a || !b) return;
      this.links.push({a, b, length: a.position.distanceTo(b.position), stiffness});
    };
    for (const joint of this.nodes) {
      const parent = joints.get(joint.bone.parent?.name.replace(/^mixamorig:?/, ''));
      addLink(parent, joint);
      joint.tip = joints.get(joint.child);
      if (joint.tip) joint.restAxis = joint.tip.bone.position.clone().normalize().applyQuaternion(joint.rotation);
    }
    // Cross-brace the pelvis and shoulders, keeping the torso from folding
    // through itself. Smaller braces let the elbows and knees give on impact.
    for (const [a, b, stiffness] of [
      ['LeftUpLeg', 'RightUpLeg', 1], ['LeftShoulder', 'RightShoulder', 1],
      ['LeftUpLeg', 'Spine1', .8], ['RightUpLeg', 'Spine1', .8],
      ['LeftShoulder', 'Neck', .8], ['RightShoulder', 'Neck', .8],
      ['LeftArm', 'LeftHand', .26], ['RightArm', 'RightHand', .26],
      ['LeftUpLeg', 'LeftFoot', .30], ['RightUpLeg', 'RightFoot', .30],
    ]) addLink(joints.get(a), joints.get(b), stiffness);
    this.nodes.sort((a, b) => {
      const depth = node => { let n = 0; for (let bone = node.bone.parent; bone?.isBone; bone = bone.parent) n++; return n; };
      return depth(a) - depth(b);
    });
  }

  update(dt) {
    if (!this.hips) return;
    const step = 1 / 60;
    this.remaining += Math.min(dt, .085);
    while (this.remaining >= step) {
      this.remaining -= step;
      this.integrate(step);
    }
    const {bone, position} = this.hips;
    bone.position.copy(bone.parent.worldToLocal(this.scratch.copy(position)));
    for (const joint of this.nodes) {
      if (!joint.tip || joint.restAxis.lengthSq() < .001) continue;
      joint.bone.getWorldPosition(this.scratch);
      const direction = this.direction.copy(joint.tip.position).sub(this.scratch);
      if (direction.lengthSq() < .00001) continue;
      joint.bone.parent.getWorldQuaternion(this.parentRotation).invert();
      direction.normalize().applyQuaternion(this.parentRotation);
      joint.bone.quaternion.copy(this.swing.setFromUnitVectors(joint.restAxis, direction)).multiply(joint.rotation);
    }
  }

  integrate(step) {
    for (const joint of this.nodes) {
      const {position, previous, radius} = joint;
      const grounded = position.y <= this.floorY + radius + .005;
      this.scratch.subVectors(position, previous).multiplyScalar(grounded ? .70 : .975);
      previous.copy(position);
      position.add(this.scratch);
      position.y -= 9.8 * step * step;
    }
    for (let pass = 0; pass < 6; pass++) {
      for (const {a, b, length, stiffness} of this.links) {
        this.scratch.subVectors(b.position, a.position);
        const distance = this.scratch.length();
        if (distance < .00001) continue;
        this.scratch.multiplyScalar((1 - length / distance) * .5 * stiffness);
        a.position.add(this.scratch);
        b.position.sub(this.scratch);
      }
      const hip = this.hips.position;
      if (!this.navigation.walkable(hip)) {
        const previous = this.hips.previous;
        const dx = previous.x - hip.x, dz = previous.z - hip.z;
        for (const {position} of this.nodes) {
          position.x += dx;
          position.z += dz;
        }
      }
      for (const {position, radius} of this.nodes) position.y = Math.max(position.y, this.floorY + radius);
    }
  }
}
