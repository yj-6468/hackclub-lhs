const shell = document.querySelector(".os-shell");
const windows = [...document.querySelectorAll("[data-window]")];
const desktopIcons = [...document.querySelectorAll(".desktop-icon")];
const desktopOpeners = [...document.querySelectorAll(".desktop-icon[data-open]")];
const desktopExternalOpeners = [...document.querySelectorAll(".desktop-icon[data-external]")];
const openers = [...document.querySelectorAll("[data-open]:not(.desktop-icon)")];
const taskButtons = [...document.querySelectorAll(".task-button")];
const taskWindowButtons = [...document.querySelectorAll(".task-button[data-open]")];
const taskExternalOpeners = [...document.querySelectorAll(".task-button[data-external]")];
const themeChoices = [...document.querySelectorAll("[data-theme-choice]")];
const taskbar = document.querySelector(".taskbar");
let topZ = 40;

const STORAGE_KEY = "hackclub-os-state";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveState(patch) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadState(), ...patch }));
  } catch {
    // localStorage unavailable (private mode, disabled, quota) -- ignore
  }
}

function saveWindowState(name, patch) {
  const state = loadState();
  const windowState = { ...state.windows?.[name], ...patch };
  saveState({ windows: { ...state.windows, [name]: windowState } });
}

function setActive(name) {
  windows.forEach((win) => win.classList.toggle("is-active", win.dataset.window === name));
  taskWindowButtons.forEach((button) => {
    const win = document.querySelector(`[data-window="${button.dataset.open}"]`);
    button.classList.toggle("is-active", Boolean(win?.classList.contains("is-open")));
  });
  saveState({ active: name });
}

function openWindow(name, detail) {
  const win = document.querySelector(`[data-window="${name}"]`);
  if (!win) return;
  win.classList.add("is-open");
  win.classList.remove("is-minimized");
  win.style.zIndex = String(++topZ);
  setActive(name);
  saveWindowState(name, { open: true });
  clampWindowToDock(win);
  win.dispatchEvent(new CustomEvent("app-open", { detail }));
}

function updateDockTop() {
  if (!taskbar) return;
  document.documentElement.style.setProperty("--dock-top", `${taskbar.getBoundingClientRect().top}px`);
}

function clampWindowToDock(win) {
  if (!taskbar || !win.classList.contains("is-open")) return;
  const dockTop = taskbar.getBoundingClientRect().top;
  const margin = 12;
  const rect = win.getBoundingClientRect();
  if (rect.bottom <= dockTop - margin) return;
  const desktopRect = win.offsetParent.getBoundingClientRect();
  const currentTop = rect.top - desktopRect.top;
  const overflow = rect.bottom - (dockTop - margin);
  win.style.top = `${Math.max(12, currentTop - overflow)}px`;
}

function clampAllWindowsToDock() {
  windows.forEach(clampWindowToDock);
}

function closeWindow(win) {
  win.classList.remove("is-open", "is-active");
  saveWindowState(win.dataset.window, { open: false });
  const next = [...document.querySelectorAll(".app-window.is-open")].pop();
  if (next) setActive(next.dataset.window);
  else setActive("");
}

openers.forEach((opener) => {
  opener.addEventListener("click", () => openWindow(opener.dataset.open, { galleryView: opener.dataset.galleryView }));
});

function clampDockLabel(button) {
  const label = button.querySelector(".dock-label");
  if (!label) return;
  label.style.setProperty("--dock-shift", "0px");
  const btn = button.getBoundingClientRect();
  const center = btn.left + btn.width / 2;
  const half = label.offsetWidth / 2;
  const margin = 8;
  let shift = 0;
  if (center + half > window.innerWidth - margin) shift = window.innerWidth - margin - (center + half);
  else if (center - half < margin) shift = margin - (center - half);
  if (shift) label.style.setProperty("--dock-shift", `${shift}px`);
}

