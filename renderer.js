const fontFamilies = {
  rounded: '"Quicksand"',
  modern: '"Segoe UI"',
  mono: '"Arial Narrow"',
  condensed: '"SF Pro Display"',
  serif: '"Georgia"',
};

const colorPresets = {
  bg: ["#000000", "#05070a", "#101016", "#11140f", "#160f13"],
  primary: ["#ffffff", "#69f7ff", "#89ffbf", "#ffe66d", "#ff8f5f"],
  colon: ["#ffffff", "#69f7ff", "#ff4fd8", "#89ffbf", "#ffe66d"],
  card: ["#000000", "#11151c", "#d9dfe8", "#f1eadf", "#6f7785"],
};

const clocks = window.KARUMES_CLOCKS || [];

// Transient memory layer to clear custom designs when tabs/windows are closed.
const isBrowserEnv = typeof window.electronAPI === "undefined";

const browserAPI = {
  loadSettings: async () => {
    return null;
  },
  saveSettings: async (data) => {
    return true;
  },
  openExternal: (url) => {
    if (!isBrowserEnv) return window.electronAPI.openExternal(url);
    window.open(url, "_blank", "noopener,noreferrer");
  }
};

const state = {
  section: "library",
  selected: 0,
  activeSelected: 0,
  pointerStart: null,
  profiles: clocks.map((clock) => ({
    bgColor: clock.defaultBg || "#000000",
    color: clock.defaultAccent || "#ffffff",
    colonColor: clock.defaultColon || "#ffffff",
    cardColor: clock.defaultSurface || "#d9dfe8",
    fontFamily: clock.defaultFont || "rounded",
    sizeScale: clock.defaultSizeScale || 1,
    fontSizeScale: clock.defaultFontSizeScale || 1,
    panelSizeScale: 1,
  })),
};

async function loadSettings() {
  try {
    const saved = await browserAPI.loadSettings();
    if (saved) {
      if (typeof saved.selected === "number" && saved.selected >= 0 && saved.selected < clocks.length) {
        state.selected = saved.selected;
        state.activeSelected = saved.selected;
      }
      if (Array.isArray(saved.profiles)) {
        saved.profiles.forEach((profile, index) => {
          if (state.profiles[index] && profile) {
            state.profiles[index] = { ...state.profiles[index], ...profile };
          }
        });
      }
    } else {
      // 保存された設定が無い場合のデフォルトフォールバックをCLOCK2に固定
      state.selected = 0;
      state.activeSelected = 0;
    }
  } catch (error) {
    console.error("Failed to load clock settings:", error);
  }
}

async function saveSettings() {
  try {
    const dataToSave = {
      selected: state.activeSelected,
      profiles: state.profiles,
    };
    await browserAPI.saveSettings(dataToSave);
  } catch (error) {
    console.error("Failed to save clock settings:", error);
  }
}

const platform = document.getElementById("platform");
const librarySection = document.getElementById("library-section");
const clockGrid = document.getElementById("clock-grid");
const saver = document.getElementById("saver");
const mainCanvas = document.getElementById("clockCanvas");
const mainCtx = mainCanvas.getContext("2d");

// Responsive mockup PC viewport screen
const mockupCanvasPC = document.getElementById("mockupCanvasPC");

const settingsPanel = document.getElementById("settings-panel");
const settingsTitle = document.getElementById("settings-title");
const bgInput = document.getElementById("bg-custom-color");
const fontInput = document.getElementById("font-custom-color");
const colonInput = document.getElementById("colon-custom-color");
const cardInput = document.getElementById("card-custom-color");
const fontSelect = document.getElementById("font-family-select");
const sizeScaleInput = document.getElementById("clock-size-scale");
const fontSizeScaleInput = document.getElementById("text-size-scale");
const panelSizeScaleInput = document.getElementById("panel-size-scale");
const dashboardSettingsBtn = document.getElementById("dashboard-settings-btn");
const renderErrors = new Set();

const revealObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add("revealed");
      });
    }, { threshold: 0.16 })
  : null;

function fillPureBlack(ctx, w, h, color) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color || "#000000";
  ctx.fillRect(0, 0, w, h);
}

