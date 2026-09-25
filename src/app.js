import {
  AXES,
  PLANE_NAMES,
  PRIMITIVES,
  primitive,
  makeObject,
  identity,
  transformVertex,
  project4,
  sampleTransform,
  validateProject,
} from "./geometry.js";
import { Renderer, drawThumbnail } from "./renderer.js";
import { icon, hydrate } from "./icons.js";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const STORAGE = "pulse.workspace.v1";
const initial = makeObject("tesseract");
initial.transform.rotation = [0, 0, 0, 25, 12, 0];
const state = {
  name: "Untitled exploration",
  objects: [initial],
  selectedId: initial.id,
  vertexSelection: new Set(),
  mode: "object",
  tool: "orbit",
  grid: true,
  vertices: true,
  shading: "solid",
  projection: "perspective",
  distance: 5,
  section: false,
  slice: 0,
  frame: 1,
  playing: false,
  spin: false,
  workspace: "model",
};
let storageError = false;
try {
  const stored = localStorage.getItem(STORAGE);
  if (stored) {
    const p = validateProject(JSON.parse(stored));
    state.name = p.name;
    state.objects = p.objects;
    state.selectedId = p.objects[0]?.id;
  }
} catch {
  storageError = true;
}
const renderer = new Renderer($("#canvas"), state);
const history = [],
  future = [];
let saveTimer,
  toastTimer,
  lastTime = 0,
  frameFloat = 1,
  pointer = null;