taskButtons.forEach((button) => {
  button.addEventListener("pointerenter", () => {
    button.classList.add("is-hovered");
    clampDockLabel(button);
  });
  button.addEventListener("pointerleave", () => button.classList.remove("is-hovered"));
  button.addEventListener("blur", () => button.classList.remove("is-hovered"));
});

taskExternalOpeners.forEach((opener) => {
  opener.addEventListener("click", () => {
    window.open(opener.dataset.external, "_blank", "noopener,noreferrer");
  });
});

function selectDesktopIcon(selectedIcon) {
  desktopIcons.forEach((opener) => {
    opener.classList.toggle("is-selected", opener === selectedIcon);
  });
}

desktopOpeners.forEach((opener) => {
  opener.addEventListener("click", () => selectDesktopIcon(opener));
  opener.addEventListener("dblclick", () => {
    selectDesktopIcon(opener);
    openWindow(opener.dataset.open, { galleryView: opener.dataset.galleryView });
  });
  opener.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    selectDesktopIcon(opener);
    openWindow(opener.dataset.open, { galleryView: opener.dataset.galleryView });
  });
});

desktopExternalOpeners.forEach((opener) => {
  opener.addEventListener("click", () => selectDesktopIcon(opener));
  opener.addEventListener("dblclick", () => {
    selectDesktopIcon(opener);
    window.open(opener.dataset.external, "_blank", "noopener,noreferrer");
  });
  opener.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    selectDesktopIcon(opener);
    window.open(opener.dataset.external, "_blank", "noopener,noreferrer");
  });
});

windows.forEach((win) => {
  win.addEventListener("pointerdown", () => {
    win.style.zIndex = String(++topZ);
    setActive(win.dataset.window);
  });

  win.querySelector("[data-close]")?.addEventListener("click", () => closeWindow(win));
  win.querySelector("[data-minimize]")?.addEventListener("click", () => {
    win.classList.remove("is-open");
    saveWindowState(win.dataset.window, { open: false });
    setActive("");
  });
  win.querySelector("[data-maximize]")?.addEventListener("click", () => {
    win.classList.toggle("is-maximized");
    win.style.zIndex = String(++topZ);
    setActive(win.dataset.window);
  });
});

function applyTheme(theme) {
  if (!shell) return;
  shell.dataset.theme = theme;
  themeChoices.forEach((choice) => {
    choice.classList.toggle("is-selected", choice.dataset.themeChoice === theme);
  });
  saveState({ theme });
}

themeChoices.forEach((choice) => {
  choice.addEventListener("click", () => applyTheme(choice.dataset.themeChoice));
});

const clock = document.querySelector("[data-clock]");

function updateClock() {
  if (!clock) return;
  const now = new Date();
  clock.textContent = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
}

updateClock();
window.setInterval(updateClock, 30000);

function makeDraggable(win) {
  const titlebar = win.querySelector(".titlebar");
  if (!titlebar) return;

  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;
  let dragging = false;
  let dockLimitY = Infinity;

  titlebar.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button") || window.matchMedia("(max-width: 720px)").matches) return;
    dragging = true;
    win.classList.add("is-dragging");
    shell?.classList.add("is-grabbing");
    win.classList.remove("is-maximized");
    const rect = win.getBoundingClientRect();
    const desktopRect = win.offsetParent.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    originX = rect.left - desktopRect.left;
    originY = rect.top - desktopRect.top;
    dockLimitY = taskbar ? taskbar.getBoundingClientRect().top - desktopRect.top - 12 : Infinity;
    win.style.left = `${originX}px`;
    win.style.top = `${originY}px`;
    win.style.zIndex = String(++topZ);
    setActive(win.dataset.window);
    titlebar.setPointerCapture(event.pointerId);
  });

  titlebar.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const desktop = win.offsetParent;
    const maxX = Math.max(12, desktop.clientWidth - win.offsetWidth - 12);
    const maxYRaw = Math.max(12, desktop.clientHeight - win.offsetHeight - 12);
    const maxY = Math.min(maxYRaw, dockLimitY - win.offsetHeight);
    const nextX = Math.max(12, Math.min(maxX, originX + event.clientX - startX));
    const nextY = Math.max(12, Math.min(maxY, originY + event.clientY - startY));
    win.style.left = `${nextX}px`;
    win.style.top = `${nextY}px`;
  });

  function stopDragging(event) {
    if (!dragging) return;
    dragging = false;
    win.classList.remove("is-dragging");
    shell?.classList.remove("is-grabbing");
    saveWindowState(win.dataset.window, { open: true, left: win.style.left, top: win.style.top });
    if (event?.pointerId != null && titlebar.hasPointerCapture(event.pointerId)) {
      titlebar.releasePointerCapture(event.pointerId);
    }
  }

  titlebar.addEventListener("pointerup", stopDragging);
  window.addEventListener("pointerup", stopDragging);

  titlebar.addEventListener("pointercancel", stopDragging);
  window.addEventListener("blur", stopDragging);
}

