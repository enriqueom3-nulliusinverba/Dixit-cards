import { CARD_W, CARD_H, createSampleBlob, illustrateSource, canvasToPngBlob } from "./filter.js";
import { deleteCard, listCards, saveCard, seedSampleIfNeeded } from "./store.js";

const stage = document.querySelector("#stage");
const video = document.querySelector("#video");
const preview = document.querySelector("#preview");
const status = document.querySelector("#status");
const gallery = document.querySelector("#gallery");
const deckCount = document.querySelector("#deck-count");
const guideEl = document.querySelector("#guide");
const zoomBar = document.querySelector("#zoom");
const fileInput = document.querySelector("#file");
const busyLayer = document.querySelector("#stage-busy");

const buttons = {
  camera: document.querySelector("#btn-camera"),
  capture: document.querySelector("#btn-capture"),
  save: document.querySelector("#btn-save"),
  upload: document.querySelector("#btn-upload"),
  download: document.querySelector("#btn-download"),
  close: document.querySelector("#btn-close"),
  discard: document.querySelector("#btn-discard"),
};

const dateFormat = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const ICON_SAVE = "M12 3v12m0 0-4-4m4 4 4-4M5 20h14";
const ICON_TRASH = "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3";

/** En un móvil con menú de compartir, guardar la carta la deja en la galería del teléfono. */
const canSharePhone = (() => {
  try {
    const probe = new File([new Blob(["x"], { type: "image/png" })], "carta.png", { type: "image/png" });
    return window.matchMedia("(pointer: coarse)").matches && !!navigator.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
})();

let mode = "idle";
let busy = false;
let stream = null;
let track = null;
let zoom = 1;
let zoomMin = 1;
let zoomMax = 4;
let zoomHardware = false;
let zoomButtons = [];
let zoomFrame = 0;
let facingUser = false;
let cameraReady = false;
let storageOk = true;
let previewBlob = null;
let previewUrl = "";
let cards = [];
let objectUrls = [];
let highlightId = "";

function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setStatus(message) {
  status.textContent = message;
}

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `carta-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function applyFrame() {
  document.documentElement.style.setProperty("--card-w", String(CARD_W));
  document.documentElement.style.setProperty("--card-h", String(CARD_H));
}

function stopCamera() {
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  video.srcObject = null;
  track = null;
  zoom = 1;
  zoomHardware = false;
  stage.style.removeProperty("--zoom");
  facingUser = false;
  cameraReady = false;
}

function renderActions() {
  const visible = {
    camera: mode === "idle",
    upload: mode === "idle" || mode === "live",
    capture: mode === "live",
    close: mode === "live",
    save: mode === "preview",
    download: mode === "preview",
    discard: mode === "preview",
  };

  for (const [name, button] of Object.entries(buttons)) {
    button.hidden = !visible[name];
    button.disabled = busy || (name === "capture" && !cameraReady);
  }

  document.documentElement.classList.toggle("camera-open", mode === "live");
  zoomBar.hidden = mode !== "live";
  stage.classList.toggle("is-live", mode === "live");
  stage.classList.toggle("is-preview", mode === "preview");
  stage.classList.toggle("is-user", mode === "live" && facingUser);
  stage.classList.toggle("is-busy", busy);
  busyLayer.hidden = !busy;
}

function cameraMessage(error) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return "Este navegador no deja usar la cámara. Puedes elegir una foto de la galería.";
  }
  switch (error?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Has bloqueado la cámara. Puedes elegir una foto de la galería.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No hay una cámara disponible. Puedes elegir una foto de la galería.";
    case "NotReadableError":
      return "La cámara está ocupada. Puedes elegir una foto de la galería.";
    default:
      return "No se ha podido abrir la cámara. Puedes elegir una foto de la galería.";
  }
}

function formatZoom(value) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}×`;
}

function renderZoom() {
  if (!zoomButtons.length) return;
  let closest = 0;
  zoomButtons.forEach((entry, index) => {
    if (Math.abs(entry.value - zoom) < Math.abs(zoomButtons[closest].value - zoom)) closest = index;
  });
  zoomButtons.forEach((entry, index) => {
    const active = index === closest;
    entry.button.setAttribute("aria-pressed", String(active));
    entry.button.textContent = formatZoom(active ? Math.round(zoom * 10) / 10 : entry.value);
  });
}

