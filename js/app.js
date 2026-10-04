import { CARD_W, CARD_H, createSampleBlob, illustrateSource, canvasToPngBlob } from "./filter.js";
import { deleteCard, listCards, saveCard, seedSampleIfNeeded } from "./store.js";

const stage = document.querySelector("#stage");
const video = document.querySelector("#video");
const preview = document.querySelector("#preview");
const status = document.querySelector("#status");
const gallery = document.querySelector("#gallery");
const deckCount = document.querySelector("#deck-count");
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
  month: "long",
  year: "numeric",
});

let mode = "idle";
let busy = false;
let stream = null;
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

  const track = stream.getVideoTracks()[0];
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
  return shot;
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
    setStatus("Carta lista. Puedes guardarla en este dispositivo o descargarla.");
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

function clearPreview() {
  previewBlob = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = "";
  preview.removeAttribute("src");
}

async function savePreview() {
  if (!previewBlob || busy) return;
  if (!storageOk) {
    setStatus("No se puede guardar en este dispositivo. Puedes descargar la carta.");
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
        ? "No queda espacio en este dispositivo para guardar más cartas. Puedes descargar esta."
        : "No se ha podido guardar la carta. Puedes descargarla.",
    );
    return;
  }

  cards.unshift(card);
  highlightId = card.id;
  clearPreview();
  mode = "idle";
  setStatus("Carta guardada. Se queda en este dispositivo.");
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

    const download = document.createElement("button");
    download.type = "button";
    download.className = "btn btn-ink";
    download.textContent = "Descargar";
    const filename = card.sample ? "dixit-cards-muestra.png" : `dixit-cards-${fileStamp(new Date(card.createdAt))}.png`;
    download.addEventListener("click", () => downloadBlob(card.blob, filename));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-ghost";
    remove.textContent = "Quitar";
    remove.addEventListener("click", async () => {
      if (remove.dataset.confirm !== "1") {
        remove.dataset.confirm = "1";
        remove.textContent = "Sí, quitar";
        return;
      }
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
      setStatus("Este navegador no puede guardar la galería. Puedes descargar la carta, pero no se quedará al salir.");
    } catch {
      setStatus("No se ha podido preparar la galería en este dispositivo.");
    }
  }
  renderGallery();
}

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
  downloadBlob(previewBlob, `dixit-cards-${fileStamp(new Date())}.png`);
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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && mode === "live") closeCamera();
});

boot();
