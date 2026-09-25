import { transformVertex, project4, sectionMesh, rotate4 } from "./geometry.js";
export class Renderer {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.state = state;
    this.width = 1;
    this.height = 1;
    this.hits = [];
    this.camera = {
      yaw: 0.55,
      pitch: 0.32,
      zoom: 1,
      pan: [0, 0],
      target: [0, 0, 0],
    };
    this.dirty = true;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.width = r.width;
    this.height = r.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = true;
  }
  cameraPoint(p) {
    const { yaw, pitch, target } = this.camera;
    const x = p[0] - target[0],
      y = p[1] - target[1],
      z = p[2] - target[2];
    const rx = x * Math.cos(yaw) + z * Math.sin(yaw),
      rz = -x * Math.sin(yaw) + z * Math.cos(yaw);
    return [
      rx,
      y * Math.cos(pitch) - rz * Math.sin(pitch),
      y * Math.sin(pitch) + rz * Math.cos(pitch),
    ];
  }
  screen(p) {
    if (!p) return null;
    const q = this.cameraPoint(p);
    const depth = 9 - q[2];
    if (depth < 0.15) return null;
    const scale =
      (Math.min(this.width, this.height) * 0.22 * this.camera.zoom * 9) / depth;
    return {
      x: this.width / 2 + q[0] * scale + this.camera.pan[0],
      y: this.height / 2 - q[1] * scale + this.camera.pan[1],
      z: q[2],
    };
  }
  line(a, b, color, width = 1) {
    if (!a || !b) return;
    const c = this.ctx;
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke();
  }
  frame() {
    const points = this.state.objects
      .filter((o) => o.visible)
      .flatMap((o) =>
        o.vertices.map((v) =>
          project4(
            transformVertex(v, o.transform),
            this.state.projection,
            this.state.distance,
          ),
        ),
      )
      .filter(Boolean);
    if (!points.length) return;
    const mins = [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i]))),
      maxs = [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i])));
    this.camera.target = mins.map((x, i) => (x + maxs[i]) / 2);
    const radius = Math.max(
      ...points.map((p) =>
        Math.hypot(...p.map((v, i) => v - this.camera.target[i])),
      ),
    );
    this.camera.zoom = Math.min(2.5, 1.7 / Math.max(radius, 0.5));
    this.camera.pan = [0, 0];
    this.dirty = true;
  }
  draw() {
    const { ctx: c, width: w, height: h, state: s } = this;
    c.clearRect(0, 0, w, h);
    const bg = c.createRadialGradient(
      w * 0.51,
      h * 0.42,
      10,
      w * 0.5,
      h * 0.5,
      Math.max(w, h) * 0.75,
    );
    bg.addColorStop(0, "#222c29");
    bg.addColorStop(0.6, "#1a211f");
    bg.addColorStop(1, "#161b1b");
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    if (s.grid) {
      for (let i = -14; i <= 14; i++) {
        const alpha = Math.abs(i) > 8 ? "0c" : "16";
        this.line(
          this.screen([i, -1.85, -14]),
          this.screen([i, -1.85, 14]),
          "#809886" + alpha,
          0.65,
        );
        this.line(
          this.screen([-14, -1.85, i]),
          this.screen([14, -1.85, i]),
          "#809886" + alpha,
          0.65,
        );
      }
      this.line(
        this.screen([-14, -1.85, 0]),
        this.screen([14, -1.85, 0]),
        "#bd6f6738",
        0.8,
      );
      this.line(
        this.screen([0, -1.85, -14]),
        this.screen([0, -1.85, 14]),
        "#6c93b13b",
        0.8,
      );
    }
    this.hits = [];
    let primitives = [];
    let total = 0;
    for (const o of s.objects) {
      if (!o.visible) continue;
      total += o.vertices.length;
      const selected = o.id === s.selectedId;
      const verts = o.vertices.map((v) => transformVertex(v, o.transform));
      const projected = verts.map((v) => project4(v, s.projection, s.distance));
      const pts = projected.map((v) => this.screen(v));
      const opacity = s.section ? 0.24 : 1;
      if (s.shading === "solid")
        for (const face of o.faces) {
          const fp = face.map((i) => pts[i]);
          if (fp.some((p) => !p)) continue;
          primitives.push({
            kind: "face",
            points: fp,
            z: fp.reduce((n, p) => n + p.z, 0) / fp.length,
            color: o.color,
            alpha: (selected ? 0.024 : 0.014) * opacity,
          });
        }
      for (const [a, b] of o.edges) {
        if (!pts[a] || !pts[b]) continue;
        const avW = (verts[a][3] + verts[b][3]) / 2;
        primitives.push({
          kind: "edge",
          a: pts[a],
          b: pts[b],
          z: (pts[a].z + pts[b].z) / 2,
          color: selected ? (avW < -0.3 ? "#78977d" : o.color) : o.color,
          alpha: (selected ? 0.7 : 0.45) * opacity,
          width: selected ? 1.15 : 0.8,
        });
      }
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!p) continue;
        this.hits.push({ ...p, index: i, objectId: o.id });
        if (s.vertices || s.mode === "edit")
          primitives.push({
            kind: "vertex",
            p,
            z: p.z,
            color:
              s.vertexSelection.has(i) && selected && s.mode === "edit"
                ? "#ffffff"
                : o.color,
            r:
              s.vertexSelection.has(i) && selected && s.mode === "edit" ? 4 : 2,
            alpha: (selected ? 0.92 : 0.45) * opacity,
          });
      }
      if (s.section) {
        const slice = sectionMesh(verts, o.faces, s.slice);
        for (const [a, b] of slice.segments) {
          const pa = this.screen(a),
            pb = this.screen(b);
          if (pa && pb)
            primitives.push({
              kind: "edge",
              a: pa,
              b: pb,
              z: (pa.z + pb.z) / 2,
              color: "#d2acf5",
              alpha: 0.95,
              width: 2,
            });
        }
        for (const p of slice.points) {
          const q = this.screen(p);
          if (q)
            primitives.push({
              kind: "vertex",
              p: q,
              z: q.z,
              color: "#eed7ff",
              r: 3,
              alpha: 1,
            });
        }
      }
    }
    primitives.sort((a, b) => a.z - b.z);
    for (const p of primitives) {
      c.globalAlpha = p.alpha;
      if (p.kind === "face") {
        c.beginPath();
        p.points.forEach((v, i) =>
          i ? c.lineTo(v.x, v.y) : c.moveTo(v.x, v.y),
        );
        c.closePath();
        c.fillStyle = p.color;
        c.fill();
      } else if (p.kind === "edge") this.line(p.a, p.b, p.color, p.width);
      else {
        c.beginPath();
        c.arc(p.p.x, p.p.y, p.r, 0, Math.PI * 2);
        c.fillStyle = p.color;
        c.fill();
      }
    }
    c.globalAlpha = 1;
    if (s.mode === "edit") {
      c.font = "9px monospace";
      c.fillStyle = "#eef5e6";
      for (const p of this.hits)
        if (p.objectId === s.selectedId && s.vertexSelection.has(p.index))
          c.fillText(String(p.index), p.x + 7, p.y - 7);
    }
    this.dirty = false;
    return total;
  }
  pick(x, y, verticesOnly = false) {
    let best = null,
      bestDist = verticesOnly ? 14 : 24;
    for (const p of this.hits) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  }
}
export function drawThumbnail(canvas, mesh) {
  const c = canvas.getContext("2d"),
    w = 110,
    h = 96;
  canvas.width = w;
  canvas.height = h;
  c.clearRect(0, 0, w, h);
  const pts = mesh.vertices.map((v) => {
    const q = project4(rotate4(v, [0, 10, 0, 25, 15, 0]));
    const x = q[0] * 0.8 + q[2] * 0.5,
      y = q[1] * 0.85 - q[2] * 0.25;
    return [w / 2 + x * 17, h / 2 - y * 17];
  });
  for (const [a, b] of mesh.edges) {
    c.beginPath();
    c.moveTo(...pts[a]);
    c.lineTo(...pts[b]);
    c.strokeStyle = "#a2b79a";
    c.lineWidth = 1.3;
    c.stroke();
  }
  for (const p of pts) {
    c.beginPath();
    c.arc(...p, 1.8, 0, Math.PI * 2);
    c.fillStyle = "#c1d9ae";
    c.fill();
  }
}
