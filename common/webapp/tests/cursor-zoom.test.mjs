import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {build} from "esbuild";
import {parse} from "@vue/compiler-sfc";

// Bundle the real control modules in memory using the existing frontend dependencies.
// Only Hammer's browser input adapter is stubbed; camera, geometry and control updates are real.
const webapp = fileURLToPath(new URL("../", import.meta.url));
const hammer = `
  export const DIRECTION_ALL = 30, DIRECTION_VERTICAL = 24;
  export class Manager { add() {} on() {} off() {} }
  export class Pan { recognizeWith() {} }
  export class Pinch extends Pan {}
  export class Rotate extends Pan {}
  export class Tap extends Pan {}
`;
const bundled = await build({
    stdin: {
        contents: `
          export {ControlsManager} from "./src/js/controls/ControlsManager.js";
          export {MapControls} from "./src/js/controls/map/MapControls.js";
          export {CursorZoomAnchor} from "./src/js/controls/map/mouse/CursorZoomAnchor.js";
          export {CombinedCamera} from "./src/js/util/CombinedCamera.js";
          export {FreeFlightControls} from "./src/js/controls/freeflight/FreeFlightControls.js";
          export {BlueMapApp} from "./src/js/BlueMapApp.js";
          export {default as ZoomButtons} from "./src/components/Controls/ZoomButtons.vue";
          export {Scene, Mesh, PlaneGeometry, MeshBasicMaterial, DoubleSide, Vector3} from "three";
        `,
        resolveDir: webapp
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    alias: {"@": path.join(webapp, "src")},
    plugins: [{
        name: "headless-input-adapter",
        setup(builder) {
            builder.onResolve({filter: /^three\/(src|addons|examples\/jsm)\//}, ({path: specifier}) => ({
                path: path.join(webapp, "node_modules", specifier.replace("three/addons/", "three/examples/jsm/") +
                    (specifier.endsWith(".js") ? "" : ".js"))
            }));
            builder.onResolve({filter: /^hammerjs$/}, () => ({path: "hammer", namespace: "input-stub"}));
            builder.onLoad({filter: /.*/, namespace: "input-stub"}, () => ({contents: hammer}));
            builder.onLoad({filter: /\.vue$/}, async ({path: filename}) => {
                if (!filename.endsWith("ZoomButtons.vue")) return {contents: "export default {};"};
                const {descriptor, errors} = parse(await readFile(filename, "utf8"));
                assert.equal(errors.length, 0);
                return {contents: descriptor.script.content, loader: "js"};
            });
        }
    }]
});

globalThis.window = new EventTarget();
globalThis.document = {
    createElement: () => ({getContext: () => ({})}),
    querySelector: () => ({setAttribute() {}})
};
globalThis.WheelEvent = {DOM_DELTA_PIXEL: 0, DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2};
globalThis.fetch = async () => ({text: async () => "{}"});
const storage = new Map();
globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
};

