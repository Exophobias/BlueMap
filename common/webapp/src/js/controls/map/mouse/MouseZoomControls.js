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

import {MathUtils} from "three";
import {MapControls} from "../MapControls";
import {CursorZoomAnchor} from "./CursorZoomAnchor";

export class MouseZoomControls {

    /**
     * @param target {EventTarget}
     * @param speed {number}
     * @param stiffness {number}
     */
    constructor(target, speed, stiffness) {
        this.target = target;
        this.manager = null;

        this.stiffness = stiffness;
        this.speed = speed;

        this.deltaZoom = 0;
        this.cursorAnchor = new CursorZoomAnchor(target);
        this.cameraUpdated = false;
        this._zoomToCursor = true;
    }

    /**
     * @param manager {ControlsManager}
     */
    start(manager) {
        this.manager = manager;

        this.target.addEventListener("wheel", this.onMouseWheel, {passive: false});
        this.target.addEventListener("mousedown", this.clearAnchor);
    }

    stop() {
        this.target.removeEventListener("wheel", this.onMouseWheel);
        this.target.removeEventListener("mousedown", this.clearAnchor);
        this.reset();
    }

    /**
     * @param delta {number}
     * @param map {Map}
     */
    update(delta, map) {
        if (this.deltaZoom === 0) {
            // Retain the point until the distance and terrain-height springs finish settling.
            if (!this.cameraUpdated && !this.settlingDistanceLimit()) this.clearAnchor();
            this.cameraUpdated = false;
            return;
        }
        this.cameraUpdated = false;

        let smoothing = this.stiffness / (16.666 / delta);
        smoothing = MathUtils.clamp(smoothing, 0, 1);

        const distance = this.manager.distance * Math.pow(1.5, this.deltaZoom * smoothing * this.speed);
        if (!Number.isFinite(distance) || distance <= 0) {
            this.reset();
            return;
        }
        this.manager.distance = distance;
        this.manager.angle = Math.min(this.manager.angle, MapControls.getMaxPerspectiveAngleForDistance(this.manager.distance));

        this.deltaZoom *= 1 - smoothing;
        if (Math.abs(this.deltaZoom) < 0.0001) {
            this.deltaZoom = 0;
        }
    }

    reset() {
        this.deltaZoom = 0;
        this.clearAnchor();
    }

    clearAnchor = () => {
        this.cursorAnchor.clear();
        this.cameraUpdated = false;
    };

    adjustCamera() {
        this.cameraUpdated = this.cursorAnchor.anchor !== null;
        return this.cursorAnchor.adjust(this.manager);
    }

    get zoomToCursor() {
        return this._zoomToCursor;
    }

    set zoomToCursor(enabled) {
        this._zoomToCursor = enabled !== false;
        if (!this._zoomToCursor) this.clearAnchor();
    }

    settlingDistanceLimit() {
        const controls = this.manager?.controls;
        return controls && (this.manager.distance < controls.minDistance - 0.0000001 ||
            this.manager.distance > controls.maxDistance + 0.0000001);
    }

    /**
     * @private
     * @param evt {WheelEvent}
     */
    onMouseWheel = evt => {
        evt.preventDefault();

        let delta = evt.deltaY;
        if (evt.deltaMode === WheelEvent.DOM_DELTA_PIXEL) delta *= 0.01;
        if (evt.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 0.33;

        if (!Number.isFinite(delta) || delta === 0 || !Number.isFinite(this.deltaZoom + delta)) return;
        if (this.zoomToCursor && this.cursorAnchor.capture(this.manager, evt.clientX, evt.clientY,
            this.deltaZoom !== 0 || this.cameraUpdated || this.settlingDistanceLimit())) {
            this.manager.controls?.stopFollowingPlayerMarker?.();
        }
        this.deltaZoom += delta;
    }

}