function useDigitalZoom() {
  zoomHardware = false;
  zoomMin = 1;
  zoomMax = 4;
  zoom = Math.max(1, Math.min(zoom, zoomMax));
  stage.style.setProperty("--zoom", String(zoom));
  renderZoom();
}

function applyZoom() {
  zoomFrame = 0;
  if (!zoomHardware || !track) {
    stage.style.setProperty("--zoom", String(zoom));
    return;
  }
  const wanted = zoom;
  track
    .applyConstraints({ advanced: [{ zoom: wanted }] })
    .then(() => {
      const applied = track?.getSettings?.().zoom;
      if (wanted > 1.05 && (applied === undefined || Math.abs(applied - wanted) > 0.25)) useDigitalZoom();
    })
    .catch(useDigitalZoom);
}

function setZoom(value) {
  zoom = Math.min(zoomMax, Math.max(zoomMin, value));
  if (!zoomFrame) zoomFrame = requestAnimationFrame(applyZoom);
  renderZoom();
}

/** Zoom de la cámara si el dispositivo lo ofrece; si no, zoom digital sobre el vídeo. */
function setupZoom() {
  const capabilities = track?.getCapabilities?.() ?? {};
  const range = capabilities.zoom ? capabilities.zoom.max - capabilities.zoom.min : 0;
  zoomHardware = range > 0.05;
  zoomMin = zoomHardware ? capabilities.zoom.min : 1;
  zoomMax = zoomHardware ? capabilities.zoom.max : 4;
  zoom = Math.max(zoomMin, Math.min(zoomMax, 1));

  const presets = [0.5, 1, 2, 3, 5].filter((value) => value >= zoomMin - 0.01 && value <= zoomMax + 0.01);
  zoomBar.replaceChildren();
  zoomButtons = (presets.length ? presets : [1, 2, 3]).map((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "zoom-btn";
    button.setAttribute("aria-label", `Zoom ${formatZoom(value)}`);
    button.addEventListener("click", () => setZoom(value));
    zoomBar.append(button);
    return { value, button };
  });
  stage.style.setProperty("--zoom", "1");
  renderZoom();
}

async function openCamera() {
  if (busy) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus(cameraMessage());
    return;
  }

  stopCamera();
  const attempts = [
    {
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 1920 },
      },
      audio: false,
    },
    { video: { facingMode: "user" }, audio: false },
    { video: true, audio: false },
  ];

  let lastError = null;
  for (const constraints of attempts) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (error?.name === "NotAllowedError" || error?.name === "SecurityError") break;
    }
  }

  if (!stream) {
    setStatus(cameraMessage(lastError));
    mode = "idle";
    renderActions();
    return;
  }

  track = stream.getVideoTracks()[0];
  facingUser = track.getSettings?.().facingMode === "user";
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    stopCamera();
    setStatus("No se ha podido mostrar la cámara. Puedes elegir una foto de la galería.");
    mode = "idle";
    renderActions();
    return;
  }

  if (!video.videoWidth) {
    await new Promise((resolve) => video.addEventListener("loadeddata", resolve, { once: true }));
  }

  cameraReady = video.videoWidth > 0;
  setupZoom();
  mode = "live";
  setStatus(cameraReady ? "Cámara lista. Cuando encuadres, captura la foto." : "Esperando la imagen de la cámara…");
  renderActions();
}

function closeCamera() {
  stopCamera();
  mode = "idle";
  setStatus("");
  renderActions();
}

