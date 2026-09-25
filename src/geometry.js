export const AXES = ["X", "Y", "Z", "W"];
export const PLANES = [
  [0, 1],
  [0, 2],
  [1, 2],
  [0, 3],
  [1, 3],
  [2, 3],
];
export const PLANE_NAMES = ["XY", "XZ", "YZ", "XW", "YW", "ZW"];
export const PRIMITIVES = [
  { type: "tesseract", name: "Tesseract", subtitle: "8-cell · Hypercube" },
  { type: "simplex", name: "5-cell", subtitle: "4-simplex" },
  { type: "cross", name: "16-cell", subtitle: "Hexadecachoron" },
  { type: "cell24", name: "24-cell", subtitle: "Icositetrachoron" },
];
export function distance2(a, b) {
  return a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
}
function triangles(vertices, edges) {
  const set = new Set(edges.map((e) => e.join(",")));
  const faces = [];
  for (let a = 0; a < vertices.length; a++)
    for (let b = a + 1; b < vertices.length; b++)
      for (let c = b + 1; c < vertices.length; c++)
        if (
          set.has(`${a},${b}`) &&
          set.has(`${a},${c}`) &&
          set.has(`${b},${c}`)
        )
          faces.push([a, b, c]);
  return faces;
}
export function primitive(type) {
  let vertices = [],
    edges = [],
    faces = [];
  if (type === "tesseract") {
    vertices = Array.from({ length: 16 }, (_, i) =>
      AXES.map((_, j) => ((i >> j) & 1 ? 1 : -1)),
    );
    for (let a = 0; a < 16; a++)
      for (let b = a + 1; b < 16; b++)
        if (((a ^ b) & ((a ^ b) - 1)) === 0) edges.push([a, b]);
    for (let a = 0; a < 4; a++)
      for (let b = a + 1; b < 4; b++)
        for (let i = 0; i < 16; i++)
          if (!(i & (1 << a)) && !(i & (1 << b)))
            faces.push([
              i,
              i | (1 << a),
              i | (1 << a) | (1 << b),
              i | (1 << b),
            ]);
  } else if (type === "simplex") {
    vertices = Array.from({ length: 5 }, (_, i) =>
      Array.from({ length: 4 }, (_, j) =>
        i <= j
          ? 1 / Math.sqrt((j + 1) * (j + 2))
          : i === j + 1
            ? -(j + 1) / Math.sqrt((j + 1) * (j + 2))
            : 0,
      ).map((x) => x * 1.8),
    );
    for (let a = 0; a < 5; a++)
      for (let b = a + 1; b < 5; b++) edges.push([a, b]);
    faces = triangles(vertices, edges);
  } else if (type === "cross") {
    for (let axis = 0; axis < 4; axis++)
      for (const sign of [-1, 1])
        vertices.push(AXES.map((_, j) => (j === axis ? sign * 1.6 : 0)));
    for (let a = 0; a < 8; a++)
      for (let b = a + 1; b < 8; b++)
        if (Math.floor(a / 2) !== Math.floor(b / 2)) edges.push([a, b]);
    faces = triangles(vertices, edges);
  } else if (type === "cell24") {
    for (let a = 0; a < 4; a++)
      for (let b = a + 1; b < 4; b++)
        for (const sa of [-1, 1])
          for (const sb of [-1, 1])
            vertices.push(
              AXES.map((_, j) => (j === a ? sa : j === b ? sb : 0)),
            );
    for (let a = 0; a < 24; a++)
      for (let b = a + 1; b < 24; b++)
        if (Math.abs(distance2(vertices[a], vertices[b]) - 2) < 1e-6)
          edges.push([a, b]);
    faces = triangles(vertices, edges);
  } else if (type !== "custom") throw new Error("Unknown primitive");
  return { vertices, edges, faces };
}
export function rotate4(v, angles) {
  const out = [...v];
  PLANES.forEach(([a, b], i) => {
    const t = (angles[i] * Math.PI) / 180,
      c = Math.cos(t),
      s = Math.sin(t),
      x = out[a],
      y = out[b];
    out[a] = x * c - y * s;
    out[b] = x * s + y * c;
  });
  return out;
}
export function transformVertex(v, t) {
  return rotate4(
    v.map((x, i) => x * t.scale[i]),
    t.rotation,
  ).map((x, i) => x + t.position[i]);
}
export function project4(v, mode = "perspective", distance = 5) {
  const d = distance - v[3];
  if (mode === "perspective" && d < 0.15) return null;
  const s = mode === "perspective" ? distance / d : 1;
  return v.slice(0, 3).map((x) => x * s);
}
export function identity() {
  return {
    position: [0, 0, 0, 0],
    scale: [1, 1, 1, 1],
    rotation: [0, 0, 0, 0, 0, 0],
  };
}
export function makeObject(type, index = 1) {
  return {
    id: crypto.randomUUID(),
    name:
      (PRIMITIVES.find((p) => p.type === type)?.name || "Mesh") +
      (index > 1 ? `.${String(index - 1).padStart(3, "0")}` : ""),
    type,
    color: "#b7f56b",
    visible: true,
    ...primitive(type),
    transform: identity(),
    keyframes: [],
  };
}
export function sectionMesh(vertices, faces, w) {
  const segments = [],
    points = [],
    pointKeys = new Set();
  const eps = 1e-7;
  const addPoint = (p) => {
    const key = p.map((v) => Math.round(v / eps)).join(",");
    if (!pointKeys.has(key)) {
      pointKeys.add(key);
      points.push(p);
    }
  };
  for (const face of faces) {
    const hits = [];
    const add = (p) => {
      if (!hits.some((q) => distance2(p, q) < eps)) hits.push(p);
      addPoint(p);
    };
    for (let k = 0; k < face.length; k++) {
      const a = vertices[face[k]],
        b = vertices[face[(k + 1) % face.length]],
        da = a[3] - w,
        db = b[3] - w;
      if (Math.abs(da) < eps) add(a.slice(0, 3));
      if (da * db < -eps) {
        const t = da / (da - db);
        add(a.slice(0, 3).map((x, i) => x + t * (b[i] - x)));
      }
    }
    if (hits.length === 2) segments.push(hits);
    else if (hits.length > 2)
      for (let i = 0; i < hits.length; i++)
        segments.push([hits[i], hits[(i + 1) % hits.length]]);
  }
  return { segments, points };
}
export function sampleTransform(object, frame) {
  const keys = object.keyframes;
  if (!keys.length) return structuredClone(object.transform);
  const sorted = [...keys].sort((a, b) => a.frame - b.frame);
  if (frame <= sorted[0].frame) return structuredClone(sorted[0].transform);
  if (frame >= sorted.at(-1).frame)
    return structuredClone(sorted.at(-1).transform);
  const hi = sorted.findIndex((k) => k.frame >= frame),
    a = sorted[hi - 1],
    b = sorted[hi],
    t = (frame - a.frame) / (b.frame - a.frame);
  return Object.fromEntries(
    ["position", "scale", "rotation"].map((key) => [
      key,
      a.transform[key].map((v, i) => v + (b.transform[key][i] - v) * t),
    ]),
  );
}
export function validateProject(data) {
  const fail = (message) => {
    throw new Error(message);
  };
  if (!data || data.format !== "pulse4d" || data.version !== 1)
    fail("This is not a supported Pulse project.");
  if (typeof data.name !== "string" || data.name.length > 100)
    fail("Invalid project name.");
  if (!Array.isArray(data.objects) || data.objects.length > 50)
    fail("Projects support up to 50 objects.");
  const nums = (v, n, limit = 10000) =>
    Array.isArray(v) &&
    v.length === n &&
    v.every(
      (x) =>
        typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= limit,
    );
  const transform = (t) =>
    t &&
    nums(t.position, 4) &&
    nums(t.rotation, 6, 36000) &&
    nums(t.scale, 4, 100);
  const ids = new Set();
  let totalVertices = 0,
    totalEdges = 0,
    totalFaces = 0;
  for (const o of data.objects) {
    if (
      !o ||
      typeof o.id !== "string" ||
      ids.has(o.id) ||
      o.id.length > 100 ||
      typeof o.name !== "string" ||
      o.name.length > 100
    )
      fail("Invalid object identity.");
    ids.add(o.id);
    if (
      !Array.isArray(o.vertices) ||
      o.vertices.length > 2000 ||
      !o.vertices.every((v) => nums(v, 4))
    )
      fail("Invalid 4D vertices (maximum 2,000 per object).");
    const indices = (arr, min, max) =>
      Array.isArray(arr) &&
      arr.length >= min &&
      arr.length <= max &&
      arr.every(
        (v) => Number.isInteger(v) && v >= 0 && v < o.vertices.length,
      ) &&
      new Set(arr).size === arr.length;
    if (
      !Array.isArray(o.edges) ||
      o.edges.length > 10000 ||
      !o.edges.every((e) => indices(e, 2, 2))
    )
      fail("Invalid mesh edges.");
    if (
      !Array.isArray(o.faces) ||
      o.faces.length > 10000 ||
      !o.faces.every((f) => indices(f, 3, 16))
    )
      fail("Invalid mesh faces.");
    totalVertices += o.vertices.length;
    totalEdges += o.edges.length;
    totalFaces += o.faces.length;
    if (totalVertices > 10000 || totalEdges > 30000 || totalFaces > 30000)
      fail("Project exceeds the geometry budget.");
    if (
      !transform(o.transform) ||
      typeof o.color !== "string" ||
      !/^#[a-fA-F0-9]{6}$/.test(o.color) ||
      typeof o.visible !== "boolean"
    )
      fail("Invalid object properties.");
    if (
      !Array.isArray(o.keyframes) ||
      o.keyframes.length > 240 ||
      !o.keyframes.every(
        (k) =>
          k &&
          Number.isInteger(k.frame) &&
          k.frame >= 1 &&
          k.frame <= 240 &&
          transform(k.transform),
      ) ||
      new Set(o.keyframes.map((k) => k.frame)).size !== o.keyframes.length
    )
      fail("Invalid animation keyframes.");
  }
  // Keep only supported data, discarding unknown imported fields.
  return {
    format: "pulse4d",
    version: 1,
    name: data.name,
    objects: data.objects.map((o) => ({
      id: o.id,
      name: o.name,
      type: PRIMITIVES.some((p) => p.type === o.type) ? o.type : "custom",
      vertices: o.vertices.map((v) => [...v]),
      edges: o.edges.map((e) => [...e]),
      faces: o.faces.map((f) => [...f]),
      transform: structuredClone(o.transform),
      color: o.color,
      visible: o.visible,
      keyframes: structuredClone(o.keyframes),
    })),
  };
}
