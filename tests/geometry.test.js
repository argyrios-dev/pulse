import test from "node:test";
import assert from "node:assert/strict";
import {
  primitive,
  rotate4,
  identity,
  transformVertex,
  sectionMesh,
  project4,
  makeObject,
  validateProject,
  sampleTransform,
} from "../src/geometry.js";
test("regular polytopes have exact vertex, edge and face counts", () => {
  for (const [type, v, e, f] of [
    ["tesseract", 16, 32, 24],
    ["simplex", 5, 10, 10],
    ["cross", 8, 24, 32],
    ["cell24", 24, 96, 96],
  ]) {
    const mesh = primitive(type);
    assert.equal(mesh.vertices.length, v);
    assert.equal(mesh.edges.length, e);
    assert.equal(mesh.faces.length, f);
    const lengths = mesh.edges.map(([a, b]) =>
      Math.hypot(...mesh.vertices[a].map((x, i) => x - mesh.vertices[b][i])),
    );
    assert.ok(lengths.every((x) => Math.abs(x - lengths[0]) < 1e-10));
  }
});
test("six-plane rotation preserves the Euclidean norm", () => {
  const v = [0.3, -2, 4, 1.1],
    out = rotate4(v, [23, -70, 12, 51, 180, 33]);
  assert.ok(Math.abs(Math.hypot(...v) - Math.hypot(...out)) < 1e-12);
  assert.deepEqual(transformVertex(v, identity()), v);
});
test("a central tesseract cross-section produces a cube", () => {
  const m = primitive("tesseract"),
    slice = sectionMesh(m.vertices, m.faces, 0);
  assert.equal(slice.points.length, 8);
  assert.equal(slice.segments.length, 12);
  assert.ok(slice.points.every((p) => p.every((x) => Math.abs(x) === 1)));
  assert.equal(sectionMesh(m.vertices, m.faces, 2).points.length, 0);
});
test("4D perspective handles camera-plane clipping", () => {
  assert.deepEqual(project4([1, 2, 3, 0]), [1, 2, 3]);
  assert.deepEqual(project4([1, 2, 3, 2.5]), [2, 4, 6]);
  assert.equal(project4([1, 2, 3, 5]), null);
  assert.deepEqual(project4([1, 2, 3, 9], "orthographic"), [1, 2, 3]);
});
test("keyframes interpolate transforms and clamp at boundaries", () => {
  const o = makeObject("simplex"),
    a = identity(),
    b = identity();
  b.position[3] = 2;
  b.rotation[3] = 180;
  o.keyframes = [
    { frame: 1, transform: a },
    { frame: 101, transform: b },
  ];
  assert.equal(sampleTransform(o, 51).rotation[3], 90);
  assert.equal(sampleTransform(o, 51).position[3], 1);
  assert.equal(sampleTransform(o, 240).position[3], 2);
});
test("project validation preserves valid geometry and rejects malformed imports", () => {
  const p = {
    format: "pulse4d",
    version: 1,
    name: "Test",
    objects: [makeObject("tesseract")],
  };
  assert.deepEqual(validateProject(p), p);
  const bad = structuredClone(p);
  bad.objects[0].edges[0] = [0, 999];
  assert.throws(() => validateProject(bad), /edges/);
  const nan = structuredClone(p);
  nan.objects[0].vertices[0][0] = NaN;
  assert.throws(() => validateProject(nan), /vertices/);
  const ids = structuredClone(p);
  ids.objects.push(structuredClone(ids.objects[0]));
  assert.throws(() => validateProject(ids), /identity/);
});