windows.forEach(makeDraggable);
updateDockTop();

function restoreState() {
  const state = loadState();
  applyTheme(state.theme || shell?.dataset.theme || "paper");

  const savedWindows = state.windows || {};
  windows.forEach((win) => {
    const saved = savedWindows[win.dataset.window];
    if (!saved) return;
    win.classList.toggle("is-open", Boolean(saved.open));
    if (saved.left && saved.top) {
      win.style.left = saved.left;
      win.style.top = saved.top;
    }
  });

  const fallbackActive = [...document.querySelectorAll(".app-window.is-open")].pop()?.dataset.window || "";
  const savedActiveIsOpen = document.querySelector(`[data-window="${state.active}"]`)?.classList.contains("is-open");
  setActive(savedActiveIsOpen ? state.active : fallbackActive);
}

restoreState();
clampAllWindowsToDock();

window.addEventListener("resize", () => {
  updateDockTop();
  clampAllWindowsToDock();
});

document.querySelector("[data-reset-desktop]")?.addEventListener("click", () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  window.location.reload();
});


// Menu bar dropdowns (Sponsors, Theme)
const dropdownTriggers = [...document.querySelectorAll("[data-dropdown]")];

function closeDropdowns(except) {
  dropdownTriggers.forEach((trigger) => {
    const item = trigger.closest(".menu-item");
    if (item && item !== except) {
      item.classList.remove("is-open");
      trigger.setAttribute("aria-expanded", "false");
    }
  });
}

dropdownTriggers.forEach((trigger) => {
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const item = trigger.closest(".menu-item");
    if (!item) return;
    const willOpen = !item.classList.contains("is-open");
    closeDropdowns(item);
    item.classList.toggle("is-open", willOpen);
    trigger.setAttribute("aria-expanded", String(willOpen));
  });
});

document.querySelectorAll(".menu-dropdown").forEach((panel) => {
  panel.addEventListener("click", (event) => {
    if (event.target.closest("[data-theme-choice], a")) closeDropdowns();
  });
});

document.addEventListener("click", () => closeDropdowns());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDropdowns();
});


