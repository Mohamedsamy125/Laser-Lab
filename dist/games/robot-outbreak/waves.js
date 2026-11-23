// Counts living enemies only. Pending replacements never exceed the active cap.
export class WaveQueue {
  constructor(total, cap) {
    if (!Number.isInteger(total) || total < 1 || !Number.isInteger(cap) || cap < 1) throw new Error('Invalid wave limits');
    this.total = total; this.cap = Math.min(cap, total); this.spawned = 0; this.defeated = 0; this.live = new Set();
  }
  get pending() { return this.total - this.spawned; }
  get complete() { return this.defeated === this.total && this.live.size === 0; }
  get slots() { return Math.min(this.cap - this.live.size, this.pending); }
  spawn(id) {
    if (this.live.has(id) || this.slots <= 0) return false;
    this.live.add(id); this.spawned++; return true;
  }
  defeat(id) {
    if (!this.live.delete(id)) return false;
    this.defeated++; return true;
  }
}
// Grid navigation over the actual floor pieces, excluding inflated solid obstacles.
export class FloorNavigation {
  constructor(floors, obstacles, step = .45, radius = .30) {
    this.step = step; this.floors = floors; this.obstacles = obstacles;
    this.minX = Math.min(...floors.map(f => f.minX)); this.minZ = Math.min(...floors.map(f => f.minZ));
    this.cols = Math.ceil((Math.max(...floors.map(f => f.maxX)) - this.minX) / step) + 1;
    this.rows = Math.ceil((Math.max(...floors.map(f => f.maxZ)) - this.minZ) / step) + 1;
    this.grid = new Uint8Array(this.cols * this.rows);
    for (let z = 0; z < this.rows; z++) for (let x = 0; x < this.cols; x++) {
      const px = this.minX + x * step, pz = this.minZ + z * step;
      const onFloor = floors.some(f => px >= f.minX - .03 && px <= f.maxX + .03 && pz >= f.minZ - .03 && pz <= f.maxZ + .03);
      const blocked = obstacles.some(o => px > o.minX - radius && px < o.maxX + radius && pz > o.minZ - radius && pz < o.maxZ + radius);
      this.grid[z * this.cols + x] = onFloor && !blocked ? 1 : 0;
    }
  }
  point(i) { return { x: this.minX + (i % this.cols) * this.step, z: this.minZ + Math.floor(i / this.cols) * this.step }; }
  nearby(p, radius) {
    const c = Math.ceil(radius / this.step);
    const x = Math.round((p.x - this.minX) / this.step), z = Math.round((p.z - this.minZ) / this.step);
    const result = [];
    for (let row = Math.max(0, z - c); row <= Math.min(this.rows - 1, z + c); row++) {
      for (let col = Math.max(0, x - c); col <= Math.min(this.cols - 1, x + c); col++) {
        const i = row * this.cols + col;
        if (!this.grid[i]) continue;
        const point = this.point(i);
        if ((point.x - p.x) ** 2 + (point.z - p.z) ** 2 <= radius ** 2) result.push(point);
      }
    }
    return result;
  }
  walkable(p) {
    const x = Math.round((p.x - this.minX) / this.step), z = Math.round((p.z - this.minZ) / this.step);
    return x >= 0 && x < this.cols && z >= 0 && z < this.rows && this.grid[z * this.cols + x] === 1;
  }
  nearest(p) {
    const x = Math.round((p.x - this.minX) / this.step), z = Math.round((p.z - this.minZ) / this.step);
    let best = -1, d = Infinity;
    for (let r = 0; r <= 12; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= this.cols || zz >= this.rows) continue;
        const i = zz * this.cols + xx; if (!this.grid[i]) continue;
        const q = this.point(i), next = (q.x-p.x)**2 + (q.z-p.z)**2;
        if (next < d) { d = next; best = i; }
      }
      if (best >= 0) break;
    }
    return best;
  }
  path(from, to, blocked = null) {
    const start = this.nearest(from), goal = this.nearest(to);
    if (start < 0 || goal < 0) return [];
    const availability = blocked && new Uint8Array(this.grid.length);
    const usable = i => {
      if (!this.grid[i]) return false;
      if (!availability || i === start) return true;
      if (!availability[i]) availability[i] = blocked(this.point(i)) ? 1 : 2;
      return availability[i] === 2;
    };
    if (!usable(goal)) return [];
    const open = new Set([start]), closed = new Set(), parent = new Map(), g = new Map([[start, 0]]);
    const heuristic = i => { const a=this.point(i), b=this.point(goal);return Math.hypot(a.x-b.x,a.z-b.z); };
    const f = new Map([[start, heuristic(start)]]);
    let budget = this.grid.length * 2;
    while (open.size && budget-- > 0) {
      let current = -1, cost = Infinity;
      for (const i of open) if (f.get(i) < cost) { current = i; cost = f.get(i); }
      if (current === goal) {
        const result=[];let i=current;
        while (i !== start) { result.push(this.point(i));i=parent.get(i); }
        result.reverse(); return [this.point(start), ...result];
      }
      open.delete(current); closed.add(current);
      const x=current%this.cols,z=Math.floor(current/this.cols);
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
        const xx=x+dx,zz=z+dz;if(xx<0||zz<0||xx>=this.cols||zz>=this.rows)continue;
        const next=zz*this.cols+xx;if(!usable(next)||closed.has(next))continue;
        if(dx&&dz&&(!usable(z*this.cols+xx)||!usable(zz*this.cols+x)))continue;
        const value=g.get(current)+this.step*(dx&&dz?Math.SQRT2:1);
        if(value >= (g.get(next)??Infinity))continue;
        parent.set(next,current);g.set(next,value);f.set(next,value+heuristic(next));open.add(next);
      }
    }
    return [];
  }
}