const selected = () => state.objects.find((o) => o.id === state.selectedId);
const project = () => ({
  format: "pulse4d",
  version: 1,
  name: state.name,
  objects: state.objects,
});
const snapshot = () => JSON.stringify(project());
function checkpoint() {
  const str = snapshot();
  if (history.at(-1) !== str) {
    history.push(str);
    if (history.length > 60) history.shift();
  }
  future.length = 0;
}
function save() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE, snapshot());
    $("#save-state").textContent = "Saved locally";
    storageError = false;
  } catch {
    $("#save-state").textContent = "Export to save";
    storageError = true;
  }
}
function changed(refresh = true) {
  renderer.dirty = true;
  $("#save-state").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 300);
  if (refresh) renderUI();
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 3400);
  $("#status-text").textContent = message;
}
function stopMotion() {
  if (state.spin) {
    state.spin = false;
  }
  state.playing = false;
  $("#spin-button").classList.remove("active");
  $("#spin-button").innerHTML = icon("Play") + "Auto-rotate";
  $("#play-button").innerHTML = icon("Play");
  $("#play-button").setAttribute("aria-label", "Play animation");
}
function restore(data) {
  state.name = data.name;
  state.objects = data.objects;
  state.selectedId = state.objects.some((o) => o.id === state.selectedId)
    ? state.selectedId
    : state.objects[0]?.id;
  state.vertexSelection.clear();
  stopMotion();
  changed();
}
function undo() {
  if (!history.length) return toast("Nothing to undo.");
  future.push(snapshot());
  restore(JSON.parse(history.pop()));
  toast("Undo");
}
function redo() {
  if (!future.length) return toast("Nothing to redo.");
  history.push(snapshot());
  restore(JSON.parse(future.pop()));
  toast("Redo");
}
function setTool(tool) {
  state.tool = tool;
  $$("[data-tool]").forEach((b) =>
    b.classList.toggle("active", b.dataset.tool === tool),
  );
  if (tool === "select") {
    state.mode = "edit";
    $("#mode").value = "edit";
    renderInspector();
  }
  $("#canvas").style.cursor =
    tool === "orbit" ? "grab" : tool === "select" ? "crosshair" : "move";
  const hints = {
    orbit: "Drag to orbit · Shift + drag to pan",
    select: "Click a vertex · Shift + click for multiple vertices",
    move: "Drag to move in X / Y · Edit W in Properties",
    rotate: "Drag to rotate in XW / YW",
    scale: "Drag to scale all four axes",
  };
  $("#status-text").textContent = hints[tool];
  renderer.dirty = true;
}
function addObject(type) {
  if (state.objects.length >= 50)
    return toast("A project supports up to 50 objects.");
  stopMotion();
  checkpoint();
  const o = makeObject(
    type,
    state.objects.filter((o) => o.type === type).length + 1,
  );
  if (state.objects.length)
    o.transform.position[0] = state.objects.length * 2.8;
  o.transform.rotation[3] = 25;
  state.objects.push(o);
  state.selectedId = o.id;
  state.vertexSelection.clear();
  changed();
  renderer.frame();
  toast(`${o.name} added`);
}
function selectObject(id) {
  state.selectedId = id;
  state.vertexSelection.clear();
  renderUI();
  renderer.dirty = true;
}
function deleteObject() {
  const o = selected();
  if (!o) return;
  checkpoint();
  state.objects = state.objects.filter((x) => x.id !== o.id);
  state.selectedId = state.objects.at(-1)?.id;
  state.vertexSelection.clear();
  changed();
  toast(`${o.name} deleted · Ctrl/⌘ Z to undo`);
}
function duplicate() {
  const o = selected();
  if (!o) return;
  checkpoint();
  const dupe = structuredClone(o);
  dupe.id = crypto.randomUUID();
  dupe.name = (o.name + " copy").slice(0, 100);
  dupe.transform.position[0] += 2.5;
  if (state.objects.length >= 50) return toast("Object limit reached.");
  state.objects.push(dupe);
  state.selectedId = dupe.id;
  state.vertexSelection.clear();
  changed();
  renderer.frame();
  toast("Object duplicated");
}
function renderOutliner() {
  $("#object-count").textContent = state.objects.length;
  $("#outliner").innerHTML = state.objects
    .map(
      (o) =>
        `<button class="scene-object ${o.id === state.selectedId ? "selected" : ""} ${!o.visible ? "hidden-object" : ""}" data-select="${escape(o.id)}" title="Select ${escape(o.name)}">${icon("Box")}<span class="object-name">${escape(o.name)}</span><span class="visibility" role="button" tabindex="0" data-visibility="${escape(o.id)}" aria-label="${o.visible ? "Hide" : "Show"} ${escape(o.name)}">${icon(o.visible ? "Eye" : "EyeOff")}</span></button>`,
    )
    .join("");
}
function coordInputs(values, group, labels = AXES) {
  return `<div class="${group === "rotation" ? "rotation-grid" : "coordinates"}">${values.map((v, i) => `<label class="coordinate"><span>${labels[i]}</span><input type="number" step="${group === "rotation" ? 1 : 0.1}" value="${Number(v.toFixed(3))}" data-group="${group}" data-index="${i}" aria-label="${group} ${labels[i]}" ${group === "scale" ? 'min="0.01" max="100"' : ""}></label>`).join("")}</div>`;
}
function renderInspector() {
  const o = selected();
  if (!o) {
    $("#inspector").innerHTML =
      '<p class="no-selection">Select a mesh or add a primitive to begin.</p>';
    return;
  }
  const vs = [...state.vertexSelection].filter((i) => i < o.vertices.length);
  $("#inspector").innerHTML =
    `<div class="inspector-object">${icon("Box")}<div><input id="object-name" aria-label="Object name" maxlength="100" value="${escape(o.name)}"><small>${escape(PRIMITIVES.find((p) => p.type === o.type)?.subtitle || "Custom 4D mesh")}</small></div><button class="icon-button" data-action="duplicate" title="Duplicate object" aria-label="Duplicate object">${icon("Copy")}</button></div><section class="property-section"><div class="section-heading">${icon("Move3d")}Transform<button class="icon-button" data-action="reset-transform" aria-label="Reset transform" title="Reset transform">${icon("RotateCcw")}</button></div><label class="field-label">Position</label>${coordInputs(o.transform.position, "position")}<label class="field-label">Rotation <span class="muted">/ degrees</span></label>${coordInputs(o.transform.rotation, "rotation", PLANE_NAMES)}<label class="field-label">Scale</label>${coordInputs(o.transform.scale, "scale")}</section>${state.mode === "edit" ? `<section class="property-section"><div class="section-heading">${icon("Waypoints")}Mesh editing <span class="muted">${vs.length} selected</span></div>${vs.length === 1 ? `<label class="field-label">Vertex ${vs[0]} · Local coordinates</label>${coordInputs(o.vertices[vs[0]], "vertex")}` : `<p class="vertex-help">${vs.length ? "Connect two vertices or extrude a selection along W." : "Click a vertex in the viewport. Shift + click to select more."}</p>`}<div class="mesh-actions"><button data-action="add-vertex">${icon("Plus")}Vertex</button><button data-action="connect" ${vs.length !== 2 ? "disabled" : ""}>${icon("Link")}Connect</button><button data-action="extrude" ${!vs.length ? "disabled" : ""}>${icon("GitBranch")}Extrude W</button><button data-action="delete-vertices" ${!vs.length ? "disabled" : ""}>${icon("Trash2")}Delete</button></div></section>` : ""}<section class="property-section"><div class="inline-field"><span>Wire color</span><input type="color" id="object-color" aria-label="Object wire color" value="${o.color}"></div></section>`;
}
function renderUI() {
  renderOutliner();
  renderInspector();
  $("#project-name").textContent = state.name;
  const o = selected();
  $("#selection-label").textContent = o
    ? `Collection / ${o.name}`
    : "Collection / No selection";
  $("#object-badge").textContent = o?.name || "No object";
  $("#geometry-count").textContent = o
    ? `${o.vertices.length} vertices · ${o.edges.length} edges`
    : "";
  $("#stats").textContent =
    `${state.objects.reduce((n, o) => n + o.vertices.length, 0)} verts`;
  $("#empty-scene").hidden = state.objects.length > 0;
  syncRotation();
  renderTimeline();
}
function syncRotation() {
  const o = selected(),
    angle = o?.transform.rotation[3] || 0;
  $("#quick-xw").value = angle;
  $("#quick-xw-value").textContent = Math.round(angle) + "°";
  if (document.activeElement?.dataset.group !== "rotation")
    $$('[data-group="rotation"]').forEach(
      (el, i) =>
        (el.value = Number((o?.transform.rotation[i] || 0).toFixed(1))),
    );
}
function renderTimeline() {
  const keys = selected()?.keyframes || [];
  $("#key-count").textContent =
    `${keys.length} keyframe${keys.length === 1 ? "" : "s"}`;
  $("#key-markers").innerHTML = keys
    .map(
      (k) =>
        `<div class="key-marker" style="left:${((k.frame - 1) / 239) * 100}%" title="Frame ${k.frame}"></div>`,
    )
    .join("");
  syncFrame();
}
function syncFrame() {
  $("#frame").value = state.frame;
  $("#frame-label").textContent = String(state.frame).padStart(3, "0");
  $("#playhead").style.left = ((state.frame - 1) / 239) * 100 + "%";
  $("#playhead span").textContent = state.frame;
}
function seek(frame) {
  state.frame = frame;
  frameFloat = frame;
  for (const o of state.objects)
    if (o.keyframes.length) o.transform = sampleTransform(o, frame);
  syncFrame();
  renderInspector();
  syncRotation();
  renderer.dirty = true;
}
function insertKey() {
  const o = selected();
  if (!o) return;
  stopMotion();
  checkpoint();
  o.keyframes = o.keyframes.filter((k) => k.frame !== state.frame);
  o.keyframes.push({
    frame: state.frame,
    transform: structuredClone(o.transform),
  });
  changed();
  toast(`Transform keyed at frame ${state.frame}`);
}
function deleteKey() {
  const o = selected();
  if (!o) return;
  checkpoint();
  o.keyframes = o.keyframes.filter((k) => k.frame !== state.frame);
  changed();
  toast(`Key removed at frame ${state.frame}`);
}
function togglePlay() {
  if (state.playing) {
    state.playing = false;
    changed();
    $("#play-button").innerHTML = icon("Play");
    $("#play-button").setAttribute("aria-label", "Play animation");
    return;
  }
  if (!state.objects.some((o) => o.keyframes.length >= 2))
    return toast("Insert keys at two different frames, then press Play.");
  stopMotion();
  checkpoint();
  state.playing = true;
  if (state.frame >= 240) {
    state.frame = 1;
    frameFloat = 1;
  }
  $("#play-button").innerHTML = icon("Pause");
  $("#play-button").setAttribute("aria-label", "Pause animation");
  toast("Playing transform animation · 24 fps");
}
function toggleSpin() {
  if (!selected()) return;
  if (state.spin) {
    state.spin = false;
    changed();
    $("#spin-button").classList.remove("active");
    $("#spin-button").innerHTML = icon("Play") + "Auto-rotate";
    return;
  }
  stopMotion();
  checkpoint();
  state.spin = true;
  $("#spin-button").classList.add("active");
  $("#spin-button").innerHTML = icon("Pause") + "Pause rotation";
}
function setWorkspace(name) {
  state.workspace = name;
  state.section = name === "section";
  $("#section-enabled").checked = state.section;
  $("#section-indicator").hidden = !state.section;
  $$("[data-workspace]").forEach((el) =>
    el.classList.toggle("active", el.dataset.workspace === name),
  );
  $("#view-label").textContent = state.section
    ? "W cross-section"
    : "User perspective";
  renderer.dirty = true;
  if (name === "animate")
    toast("Set a transform, insert a key, then repeat at another frame.");
}
function download(content, name, type = "application/json") {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const safeName = () =>
  state.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") ||
  "pulse-project";
function saveProject() {
  download(JSON.stringify(project(), null, 2), safeName() + ".pulse4d");
  save();
  toast("4D project exported — includes geometry and keyframes");
}
function exportOBJ() {
  let text = "# Pulse: 3D projection of spatial 4D geometry\n",
    offset = 1;
  for (const o of state.objects.filter((o) => o.visible)) {
    text += `o ${o.name.replace(/[^a-z0-9_-]/gi, "_")}\n`;
    const pts = o.vertices.map((v) =>
      project4(
        transformVertex(v, o.transform),
        state.projection,
        state.distance,
      ),
    );
    const map = new Map();
    pts.forEach((p, i) => {
      if (p) {
        map.set(i, offset++);
        text += `v ${p.map((n) => n.toFixed(6)).join(" ")}\n`;
      }
    });
    for (const f of o.faces)
      if (f.every((i) => map.has(i)))
        text += "f " + f.map((i) => map.get(i)).join(" ") + "\n";
    for (const e of o.edges)
      if (e.every((i) => map.has(i)))
        text += "l " + e.map((i) => map.get(i)).join(" ") + "\n";
  }
  download(text, safeName() + ".obj", "text/plain");
  toast("Projected 3D mesh exported as OBJ");
}
function exportPNG() {
  renderer.draw();
  $("#canvas").toBlob((blob) => {
    if (blob) {
      download(blob, safeName() + ".png");
      toast("Viewport image exported");
    } else toast("Image export failed. Try again.");
  }, "image/png");
}
function showDialog(title, content, eyebrow = "PULSE WORKSPACE") {
  $("#dialog-eyebrow").textContent = eyebrow;
  $("#dialog-content").innerHTML = `<h1>${title}</h1>${content}`;
  $("#dialog").showModal();
  hydrate($("#dialog"));
}
function help() {
  showDialog(
    "A little beyond ordinary.",
    `<p>Welcome to Pulse. Build and explore geometry with four spatial coordinates: X, Y, Z and W. The viewport projects that geometry into 3D, then onto your screen.</p><div class="help-grid"><div class="help-card">${icon("Orbit")}<strong>Make room for W.</strong><p>Drag the XW slider to reveal the tesseract. All six rotation planes are editable in Properties.</p></div><div class="help-card">${icon("MousePointer2")}<strong>Shape it yourself.</strong><p>Switch to Vertex Mode. Click a point to edit XYZW coordinates; Shift + click selects multiple points.</p></div><div class="help-card">${icon("ScanLine")}<strong>Look through a dimension.</strong><p>Cross-section intersects mesh faces at W. Move the slice to explore the resulting 3D wireframe.</p></div><div class="help-card">${icon("Film")}<strong>Set things in motion.</strong><p>Insert a transform key, scrub to another frame, change the transform and insert another. Play at 24 fps.</p></div></div><div class="shortcut-list"><span><kbd>Q</kbd> Orbit</span><span><kbd>V</kbd> Vertex mode</span><span><kbd>G</kbd> Move</span><span><kbd>R</kbd> 4D rotate</span><span><kbd>S</kbd> Scale</span><span><kbd>F</kbd> Frame</span><span><kbd>I</kbd> Keyframe</span><span><kbd>⌘/Ctrl K</kbd> Commands</span></div><p class="small-note">Projects are saved in this browser. Export a .pulse4d file for a portable backup. OBJ exports the current 3D projection. This first release supports polytope meshes and transform animation; it is not a full Blender replacement.</p><div class="dialog-actions"><button class="primary" data-action="close-dialog">Start exploring ${icon("ArrowRight")}</button></div>`,
    "WELCOME TO THE FOURTH DIMENSION",
  );
}
function renameProject() {
  showDialog(
    "Name your exploration.",
    `<input class="dialog-input" id="new-project-name" maxlength="100" aria-label="Project name" value="${escape(state.name)}"><div class="dialog-actions"><button data-action="close-dialog">Cancel</button><button class="primary" data-action="confirm-rename">Save name</button></div>`,
  );
  $("#new-project-name").select();
}
function newProject() {
  showDialog(
    "Start a fresh space?",
    `<p>Your current scene will be replaced. Export a copy first if you want to keep it. You can also undo this action.</p><div class="dialog-actions"><button data-action="save">Export current project</button><button class="primary" data-action="confirm-new">Create project</button></div>`,
  );
}
const commands = [
  ["New project", "new", "FilePlus", ""],
  ["Open project…", "open", "FolderInput", "⌘ O"],
  ["Save 4D project", "save", "Save", "⌘ S"],
  ["Export viewport PNG", "png", "Image", ""],
  ["Export projected OBJ", "obj", "FileBox", ""],
  ["Undo", "undo", "Undo2", "⌘ Z"],
  ["Redo", "redo", "Redo2", "⇧ ⌘ Z"],
  ["Duplicate object", "duplicate", "Copy", "⇧ D"],
  ["Delete object", "delete-object", "Trash2", "Del"],
  ["Frame scene", "frame", "Focus", "F"],
  ["Toggle grid", "grid", "Grid3x3", ""],
  ["Toggle auto-rotation", "spin", "Orbit", ""],
  ["Insert keyframe", "keyframe", "DiamondPlus", "I"],
  ["Delete current keyframe", "delete-key", "Diamond", ""],
  ["Add tesseract", "add-tesseract", "Box", ""],
  ["Add 5-cell", "add-simplex", "Pyramid", ""],
  ["Add 16-cell", "add-cross", "Diamond", ""],
  ["Add 24-cell", "add-cell24", "Waypoints", ""],
  ["Quick guide", "help", "CircleHelp", "?"],
];
function commandPalette() {
  showDialog(
    "Find your next move.",
    `<input id="command-search" class="dialog-input" placeholder="Search tools, shapes and actions…" aria-label="Search commands"><div class="command-list" id="command-list"></div>`,
    "COMMAND PALETTE",
  );
  filterCommands("");
  $("#command-search").focus();
}
function filterCommands(q) {
  $("#command-list").innerHTML =
    commands
      .filter((c) => c[0].toLowerCase().includes(q.toLowerCase()))
      .map(
        (c) => `<button data-command="${c[1]}">${icon(c[2])}${c[0]}</button>`,
      )
      .join("") || "<p>No matching commands.</p>";
}
function menu(kind, anchor) {
  const ids = {
    file: ["new", "open", "save", "png", "obj"],
    edit: ["undo", "redo", "duplicate", "delete-object", "delete-key"],
    view: ["frame", "grid", "spin", "help"],
    export: ["save", "png", "obj"],
    add: ["add-tesseract", "add-simplex", "add-cross", "add-cell24"],
  }[kind];
  const el = $("#menu");
  el.innerHTML = ids
    .map((id) => commands.find((c) => c[1] === id))
    .map(
      (c) =>
        `<button data-action="${c[1]}">${icon(c[2])}${c[0]}${c[3] ? `<kbd>${c[3]}</kbd>` : ""}</button>`,
    )
    .join("");
  el.hidden = false;
  const r = anchor.getBoundingClientRect();
  el.style.left = Math.min(r.left, innerWidth - 230) + "px";
  el.style.top =
    Math.min(r.bottom + 5, innerHeight - el.offsetHeight - 10) + "px";
}
function editMesh(action) {
  const o = selected();
  if (!o) return;
  stopMotion();
  const indices = [...state.vertexSelection].filter(
    (i) => i < o.vertices.length,
  );
  if (action === "connect" && indices.length !== 2) return;
  if (["extrude", "delete-vertices"].includes(action) && !indices.length)
    return;
  if (o.vertices.length + Math.max(indices.length, 1) > 2000)
    return toast("This mesh has reached its vertex limit.");
  checkpoint();
  if (action === "add-vertex") {
    o.vertices.push([0, 0, 0, 0]);
    state.vertexSelection = new Set([o.vertices.length - 1]);
  }
  if (action === "connect") {
    const [a, b] = indices;
    if (!o.edges.some((e) => e.includes(a) && e.includes(b)))
      o.edges.push([a, b]);
  }
  if (action === "extrude") {
    const map = new Map();
    for (const i of indices) {
      map.set(i, o.vertices.length);
      const v = [...o.vertices[i]];
      v[3] += 0.5;
      o.vertices.push(v);
    }
    const edges = [...o.edges];
    for (const [a, b] of edges)
      if (map.has(a) && map.has(b)) {
        o.edges.push([map.get(a), map.get(b)]);
        o.faces.push([a, b, map.get(b), map.get(a)]);
      }
    for (const [old, n] of map) o.edges.push([old, n]);
    state.vertexSelection = new Set(map.values());
  }
  if (action === "delete-vertices") {
    const removed = new Set(indices),
      map = new Map();
    o.vertices = o.vertices.filter((v, i) => {
      if (removed.has(i)) return false;
      map.set(i, map.size);
      return true;
    });
    o.edges = o.edges
      .filter((e) => e.every((i) => map.has(i)))
      .map((e) => e.map((i) => map.get(i)));
    o.faces = o.faces
      .filter((f) => f.every((i) => map.has(i)))
      .map((f) => f.map((i) => map.get(i)));
    state.vertexSelection.clear();
  }
  o.type = "custom";
  changed();
  toast(
    {
      connect: "Vertices connected",
      extrude: "Selection extruded +0.5 along W",
      "add-vertex": "Vertex added at origin",
      "delete-vertices": "Selected vertices deleted",
    }[action],
  );
}
function dispatch(action, el) {
  if (action.endsWith("-menu")) {
    menu(action.replace("-menu", ""), el);
    return;
  }
  $("#menu").hidden = true;
  if (
    action.startsWith("add-") &&
    ["tesseract", "simplex", "cross", "cell24", "custom"].includes(
      action.slice(4),
    )
  )
    return addObject(action.slice(4));
  if (["connect", "extrude", "add-vertex", "delete-vertices"].includes(action))
    return editMesh(action);
  const actions = {
    undo,
    redo,
    duplicate,
    "delete-object": deleteObject,
    frame: () => {
      renderer.frame();
      toast("Scene framed");
    },
    grid: () => {
      state.grid = !state.grid;
      $("#grid-button").classList.toggle("active", state.grid);
      renderer.dirty = true;
    },
    vertices: () => {
      state.vertices = !state.vertices;
      $("#vertices-button").classList.toggle("active", state.vertices);
      renderer.dirty = true;
    },
    wire: () => shade("wire"),
    solid: () => shade("solid"),
    spin: toggleSpin,
    keyframe: insertKey,
    "delete-key": deleteKey,
    play: togglePlay,
    rewind: () => {
      stopMotion();
      checkpoint();
      seek(1);
      changed();
    },
    end: () => {
      stopMotion();
      checkpoint();
      seek(240);
      changed();
    },
    save: saveProject,
    png: exportPNG,
    obj: exportOBJ,
    open: () => $("#file-input").click(),
    help,
    commands: commandPalette,
    "rename-project": renameProject,
    new: newProject,
    "close-dialog": () => $("#dialog").close(),
    "confirm-rename": () => {
      const name = $("#new-project-name").value.trim();
      if (!name) return;
      checkpoint();
      state.name = name;
      changed();
      $("#dialog").close();
    },
    "confirm-new": () => {
      checkpoint();
      const o = makeObject("tesseract");
      o.transform.rotation[3] = 25;
      restore({ name: "Untitled exploration", objects: [o] });
      renderer.frame();
      $("#dialog").close();
    },
    "reset-transform": () => {
      const o = selected();
      if (o) {
        stopMotion();
        checkpoint();
        o.transform = identity();
        changed();
      }
    },
  };
  actions[action]?.();
}
function shade(value) {
  state.shading = value;
  $("#wire-button").classList.toggle("active", value === "wire");
  $("#solid-button").classList.toggle("active", value === "solid");
  renderer.dirty = true;
}
document.addEventListener("click", (e) => {
  const visibility = e.target.closest("[data-visibility]");
  if (visibility) {
    checkpoint();
    const o = state.objects.find((o) => o.id === visibility.dataset.visibility);
    o.visible = !o.visible;
    changed();
    return;
  }
  const object = e.target.closest("[data-select]");
  if (object) {
    selectObject(object.dataset.select);
    return;
  }
  const cmd = e.target.closest("[data-command]");
  if (cmd) {
    $("#dialog").close();
    dispatch(cmd.dataset.command, cmd);
    return;
  }
  const action = e.target.closest("[data-action]");
  if (action) {
    dispatch(action.dataset.action, action);
    return;
  }
  const tool = e.target.closest("[data-tool]");
  if (tool) {
    setTool(tool.dataset.tool);
    return;
  }
  const workspace = e.target.closest("[data-workspace]");
  if (workspace) {
    setWorkspace(workspace.dataset.workspace);
    return;
  }
  const primitive = e.target.closest("[data-primitive]");
  if (primitive) {
    addObject(primitive.dataset.primitive);
    return;
  }
  if (!e.target.closest("#menu")) $("#menu").hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (
    e.target.matches("[data-visibility]") &&
    (e.key === "Enter" || e.key === " ")
  ) {
    e.preventDefault();
    e.target.click();
  }
});
$("#mode").addEventListener("change", (e) => {
  state.mode = e.target.value;
  if (state.mode === "edit") setTool("select");
  else setTool("orbit");
  state.vertexSelection.clear();
  renderInspector();
  renderer.dirty = true;
});
$("#inspector").addEventListener("change", (e) => {
  const o = selected();
  if (!o) return;
  const el = e.target;
  if (el.dataset.group) {
    const group = el.dataset.group,
      index = Number(el.dataset.index),
      value = Number(el.value);
    const limit =
      group === "rotation" ? 36000 : group === "scale" ? 100 : 10000;
    if (
      !Number.isFinite(value) ||
      Math.abs(value) > limit ||
      (group === "scale" && value < 0.01)
    ) {
      toast("Value is outside the supported range.");
      renderInspector();
      return;
    }
    stopMotion();
    checkpoint();
    if (group === "vertex") {
      const i = [...state.vertexSelection][0];
      if (o.vertices[i]) o.vertices[i][index] = value;
      o.type = "custom";
    } else o.transform[group][index] = value;
    changed();
  } else if (el.id === "object-name") {
    checkpoint();
    o.name = el.value.trim() || "Mesh";
    changed();
  } else if (el.id === "object-color") {
    checkpoint();
    o.color = el.value;
    changed();
  }
});
$("#quick-xw").addEventListener("pointerdown", () => {
  stopMotion();
  checkpoint();
});
$("#quick-xw").addEventListener("keydown", (e) => {
  if (e.key.startsWith("Arrow")) {
    stopMotion();
    checkpoint();
  }
});
$("#quick-xw").addEventListener("input", (e) => {
  const o = selected();
  if (!o) return;
  o.transform.rotation[3] = Number(e.target.value);
  syncRotation();
  changed(false);
});
$("#projection").addEventListener("change", (e) => {
  state.projection = e.target.value;
  $("#projection-label").textContent =
    `4D ${state.projection.toUpperCase()} → 3D`;
  renderer.dirty = true;
});
$("#w-distance").addEventListener("input", (e) => {
  state.distance = Number(e.target.value);
  $("#w-distance-value").textContent = state.distance.toFixed(1);
  renderer.dirty = true;
});
$("#section-enabled").addEventListener("change", (e) =>
  setWorkspace(e.target.checked ? "section" : "model"),
);
$("#slice").addEventListener("input", (e) => {
  state.slice = Number(e.target.value);
  $("#slice-value").textContent = state.slice.toFixed(2);
  $("#section-value").textContent = state.slice.toFixed(2);
  renderer.dirty = true;
});
$("#frame").addEventListener("pointerdown", () => {
  stopMotion();
  checkpoint();
});
$("#frame").addEventListener("input", (e) => seek(Number(e.target.value)));
$("#frame").addEventListener("change", () => changed(false));
$("#dialog").addEventListener("input", (e) => {
  if (e.target.id === "command-search") filterCommands(e.target.value);
});
$("#dialog").addEventListener("click", (e) => {
  if (e.target === $("#dialog")) {
    const r = e.target.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      e.target.close();
  }
});
$("#file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > 8 * 1024 * 1024)
    return toast("Project exceeds the 8 MB limit.");
  try {
    const data = validateProject(JSON.parse(await file.text()));
    checkpoint();
    restore(data);
    renderer.frame();
    toast(`Opened ${data.name}`);
  } catch (err) {
    toast("Could not open project: " + err.message);
  }
});
let lastPointerPositions = new Map();
$("#canvas").addEventListener("pointerdown", (e) => {
  if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
  const c = $("#canvas");
  c.setPointerCapture(e.pointerId);
  lastPointerPositions.set(e.pointerId, [e.clientX, e.clientY]);
  if (lastPointerPositions.size > 1) {
    pointer = null;
    return;
  }
  const rect = c.getBoundingClientRect();
  pointer = {
    x: e.clientX,
    y: e.clientY,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
    tool: e.shiftKey || e.button === 1 || e.button === 2 ? "pan" : state.tool,
    object: selected() ? structuredClone(selected().transform) : null,
    changed: false,
  };
  if (["move", "rotate", "scale"].includes(pointer.tool)) {
    stopMotion();
    checkpoint();
  }
  c.style.cursor = "grabbing";
});
$("#canvas").addEventListener("pointermove", (e) => {
  const old = lastPointerPositions.get(e.pointerId);
  if (!old) return;
  if (lastPointerPositions.size === 2) {
    const other = [...lastPointerPositions.entries()].find(
      ([id]) => id !== e.pointerId,
    )?.[1];
    if (other) {
      const a = Math.hypot(old[0] - other[0], old[1] - other[1]),
        b = Math.hypot(e.clientX - other[0], e.clientY - other[1]);
      if (a > 0)
        renderer.camera.zoom = Math.max(
          0.05,
          Math.min(8, (renderer.camera.zoom * b) / a),
        );
      renderer.dirty = true;
    }
    lastPointerPositions.set(e.pointerId, [e.clientX, e.clientY]);
    return;
  }
  lastPointerPositions.set(e.pointerId, [e.clientX, e.clientY]);
  if (!pointer) return;
  const dx = e.clientX - pointer.x,
    dy = e.clientY - pointer.y;
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  if (Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY) > 3)
    pointer.moved = true;
  const o = selected();
  if (pointer.tool === "pan") {
    renderer.camera.pan[0] += dx;
    renderer.camera.pan[1] += dy;
  } else if (pointer.tool === "orbit") {
    renderer.camera.yaw += dx * 0.007;
    renderer.camera.pitch = Math.max(
      -1.5,
      Math.min(1.5, renderer.camera.pitch + dy * 0.007),
    );
  } else if (o && pointer.object) {
    if (pointer.tool === "move") {
      o.transform.position[0] =
        pointer.object.position[0] +
        ((e.clientX - pointer.startX) * 0.01) / renderer.camera.zoom;
      o.transform.position[1] =
        pointer.object.position[1] -
        ((e.clientY - pointer.startY) * 0.01) / renderer.camera.zoom;
    } else if (pointer.tool === "rotate") {
      o.transform.rotation[3] =
        pointer.object.rotation[3] + (e.clientX - pointer.startX) * 0.5;
      o.transform.rotation[4] =
        pointer.object.rotation[4] + (e.clientY - pointer.startY) * 0.5;
    } else if (pointer.tool === "scale") {
      const factor = Math.exp(
        (e.clientX - pointer.startX - (e.clientY - pointer.startY)) * 0.005,
      );
      o.transform.scale = pointer.object.scale.map((x) =>
        Math.max(0.01, Math.min(100, x * factor)),
      );
    }
    pointer.changed = true;
    syncRotation();
  }
  renderer.dirty = true;
});
function releasePointer(e) {
  lastPointerPositions.delete(e.pointerId);
  if (pointer) {
    if (!pointer.moved) {
      const r = $("#canvas").getBoundingClientRect(),
        hit = renderer.pick(
          e.clientX - r.left,
          e.clientY - r.top,
          state.mode === "edit",
        );
      if (hit) {
        if (state.selectedId !== hit.objectId) {
          state.selectedId = hit.objectId;
          state.vertexSelection.clear();
        }
        if (state.mode === "edit") {
          if (!e.shiftKey) state.vertexSelection.clear();
          if (state.vertexSelection.has(hit.index))
            state.vertexSelection.delete(hit.index);
          else state.vertexSelection.add(hit.index);
        }
        renderUI();
        renderer.dirty = true;
      } else if (state.mode === "edit" && !e.shiftKey) {
        state.vertexSelection.clear();
        renderInspector();
        renderer.dirty = true;
      }
    }
    if (pointer.changed) changed();
    pointer = null;
  }
  $("#canvas").style.cursor = state.tool === "select" ? "crosshair" : "grab";
}
$("#canvas").addEventListener("pointerup", releasePointer);
$("#canvas").addEventListener("pointercancel", (e) => {
  lastPointerPositions.delete(e.pointerId);
  if (pointer?.changed) changed();
  pointer = null;
});
$("#canvas").addEventListener("contextmenu", (e) => e.preventDefault());
$("#canvas").addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    renderer.camera.zoom = Math.max(
      0.05,
      Math.min(8, renderer.camera.zoom * Math.exp(-e.deltaY * 0.001)),
    );
    renderer.dirty = true;
  },
  { passive: false },
);
document.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase(),
    mod = e.ctrlKey || e.metaKey,
    typing = e.target.matches("input,textarea,select,[contenteditable]");
  if ($("#dialog").open) {
    if (key === "enter" && e.target.id === "new-project-name")
      dispatch("confirm-rename");
    if (key === "enter" && e.target.id === "command-search")
      $("#command-list button")?.click();
    return;
  }
  if (typing) return;
  const map = {
    q: () => setTool("orbit"),
    v: () => {
      state.mode = "edit";
      $("#mode").value = "edit";
      setTool("select");
    },
    g: () => setTool("move"),
    r: () => setTool("rotate"),
    s: () => setTool("scale"),
    f: () => dispatch("frame"),
    i: insertKey,
    " ": togglePlay,
    "?": help,
  };
  if (mod) {
    if (key === "s") {
      e.preventDefault();
      saveProject();
    } else if (key === "o") {
      e.preventDefault();
      $("#file-input").click();
    } else if (key === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (key === "k") {
      e.preventDefault();
      commandPalette();
    }
    return;
  }
  if (e.shiftKey && key === "d") {
    e.preventDefault();
    duplicate();
    return;
  }
  if (key === "delete" || key === "backspace") {
    e.preventDefault();
    state.mode === "edit" ? editMesh("delete-vertices") : deleteObject();
    return;
  }
  if (key === "escape") {
    $("#menu").hidden = true;
    state.vertexSelection.clear();
    renderInspector();
    renderer.dirty = true;
    return;
  }
  if (map[key]) {
    e.preventDefault();
    map[key]();
  }
});
$("#primitives").innerHTML = PRIMITIVES.map(
  (p) =>
    `<button class="primitive-card" data-primitive="${p.type}" title="Add ${p.name}"><span class="plus">+</span><canvas data-thumb="${p.type}" aria-hidden="true"></canvas><span>${p.name}</span></button>`,
).join("");
$$("[data-thumb]").forEach((el) =>
  drawThumbnail(el, primitive(el.dataset.thumb)),
);
hydrate();
renderUI();
setTool("orbit");
function loop(time) {
  const dt = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;
  if (!document.hidden) {
    if (state.spin && selected()) {
      const o = selected();
      o.transform.rotation[3] =
        ((o.transform.rotation[3] + dt * 17 + 180) % 360) - 180;
      o.transform.rotation[5] =
        ((o.transform.rotation[5] + dt * 7 + 180) % 360) - 180;
      syncRotation();
      renderer.dirty = true;
    }
    if (state.playing) {
      frameFloat += dt * 24;
      if (frameFloat > 240) frameFloat = 1;
      const frame = Math.floor(frameFloat);
      if (frame !== state.frame) {
        state.frame = frame;
        for (const o of state.objects)
          if (o.keyframes.length) o.transform = sampleTransform(o, frame);
        syncFrame();
        syncRotation();
        for (const group of ["position", "scale"])
          $$(`[data-group="${group}"]`).forEach(
            (el, i) =>
              (el.value = Number(
                (selected()?.transform[group][i] || 0).toFixed(3),
              )),
          );
        renderer.dirty = true;
      }
    }
    if (renderer.dirty) renderer.draw();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.addEventListener("pagehide", save);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) save();
});
if (storageError)
  toast(
    "Local project could not be restored. Export projects for a portable backup.",
  );