// ---------------- Gallery ----------------
const GALLERY_FILES = {
  "day1Prep": [
    "IMG_6740.jpeg",
    "IMG_6748.jpeg",
    "IMG_9695.JPG",
    "IMG_9696.JPG",
    "IMG_9705.JPG",
    "IMG_9734.JPG",
    "IMG_9833.JPG",
    "IMG_9838.JPG",
    "IMG_9839.JPG",
    "IMG_9840.JPG",
    "IMG_9841.JPG"
  ],
  "day1Event": [
    "0397C8AA-A58A-4AE6-AAFA-0BA6EB68BDCF.jpeg",
    "06D0DBF4-97C4-4314-9E0D-3F14B7FB0DE6.jpeg",
    "0BC3027A-4781-4FE1-838E-9E31B25742E2.jpeg",
    "114049D4-D3AB-4378-87AB-54B1A07BF56D.jpeg",
    "1A7A9BE0-EC9E-4DDD-9A81-99878056366B.jpeg",
    "1D3E51E4-3649-44DC-9347-5778E7EDAC36.jpeg",
    "27DB4842-BFBF-4FE2-86E1-F834BB26A177.jpeg",
    "39296893-CA34-4A00-8B02-ACB534A05CD7.jpeg",
    "3F0FDA1E-42FB-49E9-B562-9F4D330E09AF.jpeg",
    "47481323-D059-4E05-8CF3-1A43EABE8A8D.jpeg",
    "48FC9F43-B2E3-4183-93C3-3F3B8375EC30.jpeg",
    "4980DE24-8AEF-4DD3-94A0-E774FC5B1B5B_1_105_c.jpeg",
    "4B2EA038-FCA0-489E-9E3A-D32F9E4E2459.jpeg",
    "53E3474D-8595-4CC4-8D47-140D94F5613C.jpeg",
    "58420583-AD42-4865-B5E2-809A08CC5BAE.jpeg",
    "5D46F7C8-42D3-478B-9E01-A4B1C111F519.jpeg",
    "6C7511AA-B31D-4A68-BC34-10DC73CB1539.jpeg",
    "6FD49B70-43D5-41CB-9585-2E5274155E83.jpeg",
    "8FF1C103-5626-4893-AB0A-ED517D33F7B8.jpeg",
    "926C3246-92AE-47F3-9388-3DB46957A1F6.jpeg",
    "940F87EB-8724-4D86-BF70-104DDE2D3C18.jpeg",
    "96378923-274B-4444-B273-99ABE1DF049A.jpeg",
    "A885C68C-302E-436E-A161-1BB287E538FF.jpeg",
    "B08AAE92-9367-49E4-9ED1-23E3F1912B5E.jpeg",
    "B0AD5966-46BF-4A4F-BC13-608F002D2503.jpeg",
    "B607E4D0-C86F-4D9C-91AB-1036C4C2C65F.jpeg",
    "C3887872-2C0C-46F0-AC48-390D522CF9E6.jpeg",
    "C662547D-4866-49A5-A501-85381CD0FFBE.jpeg",
    "C6C398D5-0CAB-46F1-8615-3B6CBE5ACD56.jpeg",
    "C740D718-2220-4B52-84B8-83D2B0FEFFCC.jpeg",
    "C8EE2E63-B4B7-46F9-A3AF-A3EF5F2877F5.jpeg",
    "DB13849D-C7C0-4773-A8D5-733E4E9973D3.jpeg",
    "EBE787EA-348D-42E4-AFFA-9FCCAA9DDC93.jpeg",
    "F78F51A9-CA04-4C6F-87C5-4393EB5274E4.jpeg",
    "F9C9EFF0-F122-418E-9EA3-96D6A415BBEE.jpeg",
    "IMG_6751.jpeg",
    "IMG_6752.jpeg",
    "IMG_6753.jpeg",
    "IMG_9712.JPG",
    "IMG_9722.JPG",
    "IMG_9740.JPG",
    "IMG_9749.JPG",
    "IMG_9750.JPG",
    "IMG_9751.JPG",
    "IMG_9754.JPG",
    "IMG_9755.JPG",
    "IMG_9758.JPG",
    "IMG_9760.JPG",
    "IMG_9761.JPG",
    "IMG_9762.JPG",
    "IMG_9763.JPG",
    "IMG_9764.JPG",
    "IMG_9765.JPG",
    "IMG_9767.JPG",
    "IMG_9768.JPG",
    "IMG_9770.JPG",
    "IMG_9771.JPG",
    "IMG_9773.JPG",
    "IMG_9774.JPG",
    "IMG_9775.JPG",
    "IMG_9777.JPG",
    "IMG_9778.JPG",
    "IMG_9779.JPG",
    "IMG_9780.JPG",
    "IMG_9783.JPG",
    "IMG_9784.JPG",
    "IMG_9785.JPG",
    "IMG_9786.JPG",
    "IMG_9787.JPG",
    "IMG_9791.JPG",
    "IMG_9796.JPG",
    "IMG_9834.JPG",
    "IMG_9835.JPG",
    "IMG_9836.JPG",
    "IMG_9837.JPG",
    "IMG_9937.JPG",
    "IMG_9938.JPG",
    "IMG_9948.JPG"
  ],
  "day2Event": [
  "IMG_0969.JPG",
  "IMG_0941.JPG",
  "IMG_0014.JPG",
  "IMG_0996.JPG",
  "1T7A2755.jpg",
  "IMG_1040.JPG",
  "IMG_0175.JPG",
  "IMG_1041.JPG",
  "1T7A2768.jpg",
  "1T7A2740.jpg",
  "IMG_0983.JPG",
  "IMG_0001.JPG",
  "IMG_0940.JPG",
  "IMG_0954.JPG",
  "IMG_0942.JPG",
  "IMG_0956.JPG",
  "IMG_0017.JPG",
  "IMG_0981.JPG",
  "IMG_0995.JPG",
  "1T7A2756.jpg",
  "1T7A2757.jpg",
  "IMG_0994.JPG",
  "IMG_0957.JPG",
  "IMG_0953.JPG",
  "IMG_0990.JPG",
  "IMG_0012.JPG",
  "1T7A2870-1.jpg",
  "IMG_1046.JPG",
  "IMG_1047.JPG",
  "1T7A2746.jpg",
  "1T7A2752.jpg",
  "IMG_0013.JPG",
  "IMG_0991.JPG",
  "IMG_0985.JPG",
  "IMG_0950.JPG",
  "IMG_0944.JPG",
  "IMG_0993.JPG",
  "IMG_0011.JPG",
  "1T7A2803.jpg",
  "IMG_1045.JPG",
  "IMG_1051.JPG",
  "IMG_1050.JPG",
  "IMG_1044.JPG",
  "1T7A2802.jpg",
  "1T7A2745.jpg",
  "IMG_0010.JPG",
  "IMG_0986.JPG",
  "IMG_0945.JPG",
  "IMG_0951.JPG",
  "1T7A2736.jpg",
  "1T7A2681.jpg",
  "1T7A2656.jpg",
  "IMG_1023.JPG",
  "1T7A2694.jpg",
  "IMG_0935.JPG",
  "1T7A2709.jpg",
  "1T7A2641.jpg",
  "IMG_1008.JPG",
  "IMG_1034.JPG",
  "1T7A2669.jpg",
  "1T7A2640.jpg",
  "IMG_1009.JPG",
  "1T7A2720.jpg",
  "1T7A2734.jpg",
  "IMG_0934.JPG",
  "1T7A2718.jpg",
  "1T7A2724.jpg",
  "IMG_1025.JPG",
  "IMG_1019.JPG",
  "1T7A2645.jpg",
  "IMG_1024.JPG",
  "1T7A2679.jpg",
  "1T7A2731.jpg",
  "1T7A2727.jpg",
  "1T7A2733.jpg",
  "IMG_1032.JPG",
  "1T7A2647.jpg",
  "1T7A2652.jpg",
  "IMG_1033.JPG",
  "1T7A2691.jpg",
  "IMG_0042.JPG",
  "1T7A2703.jpg",
  "1T7A2677.jpg",
  "IMG_1002.JPG",
  "IMG_1016.JPG",
  "1T7A2702.jpg",
  "IMG_0041.JPG",
  "1T7A2714.jpg",
  "1T7A2700.jpg",
  "1T7A2728.jpg",
  "IMG_1029.JPG",
  "1T7A2661.jpg",
  "IMG_0040.JPG",
  "IMG_0939.JPG",
  "IMG_0044.JPG",
  "IMG_1004.JPG",
  "1T7A2664.jpg",
  "IMG_1005.JPG",
  "IMG_1011.JPG",
  "1T7A2658.jpg",
  "1T7A2738.jpg",
  "IMG_0045.JPG",
  "1T7A2706.jpg",
  "1T7A2712.jpg",
  "1T7A2699.jpg",
  "IMG_1007.JPG",
  "IMG_1013.JPG",
  "1T7A2666.jpg",
  "1T7A2673.jpg",
  "1T7A2698.jpg",
  "1T7A2713.jpg",
  "1T7A2707.jpg",
  "IMG_0974.JPG",
  "IMG_0960.JPG",
  "1T7A2760.jpg",
  "1T7A2774.jpg",
  "1T7A2748.jpg",
  "IMG_1049.JPG",
  "1T7A2749.jpg",
  "IMG_0008.JPG",
  "IMG_0963.JPG",
  "IMG_0977.JPG",
  "IMG_0022.JPG",
  "IMG_0988.JPG",
  "1T7A2858-1.jpg",
  "1T7A2763.jpg",
  "1T7A2762.jpg",
  "1T7A2776.jpg",
  "IMG_0037.JPG",
  "IMG_0989.JPG",
  "IMG_0976.JPG",
  "IMG_0966.JPG",
  "IMG_0972.JPG",
  "1T7A2772.jpg",
  "1T7A2766.jpg",
  "1T7A2878-1.jpg",
  "1T7A2773.jpg",
  "1T7A2861-1.jpg",
  "IMG_0032.JPG",
  "IMG_0998.JPG",
  "IMG_0973.JPG",
  "IMG_0967.JPG",
  "IMG_0971.JPG",
  "IMG_0965.JPG",
  "IMG_0018.JPG",
  "1T7A2765.jpg",
  "1T7A2638.jpg",
  "1T7A2770.jpg",
  "IMG_0964.JPG",
  "IMG_0970.JPG"
]
};

