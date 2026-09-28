/*
 * This file is part of BlueMap, licensed under the MIT License (MIT).
 *
 * Copyright (c) Blue (Lukas Rieger) <https://bluecolored.de>
 * Copyright (c) contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

import {Ray, Raycaster, Vector2, Vector3} from "three";

/** Keeps one terrain point under the wheel cursor throughout the smoothed zoom. */
export class CursorZoomAnchor {
    constructor(target) {
        this.target = target;
        this.anchor = null;
        this.map = null;
        this.cursor = new Vector2();
        this.ndc = new Vector2();
        this.rect = null;
        this.ray = new Ray();
        this.farPoint = new Vector3();
        this.point = new Vector3();
        this.raycaster = new Raycaster();
        this.raycaster.layers.enableAll();
        this.intersections = [];
    }

    clear() {
        this.anchor = null;
        this.map = null;
        this.rect = null;
    }

    capture(manager, clientX, clientY, reuse) {
        const rect = this.target.getBoundingClientRect();
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY) ||
            !this.validRect(rect) || clientX < rect.left || clientX > rect.left + rect.width ||
            clientY < rect.top || clientY > rect.top + rect.height) {
            this.clear();
            return false;
        }
        const map = manager.mapViewer.map;
        if (reuse && this.anchor && this.map === map && this.sameRect(rect) &&
            this.cursor.x === clientX && this.cursor.y === clientY) return true;

        this.clear();
        this.cursor.set(clientX, clientY);
        this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1,
            1 - ((clientY - rect.top) / rect.height) * 2);
        if (!this.updateRay(manager.camera)) return false;

        const limit = this.distanceLimit(manager);
        let anchor = this.terrainIntersection(manager, map, limit);
        if (!anchor) {
            // Low-res relief is displaced in a shader, so its undeformed mesh is not the terrain.
            // Refine against the existing height field, keeping the captured plane fixed afterward.
            if (!this.intersectPlane(manager.position.y, limit)) return false;
            for (let i = 0; i < 4; i++) {
                const height = map?.terrainHeightAt(this.point.x, this.point.z);
                if (!Number.isFinite(height)) break; // false means an unloaded tile; zero is valid.
                const previousY = this.point.y;
                if (!this.intersectPlane(height + 1, limit)) return false;
                if (Math.abs(this.point.y - previousY) < 0.01) break;
            }
            anchor = this.point.clone();
        }
        this.anchor = anchor;
        this.map = map;
        this.rect = {left: rect.left, top: rect.top, width: rect.width, height: rect.height};
        return true;
    }

    /** Called after distance, pitch and height constraints, before camera-moved events. */
    adjust(manager) {
        if (!this.anchor) return false;
        if (this.map !== manager.mapViewer.map || !this.sameRect(this.target.getBoundingClientRect()) ||
            !this.updateRay(manager.camera) || !this.intersectPlane(this.anchor.y, this.distanceLimit(manager))) {
            this.clear();
            return false;
        }
        const dx = this.anchor.x - this.point.x;
        const dz = this.anchor.z - this.point.z;
        if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) > this.distanceLimit(manager)) {
            this.clear();
            return false;
        }
        manager.position.x += dx;
        manager.position.z += dz;
        manager.camera.position.x += dx;
        manager.camera.position.z += dz;
        manager.camera.updateMatrixWorld(true);
        return dx !== 0 || dz !== 0;
    }

    updateRay(camera) {
        // Rendering temporarily shifts camera/scenes by 10,000 blocks and restores only position.
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
        this.ray.origin.set(this.ndc.x, this.ndc.y, -1).unproject(camera);
        this.farPoint.set(this.ndc.x, this.ndc.y, 0.5).unproject(camera);
        this.ray.direction.copy(this.farPoint).sub(this.ray.origin).normalize();
        // Two unprojected points also work for CombinedCamera's blended projection matrices.
        return this.finiteVector(this.ray.origin) && this.finiteVector(this.ray.direction) &&
            this.ray.direction.y < -0.001;
    }

    intersectPlane(height, limit) {
        if (!Number.isFinite(height)) return false;
        const distance = (height - this.ray.origin.y) / this.ray.direction.y;
        if (!Number.isFinite(distance) || distance < 0 || distance > limit) return false;
        this.ray.at(distance, this.point);
        return this.finiteVector(this.point);
    }

    terrainIntersection(manager, map, limit) {
        const scene = map?.hiresTileManager?.scene;
        if (manager.distance >= 1000 || !scene?.children.length) return null;
        const x = scene.position.x, z = scene.position.z;
        try {
            scene.position.x = 0;
            scene.position.z = 0;
            scene.updateMatrixWorld(true);
            this.raycaster.ray.copy(this.ray);
            this.raycaster.near = 0;
            this.raycaster.far = limit;
            this.intersections.length = 0;
            this.raycaster.intersectObject(scene, true, this.intersections);
            for (const intersection of this.intersections) {
                let object = intersection.object;
                while (object?.visible) object = object.parent;
                if (!object && this.finiteVector(intersection.point)) return intersection.point.clone();
            }
            return null;
        } catch (ignore) {
            return null; // An incomplete tile can use the height-field/target-plane fallback.
        } finally {
            scene.position.x = x;
            scene.position.z = z;
            scene.updateMatrixWorld(true);
        }
    }

    distanceLimit(manager) {
        return Math.min(10000000, Math.max(300, Math.abs(manager.distance) * 32));
    }

    validRect(rect) {
        return Number.isFinite(rect.left) && Number.isFinite(rect.top) &&
            Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0;
    }

    sameRect(rect) {
        return this.rect && this.validRect(rect) && this.rect.left === rect.left && this.rect.top === rect.top &&
            this.rect.width === rect.width && this.rect.height === rect.height;
    }

    finiteVector(vector) {
        return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
    }
}
