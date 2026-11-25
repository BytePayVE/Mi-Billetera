"use strict";

const APP_LINKS = {
  android: "./pagobyte.apk",
  iphoneWeb: "./app/"
};

const SUPABASE_URL = "https://huqyycvdakrlfvqugvvp.supabase.co";
const SUPABASE_KEY = "sb_publishable_V8aa6DTypFBmJB6mrajhOw_j732ro87";

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function getSupabase() {
  if (!window.supabase) return null;
  if (!window.__pbSb) window.__pbSb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  return window.__pbSb;
}

document.addEventListener("DOMContentLoaded", () => {
  const yearEl = document.getElementById("currentYear");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const menuBtn = document.getElementById("menuToggle");
  const nav = document.getElementById("siteNav");
  if (menuBtn && nav) {
    menuBtn.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", String(open));
    });
  }

  const apkBtn = document.getElementById("apkDownloadBtn");
  if (apkBtn) apkBtn.href = APP_LINKS.android;
  const iphoneBtn = document.getElementById("iphoneWebBtn");
  if (iphoneBtn) iphoneBtn.href = APP_LINKS.iphoneWeb;

  const openModal = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = false;
    document.body.style.overflow = "hidden";
  };

  const closeAllModals = () => {
    document.querySelectorAll(".modal-backdrop").forEach((m) => { m.hidden = true; });
    document.body.style.overflow = "";
  };

  document.querySelectorAll("[data-open-modal]").forEach((btn) => btn.addEventListener("click", () => openModal(btn.dataset.openModal)));
  document.querySelectorAll("[data-switch-modal]").forEach((btn) => btn.addEventListener("click", () => { closeAllModals(); openModal(btn.dataset.switchModal); }));
  document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", closeAllModals));
  document.querySelectorAll(".modal-backdrop").forEach((b) => b.addEventListener("click", (e) => { if (e.target === b) closeAllModals(); }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAllModals(); });

  // 1. Directorio público de Tiendas Aliadas (tiendas.html)
  const dirContainer = document.getElementById("storesDirectory");
  if (dirContainer) {
    loadStoresDirectory(dirContainer);
  }

  // 2. Verificador público de Solvencia Digital (verificar.html)
  const verifyForm = document.getElementById("verifyForm");
  if (verifyForm) {
    initSolvencyVerifier(verifyForm);
  }

  // 3. Formulario de afiliación de comercios (ayuda.html)
  const form = document.getElementById("affiliateForm");
  if (form) {
    initAffiliateForm(form);
  }
});

async function loadStoresDirectory(container) {
  const input = document.getElementById("storeSearchInput");
  let allStores = [];

  try {
    const sb = getSupabase();
    if (!sb) throw new Error("Sin conexión");
    const { data, error } = await sb.rpc("listar_directorio_tiendas_web");
    if (error) throw error;
    allStores = Array.isArray(data) ? data : [];
  } catch (_) {
    allStores = [];
  }

  const render = (query = "") => {
    const q = query.trim().toLowerCase();
    const list = q
      ? allStores.filter((s) =>
          String(s.nombre_comercial || "").toLowerCase().includes(q) ||
          String(s.ciudad_direccion || "").toLowerCase().includes(q) ||
          String(s.categoria_productos || "").toLowerCase().includes(q)
        )
      : allStores;

    if (!list.length) {
      container.innerHTML = `<div class="loading-box">${allStores.length ? "No encontramos comercios con ese filtro." : "Próximamente publicaremos aquí nuestros comercios aliados verificados."}</div>`;
      return;
    }

    container.innerHTML = list.map((s) => `
      <article class="store-dir-card">
        <span class="store-tag">${esc(s.categoria_productos || "Comercio Aliado")}</span>
        <h3>${esc(s.nombre_comercial)}</h3>
        <p class="store-loc">${esc(s.ciudad_direccion || "Venezuela")}</p>
      </article>
    `).join("");
  };

  render();
  if (input) input.addEventListener("input", () => render(input.value));
}