const GALLERY_SETS = {
  meetings: {
    label: "Meetings",
    caption: "Meetings",
    photos: Array.from({ length: 8 }, (_, i) => ({
      src: `assets/gallery/meetings/meeting-${String(i + 1).padStart(2, "0")}.jpg`,
      alt: `Meeting photo ${i + 1}`,
    })),
  },
  day1: {
    label: "Day 1",
    caption: "LexHack '26 · Day 1",
    photos: [
      ...GALLERY_FILES.day1Prep.map((file) => ({
        src: `assets/gallery/lexhack-26/day-1/prep/${file}`,
        alt: "LexHack '26 Day 1 prep photo",
      })),
      ...GALLERY_FILES.day1Event.map((file) => ({
        src: `assets/gallery/lexhack-26/day-1/event/${file}`,
        alt: "LexHack '26 Day 1 event photo",
      })),
    ],
  },
  day2: {
    label: "Day 2",
    caption: "LexHack '26 · Day 2",
    photos: GALLERY_FILES.day2Event.map((file) => ({
      src: `assets/gallery/lexhack-26/day-2/event/${file}`,
      alt: "LexHack '26 Day 2 event photo",
    })),
  },
};

const galleryWindow = document.querySelector('[data-window="gallery"]');
const lightbox = document.querySelector("[data-lightbox]");