try {
    const {
        ControlsManager, MapControls, CursorZoomAnchor, CombinedCamera, FreeFlightControls, BlueMapApp,
        ZoomButtons, Scene, Mesh, PlaneGeometry, MeshBasicMaterial, DoubleSide, Vector3
    } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

    let passed = 0;
    let maxDrift = 0;
    const check = (name, run) => {
        try { run(); passed++; }
        catch (error) { throw new Error(`${name}: ${error.message}`); }
    };
    const close = (actual, expected, tolerance = 1e-8) => {
        assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
    };
    class Root extends EventTarget {
        clientWidth = 1024;
        clientHeight = 640;
        rect = {left: 137, top: 83, width: 1408, height: 880};
        getBoundingClientRect() { return this.rect; }
    }
    function fixture({ortho = 0, angle = 0.8, rotation = 0.7, distance = 180, height = 80,
        exact = true, x = 12000, z = -24000} = {}) {
        const root = new Root();
        const scene = new Scene();
        if (exact) {
            const plane = new Mesh(new PlaneGeometry(20000, 20000), new MeshBasicMaterial({side: DoubleSide}));
            plane.rotateX(-Math.PI * 0.5);
            plane.position.set(x, height, z);
            scene.add(plane);
        }
        const map = {hiresTileManager: {scene}, terrainHeightAt: () => height};
        const events = new EventTarget();
        const loads = [], moves = [];
        const viewer = {
            map, events, data: {loadedLowresViewDistance: 2, loadedHiresViewDistance: 2},
            loadMapArea: (px, pz) => loads.push([px, pz]),
            handleMapInteraction: () => { throw new Error("Wheel zoom dispatched a map interaction"); }
        };
        const camera = new CombinedCamera(50, root.rect.width / root.rect.height, 0.1, 2000, 0);
        const manager = new ControlsManager(viewer, camera);
        const controls = new MapControls(root, root);
        manager.controls = controls;
        manager.position.set(x, height, z);
        manager.distance = distance;
        manager.rotation = rotation;
        manager.angle = angle;
        manager.ortho = ortho;
        controls.mapHeight.targetHeight = Number.isFinite(height) ? height + 3 : 0;
        controls.mapHeight.cameraHeight = Number.isFinite(height) ? height : 0;
        manager.update(16.666, map);
        events.addEventListener("bluemapCameraMoved", () => moves.push(manager.position.clone()));
        loads.length = 0;
        return {root, scene, map, manager, controls, loads, moves,
            dispose: () => { manager.controls = null; }};
    }
    function wheel(f, deltaY, {deltaMode = 0, nx = 0.52, ny = -0.2} = {}) {
        const r = f.root.rect;
        const evt = new Event("wheel", {cancelable: true});
        Object.assign(evt, {
            deltaY, deltaMode,
            clientX: r.left + (nx + 1) * r.width * 0.5,
            clientY: r.top + (1 - ny) * r.height * 0.5
        });
        f.root.dispatchEvent(evt);
        assert.ok(evt.defaultPrevented);
        return evt;
    }
    function project(f, point) {
        f.manager.camera.updateProjectionMatrix();
        f.manager.camera.updateMatrixWorld(true);
        return point.clone().project(f.manager.camera);
    }
    function shiftedRender(f) {
        const camera = f.manager.camera;
        const sx = Math.round(camera.position.x / 10000) * 10000;
        const sz = Math.round(camera.position.z / 10000) * 10000;
        camera.position.x -= sx;
        camera.position.z -= sz;
        camera.updateMatrixWorld(true);
        camera.position.x += sx;
        camera.position.z += sz;
        f.scene.position.set(-sx, 0, -sz);
        f.scene.updateMatrixWorld(true);
    }
    function settle(f, anchor, nx = 0.52, ny = -0.2, frames = 160) {
        for (let i = 0; i < frames; i++) {
            shiftedRender(f);
            const beforeMoves = f.moves.length;
            f.manager.update(16.666, f.map);
            assert.ok(f.moves.length - beforeMoves <= 1, "Duplicate camera-moved events");
            if (f.moves.length > beforeMoves) assert.ok(f.moves.at(-1).equals(f.manager.position));
            if (anchor) {
                const screen = project(f, anchor);
                const drift = Math.hypot((screen.x - nx) * f.root.rect.width * 0.5,
                    (screen.y - ny) * f.root.rect.height * 0.5);
                maxDrift = Math.max(maxDrift, drift);
                assert.ok(drift < 0.0001, `Cursor terrain point drifted ${drift}px in frame ${i}`);
            }
            assert.ok(Number.isFinite(f.manager.distance));
            assert.ok([f.manager.position.x, f.manager.position.y, f.manager.position.z].every(Number.isFinite));
        }
    }

    for (const [name, pose] of [
        ["perspective", {ortho: 0, angle: 0.8}],
        ["flat", {ortho: 1, angle: 0}],
        ["projection transition", {ortho: 0.12, angle: 0}],
        ["maximum-pitch constraint", {ortho: 0, angle: 1.1, distance: 160}],
        ["rotated high coordinates", {ortho: 0, angle: 0.65, rotation: -2.1, x: 1250000, z: -970000}]
    ]) {
        for (const direction of [-120, 120]) check(`${name} zoom ${direction}`, () => {
            const f = fixture(pose);
            try {
                shiftedRender(f);
                wheel(f, direction);
                const anchor = f.controls.mouseZoom.cursorAnchor.anchor?.clone();
                assert.ok(anchor, "No terrain anchor captured");
                close(anchor.y, 80, 1e-7);
                settle(f, anchor);
                assert.equal(f.controls.mouseZoom.cursorAnchor.anchor, null, "Settled anchor was retained");
                if (f.loads.length) {
                    close(f.loads.at(-1)[0], f.manager.lastMapUpdatePosition.x);
                    close(f.loads.at(-1)[1], f.manager.lastMapUpdatePosition.z);
                }
            } finally { f.dispose(); }
        });
    }

    check("distance limit and slow height settlement", () => {
        const f = fixture({distance: 6, angle: 0.2, height: 140});
        try {
            f.controls.mapHeight.targetHeight = 50; // The height spring is intentionally still converging.
            wheel(f, -900);
            const anchor = f.controls.mouseZoom.cursorAnchor.anchor.clone();
            settle(f, anchor, 0.52, -0.2, 300);
            close(f.manager.distance, f.controls.minDistance, 1e-6);
            assert.equal(f.controls.mouseZoom.cursorAnchor.anchor, null);
        } finally { f.dispose(); }
    });
    check("upper distance clamp", () => {
        const f = fixture({distance: 95000, angle: 0, ortho: 1, exact: false, height: 0});
        try {
            wheel(f, 120);
            const anchor = f.controls.mouseZoom.cursorAnchor.anchor.clone();
            settle(f, anchor);
            close(f.manager.distance, f.controls.maxDistance, 1e-6);
        } finally { f.dispose(); }
    });
    check("low-res height field and zero height", () => {
        for (const height of [0, 93]) {
            const f = fixture({distance: 1300, angle: 0, height, exact: false});
            try {
                wheel(f, -120);
                const anchor = f.controls.mouseZoom.cursorAnchor.anchor.clone();
                close(anchor.y, height + 1);
                settle(f, anchor);
            } finally { f.dispose(); }
        }
    });
    check("unloaded terrain target-plane fallback", () => {
        const f = fixture({exact: false, height: false, angle: 0});
        try {
            const targetHeight = f.manager.position.y;
            wheel(f, -120);
            const anchor = f.controls.mouseZoom.cursorAnchor.anchor.clone();
            close(anchor.y, targetHeight);
            settle(f, anchor);
        } finally { f.dispose(); }
    });
    check("height sampling only once per cursor burst", () => {
        const f = fixture({exact: false, angle: 0});
        try {
            let reads = 0;
            f.map.terrainHeightAt = () => { reads++; return 80; };
            wheel(f, -120);
            const captured = reads;
            wheel(f, -60);
            assert.equal(reads, captured);
            wheel(f, -60, {nx: 0.3});
            assert.ok(reads > captured);
        } finally { f.dispose(); }
    });
    check("native delta normalization and smoothing", () => {
        for (const [deltaMode, deltaY, normalized] of [[0, 120, 1.2], [1, 3, 0.99], [2, 1, 1]]) {
            const f = fixture();
            try {
                wheel(f, deltaY, {deltaMode});
                close(f.controls.mouseZoom.deltaZoom, normalized);
                const distance = f.manager.distance;
                f.controls.mouseZoom.update(16.666, f.map);
                close(f.manager.distance, distance * Math.pow(1.5, normalized * 0.2));
                close(f.controls.mouseZoom.deltaZoom, normalized * 0.8);
            } finally { f.dispose(); }
        }
    });
    check("invalid cursor, viewport and near-horizontal rays", () => {
        const f = fixture();
        try {
            const anchor = new CursorZoomAnchor(f.root);
            for (const [x, y] of [[NaN, 100], [Infinity, 100], [-1, 100]]) {
                assert.equal(anchor.capture(f.manager, x, y, false), false);
            }
            const rect = {...f.root.rect};
            f.root.rect.width = 0;
            assert.equal(anchor.capture(f.manager, rect.left, rect.top, false), false);
            f.root.rect = rect;
            f.manager.angle = Math.PI * 0.5;
            f.manager.updateCamera();
            assert.equal(anchor.capture(f.manager, rect.left + rect.width * 0.5,
                rect.top + rect.height * 0.5, false), false);
            assert.equal(anchor.anchor, null);
            assert.ok([f.manager.position.x, f.manager.position.y, f.manager.position.z].every(Number.isFinite));
        } finally { f.dispose(); }
    });
    check("nonfinite/overflow wheel inputs", () => {
        const f = fixture();
        try {
            wheel(f, NaN);
            wheel(f, Infinity);
            wheel(f, 0);
            assert.equal(f.controls.mouseZoom.deltaZoom, 0);
            const before = f.manager.distance;
            wheel(f, Number.MAX_VALUE, {deltaMode: 2});
            f.manager.update(16.666, f.map);
            close(f.manager.distance, before);
            assert.equal(f.controls.mouseZoom.cursorAnchor.anchor, null);
        } finally { f.dispose(); }
    });

    for (const [name, interact] of [
        ["mouse down", f => f.root.dispatchEvent(new Event("mousedown"))],
        ["mouse drag", f => { f.controls.mouseMove.moving = true; }],
        ["pan inertia", f => f.controls.mouseMove.deltaPosition.set(1, 0)],
        ["rotation inertia", f => { f.controls.mouseRotate.deltaRotation = 0.1; }],
        ["keyboard zoom", f => { f.controls.keyZoom.in = true; }],
        ["keyboard rotate", f => { f.controls.keyRotate.left = true; }],
        ["touch pinch start", f => { f.controls.touchZoom.moving = true; }],
        ["touch rotate start", f => { f.controls.touchRotate.moving = true; }],
        ["touch tilt start", f => { f.controls.touchAngle.moving = true; }],
        ["zoom button", f => ZoomButtons.methods.zoom.call({$bluemap: {mapViewer: {controlsManager: f.manager}}}, 3)],
        ["reset", f => f.controls.reset()],
        ["map change", f => { f.manager.mapViewer.map = {...f.map}; }],
        ["viewport resize", f => { f.root.rect.width += 10; }],
        ["follow player", f => f.controls.followPlayerMarker({position: new Vector3(12000, 80, -24000)})],
        ["control switch", f => { f.manager.controls = new FreeFlightControls(f.root); }]
    ]) check(`${name} clears anchor`, () => {
        const f = fixture();
        try {
            wheel(f, -120);
            assert.ok(f.controls.mouseZoom.cursorAnchor.anchor);
            interact(f);
            f.manager.update(16.666, f.manager.mapViewer.map);
            assert.equal(f.controls.mouseZoom.cursorAnchor.anchor, null);
        } finally { f.dispose(); }
    });
    check("wheel leaves follow mode and free flight controls speed", () => {
        const f = fixture();
        try {
            f.controls.followPlayerMarker({position: new Vector3(12000, 80, -24000)});
            wheel(f, -120);
            assert.equal(f.controls.data.followingPlayer, null);
            assert.ok(f.controls.mouseZoom.cursorAnchor.anchor);
            const flight = new FreeFlightControls(f.root);
            f.manager.controls = flight;
            const position = f.manager.position.clone();
            const distance = f.manager.distance;
            wheel(f, -120);
            assert.ok(flight.moveSpeed > 0.5);
            assert.ok(position.equals(f.manager.position));
            close(f.manager.distance, distance);
        } finally { f.dispose(); }
    });

    check("cursor toggle defaults on and disabling clears an active burst", () => {
        const f = fixture({ortho: 1, angle: 0});
        try {
            assert.equal(f.controls.mouseZoom.zoomToCursor, true);
            wheel(f, -120);
            assert.ok(f.controls.mouseZoom.cursorAnchor.anchor);
            f.controls.mouseZoom.zoomToCursor = false;
            assert.equal(f.controls.mouseZoom.cursorAnchor.anchor, null);
            const center = f.manager.position.clone();
            const distance = f.manager.distance;
            settle(f, null);
            close(f.manager.position.x, center.x);
            close(f.manager.position.z, center.z);
            assert.ok(f.manager.distance < distance);
            wheel(f, 120);
            assert.equal(f.controls.mouseZoom.cursorAnchor.anchor, null);
            settle(f, null);
            close(f.manager.position.x, center.x);
            close(f.manager.position.z, center.z);
            f.controls.mouseZoom.zoomToCursor = true;
            wheel(f, -120);
            const anchor = f.controls.mouseZoom.cursorAnchor.anchor.clone();
            settle(f, anchor);
        } finally { f.dispose(); }
    });

    // Exercise the real app save/load/reset pipeline without constructing a WebGL renderer.
    const f = fixture();
    try {
        const app = Object.create(BlueMapApp.prototype);
        app.savedUserSettings = new Map();
        app.settings = {useCookies: true};
        app.events = {dispatchEvent: () => false};
        app.mapControls = f.controls;
        app.freeFlightControls = new FreeFlightControls(f.root);
        app.appState = {
            controls: {mouseSensitivity: 1, invertMouse: false, pauseTileLoading: false,
                showZoomButtons: true, zoomToCursor: true},
            screenshot: {clipboard: true}, theme: null, debug: false
        };
        app.mapViewer = {
            ...f.manager.mapViewer,
            rootElement: {classList: {add() {}, remove() {}}},
            data: {superSampling: 1, loadedHiresViewDistance: 50, loadedLowresViewDistance: 500,
                uniforms: {chunkBorders: {value: false}}},
            stats: {showPanel() {}},
            updateLoadedMapArea() {}, clearTileCache() {}, redraw() {}
        };
        globalThis.performance = {getEntriesByType: () => [{type: "navigate"}]};
        let reloads = 0;
        globalThis.location = {reload: () => { reloads++; }};

        app.appState.controls.zoomToCursor = false;
        app.updateControlsSettings();
        app.saveUserSettings();
        assert.equal(localStorage.getItem("bluemap-zoomToCursor"), "false");
        app.appState.controls.zoomToCursor = true;
        await app.loadUserSettings();
        assert.equal(app.appState.controls.zoomToCursor, false);
        assert.equal(f.controls.mouseZoom.zoomToCursor, false);
        passed++;

        for (const invalid of ["null", "0", '"false"', "{}", "malformed"]) {
            localStorage.setItem("bluemap-zoomToCursor", invalid);
            await app.loadUserSettings();
            assert.equal(app.appState.controls.zoomToCursor, true);
            assert.equal(f.controls.mouseZoom.zoomToCursor, true);
        }
        storage.delete("bluemap-zoomToCursor");
        await app.loadUserSettings();
        assert.equal(app.appState.controls.zoomToCursor, true);
        passed++;

        app.resetSettings();
        assert.equal(reloads, 1);
        assert.equal(localStorage.getItem("bluemap-resetSettings"), "true");
        // A reloaded app starts with its default-on preference; reset writes that default.
        app.savedUserSettings = new Map();
        app.appState.controls.zoomToCursor = true;
        f.controls.mouseZoom.zoomToCursor = true;
        await app.loadUserSettings();
        assert.equal(localStorage.getItem("bluemap-zoomToCursor"), "true");
        assert.equal(localStorage.getItem("bluemap-resetSettings"), "false");
        passed++;
    } catch (error) {
        throw new Error(`Browser preference save/load/reset: ${error.message}`);
    } finally { f.dispose(); }

    console.log(JSON.stringify({passed, maximumCursorDriftPixels: maxDrift,
        actualControls: true, browserInputAdapterStubbed: true, filesWrittenByGate: 0}));
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
