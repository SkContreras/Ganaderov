// Presentation metadata only: the original image is never cropped or re-encoded.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => value != null && Number.isFinite(Number(value)) ? Number(value) : fallback;

export function normalizeCrop(crop = {}) {
  return {x: clamp(finite(crop.x, 50), 0, 100), y: clamp(finite(crop.y, 50), 0, 100), zoom: clamp(finite(crop.zoom, 1), 1, 3)};
}

export function cropGeometry(crop, metrics) {
  const {x, y, zoom} = normalizeCrop(crop);
  const width = Math.max(0, finite(metrics.width, 0));
  const height = Math.max(0, finite(metrics.height, 0));
  const imageWidth = Math.max(1, finite(metrics.imageWidth, width));
  const imageHeight = Math.max(1, finite(metrics.imageHeight, height));
  const scale = Math.max(width / imageWidth, height / imageHeight) * zoom;
  const renderedWidth = imageWidth * scale, renderedHeight = imageHeight * scale;
  const overflowX = Math.max(0, renderedWidth - width), overflowY = Math.max(0, renderedHeight - height);
  return {renderedWidth, renderedHeight, overflowX, overflowY, left: -overflowX * x / 100, top: -overflowY * y / 100};
}

export function panCrop(crop, metrics, delta) {
  const value = normalizeCrop(crop), geometry = cropGeometry(value, metrics);
  return normalizeCrop({...value,
    x: geometry.overflowX > 0.001 ? value.x - finite(delta.x, 0) * 100 / geometry.overflowX : value.x,
    y: geometry.overflowY > 0.001 ? value.y - finite(delta.y, 0) * 100 / geometry.overflowY : value.y});
}

export function zoomCrop(crop, metrics, nextZoom, anchor = {x: metrics.width / 2, y: metrics.height / 2}, targetAnchor = anchor) {
  const value = normalizeCrop(crop), next = normalizeCrop({...value, zoom: nextZoom});
  const before = cropGeometry(value, metrics), after = cropGeometry(next, metrics);
  if (!before.renderedWidth || !before.renderedHeight) return next;
  // Keep the image point under the cursor / pinch centroid fixed as it scales.
  const imageX = (anchor.x - before.left) / before.renderedWidth;
  const imageY = (anchor.y - before.top) / before.renderedHeight;
  return normalizeCrop({...next,
    x: after.overflowX > 0.001 ? (imageX * after.renderedWidth - targetAnchor.x) * 100 / after.overflowX : value.x,
    y: after.overflowY > 0.001 ? (imageY * after.renderedHeight - targetAnchor.y) * 100 / after.overflowY : value.y});
}

export function createPhotoFraming({frame, image, crop, onChange = () => {}}) {
  let value = normalizeCrop(crop), disabled = false, gesture = null;
  const pointers = new Map(), events = new AbortController();
  const listen = (target, name, handler, options = {}) => target.addEventListener(name, handler, {...options, signal: events.signal});
  const metrics = () => ({width: frame.clientWidth, height: frame.clientHeight, imageWidth: image.naturalWidth, imageHeight: image.naturalHeight});
  const ready = () => !disabled && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
  const localPoint = point => {const rect = frame.getBoundingClientRect(); return {x: point.x - rect.left, y: point.y - rect.top};};
  const center = points => points.length === 1 ? points[0] : {x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2};
  const distance = points => points.length < 2 ? 0 : Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  const rebase = () => {
    const points = [...pointers.values()].slice(0, 2);
    gesture = points.length ? {crop: {...value}, center: localPoint(center(points)), distance: distance(points), metrics: metrics()} : null;
    frame.classList.toggle('is-dragging', points.length > 0);
  };
  const clearPointers = () => {
    const ids = [...pointers.keys()]; pointers.clear(); rebase();
    for (const id of ids) if (frame.hasPointerCapture?.(id)) frame.releasePointerCapture(id);
  };
  const render = () => {
    image.style.objectPosition = value.x + '% ' + value.y + '%';
    image.style.transformOrigin = value.x + '% ' + value.y + '%';
    image.style.transform = 'scale(' + value.zoom + ')';
    frame.dataset.cropX = String(value.x); frame.dataset.cropY = String(value.y); frame.dataset.cropZoom = String(value.zoom);
    onChange({...value});
  };
  const setCrop = next => {value = normalizeCrop(next); render();};
  const zoomBy = delta => {if (ready()) {setCrop(zoomCrop(value, metrics(), Math.round((value.zoom + delta) * 1000) / 1000)); rebase();}};
  listen(frame, 'pointerdown', event => {
    if (!ready() || event.pointerType === 'mouse' && event.button !== 0 || pointers.size >= 2) return;
    event.preventDefault(); frame.focus({preventScroll: true});
    pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    frame.setPointerCapture(event.pointerId); rebase();
  });
  listen(frame, 'pointermove', event => {
    if (!ready() || !pointers.has(event.pointerId) || !gesture) return;
    event.preventDefault(); pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    const points = [...pointers.values()].slice(0, 2), current = localPoint(center(points));
    if (points.length === 2 && gesture.distance > 0.001) {
      setCrop(zoomCrop(gesture.crop, gesture.metrics, gesture.crop.zoom * distance(points) / gesture.distance, gesture.center, current));
    } else setCrop(panCrop(gesture.crop, gesture.metrics, {x: current.x - gesture.center.x, y: current.y - gesture.center.y}));
  });
  const release = event => {
    if (!pointers.delete(event.pointerId)) return;
    if (frame.hasPointerCapture?.(event.pointerId)) frame.releasePointerCapture(event.pointerId);
    rebase();
  };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(frame, name, release);
  listen(frame, 'wheel', event => {
    if (!ready()) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? frame.clientHeight : 1;
    const delta = clamp(event.deltaY * unit, -240, 240);
    setCrop(zoomCrop(value, metrics(), value.zoom * Math.exp(-delta * 0.002), localPoint({x: event.clientX, y: event.clientY})));
    rebase();
  }, {passive: false});
  listen(frame, 'keydown', event => {
    if (!ready() || event.ctrlKey || event.metaKey || event.altKey) return;
    const step = event.shiftKey ? 10 : 1, geometry = cropGeometry(value, metrics());
    const next = {...value};
    if (event.key === '+' || event.key === '=') zoomBy(0.1);
    else if (event.key === '-' || event.key === '_') zoomBy(-0.1);
    else if (event.key === 'Home') setCrop({x: 50, y: 50, zoom: 1});
    else if (event.key.startsWith('Arrow')) {
      if (geometry.overflowX > 0.001 && event.key === 'ArrowRight') next.x -= step;
      if (geometry.overflowX > 0.001 && event.key === 'ArrowLeft') next.x += step;
      if (geometry.overflowY > 0.001 && event.key === 'ArrowDown') next.y -= step;
      if (geometry.overflowY > 0.001 && event.key === 'ArrowUp') next.y += step;
      setCrop(next);
    } else return;
    event.preventDefault(); rebase();
  });
  listen(image, 'dragstart', event => event.preventDefault());
  const resize = new ResizeObserver(() => {clearPointers(); render();});
  resize.observe(frame);
  render();
  return {
    get crop() {return {...value};}, setCrop, zoomBy,
    reset() {if (ready()) {clearPointers(); setCrop({x: 50, y: 50, zoom: 1});}},
    setDisabled(next) {disabled = Boolean(next); frame.setAttribute('aria-disabled', String(disabled)); if (disabled) clearPointers();},
    destroy() {events.abort(); resize.disconnect(); clearPointers();}
  };
}
