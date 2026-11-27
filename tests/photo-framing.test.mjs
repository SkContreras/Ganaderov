import test from "node:test";
import assert from "node:assert/strict";
import {normalizeCrop, cropGeometry, panCrop, zoomCrop} from "../ui/photo-framing.mjs";

const wide = {width:400, height:200, imageWidth:800, imageHeight:400};
const close = (actual, expected, message) => assert(Math.abs(actual - expected) < 0.001, `${message}: ${actual} != ${expected}`);
const sourcePoint = (geometry, anchor) => ({
  x:(anchor.x - geometry.left) / geometry.renderedWidth,
  y:(anchor.y - geometry.top) / geometry.renderedHeight
});

test("framing normalizes the existing metadata contract without mutating its input", () => {
  assert.deepEqual(normalizeCrop({}), {x:50, y:50, zoom:1});
  const input = {x:-5, y:125, zoom:8};
  assert.deepEqual(normalizeCrop(input), {x:0, y:100, zoom:3});
  assert.deepEqual(input, {x:-5, y:125, zoom:8});
  for (const value of [NaN, Infinity, -Infinity, null, undefined]) {
    const crop = normalizeCrop({x:value, y:value, zoom:value});
    assert([crop.x, crop.y, crop.zoom].every(Number.isFinite));
    assert(crop.x >= 0 && crop.x <= 100 && crop.y >= 0 && crop.y <= 100);
    assert(crop.zoom >= 1 && crop.zoom <= 3);
  }
});

test("cover geometry keeps the established object-position and zoom-origin semantics", () => {
  const geometry = cropGeometry({x:25, y:75, zoom:2}, wide);
  close(geometry.renderedWidth, 800, "rendered width");
  close(geometry.renderedHeight, 400, "rendered height");
  close(geometry.overflowX, 400, "horizontal overflow");
  close(geometry.overflowY, 200, "vertical overflow");
  close(geometry.left, -100, "left offset");
  close(geometry.top, -150, "top offset");
});

test("portrait, landscape and square photos never expose empty frame edges at valid limits", () => {
  for (const [imageWidth,imageHeight] of [[200,400],[1200,300],[300,300]]) {
    for (const zoom of [1,1.01,2,3]) for (const x of [0,50,100]) for (const y of [0,50,100]) {
      const geometry = cropGeometry({x,y,zoom}, {...wide,imageWidth,imageHeight});
      assert(geometry.left <= 0.001 && geometry.top <= 0.001);
      assert(geometry.left + geometry.renderedWidth >= wide.width - 0.001);
      assert(geometry.top + geometry.renderedHeight >= wide.height - 0.001);
    }
  }
});

test("panning follows the pointer in CSS pixels and clamps at the image boundary", () => {
  const crop = {x:50, y:50, zoom:2};
  const moved = panCrop(crop, wide, {x:80, y:-20});
  close(moved.x, 30, "horizontal pan");
  close(moved.y, 60, "vertical pan");
  const before = cropGeometry(crop, wide), after = cropGeometry(moved, wide);
  close(after.left - before.left, 80, "visible horizontal movement");
  close(after.top - before.top, -20, "visible vertical movement");
  assert.deepEqual(crop, {x:50, y:50, zoom:2});
  assert.deepEqual(panCrop(crop, wide, {x:100000, y:-100000}), {x:0,y:100,zoom:2});
});

test("an axis without overflow remains finite and stable while the other axis pans", () => {
  const metrics = {...wide,imageWidth:200,imageHeight:400};
  const crop = {x:23, y:50, zoom:1};
  const moved = panCrop(crop, metrics, {x:200, y:60});
  close(moved.x, 23, "uncropped axis");
  close(moved.y, 40, "cropped axis");
  const geometry = cropGeometry(moved, metrics);
  close(geometry.left, 0, "zero overflow left");
  assert(Object.values(geometry).filter(value => typeof value === "number").every(Number.isFinite));
});

test("zoom holds the source pixel under the pointer instead of snapping toward the center", () => {
  const metrics = {width:400,height:300,imageWidth:800,imageHeight:400};
  const crop = {x:40,y:60,zoom:1.3};
  const anchor = {x:135,y:190};
  const before = sourcePoint(cropGeometry(crop, metrics), anchor);
  const next = zoomCrop(crop, metrics, 2.1, anchor);
  const after = sourcePoint(cropGeometry(next, metrics), anchor);
  close(after.x, before.x, "anchored source x");
  close(after.y, before.y, "anchored source y");
  close(next.zoom, 2.1, "zoom");
});

test("a two-finger pinch can move its midpoint while preserving the source point", () => {
  const crop = {x:50,y:50,zoom:1.8};
  const anchor = {x:170,y:90}, target = {x:190,y:105};
  const before = sourcePoint(cropGeometry(crop, wide), anchor);
  const next = zoomCrop(crop, wide, 2.4, anchor, target);
  const after = sourcePoint(cropGeometry(next, wide), target);
  close(after.x, before.x, "moving pinch source x");
  close(after.y, before.y, "moving pinch source y");
});

test("zoom limits and reset retain finite normalized coordinates without cropping bytes", () => {
  const crop = {x:0,y:100,zoom:2};
  for (const requested of [-10,0,1,3,100]) {
    const next = zoomCrop(crop, wide, requested, {x:0,y:200});
    assert(next.zoom >= 1 && next.zoom <= 3);
    assert(next.x >= 0 && next.x <= 100 && next.y >= 0 && next.y <= 100);
    assert([next.x,next.y,next.zoom].every(Number.isFinite));
  }
  assert.deepEqual(normalizeCrop({x:50,y:50,zoom:1}), {x:50,y:50,zoom:1});
});