function drawClockFallback(ctx, w, h, clockName) {
  ctx.save();
  fillPureBlack(ctx, w, h, "#000000");
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.max(18, Math.floor(Math.min(w, h) * 0.055))}px ${fontFamilies.modern}`;
  ctx.fillText(clockName || "Clock", w / 2, h / 2);
  ctx.restore();
}

function getClockControls(index) {
  return new Set(clocks[index]?.controls || []);
}

function buildRendererOptions(clock, profile) {
  const options = {
    suppressBg: true,
    bg: profile.bgColor,
    color: profile.color,
    colonColor: profile.colonColor,
    circleDigitColor: profile.colonColor,
    cardColor: profile.cardColor,
    fontFamily: fontFamilies[profile.fontFamily] || fontFamilies.rounded,
    sizeScale: profile.sizeScale,
    fontSizeScale: profile.fontSizeScale,
    panelSizeScale: profile.panelSizeScale,
    clock6Speed: 0.42,
    fontMode: "solid",
  };
  const optionMap = clock.optionMap || {};
  Object.entries(optionMap).forEach(([profileKey, optionKey]) => {
    if (profileKey === "card") options[optionKey] = profile.cardColor;
    if (profileKey === "colon") options[optionKey] = profile.colonColor;
  });
  return options;
}

function executeRenderer(renderer, ctx, w, h, clock, profile, baseSize, sizeScale, now, options) {
  if (typeof renderer !== "function") throw new Error("Renderer is not a function");
  if (clock.renderer === "renderClock5") {
    renderer(ctx, w, h, profile.color, baseSize * sizeScale, now, options);
  } else {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(sizeScale, sizeScale);
    ctx.translate(-w / 2, -h / 2);
    renderer(ctx, w, h, profile.color, baseSize, now, options);
    ctx.restore();
  }
}

function renderClock(ctx, canvas, index, now, scaleFactor = 1.0) {
  const clock = clocks[index];
  if (!clock) return;
  const profile = state.profiles[index];
  const w = canvas.width;
  const h = canvas.height;
  
  ctx.imageSmoothingEnabled = false;
  fillPureBlack(ctx, w, h, profile.bgColor);

  const renderer = window[clock.renderer];
  // Magnify active size scale to fit monitors properly
  const sizeScale = (Number(profile.sizeScale) || 1) * scaleFactor;
  
  const referenceHeight = 820;
  const baseSize = clock.size * (h / referenceHeight);

  const options = buildRendererOptions(clock, profile);

  try {
    executeRenderer(renderer, ctx, w, h, clock, profile, baseSize, sizeScale, now, options);
  } catch (error) {
    if (!renderErrors.has(clock.renderer)) {
      console.error(`Failed to render ${clock.name}`, error);
      renderErrors.add(clock.renderer);
    }
    drawClockFallback(ctx, w, h, clock.name);
  }
}

function createClockCard(clock, index) {
  const card = document.createElement("button");
  card.className = "clock-card";
  card.type = "button";
  card.setAttribute("aria-label", `${clock.name} clock`);
  
  // Direct fullscreen launching upon item click
  card.addEventListener("click", () => {
    launchClock(index, false);
  });

  const img = document.createElement("img");
  img.className = "clock-preview-image";
  img.src = clock.previewImage || ""; 
  img.alt = `${clock.name} preview`;
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "contain";
  const shine = document.createElement("span");
  shine.className = "card-shine";
  card.append(img, shine);
  clockGrid.appendChild(card);
  if (revealObserver) revealObserver.observe(card);
  else requestAnimationFrame(() => card.classList.add("revealed"));
}

function buildGrid() {
  clockGrid.innerHTML = "";
  clocks.forEach(createClockCard);
  updateSelectionUI();
}

function updateSelectionUI() {
  document.querySelectorAll(".clock-card").forEach((card, index) => {
    card.classList.toggle("selected", index === state.activeSelected);
    card.setAttribute("aria-pressed", String(index === state.activeSelected));
  });
}

function launchClock(index, makeActive = false) {
  state.selected = index;
  if (makeActive) {
    state.activeSelected = index;
    saveSettings();
  }
  updateSelectionUI();
  platform.classList.add("hidden");
  saver.classList.remove("hidden");
  closeSettings();
  resizeMainCanvas();
  renderMain(new Date());
}

function returnHome() {
  saver.classList.add("hidden");
  settingsPanel.classList.add("hidden");
  platform.classList.remove("hidden");
  updateSelectionUI();
}

function setColorInput(input, value) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function syncSwatchState() {
  const map = {
    bg: bgInput.value,
    primary: fontInput.value,
    colon: colonInput.value,
    card: cardInput.value,
  };
  Object.entries(map).forEach(([key, value]) => {
    document.querySelectorAll(`[data-swatches="${key}"] .color-swatch`).forEach((button) => {
      button.classList.toggle("active", button.dataset.color === value);
    });
  });
}

function buildColorSwatches() {
  Object.entries(colorPresets).forEach(([key, colors]) => {
    const wrap = document.querySelector(`[data-swatches="${key}"]`);
    if (!wrap) return;
    wrap.innerHTML = "";
    colors.forEach((color) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "color-swatch";
      button.dataset.color = color;
      button.style.setProperty("--swatch", color);
      button.setAttribute("aria-label", `${key} ${color}`);
      button.addEventListener("click", () => {
        const input = document.getElementById(wrap.closest("[data-color-target]").dataset.colorTarget);
        wrap.closest(".settings-color").querySelector(".custom-color-panel").classList.remove("open");
        setColorInput(input, color);
        syncSwatchState();
      });
      wrap.appendChild(button);
    });
    const custom = document.createElement("button");
    custom.type = "button";
    custom.className = "color-swatch custom";
    custom.setAttribute("aria-label", `Custom ${key} color`);
    custom.addEventListener("click", () => {
      wrap.closest(".settings-color").querySelector(".custom-color-panel").classList.toggle("open");
    });
    wrap.appendChild(custom);
  });
}

function openSettings() {
  const clock = clocks[state.selected];
  const profile = state.profiles[state.selected];
  const controls = getClockControls(state.selected);
  settingsTitle.textContent = clock.name;
  bgInput.value = profile.bgColor;
  fontInput.value = profile.color;
  colonInput.value = profile.colonColor;
  cardInput.value = profile.cardColor;
  fontSelect.value = profile.fontFamily;
  if (sizeScaleInput) {
    sizeScaleInput.setAttribute("max", "10"); 
    sizeScaleInput.setAttribute("step", "0.05");
  }
  sizeScaleInput.value = profile.sizeScale;
  fontSizeScaleInput.value = profile.fontSizeScale;
  panelSizeScaleInput.value = profile.panelSizeScale;
  document.querySelectorAll("[data-setting]").forEach((row) => {
    const visible = controls.has(row.dataset.setting);
    row.classList.toggle("hidden-setting", !visible);
  });
  syncSwatchState();
  settingsPanel.classList.remove("hidden");
}

function closeSettings() {
  settingsPanel.classList.add("hidden");
}

function updateProfileFromControls() {
  const profile = state.profiles[state.selected];
  profile.bgColor = bgInput.value;
  profile.color = fontInput.value;
  profile.colonColor = colonInput.value;
  profile.cardColor = cardInput.value;
  profile.fontFamily = fontSelect.value;
  profile.sizeScale = Number(sizeScaleInput.value);
  profile.fontSizeScale = Number(fontSizeScaleInput.value);
  profile.panelSizeScale = Number(panelSizeScaleInput.value);
  syncSwatchState();
}

function resizeMainCanvas() {
  mainCanvas.width = Math.floor(window.innerWidth * window.devicePixelRatio);
  mainCanvas.height = Math.floor(window.innerHeight * window.devicePixelRatio);
}

function resizeMockupCanvases() {
  if (mockupCanvasPC) {
    // 1080p native lock resolution maintains precise widescreen aspect rendering
    mockupCanvasPC.width = 1920;
    mockupCanvasPC.height = 1080;
  }
}

function renderMain(now) {
  if (saver.classList.contains("hidden")) return;
  renderClock(mainCtx, mainCanvas, state.selected, now);
}

function renderMockups(now) {
  if (mockupCanvasPC) {
    const ctx = mockupCanvasPC.getContext("2d");
    // Clock scale amplified (1.2x baseline) for full widescreen presence
    renderClock(ctx, mockupCanvasPC, state.activeSelected, now, 1);
  }
}

function loop() {
  const now = new Date();
  renderMain(now);
  renderMockups(now);
  requestAnimationFrame(loop);
}

const WEB3FORMS_ACCESS_KEY = "5f0c4abe-c128-4c14-9add-346edee2740c"; 

function initDashboardElements() {
  const feedbackForm = document.getElementById("feedback-form");
  const feedbackStatus = document.getElementById("feedback-status");
  const submitBtn = document.getElementById("submit-feedback-btn");

  const paypalBtn = document.getElementById("paypal-donate-btn");
  const stripeBtn = document.getElementById("stripe-donate-btn");

  const downloadModal = document.getElementById("download-modal");
  const closeDownloadModal = document.getElementById("close-download-modal");

  const historyModal = document.getElementById("history-modal");
  const closeHistoryModal = document.getElementById("close-history-modal");
  const historyToggleBtn = document.getElementById("history-toggle-btn");

  const openModal = (modal) => {
    modal.classList.remove("hidden");
  };

  const closeModal = (modal) => {
    modal.classList.add("hidden");
  };

  if (historyToggleBtn) {
    historyToggleBtn.addEventListener("click", () => openModal(historyModal));
  }
  if (closeHistoryModal) {
    closeHistoryModal.addEventListener("click", () => closeModal(historyModal));
  }

  if (paypalBtn) {
    paypalBtn.addEventListener("click", () => {
      browserAPI.openExternal("https://www.paypal.com/ncp/payment/L5YJBZE3DX6DQ");
    });
  }
  if (stripeBtn) {
    stripeBtn.addEventListener("click", () => {
      browserAPI.openExternal("https://donate.stripe.com/14A14g1hD0lrdxzdycdUY02");
    });
  }

  document.querySelectorAll(".web-download-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const link = document.createElement('a');
      link.href = 'Karumes Clock.zip';
      link.download = 'Karumes Clock.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  });

  [downloadModal, historyModal].forEach((modal) => {
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          closeModal(modal);
        }
      });
    }
  });

  feedbackForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    feedbackStatus.textContent = "Sending message...";
    feedbackStatus.className = "feedback-status sending";

    const subject = document.getElementById("feedback-subject").value;
    const message = document.getElementById("feedback-message").value;

    const payload = {
      access_key: WEB3FORMS_ACCESS_KEY,
      subject: `[Karumes Web Feedback] ${subject}`,
      message: `Message:\n${message}`,
    };

    try {
      const response = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (response.status === 200 || result.success) { 
        feedbackStatus.textContent = "Thank you! Your feedback has been sent successfully.";
        feedbackStatus.className = "feedback-status success";
        feedbackForm.reset();
      } else {
        feedbackStatus.textContent = "Something went wrong. Please try again.";
        feedbackStatus.className = "feedback-status error";
      }
    } catch (error) {
      console.error("Error sending email:", error);
      feedbackStatus.textContent = "Network error. Please check your connection and try again.";
      feedbackStatus.className = "feedback-status error";
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function initEvents() {
  dashboardSettingsBtn.addEventListener("click", () => {
    state.selected = state.activeSelected;
    openSettings();
  });
  document.getElementById("home-btn").addEventListener("click", returnHome);
  document.getElementById("settings-btn").addEventListener("click", openSettings);
  document.getElementById("close-settings").addEventListener("click", closeSettings);
  document.getElementById("apply-btn").addEventListener("click", async () => {
    state.activeSelected = state.selected;
    await saveSettings();
    returnHome();
  });
  [bgInput, fontInput, colonInput, cardInput, fontSelect, sizeScaleInput, fontSizeScaleInput, panelSizeScaleInput].forEach((input) => {
    input.addEventListener("input", () => {
      updateProfileFromControls();
      renderMockups(new Date());
    });
    input.addEventListener("change", () => {
      updateProfileFromControls();
      renderMockups(new Date());
    });
  });
  window.addEventListener("resize", () => {
    resizeMainCanvas();
    resizeMockupCanvases();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !saver.classList.contains("hidden")) returnHome();
  });

  // Track cursor coordinates dynamically to update dynamic interactable radial ambient gradient
  window.addEventListener("mousemove", (e) => {
    document.documentElement.style.setProperty("--mouse-x", `${e.clientX}px`);
    document.documentElement.style.setProperty("--mouse-y", `${e.clientY}px`);
  });

  // renderer.js の initDashboardElements 関数内の一部を変更、または追加
const historyModal = document.getElementById("history-modal");
const closeHistoryModal = document.getElementById("close-history-modal");

const openModal = (modal) => {
  modal.classList.remove("hidden");
};

const closeModal = (modal) => {
  modal.classList.add("hidden");
};

// 既存のナビバーボタンに加え、ヒーロー領域の履歴ボタンにもイベントを登録
document.querySelectorAll("#history-toggle-btn, #hero-history-btn").forEach((btn) => {
  btn.addEventListener("click", () => openModal(historyModal));
});

if (closeHistoryModal) {
  closeHistoryModal.addEventListener("click", () => closeModal(historyModal));
}

  initDashboardElements();
}

async function init() {
  await loadSettings();
  buildColorSwatches();
  buildGrid();
  initEvents();
  resizeMainCanvas();
  resizeMockupCanvases();
  requestAnimationFrame(loop);
}

init();