function initSolvencyVerifier(form) {
  const input = document.getElementById("verifyCodeInput");
  const resultBox = document.getElementById("verifyResult");
  const submitBtn = document.getElementById("verifySubmitBtn");

  const runCheck = async (rawCode) => {
    const code = rawCode.trim().toUpperCase();
    if (!code) return;
    resultBox.hidden = false;
    resultBox.className = "verify-result";
    resultBox.textContent = "Consultando registro de Solvencia Digital...";
    submitBtn.disabled = true;

    try {
      const sb = getSupabase();
      if (!sb) throw new Error("No se pudo conectar con el servidor.");
      const { data, error } = await sb.rpc("verificar_solvencia_publica", { p_codigo: code });
      if (error) throw error;

      if (!data || !data.valida) {
        resultBox.className = "verify-result err";
        resultBox.textContent = (data && data.mensaje) || "Certificado no encontrado o aún no saldado al 100%.";
        return;
      }

      resultBox.className = "verify-result ok";
      resultBox.innerHTML = `
        <strong style="color:#0B7A5A;font-size:1.05rem;">✓ CERTIFICADO AUTÉNTICO Y VERIFICADO</strong>
        <div class="verify-rows">
          <div class="verify-row"><span>Código</span><strong>${esc(data.codigo)}</strong></div>
          <div class="verify-row"><span>Titular</span><strong>${esc(data.titular)}</strong></div>
          <div class="verify-row"><span>Cédula</span><strong>${esc(data.cedula_parcial)}</strong></div>
          <div class="verify-row"><span>Producto saldado</span><strong>${esc(data.producto)}</strong></div>
          <div class="verify-row"><span>Monto saldado</span><strong>$${Number(data.monto_saldado_usd || 0).toFixed(2)} USD</strong></div>
          <div class="verify-row"><span>Estado</span><strong>${esc(data.estado)}</strong></div>
        </div>
      `;
    } catch (err) {
      resultBox.className = "verify-result err";
      resultBox.textContent = "No pudimos validar el código en este momento. Intenta nuevamente.";
    } finally {
      submitBtn.disabled = false;
    }
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    runCheck(input.value);
  });

  // Permite validación automática si el usuario llega escaneando un QR (?codigo=PB-SOLV-...)
  const params = new URLSearchParams(window.location.search);
  const urlCode = params.get("codigo");
  if (urlCode) {
    input.value = urlCode.trim().toUpperCase();
    runCheck(urlCode);
  }
}

function initAffiliateForm(form) {
  const feedback = document.getElementById("formFeedback");
  const submitBtn = document.getElementById("submitAffiliate");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    feedback.textContent = "";
    feedback.className = "form-feedback";

    const hp = document.getElementById("hpField");
    if (hp && hp.value.trim() !== "") return;

    const payload = {
      nombre_comercial: document.getElementById("fNombre").value.trim(),
      rif: document.getElementById("fRif").value.trim().toUpperCase(),
      representante_legal: document.getElementById("fRep").value.trim(),
      telefono_contacto: document.getElementById("fTel").value.trim(),
      correo: document.getElementById("fCorreo").value.trim().toLowerCase(),
      categoria_productos: document.getElementById("fCat").value.trim(),
      ciudad_direccion: document.getElementById("fDir").value.trim(),
      banco_pago_movil: document.getElementById("fBanco").value.trim(),
      telefono_pago_movil: document.getElementById("fTelPm").value.trim()
    };

    if (Object.values(payload).some((v) => !v)) {
      feedback.textContent = "Completa todos los campos para enviar tu solicitud.";
      feedback.classList.add("err");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Enviando solicitud...";

    try {
      const sb = getSupabase();
      if (!sb) throw new Error("No se pudo conectar con el servidor.");
      const { error } = await sb.from("solicitudes_tiendas").insert(payload);
      if (error) throw error;

      form.reset();
      feedback.textContent = "Recibimos tu solicitud. Nuestro equipo te contactará pronto.";
      feedback.classList.add("ok");
      showToast("Solicitud enviada correctamente");
    } catch (_) {
      feedback.textContent = "No pudimos enviar la solicitud en este momento. Intenta de nuevo más tarde.";
      feedback.classList.add("err");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Enviar solicitud de afiliación";
    }
  });
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 3500);
}