/** Recorta la captura a lo que enmarca la guía, que tiene la forma de la carta. */
function snapshotVideo() {
  const shot = document.createElement("canvas");
  shot.width = video.videoWidth;
  shot.height = video.videoHeight;
  const ctx = shot.getContext("2d");
  if (facingUser) {
    ctx.translate(shot.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0);

  const box = video.getBoundingClientRect();
  const guide = guideEl.getBoundingClientRect();
  if (!box.width || !guide.width) return shot;

  const scale = Math.max(box.width / shot.width, box.height / shot.height);
  const offsetX = (box.width - shot.width * scale) / 2;
  const offsetY = (box.height - shot.height * scale) / 2;
  const digital = zoomHardware ? 1 : zoom;
  const centerX = box.width / 2;
  const centerY = box.height / 2;
  const left = centerX + (guide.left - box.left - centerX) / digital;
  const top = centerY + (guide.top - box.top - centerY) / digital;
  const sx = Math.max(0, (left - offsetX) / scale);
  const sy = Math.max(0, (top - offsetY) / scale);
  const sw = Math.min(shot.width - sx, guide.width / digital / scale);
  const sh = Math.min(shot.height - sy, guide.height / digital / scale);
  if (sw < 16 || sh < 16) return shot;

  const crop = document.createElement("canvas");
  crop.width = Math.round(sw);
  crop.height = Math.round(sh);
  crop.getContext("2d").drawImage(shot, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
  return crop;
}

async function illustrate(source) {
  if (busy) return;
  busy = true;
  renderActions();
  setStatus("Ilustrando la foto…");
  await nextPaint();

  try {
    const card = await illustrateSource(source);
    previewBlob = await canvasToPngBlob(card);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(previewBlob);
    preview.src = previewUrl;
    stopCamera();
    mode = "preview";
    setStatus("Carta lista. Guárdala en el móvil o en tu mazo.");
  } catch {
    setStatus("No se ha podido ilustrar esa imagen. Prueba con un JPG o un PNG.");
    if (mode !== "live") mode = "idle";
  } finally {
    if (source?.close) source.close();
    busy = false;
    renderActions();
  }
}

async function onFile(file) {
  if (!file) return;
  if (file.type && !file.type.startsWith("image/")) {
    setStatus("Ese archivo no es una imagen. Prueba con un JPG o un PNG.");
    return;
  }
  try {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      bitmap = await createImageBitmap(file);
    }
    await illustrate(bitmap);
  } catch {
    setStatus("No se ha podido leer esa imagen. Prueba con un JPG o un PNG.");
  }
}

function fileStamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Abre el menú de compartir con la carta, que ofrece guardarla en la galería del móvil. */
async function sendToPhone(blob, filename) {
  const file = new File([blob], filename, { type: "image/png" });
  try {
    await navigator.share({ files: [file], title: "Dixit cards" });
    return true;
  } catch (error) {
    return error?.name === "AbortError";
  }
}

function saveToDevice(blob, filename) {
  if (canSharePhone) {
    sendToPhone(blob, filename).then((done) => {
      if (!done) downloadBlob(blob, filename);
    });
  } else {
    downloadBlob(blob, filename);
  }
}

function iconButton(label, path, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `btn btn-sm ${className}`;
  button.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
  const text = document.createElement("span");
  text.textContent = label;
  button.append(text);
  return button;
}

function clearPreview() {
  previewBlob = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = "";
  preview.removeAttribute("src");
}

async function savePreview() {
  if (!previewBlob || busy) return;
  if (!storageOk) {
    setStatus("No se puede guardar en este dispositivo. Puedes guardarla en el móvil.");
    return;
  }

  const card = {
    id: uid(),
    createdAt: Date.now(),
    blob: previewBlob,
    sample: false,
  };

  try {
    await saveCard(card);
  } catch (error) {
    const quota = error?.name === "QuotaExceededError";
    setStatus(
      quota
        ? "No queda espacio en este dispositivo para guardar más cartas. Puedes guardar esta en el móvil."
        : "No se ha podido guardar la carta. Puedes guardarla en el móvil.",
    );
    return;
  }

  cards.unshift(card);
  highlightId = card.id;
  clearPreview();
  mode = "idle";
  setStatus("Carta guardada en tu mazo.");
  renderActions();
  renderGallery();
  gallery.querySelector(".carta")?.scrollIntoView({
    behavior: reduceMotion() ? "auto" : "smooth",
    block: "nearest",
  });
}

function discardPreview() {
  clearPreview();
  mode = "idle";
  setStatus("");
  renderActions();
}

function revokeGalleryUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
}