if (galleryWindow) {
  const galleryPanels = {
    albums: galleryWindow.querySelector('[data-gallery-panel="albums"]'),
    lexhack: galleryWindow.querySelector('[data-gallery-panel="lexhack"]'),
    photos: galleryWindow.querySelector('[data-gallery-panel="photos"]'),
  };
  const galleryCrumbs = galleryWindow.querySelector("[data-gallery-crumbs]");
  let currentSetKey = null;
  let lightboxIndex = 0;

  function showGalleryPanel(name) {
    Object.entries(galleryPanels).forEach(([key, el]) => {
      if (el) el.hidden = key !== name;
    });
    clampWindowToDock(galleryWindow);
  }

  function setGalleryCrumbs(steps) {
    galleryCrumbs.innerHTML = "";
    steps.forEach((step, index) => {
      const isLast = index === steps.length - 1;
      const crumb = document.createElement("button");
      crumb.type = "button";
      crumb.textContent = step.label;
      if (isLast) {
        crumb.disabled = true;
        crumb.classList.add("is-current");
      } else {
        crumb.addEventListener("click", step.action);
      }
      galleryCrumbs.appendChild(crumb);
      if (!isLast) {
        const sep = document.createElement("span");
        sep.className = "gallery-crumb-sep";
        sep.textContent = "/";
        galleryCrumbs.appendChild(sep);
      }
    });
  }

  function openGalleryAlbums() {
    showGalleryPanel("albums");
    setGalleryCrumbs([{ label: "Gallery", action: openGalleryAlbums }]);
  }

  function openLexhackFolders() {
    showGalleryPanel("lexhack");
    setGalleryCrumbs([
      { label: "Gallery", action: openGalleryAlbums },
      { label: "LexHack '26", action: openLexhackFolders },
    ]);
  }

  function renderGalleryPhotoGrid(setKey) {
    const set = GALLERY_SETS[setKey];
    const grid = galleryPanels.photos;
    grid.innerHTML = "";
    set.photos.forEach((photo, index) => {
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "gallery-thumb";
      const img = document.createElement("img");
      img.src = photo.src;
      img.alt = photo.alt;
      img.loading = "lazy";
      img.addEventListener("error", () => {
        img.style.display = "none";
      });
      thumb.appendChild(img);
      thumb.addEventListener("click", () => openLightbox(setKey, index));
      grid.appendChild(thumb);
    });
  }

  function openGallerySet(setKey) {
    currentSetKey = setKey;
    renderGalleryPhotoGrid(setKey);
    showGalleryPanel("photos");
    const set = GALLERY_SETS[setKey];
    const steps = [{ label: "Gallery", action: openGalleryAlbums }];
    if (setKey === "day1" || setKey === "day2") {
      steps.push({ label: "LexHack '26", action: openLexhackFolders });
    }
    steps.push({ label: set.label, action: () => openGallerySet(setKey) });
    setGalleryCrumbs(steps);
  }

  galleryWindow.querySelectorAll("[data-gallery-album]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.galleryAlbum;
      if (key === "meetings") openGallerySet("meetings");
      else if (key === "lexhack") openLexhackFolders();
    });
  });

  galleryWindow.querySelectorAll("[data-gallery-folder]").forEach((button) => {
    button.addEventListener("click", () => openGallerySet(button.dataset.galleryFolder));
  });

  openGalleryAlbums();
  galleryWindow.addEventListener("app-open", (event) => {
    if (event.detail?.galleryView === "lexhack") openLexhackFolders();
    else openGalleryAlbums();
  });

  // ---- lightbox ----
  const lightboxImg = lightbox?.querySelector("[data-lightbox-img]");
  const lightboxCaption = lightbox?.querySelector("[data-lightbox-caption]");

  function updateLightbox() {
    const set = GALLERY_SETS[currentSetKey];
    const photo = set.photos[lightboxIndex];
    lightboxImg.src = photo.src;
    lightboxImg.alt = photo.alt;
    lightboxCaption.textContent = `${set.caption} — ${lightboxIndex + 1} / ${set.photos.length}`;
  }

  function openLightbox(setKey, index) {
    currentSetKey = setKey;
    lightboxIndex = index;
    updateLightbox();
    lightbox.hidden = false;
  }

  function closeLightbox() {
    lightbox.hidden = true;
  }

  function stepLightbox(delta) {
    const set = GALLERY_SETS[currentSetKey];
    lightboxIndex = (lightboxIndex + delta + set.photos.length) % set.photos.length;
    updateLightbox();
  }

  lightbox?.querySelector("[data-lightbox-close]")?.addEventListener("click", closeLightbox);
  lightbox?.querySelector("[data-lightbox-prev]")?.addEventListener("click", () => stepLightbox(-1));
  lightbox?.querySelector("[data-lightbox-next]")?.addEventListener("click", () => stepLightbox(1));
  lightbox?.addEventListener("click", (event) => {
    if (event.target === lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (lightbox?.hidden) return;
    if (event.key === "Escape") closeLightbox();
    if (event.key === "ArrowLeft") stepLightbox(-1);
    if (event.key === "ArrowRight") stepLightbox(1);
  });
}
