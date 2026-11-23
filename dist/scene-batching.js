import * as THREE from './vendor/three.module.js';
import {mergeGeometries} from './vendor/addons/utils/BufferGeometryUtils.js';

// Keep original meshes for exact hit/cover raycasts; render static geometry in
// spatial material batches so distant rooms can still be frustum culled.
export function batchStaticScene(root) {
  root.updateMatrixWorld(true);const buckets=new Map(),originals=[],center=new THREE.Vector3();let before=0;
  root.traverse(mesh=>{
    if(!mesh.isMesh||mesh.isSkinnedMesh)return;
    for(let p=mesh;p;p=p.parent)if(!p.visible)return;
    const geometry=mesh.geometry;if(!geometry.attributes.position)return;
    const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    const base=geometry.index?geometry.toNonIndexed():geometry.clone();
    base.applyMatrix4(mesh.matrixWorld);
    // Baking a mirrored transform removes the renderer's determinant-based
    // front-face correction, so reverse triangle order along with its UVs.
    if(mesh.matrixWorld.determinant()<0)for(const attribute of Object.values(base.attributes)){
      const array=attribute.array,size=attribute.itemSize;
      for(let vertex=0;vertex<attribute.count;vertex+=3)for(let component=0;component<size;component++){
        const a=vertex*size+component,b=(vertex+2)*size+component,value=array[a];array[a]=array[b];array[b]=value;
      }
    }
    base.computeBoundingBox();base.boundingBox.getCenter(center);
    const groups=Array.isArray(mesh.material)?base.groups:[{start:0,count:base.attributes.position.count,materialIndex:0}];
    for(const group of groups){
      const material=materials[group.materialIndex];if(!material)continue;
      const part=new THREE.BufferGeometry();
      for(const [name,attribute]of Object.entries(base.attributes)){
        const array=attribute.array.slice(group.start*attribute.itemSize,(group.start+group.count)*attribute.itemSize);
        part.setAttribute(name,new THREE.BufferAttribute(array,attribute.itemSize,attribute.normalized));
      }
      const schema=Object.keys(part.attributes).sort().join(','),key=material.uuid+':'+Math.floor(center.x/12)+':'+Math.floor(center.z/12)+':'+schema;
      if(!buckets.has(key))buckets.set(key,{material,parts:[]});buckets.get(key).parts.push(part);before++;
    }
    base.dispose();originals.push(mesh);
  });
  const batches=new THREE.Group();batches.name='StaticRenderBatches';
  for(const {material,parts}of buckets.values()){
    const geometry=mergeGeometries(parts,false);if(!geometry)throw new Error('Static geometry batch failed');
    geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,material);mesh.matrixAutoUpdate=false;batches.add(mesh);
    for(const part of parts)part.dispose();
  }
  for(const mesh of originals)mesh.visible=false;
  root.traverse(o=>{o.matrixAutoUpdate=false;});
  return {batches,before,after:batches.children.length};
}