function renderGallery() {
  revokeGalleryUrls();
  gallery.replaceChildren();

  const own = cards.filter((card) => !card.sample).length;
  deckCount.textContent = own === 1 ? "1 carta tuya" : `${own} cartas tuyas`;

  if (!cards.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Todavía no hay cartas. Cuando guardes una, aparecerá aquí.";
    gallery.append(empty);
    return;
  }

  for (const card of cards) {
    const article = document.createElement("article");
    article.className = card.id === highlightId ? "carta carta--nueva" : "carta";

    const image = document.createElement("img");
    const url = URL.createObjectURL(card.blob);
    objectUrls.push(url);
    image.src = url;
    image.alt = card.sample ? "Carta de muestra" : `Carta ilustrada del ${dateFormat.format(card.createdAt)}`;
    image.width = CARD_W;
    image.height = CARD_H;

    const meta = document.createElement("p");
    meta.className = "carta-meta";
    if (card.sample) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Muestra";
      meta.append(badge);
    }
    const time = document.createElement("time");
    time.dateTime = new Date(card.createdAt).toISOString();
    time.textContent = dateFormat.format(card.createdAt);
    meta.append(time);

    const actions = document.createElement("div");
    actions.className = "carta-actions";

    const filename = card.sample ? "dixit-cards-muestra.png" : `dixit-cards-${fileStamp(new Date(card.createdAt))}.png`;
    const download = iconButton("Guardar", ICON_SAVE, "btn-ink");
    download.title = canSharePhone ? "Guardar en la galería del móvil" : "Descargar la carta en PNG";
    download.addEventListener("click", () => saveToDevice(card.blob, filename));

    const remove = iconButton("Quitar", ICON_TRASH, "btn-ghost");
    const removeLabel = remove.querySelector("span");
    let resetTimer = 0;
    remove.addEventListener("click", async () => {
      if (remove.dataset.confirm !== "1") {
        remove.dataset.confirm = "1";
        removeLabel.textContent = "¿Seguro?";
        resetTimer = setTimeout(() => {
          remove.dataset.confirm = "";
          removeLabel.textContent = "Quitar";
        }, 3000);
        return;
      }
      clearTimeout(resetTimer);
      try {
        if (storageOk) await deleteCard(card.id);
      } catch {
        setStatus("No se ha podido quitar la carta.");
        return;
      }
      cards = cards.filter((item) => item.id !== card.id);
      if (highlightId === card.id) highlightId = "";
      renderGallery();
      setStatus("Carta quitada de este dispositivo.");
    });

    actions.append(download, remove);
    article.append(image, meta, actions);
    gallery.append(article);
  }
}

async function boot() {
  applyFrame();
  renderActions();
  try {
    await seedSampleIfNeeded(createSampleBlob);
    cards = await listCards();
  } catch {
    storageOk = false;
    try {
      const blob = await createSampleBlob();
      cards = [{ id: "muestra", createdAt: Date.now(), blob, sample: true }];
      setStatus("Este navegador no puede guardar la galería. Puedes guardar la carta en el móvil, pero no se quedará en el mazo al salir.");
    } catch {
      setStatus("No se ha podido preparar la galería en este dispositivo.");
    }
  }
  renderGallery();
}

buttons.download.textContent = canSharePhone ? "Guardar en el móvil" : "Descargar";

buttons.camera.addEventListener("click", () => {
  openCamera();
});

buttons.close.addEventListener("click", closeCamera);

buttons.capture.addEventListener("click", () => {
  if (!cameraReady) return;
  illustrate(snapshotVideo());
});

buttons.upload.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) onFile(file);
});

buttons.save.addEventListener("click", savePreview);
buttons.discard.addEventListener("click", discardPreview);
buttons.download.addEventListener("click", () => {
  if (!previewBlob) return;
  saveToDevice(previewBlob, `dixit-cards-${fileStamp(new Date())}.png`);
});

stage.addEventListener("dragover", (event) => {
  event.preventDefault();
  stage.classList.add("is-drag");
});

stage.addEventListener("dragleave", () => stage.classList.remove("is-drag"));

stage.addEventListener("drop", (event) => {
  event.preventDefault();
  stage.classList.remove("is-drag");
  const file = event.dataTransfer?.files?.[0];
  if (file) onFile(file);
});

const pointers = new Map();
let pinchStart = null;

function pinchDistance() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
}

stage.addEventListener("pointerdown", (event) => {
  if (mode !== "live") return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2) pinchStart = { distance: pinchDistance(), zoom };
});

stage.addEventListener("pointermove", (event) => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinchStart && pointers.size === 2) setZoom((pinchStart.zoom * pinchDistance()) / pinchStart.distance);
});

for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
  stage.addEventListener(type, (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchStart = null;
  });
}

stage.addEventListener(
  "wheel",
  (event) => {
    if (mode !== "live") return;
    event.preventDefault();
    setZoom(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
  },
  { passive: false },
);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && mode === "live") closeCamera();
});

boot();
