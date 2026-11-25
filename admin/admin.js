"use strict";

// ============================================================================
// 1. CONFIGURACIÓN Y CONEXIÓN CON SUPABASE
// ============================================================================
const SUPABASE_URL = 'https://huqyycvdakrlfvqugvvp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_V8aa6DTypFBmJB6mrajhOw_j732ro87';
const INICIAL_MIN = 0.40;
const CUOTAS_OPC = [3, 4, 5, 6, 9];
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const TERMINOS_VERSION = 'v3-2026-11';
const TERMINOS_CONTRATO = [
  ['1. Naturaleza del Servicio (SENIAT / SUDEBAN)', 'Pagobyte opera como plataforma tecnológica de gestión de compras en cuotas. Los pagos de inicial y cuotas se realizan directamente a las cuentas autorizadas del vendedor/comercio al tipo de cambio oficial del BCV vigente el día del pago.'],
  ['2. Identidad y Datos Inmutables', 'El nombre completo, cédula de identidad, teléfono y correo electrónico registrados constituyen el aval legal del cliente y no pueden ser modificados desde la aplicación.'],
  ['3. Una Solicitud Activa a la Vez', 'El cliente podrá mantener únicamente una (1) solicitud o compra financiada activa a la vez hasta saldar el 100% de sus cuotas.'],
  ['4. Fases, Cuotas y Cero Intereses', 'El precio acordado es final (sin IVA adicional ni intereses ordinarios sobre las cuotas). Las cuotas dependen de la fase del cliente: Bit (3), Byte (4), Kilo (5), Mega (6) y Giga (hasta 9).'],
  ['5. Adelanto de Cuotas', 'El cliente tiene derecho a adelantar cualquier cuota sin penalidad, acumulando puntos a favor para ascender de fase.'],
  ['6. Irrevocabilidad de la Compra', 'Una vez verificada la cuota inicial y entregado el producto, la compra es definitiva e irrevocable y no admite devoluciones ni reembolsos de la inicial.'],
  ['7. Mora, Recargos y Cobranza', 'Un atraso de dos (2) días respecto al vencimiento genera un recargo automático de $5.00 USD. Por cada semana adicional de atraso se sumarán $5.00 USD adicionales (hasta un máximo igual al monto de la cuota). Atención al cliente realizará gestión de cobranza por teléfono, WhatsApp, correo y vías legales correspondientes.']
];

// ============================================================================
// 2. UTILIDADES
// ============================================================================
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = (n) => Math.round(n * 100) / 100;
const num = (n) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (n) => '$' + num(n);
const bs = (n) => 'Bs ' + num(n);
const cuando = (f) => new Date(f).toLocaleString('es-VE', { dateStyle: 'medium', timeStyle: 'short' });
const dia = (f) => new Date(f + 'T00:00:00').toLocaleDateString('es-VE', { dateStyle: 'medium' });
const hoy = () => new Date().toISOString().slice(0, 10);

function fechaMasDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}
function recargoLocal(vence, monto) {
  const d = Math.floor((new Date(hoy() + 'T00:00:00') - new Date(vence + 'T00:00:00')) / 86400000);
  if (d < 2) return 0;
  return Math.min(r2(5 + 5 * Math.floor((d - 2) / 7)), Number(monto));
}
function linkWhatsApp(tel, texto) {
  let clean = String(tel || '').replace(/\D/g, '');
  if (clean.startsWith('0')) clean = '58' + clean.slice(1);
  if (!clean.startsWith('58') && clean.length === 10) clean = '58' + clean;
  return `https://wa.me/${clean}?text=${encodeURIComponent(texto)}`;
}

const vacio = (t) => `<p class="vacio">${t}</p>`;
const falla = (e) => `<p class="error">No se pudo cargar: ${esc(e.message)}</p>`;
const cifra = (t, v, nota = '', clase = '') => `<div class="cifra ${clase}"><span>${t}</span><strong>${v}</strong>${nota ? `<small>${nota}</small>` : ''}</div>`;

let usuarioId = null;
let vistaActual = 'resumen';
let lista = [];
let comprasCache = [];
let clientesCache = [];
let prefill = null;
let tasaActualBcv = null;

const abrir = (html) => { $('hojaCont').innerHTML = html; $('hoja').hidden = false; };
const cerrar = () => { $('hoja').hidden = true; };

// Ocultar Splash de caída Pagobyte suavemente al iniciar
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const sp = document.getElementById('pbSplash');
    if (sp) sp.classList.add('oculto');
  }, 1150);
});

const skeletonCards = (n = 3) => Array.from({ length: n }, () => `
  <div class="pb-skel-card">
    <div class="pb-skel-line"></div>
    <div class="pb-skel-line sm"></div>
    <div class="pb-skel-line lg"></div>
  </div>`).join('');

async function actualizarBadgesNav() {
  try {
    const [sol, pag] = await Promise.all([
      sb.from('solicitudes').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente'),
      sb.from('pagos_reportados').select('id', { count: 'exact', head: true }).eq('estado', 'reportado')
    ]);
    const bSol = $('bdgSol'), bPag = $('bdgPag');
    if (bSol) { const c = sol.count || 0; bSol.textContent = c > 9 ? '9+' : c; bSol.hidden = c === 0; }
    if (bPag) { const c = pag.count || 0; bPag.textContent = c > 9 ? '9+' : c; bPag.hidden = c === 0; }
  } catch (_) {}
}

function aviso(t, tipo = 'ok') {
  const a = $('aviso'); a.textContent = t; a.className = 'toast-' + tipo; a.hidden = false;
  clearTimeout(aviso.t); aviso.t = setTimeout(() => { a.hidden = true; }, 4000);
}
function mostrar(cual) {
  $('login').hidden = cual !== 'login';
  $('panel').hidden = cual !== 'panel';
  $('panelTienda').hidden = cual !== 'tienda';
}

// ============================================================================
// 3. SINCRONIZACIÓN AUTOMÁTICA DE TASA BCV
// ============================================================================
const BcvService = {
  async sincronizar(guardarEnDb = false) {
    $('bcvTexto').textContent = 'BCV: Sync...';
    try {
      const res = await fetch('https://ve.dolarapi.com/v1/dolares/oficial', { cache: 'no-store' });
      const data = await res.json();
      const valor = r2(parseFloat(data.promedio || data.valor));
      if (valor > 0) {
        tasaActualBcv = valor;
        $('bcvTexto').textContent = `BCV: Bs ${num(valor)}`;
        if (guardarEnDb) {
          await sb.from('tasas_bcv').upsert({ fecha: hoy(), tasa_bs: valor }, { onConflict: 'fecha' });
          aviso(`Tasa BCV actualizada en Supabase: Bs ${num(valor)}`);
          if (vistaActual === 'resumen') cargar('resumen');
        }
        return;
      }
    } catch (_) {
      const { data } = await sb.from('tasas_bcv').select('tasa_bs').order('fecha', { ascending: false }).limit(1);
      if (data && data[0]) {
        tasaActualBcv = Number(data[0].tasa_bs);
        $('bcvTexto').textContent = `BCV: Bs ${num(tasaActualBcv)}`;
      }
    }
  }
};


// ============================================================================
// UTILIDADES v2: COMPRESOR DE FOTOS (MÁX 1700 PX) Y BITÁCORA DE AUDITORÍA
// ============================================================================
async function compressImageMax1700(file) {
  if (!file) throw new Error('Selecciona una imagen.');
  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    throw new Error('Formato no permitido. Usa únicamente JPG o PNG.');
  }
  const bitmap = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    img.src = URL.createObjectURL(file);
  });

  const MAX_DIM = 1700;
  let { width, height } = bitmap;
  if (width > MAX_DIM || height > MAX_DIM) {
    if (width >= height) {
      height = Math.round((height * MAX_DIM) / width);
      width = MAX_DIM;
    } else {
      width = Math.round((width * MAX_DIM) / height);
      height = MAX_DIM;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('Error al comprimir la imagen.');
  if (blob.size > 2 * 1024 * 1024) {
    throw new Error('La imagen comprimida supera los 2 MB. Intenta con otra foto.');
  }
  return { blob, width, height };
}

async function uploadProductPhoto(file) {
  const { blob } = await compressImageMax1700(file);
  const path = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await sb.storage.from('productos_img').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false
  });
  if (error) throw error;
  const { data } = sb.storage.from('productos_img').getPublicUrl(path);
  return data.publicUrl;
}

async function registrarAuditoria(actorTipo, actorNombre, accion, detalle = '') {
  try {
    await sb.from('auditoria_eventos').insert({
      actor_tipo: actorTipo,
      actor_nombre: actorNombre,
      accion,
      detalle
    });
  } catch (_) {}
}

function imprimirHabladorTienda(tienda) {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent('https://pagobyte.com')}`;
  const w = window.open('', '_blank', 'width=720,height=920');
  if (!w) return aviso('Permite ventanas emergentes para imprimir el hablador.', 'alerta');
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Hablador Pagobyte — ${esc(tienda.nombre_comercial)}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Georama:wght@600;700;800&display=swap">
  <style>
    body{margin:0;font-family:'Georama',Arial,sans-serif;background:#F4F7FC;display:grid;place-items:center;min-height:100vh;padding:20px;}
    .poster{width:100%;max-width:520px;background:#fff;border:3px solid #1D4ED8;border-radius:24px;overflow:hidden;text-align:center;box-shadow:0 12px 30px rgba(0,0,0,.08);}
    .top{background:linear-gradient(135deg,#1D4ED8,#38A3F1);color:#fff;padding:28px 20px;}
    .top h1{margin:8px 0 4px;font-size:2rem;line-height:1.1;}
    .top p{margin:0;color:#E0F2FE;font-size:1.05rem;font-weight:700;}
    .body{padding:26px 24px;}
    .store{display:inline-block;background:#EAF2FF;color:#1D4ED8;padding:6px 16px;border-radius:999px;font-weight:800;font-size:1rem;margin-bottom:16px;}
    .qr{width:230px;height:230px;padding:12px;border:2px dashed #2563EB;border-radius:18px;margin:0 auto 18px;display:block;}
    .steps{text-align:left;max-width:340px;margin:0 auto 18px;font-size:0.98rem;line-height:1.6;color:#10203A;font-weight:700;}
    .foot{background:#F4F7FC;padding:14px;font-size:0.86rem;color:#52627E;font-weight:700;}
    @media print { body{background:#fff;padding:0;} .no-print{display:none;} .poster{box-shadow:none;} }
  </style></head><body>
  <div class="poster">
    <div class="top">
      <div style="font-size:1.25rem;font-weight:800;letter-spacing:0.5px;">PAGOBYTE</div>
      <h1>¡LLÉVATELO HOY DESDE $5!</h1>
      <p>Inicial flexible + cuotas quincenales • 0% intereses</p>
    </div>
    <div class="body">
      <div class="store">${esc(tienda.nombre_comercial)}</div>
      <img class="qr" src="${qrUrl}" alt="QR Pagobyte">
      <div class="steps">
        1. Escanea el QR y descarga Pagobyte.<br>
        2. Muestra tu ByteCode en caja.<br>
        3. Paga tu inicial directo a la tienda.
      </div>
      <button class="no-print" onclick="window.print()" style="padding:12px 24px;border:none;border-radius:12px;background:#2563EB;color:#fff;font-weight:800;font-size:1rem;cursor:pointer;">Imprimir / Guardar PDF</button>
    </div>
    <div class="foot">Comercio Aliado Verificado • Código #${esc(tienda.codigo_numerico)}</div>
  </div></body></html>`);
  w.document.close();
}

// ============================================================================
// 4. SERVICIO DE EXPORTACIÓN DIGITAL (EXCLUSIVO ORGANIZACIÓN)
// ============================================================================
const ExportService = {
  exportarClientesXlsx() {
    if (!clientesCache.length) return aviso('No hay clientes cargados para exportar.');
    const filas = clientesCache.map((c) => ({
      'Cédula': c.cedula,
      'Nombre Completo': c.nombre,
      'Teléfono': c.telefono,
      'Correo': c.correo || '',
      'Fase': `Fase ${c.fase} (${c.fases?.nombre || ''})`,
      'Máximo Cuotas': c.fases?.max_cuotas || 3,
      'Total Compras': (c.compras || []).length,
      'Registrado': cuando(c.creado_en)
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Clientes_Pagobyte');
    XLSX.writeFile(wb, `Pagobyte_Clientes_${hoy()}.xlsx`);
  },

  async exportarContratoWord(compraId) {
    const compra = comprasCache.find((c) => c.id === compraId);
    if (!compra) return;
    const { data: cuotas } = await sb.from('cuotas').select('numero, monto_usd, fecha_vencimiento, estado').eq('compra_id', compraId).order('numero');
    const filasCuotas = (cuotas || []).map((q) => `
      <tr>
        <td style="border:1px solid #dce1ee;padding:7px;">${q.numero === 0 ? 'Inicial (Irrevocable)' : 'Cuota ' + q.numero}</td>
        <td style="border:1px solid #dce1ee;padding:7px;">${q.fecha_vencimiento ? dia(q.fecha_vencimiento) : 'Al activar'}</td>
        <td style="border:1px solid #dce1ee;padding:7px;font-weight:bold;">${usd(q.monto_usd)}</td>
        <td style="border:1px solid #dce1ee;padding:7px;">${q.estado.toUpperCase()}</td>
      </tr>`).join('');

    const clausulasHtml = TERMINOS_CONTRATO.map((t) => `<p style="margin:6px 0;font-size:9.5pt;"><strong>${t[0]}:</strong> ${t[1]}</p>`).join('');

    const html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8"><title>Contrato Pagobyte ${compra.id.slice(0, 8)}</title></head>
      <body style="font-family:Arial,sans-serif;color:#0b1020;padding:24px;line-height:1.45;">
        <table style="width:100%;border-bottom:3px solid #2447f5;padding-bottom:10px;margin-bottom:16px;">
          <tr>
            <td style="width:52px;">
              <svg width="42" height="42" viewBox="0 0 48 48"><rect x="3" y="3" width="19" height="19" rx="5" fill="#0b1020"/><rect x="26" y="3" width="19" height="19" rx="5" fill="#0b1020"/><rect x="3" y="26" width="19" height="19" rx="5" fill="#0b1020"/><rect x="28" y="28" width="17" height="17" rx="4" fill="#2447f5"/></svg>
            </td>
            <td>
              <h1 style="margin:0;color:#0b1020;font-size:18pt;">PAGO<span style="color:#2447f5;">BYTE</span></h1>
              <div style="font-size:9pt;color:#55607a;">CONTRATO DIGITAL DE COMPROMISO DE PAGO EN CUOTAS • Versión ${TERMINOS_VERSION}</div>
            </td>
            <td style="text-align:right;font-size:9pt;">
              <strong>Contrato N°:</strong> ${compra.id.slice(0, 8).toUpperCase()}<br>
              <strong>Emisión:</strong> ${cuando(compra.creado_en)}
            </td>
          </tr>
        </table>

        <table style="width:100%;background:#f3f5fa;border:1px solid #dce1ee;padding:12px;margin-bottom:14px;font-size:10pt;">
          <tr>
            <td><strong>CLIENTE:</strong> ${esc(compra.clientes?.nombre)}<br><strong>CÉDULA:</strong> ${esc(compra.clientes?.cedula)}</td>
            <td><strong>PRODUCTO:</strong> ${esc(compra.productos?.nombre)} (x${compra.cantidad})<br><strong>TOTAL SIN INTERESES:</strong> ${usd(compra.total_usd)} | <strong>INICIAL:</strong> ${usd(compra.inicial_usd)}</td>
          </tr>
        </table>

        <h3 style="color:#2447f5;font-size:11pt;margin-bottom:6px;">CRONOGRAMA DE PAGOS ACORDADO</h3>
        <table style="width:100%;border-collapse:collapse;font-size:9.5pt;margin-bottom:16px;">
          <thead>
            <tr style="background:#0b1020;color:#ffffff;">
              <th style="padding:7px;text-align:left;">Concepto</th>
              <th style="padding:7px;text-align:left;">Fecha Límite</th>
              <th style="padding:7px;text-align:left;">Monto USD</th>
              <th style="padding:7px;text-align:left;">Estado</th>
            </tr>
          </thead>
          <tbody>${filasCuotas}</tbody>
        </table>

        <h3 style="color:#2447f5;font-size:11pt;margin-bottom:6px;">TÉRMINOS Y CONDICIONES LEGALES</h3>
        ${clausulasHtml}

        <table style="width:100%;margin-top:42px;text-align:center;font-size:9.5pt;">
          <tr>
            <td style="width:50%;">________________________________________<br><strong>FIRMA DEL CLIENTE</strong><br>${esc(compra.clientes?.nombre)} (${esc(compra.clientes?.cedula)})</td>
            <td style="width:50%;">________________________________________<br><strong>ORGANIZACIÓN PAGOBYTE</strong><br>Sello de Validación Digital</td>
          </tr>
        </table>
      </body></html>`;

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' }));
    a.download = `Contrato_Pagobyte_${compra.clientes?.cedula || 'cliente'}_${compra.id.slice(0, 6)}.doc`;
    a.click();
  },

  async exportarContratoPdf(compraId) {
    const compra = comprasCache.find((c) => c.id === compraId);
    if (!compra) return;
    const { data: cuotas } = await sb.from('cuotas').select('numero, monto_usd, fecha_vencimiento, estado').eq('compra_id', compraId).order('numero');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFillColor(11, 16, 32);
    doc.rect(0, 0, 210, 32, 'F');
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(14, 7, 7, 7, 1.5, 1.5, 'F');
    doc.roundedRect(23, 7, 7, 7, 1.5, 1.5, 'F');
    doc.roundedRect(14, 16, 7, 7, 1.5, 1.5, 'F');
    doc.setFillColor(25, 213, 255);
    doc.roundedRect(23.5, 16.5, 6.5, 6.5, 1.2, 1.2, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(17);
    doc.text('PAGOBYTE', 35, 15);
    doc.setTextColor(25, 213, 255);
    doc.setFontSize(9.5);
    doc.text(`CONTRATO DE COMPROMISO DE PAGO N° ${compra.id.slice(0, 8).toUpperCase()}`, 35, 22);

    doc.autoTable({
      startY: 38,
      head: [['DATOS LEGALES DEL CLIENTE', 'CONDICIONES DE LA COMPRA (0% INTERÉS)']],
      body: [[
        `Nombre: ${compra.clientes?.nombre || ''}\nCédula: ${compra.clientes?.cedula || ''}\nFecha: ${cuando(compra.creado_en)}`,
        `Producto: ${compra.productos?.nombre || ''} (x${compra.cantidad})\nPrecio Final: ${usd(compra.total_usd)} | Inicial: ${usd(compra.inicial_usd)}\nPlan: ${compra.numero_cuotas} cuotas quincenales`
      ]],
      headStyles: { fillColor: [36, 71, 245] },
      styles: { fontSize: 9 }
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 6,
      head: [['Cuota', 'Fecha Vencimiento', 'Monto USD', 'Estado']],
      body: (cuotas || []).map((q) => [
        q.numero === 0 ? 'Inicial (Irrevocable)' : `Cuota ${q.numero}`,
        q.fecha_vencimiento ? dia(q.fecha_vencimiento) : 'Al verificar inicial',
        usd(q.monto_usd),
        q.estado.toUpperCase()
      ]),
      headStyles: { fillColor: [11, 16, 32] },
      styles: { fontSize: 8.5 }
    });

    let y = doc.lastAutoTable.finalY + 10;
    doc.setTextColor(36, 71, 245);
    doc.setFontSize(10);
    doc.text(`TÉRMINOS Y CONDICIONES DE COMPROMISO (${TERMINOS_VERSION})`, 14, y);
    y += 5;
    doc.setTextColor(11, 16, 32);
    doc.setFontSize(8);
    TERMINOS_CONTRATO.forEach((t) => {
      const lines = doc.splitTextToSize(`${t[0]}: ${t[1]}`, 182);
      if (y + lines.length * 4 > 258) { doc.addPage(); y = 20; }
      doc.text(lines, 14, y);
      y += lines.length * 3.8 + 2.5;
    });

    const signY = Math.min(272, y + 14);
    doc.line(18, signY, 92, signY);
    doc.line(118, signY, 192, signY);
    doc.setFontSize(8.5);
    doc.text(`Firma Cliente: ${compra.clientes?.nombre || ''}`, 18, signY + 5);
    doc.text(`C.I.: ${compra.clientes?.cedula || ''}`, 18, signY + 9.5);
    doc.text('Organización Pagobyte', 118, signY + 5);
    doc.text('Validación Digital y Auditoría', 118, signY + 9.5);

    doc.save(`Contrato_Pagobyte_${compra.clientes?.cedula || 'cliente'}_${compra.id.slice(0, 6)}.pdf`);
  }
};

// ============================================================================
// 5. AUTENTICACIÓN DUAL (ORGANIZACIÓN VS TIENDAS ALIADAS)
// ============================================================================
document.querySelectorAll('.portal-tab').forEach((b) => {
  b.addEventListener('click', () => {
    const esOrg = b.dataset.portal === 'org';
    $('tabOrg').classList.toggle('activo', esOrg);
    $('tabTienda').classList.toggle('activo', !esOrg);
    $('formLogin').hidden = !esOrg;
    $('cajaTienda').hidden = esOrg;
  });
});

$('subTiendaEntrar').addEventListener('click', () => {
  $('subTiendaEntrar').classList.add('activo');
  $('subTiendaCrear').classList.remove('activo');
  $('formTiendaLogin').hidden = false;
  $('formTiendaRegistro').hidden = true;
});

$('subTiendaCrear').addEventListener('click', () => {
  $('subTiendaCrear').classList.add('activo');
  $('subTiendaEntrar').classList.remove('activo');
  $('formTiendaLogin').hidden = true;
  $('formTiendaRegistro').hidden = false;
});

async function iniciar(registrar) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return mostrar('login');
  const { data: esAdmin } = await sb.rpc('es_admin');
  if (!esAdmin) {
    await sb.auth.signOut();
    $('loginError').textContent = 'Esta cuenta no es de administrador de la Organización.';
    return mostrar('login');
  }
  usuarioId = session.user.id;
  $('usuario').textContent = session.user.email;
  if (registrar) await sb.from('actividad').insert({ usuario_id: usuarioId, accion: 'inicio_sesion', detalle: 'Panel Organización' });
  mostrar('panel');
  BcvService.sincronizar(false);
  actualizarBadgesNav();
  cargar(vistaActual);
}

$('formLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('clave').value });
  if (error) { $('loginError').textContent = 'Correo o contraseña incorrectos.'; return; }
  iniciar(true);
});


// Recuperación de contraseña de la Organización (Supabase Auth)
$('btnOlvideOrg').addEventListener('click', async () => {
  const correo = $('email').value.trim();
  if (!correo) {
    $('loginError').textContent = 'Escribe tu correo administrativo arriba y vuelve a pulsar "¿Olvidaste tu contraseña?".';
    return;
  }
  $('loginError').textContent = '';
  const { error } = await sb.auth.resetPasswordForEmail(correo, {
    redirectTo: location.href.split('#')[0].split('?')[0]
  });
  if (error) {
    $('loginError').textContent = 'No se pudo enviar el correo: ' + error.message;
    return;
  }
  aviso('Te enviamos un enlace a tu correo para restablecer tu contraseña.');
});

sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    abrir(`<h2>Nueva contraseña</h2>
      <p class="nota">Escribe tu nueva contraseña para la cuenta de Organización.</p>
      <label>Nueva contraseña (mínimo 8 caracteres)<input id="nuevaClaveOrg" type="password" minlength="8"></label>
      <p id="errRecOrg" class="error"></p>
      <button id="okRecOrg" class="boton" type="button">Guardar nueva contraseña</button>`);
    $('okRecOrg').addEventListener('click', async () => {
      const nueva = $('nuevaClaveOrg').value;
      if (nueva.length < 8) { $('errRecOrg').textContent = 'Mínimo 8 caracteres.'; return; }
      $('okRecOrg').disabled = true;
      const { error } = await sb.auth.updateUser({ password: nueva });
      if (error) { $('okRecOrg').disabled = false; $('errRecOrg').textContent = error.message; return; }
      cerrar();
      aviso('Contraseña actualizada correctamente.');
      iniciar(false);
    });
  }
});

$('salir').addEventListener('click', async () => { await sb.auth.signOut(); $('clave').value = ''; mostrar('login'); });
$('btnSyncBcv').addEventListener('click', () => BcvService.sincronizar(true));

// Login Tiendas Aliadas Aprobadas
$('formTiendaLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('tiendaError').textContent = '';
  const codigo = $('tCodigo').value.trim();
  const clave = $('tClave').value.trim();
  const { data, error } = await sb.rpc('login_tienda_o_cajero', { p_codigo: codigo, p_clave: clave });
  if (error || !data) {
    $('tiendaError').textContent = error?.message || 'Código o contraseña incorrectos.';
    return;
  }
  abrirPanelTienda(data.tienda, data.rol, data.operador);
});

// Solicitud de Afiliación de Tiendas (Pasa a Entrevista y Revisión)
$('formTiendaRegistro').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('tiendaRegError').textContent = '';
  if ($('trHp') && $('trHp').value.trim() !== '') { $('tiendaRegError').textContent = 'Solicitud bloqueada por filtro antibot.'; return; }
  const solicitud = {
    nombre_comercial: $('trNombre').value.trim(),
    rif: $('trRif').value.trim().toUpperCase(),
    representante_legal: $('trRep').value.trim(),
    correo: $('trCorreo').value.trim(),
    telefono_contacto: $('trTelContacto').value.trim(),
    ciudad_direccion: $('trDireccion').value.trim(),
    categoria_productos: $('trCategoria').value.trim(),
    banco_pago_movil: $('trBanco').value,
    telefono_pago_movil: $('trTel').value.trim(),
    estado: 'pendiente'
  };
  const { error } = await sb.from('solicitudes_tiendas').insert(solicitud);
  if (error) { $('tiendaRegError').textContent = 'No se pudo enviar la solicitud: ' + error.message; return; }
  e.target.reset();
  aviso('Solicitud enviada. Te contactaremos para coordinar la entrevista y validar los requisitos.');
  $('subTiendaEntrar').click();
});

let tiendaActual = null;
let tiendaRol = 'dueno';
async function abrirPanelTienda(tienda, rol = 'dueno', operador = 'Dueño') {
  tiendaActual = tienda;
  tiendaRol = rol;
  $('tiendaNombreBar').textContent = `${tienda.nombre_comercial} (${rol === 'dueno' ? 'Dueño' : 'Cajero: ' + operador})`;
  $('vistaTienda').innerHTML = `
    <div class="hero">
      <span>Portal de Comercio Aliado • Rol: ${rol === 'dueno' ? 'Dueño' : 'Cajero (' + esc(operador) + ')'}</span>
      <strong>${esc(tienda.nombre_comercial)}</strong>
      <small>${rol === 'dueno' ? `RIF: ${esc(tienda.rif)} • Pago Móvil: ${esc(tienda.banco_pago_movil)} (${esc(tienda.telefono_pago_movil)})` : 'Acceso limitado de mostrador: ByteCode y Entregas'}</small>
    </div>
    <div class="tienda-nav" style="grid-column:1/-1;">
      <button type="button" class="activo" data-tvista="qr">🔐 ByteCode</button>
      <button type="button" data-tvista="entregas">📦 Entregas</button>
      <button type="button" data-tvista="buro">🚦 Semáforo Buró</button>
      ${rol === 'dueno' ? '<button type="button" data-tvista="catalogo">🖼️ Mi Catálogo</button>' : ''}
      ${rol === 'dueno' ? '<button type="button" data-tvista="cierre">💵 Cierre de Caja</button>' : ''}
      ${rol === 'dueno' ? '<button type="button" data-tvista="hablador">🖨️ Hablador QR</button>' : ''}
      ${rol === 'dueno' ? '<button type="button" data-tvista="cajeros">👥 Cajeros</button>' : ''}
    </div>
    <div id="tiendaContenido" style="grid-column:1/-1;display:grid;gap:14px;"></div>`;
  mostrar('tienda');
  cargarVistaTienda('qr');
}

async function cargarVistaTienda(tab) {
  document.querySelectorAll('.tienda-nav button').forEach((b) => b.classList.toggle('activo', b.dataset.tvista === tab));
  const box = $('tiendaContenido');
  box.innerHTML = skeletonCards(3);

  if (tab === 'qr') {
    const { data: prods, error } = await sb.from('productos').select('id, nombre, precio_usd, stock').eq('activo', true).gt('stock', 0).order('nombre');
    if (error) { box.innerHTML = falla(error); return; }
    if (!prods.length) { box.innerHTML = vacio('No hay productos activos con stock.'); return; }
    box.innerHTML = `<article class="tarjeta">
      <h3>Cobro en 1 Toque con ByteCode (Sin QR)</h3>
      <p class="nota">Pide al cliente el código dinámico de 6 dígitos que genera su App Pagobyte. Sin cámaras ni escaneos.</p>
      <label>ByteCode del cliente (6 dígitos)<input id="tBcCode" type="text" inputmode="numeric" maxlength="6" placeholder="Ej: 482910" style="font-size:1.25rem;letter-spacing:4px;font-weight:700;"></label>
      <label>Producto<select id="tQrProd">${prods.map((p) => `<option value="${p.id}">${esc(p.nombre)} — ${usd(p.precio_usd)} (stock ${p.stock})</option>`).join('')}</select></label>
      <label>Cantidad<input id="tQrCant" type="number" min="1" max="5" value="1"></label>
      <p id="bcErr" class="error"></p>
      <div class="acciones">
        <button id="btnGenQr" class="boton" type="button">Validar ByteCode y Enviar al Cliente</button>
        <button id="btnShareProd" class="boton claro" type="button">📲 Copiar oferta para WhatsApp / IG</button>
      </div>
    </article>`;
        $('btnShareProd').addEventListener('click', () => {
      const pid = $('tQrProd').value;
      const prod = prods.find((x) => x.id === pid);
      if (!prod) return;
      const ini = r2(prod.precio_usd * 0.40);
      const cuota3 = r2((prod.precio_usd - ini) / 3);
      const txt = `✨ ¡Llévate *${prod.nombre}* en cuotas sin intereses con *Pagobyte* en *${tiendaActual.nombre_comercial}*!\n\n💵 Precio final: ${usd(prod.precio_usd)}\n🔹 Inicial (40%): ${usd(ini)}\n📅 3 cuotas quincenales de ${usd(cuota3)} (0% interés)\n\nDescarga Pagobyte, genera tu ByteCode y ven por el tuyo.`;
      navigator.clipboard.writeText(txt).then(() => aviso('Texto promocional copiado para WhatsApp / Instagram.'));
    });
    $('btnGenQr').addEventListener('click', async () => {
      const code = $('tBcCode').value.replace(/\D/g, '');
      $('bcErr').textContent = '';
      if (code.length !== 6) { $('bcErr').textContent = 'Ingresa el ByteCode completo de 6 dígitos.'; return; }
      $('btnGenQr').disabled = true;
      const { data: res, error: errRpc } = await sb.rpc('enviar_orden_tienda_bytecode', {
        p_codigo: code,
        p_producto_id: $('tQrProd').value,
        p_cantidad: Math.max(1, parseInt($('tQrCant').value, 10) || 1),
        p_tienda_nombre: tiendaActual.nombre_comercial
      });
      $('btnGenQr').disabled = false;
      if (errRpc) { $('bcErr').textContent = errRpc.message; return; }
      $('tBcCode').value = '';
      aviso(`Orden enviada a ${res.cliente} (${res.cedula}).`);
    });
    return;
  }

  if (tab === 'entregas') {
    const { data, error } = await sb.from('compras')
      .select('id, estado, total_usd, inicial_usd, cantidad, entregado, entregado_en, serial_imei, garantia_notas, creado_en, clientes(nombre, cedula), productos(nombre)')
      .in('estado', ['activa', 'esperando_inicial', 'pagada'])
      .order('creado_en', { ascending: false }).limit(30);
    if (error) { box.innerHTML = falla(error); return; }
    if (!data.length) { box.innerHTML = vacio('No hay ventas listas para entrega todavía.'); return; }
    box.innerHTML = data.map((c) => {
      const listaEntrega = c.estado === 'activa' && !c.entregado;
      return `<article class="tarjeta">
        <div class="fila"><strong>${esc(c.clientes?.nombre ?? 'Cliente')} (${esc(c.clientes?.cedula ?? '')})</strong><span class="monto">${usd(c.total_usd)}</span></div>
        <p class="detalle">${esc(c.productos?.nombre ?? '')} x${c.cantidad} • Inicial: ${usd(c.inicial_usd)}</p>
        <p class="nota">
          ${c.entregado ? `<span class="insignia ok">✓ Entregado${c.serial_imei ? ' • IMEI/Serial: ' + esc(c.serial_imei) : ''}</span>` : c.estado === 'activa' ? '<span class="insignia alerta">Inicial verificada — Listo para entregar</span>' : '<span class="insignia">Esperando inicial</span>'}
        </p>
        ${listaEntrega ? `<div class="acciones"><button class="boton" data-entregar="${c.id}">✓ Confirmar Entrega del Producto</button></div>` : ''}
      </article>`;
    }).join('');
    return;
  }


  if (tab === 'cajeros' && tiendaRol === 'dueno') {
    const { data: cajs, error } = await sb.from('cajeros_tienda').select('*').eq('tienda_id', tiendaActual.id).order('creado_en', { ascending: false });
    if (error) { box.innerHTML = falla(error); return; }
    box.innerHTML = `<form id="formNuevoCajero" class="tarjeta">
      <h3>Crear acceso de Cajero (Mostrador)</h3>
      <p class="nota">El cajero entra usando el mismo código numérico de tu tienda (${esc(tiendaActual.codigo_numerico)}) pero con su propio PIN. Solo verá ByteCode y Entregas.</p>
      <div class="dos">
        <label>Nombre del cajero<input id="cajNom" placeholder="Ej: Luis Pérez" required></label>
        <label>PIN de acceso<input id="cajPin" placeholder="Ej: 4580" required></label>
      </div>
      <button type="submit" class="boton">Crear Cajero</button>
    </form>
    ${cajs.length ? cajs.map((c) => `<article class="tarjeta">
      <div class="fila"><strong>${esc(c.nombre)}</strong><span class="mono">PIN: ${esc(c.pin_acceso)}</span></div>
      <p class="nota">${c.activo ? '<span class="insignia ok">Activo</span>' : '<span class="insignia mal">Inactivo</span>'}</p>
      <div class="acciones"><button class="boton claro" data-togglecaj="${c.id}" data-act="${c.activo ? 0 : 1}">${c.activo ? 'Desactivar' : 'Reactivar'}</button></div>
    </article>`).join('') : vacio('No has creado cajeros todavía.')}`;
    $('formNuevoCajero').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { error: eIns } = await sb.from('cajeros_tienda').insert({
        tienda_id: tiendaActual.id,
        nombre: $('cajNom').value.trim(),
        pin_acceso: $('cajPin').value.trim()
      });
      if (eIns) return alert(eIns.message);
      aviso('Cajero creado.');
      cargarVistaTienda('cajeros');
    });
    return;
  }

  if (tab === 'buro') {
    box.innerHTML = `<article class="tarjeta">
      <h3>Semáforo del Buró Interno Pagobyte</h3>
      <p class="nota">Consulta rápida para cajeros y dueños antes de despachar: Verde (puntual), Amarillo (atrasos previos) o Rojo (bloqueado).</p>
      <label>Número de Cédula<input id="buroCed" placeholder="Ej: V12345678"></label>
      <button id="btnBuscarBuro" class="boton" type="button">Consultar Semáforo</button>
      <div id="buroRes" style="margin-top:14px;"></div>
    </article>`;
    $('btnBuscarBuro').addEventListener('click', async () => {
      const q = $('buroCed').value.trim().toUpperCase();
      if (!q) return;
      $('buroRes').innerHTML = vacio('Consultando…');
      const { data, error } = await sb.from('clientes')
        .select('id, nombre, cedula, fase, kyc_verificado, suspendido, motivo_suspension, compras(cuotas(estado, fecha_vencimiento))')
        .ilike('cedula', `%${q}%`).limit(5);
      if (error) { $('buroRes').innerHTML = falla(error); return; }
      if (!data.length) { $('buroRes').innerHTML = '<p class="nota">No se encontró ningún cliente registrado con esa cédula.</p>'; return; }
      $('buroRes').innerHTML = data.map((c) => {
        const todasCuotas = (c.compras || []).flatMap((x) => x.cuotas || []);
        const vencidas = todasCuotas.filter((q) => q.estado === 'vencida' || (q.estado === 'pendiente' && q.fecha_vencimiento && q.fecha_vencimiento < hoy())).length;
        let luz = 'verde', txt = 'VERDE • Puntual / Apto';
        if (c.suspendido) { luz = 'rojo'; txt = 'ROJO • Bloqueado'; }
        else if (vencidas > 0 || !c.kyc_verificado) { luz = 'amarillo'; txt = vencidas > 0 ? `AMARILLO • ${vencidas} atraso(s)` : 'AMARILLO • KYC pendiente'; }
        return `<div class="tarjeta" style="margin-top:8px;">
          <div class="fila">
            <strong>${esc(c.nombre)} (${esc(c.cedula)})</strong>
            <span class="semaforo ${luz}"><span class="dot"></span>${txt}</span>
          </div>
          <p class="nota">Fase ${c.fase} • ${c.kyc_verificado ? 'Identidad verificada' : 'Identidad en revisión'}${c.motivo_suspension ? ' • ' + esc(c.motivo_suspension) : ''}</p>
        </div>`;
      }).join('');
    });
    return;
  }

  if (tab === 'catalogo' && tiendaRol === 'dueno') {
    const { data: prods, error } = await sb.from('productos')
      .select('id, nombre, categoria, precio_usd, stock, activo, max_cuotas, imagen_url')
      .eq('tienda_id', tiendaActual.id).order('nombre');
    if (error) { box.innerHTML = falla(error); return; }
    box.innerHTML = `<form id="formProdTienda" class="tarjeta">
      <h3>Publicar Producto en Mi Catálogo</h3>
      <p class="nota">Las fotos (JPG o PNG) se redimensionan y comprimen automáticamente a máximo 1700 px antes de subir.</p>
      <div class="dos">
        <label>Nombre del producto<input id="tpNom" required placeholder="Ej. Audífonos Bluetooth"></label>
        <label>Categoría<input id="tpCat" required placeholder="Ej. Accesorios, Audio"></label>
      </div>
      <div class="dos">
        <label>Precio final (USD, desde $5)<input id="tpPrecio" type="number" step="0.01" min="5" required placeholder="10.00"></label>
        <label>Stock disponible<input id="tpStock" type="number" min="0" value="5" required></label>
      </div>
      <label>Descripción corta<input id="tpDesc" placeholder="Detalles, garantía o modelo"></label>
      <label>Foto de presentación (JPG/PNG, máx. 1700 px)<input id="tpFoto" type="file" accept="image/jpeg,image/png"></label>
      <p id="tpErr" class="error"></p>
      <button type="submit" id="tpBtn" class="boton">Guardar producto en mi tienda</button>
    </form>
    ${(prods || []).length ? prods.map((p) => {
      const agotado = Number(p.stock || 0) <= 0 || p.activo === false;
      const badgeCls = agotado ? 'mal' : p.stock <= 5 ? 'alerta' : 'ok';
      const badgeTxt = agotado ? 'Agotado / Oculto' : p.stock <= 5 ? 'Stock bajo' : 'Disponible';
      return `<article class="tarjeta">
      <div class="fila" style="align-items:center;gap:12px;">
        ${p.imagen_url ? `<img class="prod-thumb" src="${esc(p.imagen_url)}" alt="${esc(p.nombre)}">` : ''}
        <div style="flex:1;">
          <strong>${esc(p.nombre)}</strong>
          <p class="detalle" style="margin:2px 0;">${esc(p.categoria || 'General')} • Stock: ${p.stock} <span class="insignia ${badgeCls}">${badgeTxt}</span></p>
        </div>
        <span class="monto">${usd(p.precio_usd)}</span>
      </div>
      <div class="stock-ctrl">
        <input type="number" min="0" id="stk-t-${p.id}" value="${p.stock ?? 0}" aria-label="Stock exacto">
        <button type="button" class="boton" data-guardar-stock="${p.id}" data-origen="tienda">Guardar stock</button>
        <button type="button" class="boton alerta" data-eliminar-prod="${p.id}" data-pnom="${esc(p.nombre)}" data-origen="tienda">Eliminar</button>
      </div>
    </article>`;
    }).join('') : vacio('Aún no has publicado productos propios en tu catálogo.')}`;

    $('formProdTienda').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('tpErr').textContent = '';
      const btn = $('tpBtn');
      btn.disabled = true; btn.textContent = 'Optimizando y guardando...';
      try {
        const precio = parseFloat($('tpPrecio').value);
        if (isNaN(precio) || precio < 5) throw new Error('El precio mínimo es de $5.00 USD.');
        let imagen_url = null;
        const file = $('tpFoto').files[0];
        if (file) imagen_url = await uploadProductPhoto(file);
        const { error: insErr } = await sb.from('productos').insert({
          tienda_id: tiendaActual.id,
          nombre: $('tpNom').value.trim(),
          categoria: $('tpCat').value.trim(),
          descripcion: $('tpDesc').value.trim(),
          costo_usd: r2(precio * 0.7),
          precio_usd: r2(precio),
          stock: parseInt($('tpStock').value, 10) || 1,
          max_cuotas: precio <= 15 ? 3 : 6,
          activo: true,
          imagen_url
        });
        if (insErr) throw insErr;
        await registrarAuditoria('tienda', tiendaActual.nombre_comercial, 'Publicó producto', $('tpNom').value.trim());
        aviso('Producto publicado en tu catálogo.');
        cargarVistaTienda('catalogo');
      } catch (err) {
        $('tpErr').textContent = err.message || 'No se pudo guardar el producto.';
      } finally {
        btn.disabled = false; btn.textContent = 'Guardar producto en mi tienda';
      }
    });
    return;
  }

  if (tab === 'cierre' && tiendaRol === 'dueno') {
    const { data, error } = await sb.from('compras')
      .select('id, estado, total_usd, inicial_usd, entregado, creado_en, productos(nombre), clientes(nombre)')
      .or(`tienda_id.eq.${tiendaActual.id},tienda_id.is.null`)
      .in('estado', ['activa', 'pagada', 'esperando_inicial'])
      .order('creado_en', { ascending: false }).limit(60);
    if (error) { box.innerHTML = falla(error); return; }
    const lista = data || [];
    const totalVendido = lista.reduce((s, c) => s + Number(c.total_usd || 0), 0);
    const iniciales = lista.filter((c) => c.estado !== 'esperando_inicial').reduce((s, c) => s + Number(c.inicial_usd || 0), 0);
    const pendEntrega = lista.filter((c) => c.estado === 'activa' && !c.entregado).length;
    box.innerHTML = `<article class="tarjeta">
      <h3>Cierre de Caja — ${esc(tiendaActual.nombre_comercial)}</h3>
      <p class="nota">Resumen de ventas recientes, iniciales confirmadas y entregas pendientes por despachar.</p>
      <div class="kpi-mini-grid">
        <div class="kpi-mini"><span>Total vendido</span><strong>${usd(totalVendido)}</strong></div>
        <div class="kpi-mini"><span>Iniciales confirmadas</span><strong>${usd(iniciales)}</strong></div>
        <div class="kpi-mini"><span>Entregas pendientes</span><strong>${pendEntrega}</strong></div>
      </div>
      ${lista.length ? lista.slice(0, 15).map((c) => `<div class="fila" style="padding:8px 0;border-bottom:1px solid #DCE5F4;">
        <span>${esc(c.clientes?.nombre || 'Cliente')} — ${esc(c.productos?.nombre || '')}</span>
        <strong>${usd(c.total_usd)} <small style="color:#52627E;">(${c.entregado ? 'Entregado' : 'Pendiente'})</small></strong>
      </div>`).join('') : '<p class="nota">Sin movimientos registrados aún.</p>'}
    </article>`;
    return;
  }

  if (tab === 'hablador' && tiendaRol === 'dueno') {
    box.innerHTML = `<article class="tarjeta">
      <h3>Generador de Hablador QR para Mostrador</h3>
      <p class="nota">Descarga o imprime el cartel oficial de <strong>${esc(tiendaActual.nombre_comercial)}</strong> con el mensaje "Llévatelo hoy desde $5" y tu código QR de Pagobyte listo para colocar en caja.</p>
      <button id="btnImprimirHablador" class="boton" type="button">🖨️ Abrir Hablador Listo para Imprimir / PDF</button>
    </article>`;
    $('btnImprimirHablador').addEventListener('click', () => imprimirHabladorTienda(tiendaActual));
    return;
  }
}
$('salirTienda').addEventListener('click', () => mostrar('login'));

// ============================================================================
// 6. VISTAS DE LA ORGANIZACIÓN
// ============================================================================
$('menu').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-vista]');
  if (b) { prefill = null; cargar(b.dataset.vista); }
});

async function vResumen() {
  const [v, q, sol, pag, cl, t, pagadas] = await Promise.all([
    sb.from('compras').select('total_usd').in('estado', ['esperando_inicial', 'activa', 'pagada']),
    sb.from('cuotas').select('monto_usd, fecha_vencimiento, compras!inner(estado)').neq('estado', 'pagada').in('compras.estado', ['esperando_inicial', 'activa']),
    sb.from('solicitudes').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente'),
    sb.from('pagos_reportados').select('id', { count: 'exact', head: true }).eq('estado', 'reportado'),
    sb.from('clientes').select('id', { count: 'exact', head: true }),
    sb.from('tasas_bcv').select('fecha, tasa_bs').order('fecha', { ascending: false }).limit(1),
    sb.from('cuotas').select('fecha_vencimiento, pagada_en').eq('estado', 'pagada').limit(500),
  ]);
  const err = [v, q, sol, pag, cl, t].find((r) => r.error);
  if (err) return falla(err.error);
  const suma = (l, c) => l.reduce((s, x) => s + Number(x[c]), 0);
  const atras = q.data.filter((x) => x.compras.estado === 'activa' && x.fecha_vencimiento < hoy());
  const tasa = t.data[0];
  const lim7 = fechaMasDias(7);
  const lim15 = fechaMasDias(15);
  const prox7 = q.data.filter((x) => x.compras.estado === 'activa' && x.fecha_vencimiento >= hoy() && x.fecha_vencimiento <= lim7);
  const prox15 = q.data.filter((x) => x.compras.estado === 'activa' && x.fecha_vencimiento >= hoy() && x.fecha_vencimiento <= lim15);
  return `<div class="hero"><span>Por cobrar en cuotas</span><strong>${usd(suma(q.data, 'monto_usd'))}</strong><small>${q.data.length} cuotas pendientes en compras comprometidas</small></div>
    <div class="cifras">
      ${cifra('Cobranza próximos 7 días', usd(suma(prox7, 'monto_usd')), prox7.length + ' cuotas por vencer')}
      ${cifra('Cobranza próximos 15 días', usd(suma(prox15, 'monto_usd')), prox15.length + ' cuotas por vencer')}
      ${cifra('Solicitudes por revisar', sol.count ?? 0, '', sol.count > 0 ? 'aviso' : '')}
      ${cifra('Pagos por verificar', pag.count ?? 0, '', pag.count > 0 ? 'aviso' : '')}
      ${cifra('Compras comprometidas', usd(suma(v.data, 'total_usd')))}
      ${cifra('Cuotas atrasadas', atras.length, usd(suma(atras, 'monto_usd')), atras.length ? 'aviso' : '')}
      ${cifra('Clientes registrados', cl.count ?? 0)}
      ${(() => { const list = pagadas.data || []; const aTiempo = list.filter((x) => x.pagada_en && x.pagada_en.slice(0,10) <= x.fecha_vencimiento).length; const pct = list.length ? Math.round((aTiempo / list.length) * 100) : 100; return cifra('Puntualidad de pagos', pct + '%', aTiempo + ' de ' + list.length + ' cuotas a tiempo'); })()}
      ${cifra('Tasa BCV en DB', tasa ? bs(tasa.tasa_bs) : 'Sin tasa', tasa ? 'del ' + dia(tasa.fecha) : 'Pulsa ↻ API arriba')}
    </div>`;
}

async function vSolicitudes() {
  const { data, error } = await sb.from('solicitudes')
    .select('id, cliente_id, producto_id, cantidad, motivo, creada_en, clientes(nombre, cedula, telefono, correo), productos(nombre, stock)')
    .eq('estado', 'pendiente').order('creada_en');
  if (error) return falla(error);
  lista = data;
  if (!data.length) return vacio('No hay solicitudes de clientes por revisar.');
  return data.map((s, i) => `<article class="tarjeta">
    <div class="fila"><strong>${esc(s.clientes?.nombre ?? 'Cliente')}</strong><span class="insignia alerta">Por revisar</span></div>
    <p class="detalle">${esc(s.productos?.nombre ?? '')}, cantidad ${s.cantidad} (stock ${s.productos?.stock ?? 0})</p>
    <p class="detalle">${esc(s.clientes?.cedula ?? '')}, tel. ${esc(s.clientes?.telefono ?? '')}, ${esc(s.clientes?.correo ?? '')}</p>
    <p class="detalle"><em>Motivo:</em> ${esc(s.motivo)}</p>
    <p class="nota">Solicitada el ${cuando(s.creada_en)}</p>
    <div class="acciones"><button class="boton" data-asignar="${i}">Aprobar y asignar</button><button class="boton claro" data-rechazar="${i}">Rechazar</button></div></article>`).join('');
}

async function vAsignar() {
  const [c, p, f] = await Promise.all([
    sb.from('clientes').select('id, nombre, cedula, fase').order('cedula_num'),
    sb.from('productos').select('id, nombre, precio_usd, stock, max_cuotas').eq('activo', true).order('nombre'),
    sb.from('fases').select('fase, nombre, max_cuotas').order('fase'),
  ]);
  if (c.error || p.error || f.error) return falla(c.error || p.error || f.error);
  if (!c.data.length || !p.data.length) return vacio('Necesitas al menos un cliente registrado y un producto activo.');
  const pf = prefill || {};
  setTimeout(() => montarAsignar(c.data, p.data, f.data, pf), 0);
  return `<form id="formAsignar" class="tarjeta">
    <h2>Asignar producto y fraccionar cuotas</h2>
    <label>Cliente (ordenado por cédula)<select id="aCli">${c.data.map((x) => `<option value="${x.id}" ${pf.cliente_id === x.id ? 'selected' : ''}>${esc(x.cedula)} — ${esc(x.nombre)}</option>`).join('')}</select></label>
    <label>Producto<select id="aProd">${p.data.map((x) => `<option value="${x.id}" ${pf.producto_id === x.id ? 'selected' : ''}>${esc(x.nombre)}, ${usd(x.precio_usd)}, stock ${x.stock}</option>`).join('')}</select></label>
    <label>Cantidad<input id="aCant" type="number" min="1" value="${pf.cantidad || 1}" inputmode="numeric"></label>
    <label>Inicial en dólares (mínimo ${Math.round(INICIAL_MIN * 100)} %)<input id="aIni" type="number" step="0.01" inputmode="decimal"></label>
    <label>Número de cuotas (según Fase)<select id="aNc"></select></label>
    <p id="aFase" class="nota"></p>
    <label>Justificación de la asignación<textarea id="aJus" placeholder="Revisión realizada, referencias..."></textarea></label>
    <div id="aSim" class="sim"></div>
    <p id="aErr" class="error" role="alert"></p>
    <button id="aOk" class="boton" type="submit">Asignar y enviar oferta al cliente</button></form>`;
}

function montarAsignar(cls, prods, fases, pf) {
  const llenar = () => {
    const cli = cls.find((x) => x.id === $('aCli').value), p = prods.find((x) => x.id === $('aProd').value);
    const fa = fases.find((x) => x.fase === cli.fase), tope = Math.min(fa ? fa.max_cuotas : 3, p.max_cuotas);
    $('aNc').innerHTML = CUOTAS_OPC.filter((n) => n <= tope).map((n) => `<option value="${n}">${n}</option>`).join('');
    $('aFase').textContent = `Fase ${cli.fase}${fa ? ' (' + fa.nombre + ')' : ''}: hasta ${tope} cuotas (0% interés).`;
  };
  const calc = (fijar) => {
    const p = prods.find((x) => x.id === $('aProd').value);
    const cant = Math.max(1, parseInt($('aCant').value, 10) || 1);
    const total = r2(p.precio_usd * cant), min = r2(total * INICIAL_MIN);
    if (fijar) $('aIni').value = min.toFixed(2);
    const ini = r2(parseFloat($('aIni').value) || 0), n = parseInt($('aNc').value, 10) || 3;
    const resto = r2(total - ini), cuota = r2(resto / n), ultima = r2(resto - cuota * (n - 1));
    const filas = Array.from({ length: n }, (_, i) => `<div><span>Cuota ${i + 1}</span><span>${usd(i === n - 1 ? ultima : cuota)}</span></div>`).join('');
    $('aSim').innerHTML = `<div class="total"><span>Total final (sin IVA ni intereses)</span><span>${usd(total)}</span></div>
      <div><span>Inicial (irrevocable)</span><span>${usd(ini)}</span></div>${filas}`;
    return { p, cant, min, ini, n };
  };
  llenar(); calc(true);
  ['aCli', 'aProd'].forEach((id) => $(id).addEventListener('change', () => { llenar(); calc(true); }));
  $('aCant').addEventListener('input', () => calc(true));
  $('aIni').addEventListener('input', () => calc(false));
  $('aNc').addEventListener('change', () => calc(false));
  $('formAsignar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = calc(false);
    if (v.ini < v.min) { $('aErr').textContent = 'La inicial mínima es ' + usd(v.min) + '.'; return; }
    $('aOk').disabled = true;
    const { error } = await sb.rpc('asignar_compra', {
      p_cliente_id: $('aCli').value, p_producto_id: v.p.id, p_cantidad: v.cant, p_inicial_usd: v.ini,
      p_numero_cuotas: v.n, p_justificacion: $('aJus').value, p_solicitud_id: pf.solicitud_id || null,
    });
    if (error) { $('aOk').disabled = false; $('aErr').textContent = error.message; return; }
    prefill = null; aviso('Oferta enviada al cliente.'); cargar('compras');
  });
}

async function vPagos() {
  const { data, error } = await sb.from('pagos_reportados')
    .select('id, monto_usd, monto_bs, tasa_bs, metodo, referencia, telefono_pago, cedula_titular, fecha_pago, comprobante_path, reportado_en, cuotas(numero, compras(clientes(nombre, cedula, telefono), productos(nombre)))')
    .eq('estado', 'reportado').order('reportado_en');
  if (error) return falla(error);
  if (!data.length) return vacio('No hay pagos por verificar.');
  const refs = data.map((p) => p.referencia).filter(Boolean);
  const { data: refsHist } = refs.length
    ? await sb.from('pagos_reportados').select('id, referencia').in('referencia', refs)
    : { data: [] };
  const refCounts = {};
  (refsHist || []).forEach((r) => { refCounts[r.referencia] = (refCounts[r.referencia] || 0) + 1; });
  const urls = await Promise.all(data.map((p) => (p.comprobante_path ? sb.storage.from('comprobantes').createSignedUrl(p.comprobante_path, 900) : Promise.resolve({ data: null }))));
  return data.map((p, i) => {
    const co = p.cuotas?.compras, ini = p.cuotas?.numero === 0, u = urls[i].data?.signedUrl;
    return `<article class="tarjeta">
      <div class="fila"><strong>${esc(co?.clientes?.nombre ?? 'Cliente')}</strong><span class="monto">${bs(p.monto_bs)}</span></div>
      <p class="detalle">${esc(co?.productos?.nombre ?? '')} • ${ini ? '<b>Inicial</b>' : 'Cuota ' + (p.cuotas?.numero ?? '')} (${usd(p.monto_usd)} a Bs ${Number(p.tasa_bs).toFixed(2)})</p>
      <p class="detalle">${esc(p.metodo ?? '')} • Ref: <b>${esc(p.referencia ?? '')}</b> • Tel: ${esc(p.telefono_pago ?? '')} • C.I. Titular: ${esc(p.cedula_titular ?? '')}</p>
      ${u ? `<a href="${u}" target="_blank" rel="noopener"><img class="comprobante" src="${u}" alt="Comprobante" loading="lazy"></a>` : ''}
      <div class="acciones"><button class="boton" data-pago="${p.id}" data-ok="1">Verificar pago</button><button class="boton claro" data-pago="${p.id}" data-ok="0">Rechazar</button></div></article>`;
  }).join('');
}

let secCli = 0;
async function vClientes() {
  setTimeout(() => {
    let espera;
    $('qCli').addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(dibujarClientes, 300); });
    $('oCli').addEventListener('change', dibujarClientes);
    $('btnExpCliXlsx').addEventListener('click', () => ExportService.exportarClientesXlsx());
    dibujarClientes();
  }, 0);
  return `<div class="barra-herramientas">
      <strong>Padrón de Clientes (Datos Legales Inmutables)</strong>
      <button type="button" id="btnExpCliXlsx" class="mini-btn">📊 Exportar Clientes (.XLSX)</button>
    </div>
    <div class="buscador">
      <input id="qCli" type="search" placeholder="Buscar por cédula o nombre" autocomplete="off">
      <select id="oCli">
        <option value="asc">Cédula, de menor a mayor</option>
        <option value="desc">Cédula, de mayor a menor</option>
        <option value="nuevo">Más recientes primero</option>
      </select>
    </div>
    <div id="listaClientes"></div>`;
}

async function dibujarClientes() {
  const mi = ++secCli, q = $('qCli').value.trim().replace(/[^\p{L}\p{N} ]/gu, ''), o = $('oCli').value;
  let c = sb.from('clientes').select('id, nombre, cedula, telefono, correo, creado_en, fase, estado, ciudad, tipo_zona, direccion_detalle, foto_cedula_path, foto_selfie_path, kyc_verificado, suspendido, motivo_suspension, fases(nombre, max_cuotas), compras(estado)');
  if (q) c = c.or(`cedula.ilike.%${q}%,nombre.ilike.%${q}%`);
  c = o === 'nuevo' ? c.order('creado_en', { ascending: false }) : c.order('cedula_num', { ascending: o === 'asc' });
  const { data, error } = await c.limit(60);
  if (mi !== secCli) return;
  const caja = $('listaClientes');
  if (error) { caja.innerHTML = falla(error); return; }
  clientesCache = data;
  if (!data.length) { caja.innerHTML = vacio('No hay clientes con esa búsqueda.'); return; }
  const telCount = {};
  const dirCount = {};
  data.forEach((x) => {
    const tl = (x.telefono || '').replace(/\D/g, '');
    const dr = (x.direccion_detalle || '').trim().toLowerCase();
    if (tl.length >= 8) telCount[tl] = (telCount[tl] || 0) + 1;
    if (dr.length >= 10) dirCount[dr] = (dirCount[dr] || 0) + 1;
  });
  caja.innerHTML = data.map((c) => {
    const tl = (c.telefono || '').replace(/\D/g, '');
    const dr = (c.direccion_detalle || '').trim().toLowerCase();
    const dupAlert = (tl && telCount[tl] > 1) || (dr && dirCount[dr] > 1);
    const curso = (c.compras || []).some((x) => ['por_aceptar', 'esperando_inicial', 'activa'].includes(x.estado));
    const kycBadge = c.kyc_verificado
      ? '<span class="insignia ok">KYC Verificado</span>'
      : '<span class="insignia alerta">KYC Pendiente</span>';
    const buroBadge = c.suspendido
      ? '<span class="insignia mal">🚫 BLOQUEADO (BURÓ)</span>'
      : '';
    return `<article class="tarjeta" ${c.suspendido ? 'style="border-color:var(--bad);box-shadow:inset 4px 0 0 var(--bad);"' : ''}>
      <div class="fila"><strong>${esc(c.nombre)}</strong><span class="mono">${esc(c.cedula)}</span></div>
      <p class="detalle">Tel. ${esc(c.telefono)} • ${esc(c.correo ?? '')}</p>
      ${c.ciudad ? `<p class="nota">📍 ${esc(c.estado ?? '')}, ${esc(c.ciudad)} (${esc(c.tipo_zona ?? '')})</p>` : ''}
      <p class="detalle">Fase ${c.fase} (${esc(c.fases?.nombre ?? '')}): hasta ${c.fases?.max_cuotas ?? 3} cuotas ${kycBadge} ${buroBadge} ${dupAlert ? '<span class="insignia alerta">⚠️ Alerta Antifraude (Tel/Dir duplicado)</span>' : ''} ${curso ? '<span class="insignia alerta">Compra en curso</span>' : ''}</p>
      <div class="acciones">
        <button class="boton claro" data-kyc="${c.id}">🔍 Revisar KYC</button>
        <button class="boton" data-asignarcli="${c.id}" data-curso="${curso ? 1 : 0}" ${c.suspendido ? 'disabled' : ''}>Asignar</button>
        ${c.fase < 5 ? `<button class="boton claro" data-fase="${c.id}" data-nf="${c.fase + 1}">+Fase</button>` : ''}
        ${c.fase > 1 ? `<button class="boton claro" data-fase="${c.id}" data-nf="${c.fase - 1}">-Fase</button>` : ''}
      </div></article>`;
  }).join('');
}

const ESTADOS = { por_aceptar: ['alerta', 'Esperando aceptación'], esperando_inicial: ['alerta', 'Esperando inicial'], activa: ['ok', 'Activa'], pagada: ['ok', 'Pagada'], cancelada: ['mal', 'Cancelada'] };
async function vCompras() {
  const { data, error } = await sb.from('compras')
    .select('id, estado, total_usd, inicial_usd, numero_cuotas, cantidad, justificacion, creado_en, clientes(nombre, cedula), productos(nombre)')
    .order('creado_en', { ascending: false }).limit(60);
  if (error) return falla(error);
  comprasCache = data;
  if (!data.length) return vacio('Todavía no hay compras registradas.');
  return data.map((c) => {
    const e = ESTADOS[c.estado] || ['', c.estado];
    const cancelable = c.estado === 'por_aceptar' || c.estado === 'esperando_inicial';
    return `<article class="tarjeta">
      <div class="fila"><strong>${esc(c.clientes?.nombre ?? 'Cliente')}</strong><span class="monto">${usd(c.total_usd)}</span></div>
      <p class="detalle">${esc(c.productos?.nombre ?? '')} x${c.cantidad} • Inicial ${usd(c.inicial_usd)} • ${c.numero_cuotas} cuotas</p>
      <p class="nota"><span class="insignia ${e[0]}">${e[1]}</span> ${cuando(c.creado_en)}</p>
      <div class="acciones">
        <button class="boton claro" data-word="${c.id}">📝 Contrato Word</button>
        <button class="boton" data-pdf="${c.id}">📄 Contrato PDF</button>
        ${cancelable ? `<button class="boton alerta" data-cancelar="${c.id}">Cancelar</button>` : ''}
      </div></article>`;
  }).join('');
}

async function vCuotas() {
  const { data, error } = await sb.from('cuotas')
    .select('id, numero, monto_usd, abonado_usd, estado, fecha_vencimiento, compras!inner(id, cliente_id, estado, numero_cuotas, clientes(nombre, telefono), productos(nombre))')
    .neq('estado', 'pagada').eq('compras.estado', 'activa').order('fecha_vencimiento').limit(80);
  if (error) return falla(error);
  if (!data.length) return vacio('No hay cuotas pendientes en compras activas.');
  return data.map((c) => {
    const atras = c.fecha_vencimiento < hoy();
    const rec = atras ? recargoLocal(c.fecha_vencimiento, c.monto_usd) : 0;
    const abonado = r2(Number(c.abonado_usd || 0));
    const total = Math.max(0, r2(Number(c.monto_usd) + rec - abonado));
    const bsTxt = tasaActualBcv ? ` (${bs(total * tasaActualBcv)} a tasa BCV)` : '';
    const cliNom = c.compras.clientes?.nombre ?? 'Cliente';
    const cliTel = c.compras.clientes?.telefono ?? '';
    const prodNom = c.compras.productos?.nombre ?? 'tu compra';
    const msgWa = atras
      ? `Hola ${cliNom}, te escribimos de Pagobyte. Tu cuota ${c.numero} de ${prodNom} venció el ${dia(c.fecha_vencimiento)}. El monto actualizado es ${usd(total)}${bsTxt}${rec > 0 ? ' (incluye ' + usd(rec) + ' de recargo por mora)' : ''}. Por favor reporta tu pago en la app para evitar nuevos recargos.`
      : `Hola ${cliNom}, te recordamos desde Pagobyte que tu cuota ${c.numero} de ${prodNom} vence el ${dia(c.fecha_vencimiento)} por ${usd(total)}${bsTxt}. Recuerda que si adelantas tu pago sumas puntos para subir de Fase.`;
    const waUrl = linkWhatsApp(cliTel, msgWa);
    const e = atras ? ['mal', rec > 0 ? 'Vencida +' + usd(rec) : 'Atrasada'] : c.estado === 'reportada' ? ['alerta', 'Pago reportado'] : ['', 'Pendiente'];
    return `<article class="tarjeta">
      <div class="fila"><strong>${esc(cliNom)}</strong><span class="monto">${usd(total)}</span></div>
      <p class="detalle">${esc(prodNom)}, cuota ${c.numero} de ${c.compras.numero_cuotas}, tel. ${esc(cliTel)}</p>
      <p class="nota">Vence el ${dia(c.fecha_vencimiento)} <span class="insignia ${e[0]}">${e[1]}</span></p>
      ${abonado > 0 ? `<p class="nota" style="color:#0B7A5A;font-weight:700;">Abonado parcial: ${usd(abonado)} • Restante: ${usd(total)}</p>` : ''}
      <div class="acciones">
        <button class="boton claro" data-abono="${c.id}" data-restante="${total}" data-abonado="${abonado}" data-nom="${esc(cliNom)}">💵 Registrar abono parcial</button>
        ${cliTel ? `<a class="boton wa" style="text-align:center;text-decoration:none;" href="${waUrl}" target="_blank" rel="noopener">📲 Recordatorio WhatsApp</a>` : ''}
        ${atras ? `<button class="boton claro" data-acuerdo="${c.compras.id}" data-cli="${c.compras.cliente_id}" data-nom="${esc(cliNom)}">🤝 Acuerdo de Pago</button>` : ''}
      </div>
    </article>`;
  }).join('');
}

async function vProductos() {
  const [prodsRes, tiendasRes] = await Promise.all([
    sb.from('productos').select('id, nombre, categoria, costo_usd, precio_usd, stock, activo, max_cuotas, tienda_id, imagen_url').order('nombre'),
    sb.from('tiendas_aliadas').select('id, nombre_comercial').eq('activa', true).order('nombre_comercial')
  ]);
  if (prodsRes.error) return falla(prodsRes.error);
  const tiendas = tiendasRes.data || [];
  const tiendaMap = Object.fromEntries(tiendas.map((t) => [t.id, t.nombre_comercial]));

  setTimeout(() => {
    const form = $('formAdminProd');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('apBtn');
      const errEl = $('apErr');
      errEl.textContent = '';
      btn.disabled = true; btn.textContent = 'Optimizando y guardando...';
      try {
        const precio = parseFloat($('apPrecio').value);
        const costo = parseFloat($('apCosto').value || '0');
        if (isNaN(precio) || precio < 5) throw new Error('El precio mínimo es de $5.00 USD.');
        let imagen_url = null;
        const file = $('apFoto').files[0];
        if (file) imagen_url = await uploadProductPhoto(file);
        const tid = $('apTienda').value || null;
        const { error } = await sb.from('productos').insert({
          tienda_id: tid,
          nombre: $('apNom').value.trim(),
          categoria: $('apCat').value.trim(),
          descripcion: $('apDesc').value.trim(),
          costo_usd: r2(costo),
          precio_usd: r2(precio),
          stock: parseInt($('apStock').value, 10) || 1,
          max_cuotas: parseInt($('apCuotas').value, 10) || 3,
          activo: true,
          imagen_url
        });
        if (error) throw error;
        await registrarAuditoria('organizacion', 'Administración', 'Creó producto', `${$('apNom').value.trim()} (${usd(precio)})`);
        aviso('Producto guardado con éxito.');
        cargar('productos');
      } catch (err) {
        errEl.textContent = err.message || 'No se pudo guardar el producto.';
      } finally {
        btn.disabled = false; btn.textContent = 'Guardar producto';
      }
    });
  }, 50);

  const formHtml = `<form id="formAdminProd" class="tarjeta">
    <h3>Agregar Producto al Catálogo</h3>
    <p class="nota">Asigna el artículo a una Tienda Aliada y sube su foto (JPG/PNG; se redimensiona automáticamente a máx. 1700 px).</p>
    <div class="dos">
      <label>Tienda Aliada<select id="apTienda"><option value="">— Tienda Oficial Pagobyte —</option>${tiendas.map((t) => `<option value="${t.id}">${esc(t.nombre_comercial)}</option>`).join('')}</select></label>
      <label>Nombre del producto<input id="apNom" required placeholder="Ej. Cargador Rápido 25W"></label>
    </div>
    <div class="dos">
      <label>Categoría<input id="apCat" required placeholder="Ej. Tecnología, Accesorios"></label>
      <label>Precio venta USD (desde $5)<input id="apPrecio" type="number" step="0.01" min="5" required></label>
    </div>
    <div class="dos">
      <label>Costo referencial USD<input id="apCosto" type="number" step="0.01" min="0" value="0"></label>
      <label>Stock y Máx. cuotas
        <div class="dos">
          <input id="apStock" type="number" min="0" value="5" placeholder="Stock">
          <input id="apCuotas" type="number" min="2" max="9" value="3" placeholder="Cuotas">
        </div>
      </label>
    </div>
    <label>Descripción<input id="apDesc" placeholder="Detalles del producto"></label>
    <label>Foto de presentación (JPG/PNG, máx. 1700 px)<input id="apFoto" type="file" accept="image/jpeg,image/png"></label>
    <p id="apErr" class="error"></p>
    <button type="submit" id="apBtn" class="boton">Guardar producto</button>
  </form>`;

  const listHtml = (prodsRes.data || []).length
    ? prodsRes.data.map((p) => {
      const agotado = Number(p.stock || 0) <= 0 || p.activo === false;
      const badgeCls = agotado ? 'mal' : p.stock <= 5 ? 'alerta' : 'ok';
      const badgeTxt = agotado ? 'Agotado / Oculto' : p.stock <= 5 ? 'Stock bajo' : 'Disponible';
      return `<article class="tarjeta">
      <div class="fila" style="align-items:center;gap:12px;">
        ${p.imagen_url ? `<img class="prod-thumb" src="${esc(p.imagen_url)}" alt="${esc(p.nombre)}">` : ''}
        <div style="flex:1;">
          <strong>${esc(p.nombre)}</strong>
          <p class="detalle" style="margin:2px 0;">${esc(tiendaMap[p.tienda_id] || 'Tienda Oficial')} • ${esc(p.categoria ?? 'Sin categoría')}</p>
        </div>
        <span class="monto">${usd(p.precio_usd)}</span>
      </div>
      <p class="nota">Stock: ${p.stock} • Hasta ${p.max_cuotas} cuotas <span class="insignia ${badgeCls}">${badgeTxt}</span></p>
      <div class="stock-ctrl">
        <input type="number" min="0" id="stk-o-${p.id}" value="${p.stock ?? 0}" aria-label="Stock exacto">
        <button type="button" class="boton" data-guardar-stock="${p.id}" data-origen="org">Guardar stock</button>
        <button type="button" class="boton alerta" data-eliminar-prod="${p.id}" data-pnom="${esc(p.nombre)}" data-origen="org">Eliminar</button>
      </div>
    </article>`;
    }).join('')
    : vacio('Todavía no hay productos.');

  return formHtml + listHtml;
}

async function vTiendas() {
  const [sols, aprobadas] = await Promise.all([
    sb.from('solicitudes_tiendas').select('*').in('estado', ['pendiente', 'en_entrevista']).order('creada_en'),
    sb.from('tiendas_aliadas').select('*').order('aprobada_en', { ascending: false })
  ]);
  if (sols.error || aprobadas.error) return falla(sols.error || aprobadas.error);

  const htmlSols = sols.data.length
    ? sols.data.map((s) => `
      <article class="tarjeta">
        <div class="fila">
          <strong>${esc(s.nombre_comercial)}</strong>
          <span class="insignia ${s.estado === 'en_entrevista' ? 'ok' : 'alerta'}">${s.estado === 'en_entrevista' ? 'En entrevista' : 'Pendiente'}</span>
        </div>
        <p class="detalle">RIF: <b>${esc(s.rif)}</b> • Rep.: ${esc(s.representante_legal)}</p>
        <p class="detalle">Contacto: ${esc(s.telefono_contacto)} • ${esc(s.correo)}</p>
        <p class="detalle">Ubicación: ${esc(s.ciudad_direccion)} • Rubro: ${esc(s.categoria_productos)}</p>
        <p class="nota">Pago Móvil: ${esc(s.banco_pago_movil)} (${esc(s.telefono_pago_movil)})</p>
        <div class="acciones">
          ${s.estado === 'pendiente' ? `<button class="boton claro" data-entrevista="${s.id}">Marcar en entrevista</button>` : ''}
          <button class="boton" data-aprobartienda="${s.id}">Aprobar y generar acceso</button>
          <button class="boton alerta" data-rechazartienda="${s.id}">Rechazar</button>
        </div>
      </article>`).join('')
    : vacio('No hay solicitudes de tiendas pendientes.');

  const htmlAprobadas = aprobadas.data.length
    ? aprobadas.data.map((t) => `
      <article class="tarjeta">
        <div class="fila">
          <strong>${esc(t.nombre_comercial)}</strong>
          <span class="mono">ID: ${esc(t.codigo_numerico)}</span>
        </div>
        <p class="detalle">RIF: ${esc(t.rif)} • Clave: <code>${esc(t.clave_acceso)}</code></p>
        <p class="nota">Pago Móvil: ${esc(t.banco_pago_movil)} • ${esc(t.telefono_pago_movil)}</p>
        <p class="nota">Estado licencia: <span class="insignia ${t.activa ? 'ok' : 'mal'}">${t.activa ? 'Activa / Al día' : 'Suspendida'}</span></p>
        <div class="acciones">
          <button class="boton claro" data-comision="${t.id}" data-tnombre="${esc(t.nombre_comercial)}">💳 Registrar mensualidad</button>
          <button class="boton ${t.activa ? 'alerta' : ''}" data-toggletienda="${t.id}" data-activa="${t.activa ? '0' : '1'}" data-tnombre="${esc(t.nombre_comercial)}">${t.activa ? 'Suspender' : 'Reactivar'}</button>
          <button class="boton claro" data-resettienda="${t.id}" data-tnombre="${esc(t.nombre_comercial)}">Restablecer clave</button>
        </div>
      </article>`).join('')
    : vacio('Aún no hay tiendas aliadas aprobadas.');

  return `
    <div class="barra-herramientas"><strong>Solicitudes de Afiliación (Entrevista y Requisitos)</strong></div>
    ${htmlSols}
    <div class="barra-herramientas"><strong>Tiendas Aliadas Activas</strong></div>
    ${htmlAprobadas}`;
}


const MENSAJES_RANDOM = [
  ['¡Sube de Fase más rápido!', 'Adelanta una cuota hoy y acumula puntos extra para desbloquear hasta 9 cuotas sin intereses.'],
  ['Tasa BCV actualizada', 'Recuerda que puedes consultar el monto exacto en bolívares de tu próxima cuota directo en la app.'],
  ['Tu historial vale oro', 'Mantener tus cuotas al día te abre las puertas a mejores productos en todas nuestras tiendas aliadas.'],
  ['¿Sabías que puedes adelantar?', 'En Pagobyte puedes adelantar cuotas cuando quieras sin penalidad y sumar puntos a favor.'],
  ['Compra sin intereses', 'Recuerda que nuestros precios son finales: cero intereses ordinarios y cero IVA adicional.']
];

async function vNotificaciones() {
  const { data: cls, error } = await sb.from('clientes').select('id, nombre, cedula').order('cedula_num');
  if (error) return falla(error);

  setTimeout(() => {
    $('formNotif').addEventListener('submit', async (e) => {
      e.preventDefault();
      const dest = $('nDest').value;
      const titulo = $('nTit').value.trim();
      const mensaje = $('nMsg').value.trim();
      if (!titulo || !mensaje) return;
      $('btnEnvNotif').disabled = true;
      try {
        if (dest === 'TODOS') {
          const filas = cls.map((c) => ({ cliente_id: c.id, titulo, mensaje, tipo: 'broadcast' }));
          const { error: errIns } = await sb.from('notificaciones').insert(filas);
          if (errIns) throw errIns;
          aviso(`Notificación enviada a ${cls.length} clientes.`);
        } else {
          const { error: errIns } = await sb.from('notificaciones').insert({ cliente_id: dest, titulo, mensaje, tipo: 'directa' });
          if (errIns) throw errIns;
          aviso('Notificación enviada al cliente.');
        }
        $('nTit').value = '';
        $('nMsg').value = '';
      } catch (err) {
        alert('No se pudo enviar: ' + err.message);
      } finally {
        $('btnEnvNotif').disabled = false;
      }
    });

    $('btnNotifRandom').addEventListener('click', async () => {
      if (!cls.length) return aviso('No hay clientes registrados.');
      const pick = MENSAJES_RANDOM[Math.floor(Math.random() * MENSAJES_RANDOM.length)];
      if (!confirm(`¿Enviar esta notificación aleatoria a todos (${cls.length} clientes)?\n\n"${pick[0]}"\n${pick[1]}`)) return;
      $('btnNotifRandom').disabled = true;
      try {
        const filas = cls.map((c) => ({ cliente_id: c.id, titulo: pick[0], mensaje: pick[1], tipo: 'random' }));
        const { error: errIns } = await sb.from('notificaciones').insert(filas);
        if (errIns) throw errIns;
        aviso('Notificación aleatoria enviada a todos los clientes.');
      } catch (err) {
        alert('Error: ' + err.message);
      } finally {
        $('btnNotifRandom').disabled = false;
      }
    });
  }, 0);

  return `
    <form id="formNotif" class="tarjeta">
      <h2>Enviar Notificación Push (Supabase Realtime)</h2>
      <p class="nota">Las notificaciones llegan directo a la app de los clientes sin servicios pagos de terceros.</p>
      <label>Destinatario
        <select id="nDest">
          <option value="TODOS">📢 Todos los clientes (${cls.length})</option>
          ${cls.map((c) => `<option value="${c.id}">${esc(c.cedula)} — ${esc(c.nombre)}</option>`).join('')}
        </select>
      </label>
      <label>Título<input id="nTit" placeholder="Ej: ¡Promoción especial o recordatorio!" required></label>
      <label>Mensaje<textarea id="nMsg" placeholder="Escribe el aviso que verá el cliente en su teléfono..." required></textarea></label>
      <div class="acciones">
        <button id="btnEnvNotif" type="submit" class="boton">Enviar Notificación</button>
        <button id="btnNotifRandom" type="button" class="boton claro">🎲 Enviar Aleatoria a Todos</button>
      </div>
    </form>`;
}

async function vActividad() {
  const [aud, a, cl] = await Promise.all([
    sb.from('auditoria_eventos').select('*').order('creado_en', { ascending: false }).limit(50),
    sb.from('actividad').select('usuario_id, accion, creado_en').order('creado_en', { ascending: false }).limit(40),
    sb.from('clientes').select('id, nombre'),
  ]);
  const n = Object.fromEntries((cl.data || []).map((x) => [x.id, x.nombre]));
  const htmlAud = (aud.data || []).length
    ? aud.data.map((ev) => `<article class="tarjeta">
        <div class="fila"><strong>${esc(ev.actor_nombre)} <small style="color:#52627E;">(${esc(ev.actor_tipo)})</small></strong><span class="nota">${cuando(ev.creado_en)}</span></div>
        <p class="detalle"><b>${esc(ev.accion)}</b>${ev.detalle ? ' — ' + esc(ev.detalle) : ''}</p>
      </article>`).join('')
    : vacio('Sin eventos en la bitácora de auditoría todavía.');

  const htmlAct = (a.data || []).length
    ? a.data.map((x) => `<article class="tarjeta"><div class="fila"><strong>${esc(n[x.usuario_id] ?? 'Administración')}</strong><span class="nota">${cuando(x.creado_en)}</span></div>
      <p class="detalle">${esc(x.accion)}</p></article>`).join('')
    : '';

  return `<div class="barra-herramientas"><strong>Bitácora de Auditoría (Organización y Tiendas)</strong></div>${htmlAud}
    ${htmlAct ? `<div class="barra-herramientas"><strong>Actividad de Clientes</strong></div>${htmlAct}` : ''}`;
}

const vistas = {
  resumen: vResumen,
  solicitudes: vSolicitudes,
  clientes: vClientes,
  asignar: vAsignar,
  pagos: vPagos,
  compras: vCompras,
  cuotas: vCuotas,
  productos: vProductos,
  tiendas: vTiendas,
  notificaciones: vNotificaciones,
  actividad: vActividad
};

async function cargar(v) {
  vistaActual = v;
  document.querySelectorAll('#menu button').forEach((b) => b.classList.toggle('activo', b.dataset.vista === v));
  $('vista').innerHTML = skeletonCards(3);
  try { $('vista').innerHTML = await vistas[v](); } catch (e) { $('vista').innerHTML = falla(e); }
  window.scrollTo(0, 0);
}

// ============================================================================
// 7. EVENTOS GLOBALES
// ============================================================================
async function llamar(fn, args, ok, recargar) {
  const { error } = await sb.rpc(fn, args);
  if (error) { alert('No se pudo completar: ' + error.message); return false; }
  aviso(ok); cargar(recargar); return true;
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-cerrar],[data-asignar],[data-asignarcli],[data-fase],[data-rechazar],[data-pago],[data-cancelar],[data-word],[data-pdf],[data-entrevista],[data-aprobartienda],[data-rechazartienda],[data-resettienda],[data-kyc],[data-tvista],[data-entregar],[data-togglecaj],[data-acuerdo],[data-abono],[data-comision],[data-toggletienda],[data-guardar-stock],[data-eliminar-prod]');
  if (!t) return;
  if (t.dataset.cerrar !== undefined) return cerrar();
  if (t.dataset.word) return ExportService.exportarContratoWord(t.dataset.word);
  if (t.dataset.pdf) return ExportService.exportarContratoPdf(t.dataset.pdf);

  

  if (t.dataset.guardarStock) {
    const id = t.dataset.guardarStock;
    const esTienda = t.dataset.origen === 'tienda';
    const inp = $(esTienda ? `stk-t-${id}` : `stk-o-${id}`);
    const nuevoStock = parseInt(inp?.value, 10);
    if (isNaN(nuevoStock) || nuevoStock < 0) {
      return aviso('Ingresa un número válido de stock (0 o mayor).', 'alerta');
    }
    t.disabled = true;
    let q = sb.from('productos').update({ stock: nuevoStock, activo: nuevoStock > 0 }).eq('id', id);
    if (esTienda && tiendaActual?.id) q = q.eq('tienda_id', tiendaActual.id);
    const { error } = await q;
    t.disabled = false;
    if (error) return alert('No se pudo actualizar el stock: ' + error.message);
    await registrarAuditoria(
      esTienda ? 'tienda' : 'organizacion',
      esTienda ? (tiendaActual?.nombre_comercial || 'Tienda') : 'Administración',
      'Actualizó stock exacto',
      `Producto ${id.slice(0, 8)} → ${nuevoStock} uds.`
    );
    aviso(nuevoStock === 0 ? 'Stock en 0 (producto marcado como agotado).' : `Stock actualizado a ${nuevoStock} unidades.`);
    return esTienda ? cargarVistaTienda('catalogo') : cargar('productos');
  }

  if (t.dataset.eliminarProd) {
    const id = t.dataset.eliminarProd;
    const nom = t.dataset.pnom || 'este producto';
    const esTienda = t.dataset.origen === 'tienda';
    if (!confirm(`¿Seguro que deseas eliminar "${nom}" del catálogo? Esta acción no se puede deshacer.`)) return;
    t.disabled = true;
    let q = sb.from('productos').delete().eq('id', id);
    if (esTienda && tiendaActual?.id) q = q.eq('tienda_id', tiendaActual.id);
    const { error } = await q;
    t.disabled = false;
    if (error) {
      if (error.code === '23503') {
        const ocultar = confirm(`"${nom}" ya tiene compras o solicitudes registradas y no se puede borrar del historial.\n\n¿Deseas poner su stock en 0 y ocultarlo del catálogo?`);
        if (ocultar) {
          let qOff = sb.from('productos').update({ stock: 0, activo: false }).eq('id', id);
          if (esTienda && tiendaActual?.id) qOff = qOff.eq('tienda_id', tiendaActual.id);
          const { error: errOff } = await qOff;
          if (errOff) return alert('No se pudo desactivar: ' + errOff.message);
          await registrarAuditoria(
            esTienda ? 'tienda' : 'organizacion',
            esTienda ? (tiendaActual?.nombre_comercial || 'Tienda') : 'Administración',
            'Ocultó producto con historial',
            nom
          );
          aviso('Producto marcado como agotado y oculto.');
          return esTienda ? cargarVistaTienda('catalogo') : cargar('productos');
        }
        return;
      }
      return alert('No se pudo eliminar el producto: ' + error.message);
    }
    await registrarAuditoria(
      esTienda ? 'tienda' : 'organizacion',
      esTienda ? (tiendaActual?.nombre_comercial || 'Tienda') : 'Administración',
      'Eliminó producto',
      nom
    );
    aviso('Producto eliminado correctamente.');
    return esTienda ? cargarVistaTienda('catalogo') : cargar('productos');
  }

  if (t.dataset.abono) {
    const rest = parseFloat(t.dataset.restante || '0');
    const prev = parseFloat(t.dataset.abonado || '0');
    const bsHint = tasaActualBcv ? ` (Tasa BCV hoy: Bs ${num(tasaActualBcv)})` : '';
    const raw = prompt(`Registrar abono parcial para ${t.dataset.nom}\nRestante actual: ${usd(rest)}${bsHint}\n\nIngresa el monto abonado en USD:`);
    if (raw === null) return;
    const monto = r2(parseFloat(raw.replace(',', '.')));
    if (isNaN(monto) || monto <= 0) return aviso('Ingresa un monto válido mayor a 0.', 'alerta');
    const nuevoAbonado = r2(prev + monto);
    const upd = { abonado_usd: nuevoAbonado };
    if (monto >= rest) upd.estado = 'pagada';
    const { error } = await sb.from('cuotas').update(upd).eq('id', t.dataset.abono);
    if (error) return alert('No se pudo registrar el abono: ' + error.message);
    await registrarAuditoria('organizacion', 'Administración', 'Registró abono parcial', `${t.dataset.nom}: +${usd(monto)} USD`);
    aviso(monto >= rest ? 'Abono registrado. ¡Cuota saldada!' : `Abono de ${usd(monto)} registrado.`);
    return cargar('cuotas');
  }

  if (t.dataset.comision) {
    const monto = prompt(`Registrar pago de mensualidad / comisión de ${t.dataset.tnombre} (ej: $20 Mes Noviembre):`);
    if (!monto || !monto.trim()) return;
    await registrarAuditoria('organizacion', 'Administración', 'Mensualidad / Comisión Tienda', `${t.dataset.tnombre}: ${monto.trim()}`);
    aviso('Mensualidad registrada en la bitácora.');
    return;
  }

  if (t.dataset.toggletienda) {
    const activar = t.dataset.activa === '1';
    const { error } = await sb.from('tiendas_aliadas').update({ activa: activar }).eq('id', t.dataset.toggletienda);
    if (error) return alert(error.message);
    await registrarAuditoria('organizacion', 'Administración', activar ? 'Reactivó tienda' : 'Suspendió tienda', t.dataset.tnombre);
    aviso(activar ? 'Tienda reactivada.' : 'Tienda suspendida.');
    return cargar('tiendas');
  }

  if (t.dataset.tvista) {
    return cargarVistaTienda(t.dataset.tvista);
  }

  if (t.dataset.togglecaj) {
    const { error } = await sb.from('cajeros_tienda').update({ activo: t.dataset.act === '1' }).eq('id', t.dataset.togglecaj);
    if (error) return alert(error.message);
    aviso('Estado del cajero actualizado.');
    return cargarVistaTienda('cajeros');
  }

  if (t.dataset.entregar) {
    const imei = prompt('Ingresa el Serial o IMEI del equipo entregado (opcional, recomendado para garantía):') || '';
    const notas = prompt('Notas de garantía (ej: 30 días por defecto de fábrica, caja sellada):') || 'Entregado conforme';
    const { error } = await sb.from('compras').update({
      entregado: true,
      entregado_en: new Date().toISOString(),
      serial_imei: imei.trim() || null,
      garantia_notas: notas.trim() || null
    }).eq('id', t.dataset.entregar);
    if (error) return alert('No se pudo registrar la entrega: ' + error.message);
    aviso('Entrega y serial/garantía registrados.');
    return cargarVistaTienda('entregas');
  }


  if (t.dataset.acuerdo) {
    abrir(`<h2>Acuerdo de Pago — ${esc(t.dataset.nom)}</h2>
      <p class="nota">Registra un plan de rescate congelando recargos adicionales si el cliente abona hoy.</p>
      <form id="fAcuerdo">
        <label>Abono acordado hoy (USD)<input id="acAbono" type="number" step="0.01" min="0" value="10" required></label>
        <label>Nueva fecha límite<input id="acFecha" type="date" value="${fechaMasDias(7)}" required></label>
        <label>Condiciones del anexo<textarea id="acCond" required>Se congelan recargos adicionales de mora sujeto al abono acordado hoy y liquidación en la nueva fecha límite.</textarea></label>
        <button type="submit" class="boton">Guardar Acuerdo y Notificar al Cliente</button>
      </form>`);
    $('fAcuerdo').addEventListener('submit', async (e) => {
      e.preventDefault();
      const abono = Number($('acAbono').value) || 0;
      const fecha = $('acFecha').value;
      const cond = $('acCond').value.trim();
      const { error } = await sb.from('acuerdos_pago').insert({
        compra_id: t.dataset.acuerdo,
        cliente_id: t.dataset.cli,
        abono_hoy_usd: abono,
        nueva_fecha_limite: fecha,
        congelar_mora: true,
        condiciones: cond
      });
      if (error) return alert(error.message);
      await sb.from('notificaciones').insert({
        cliente_id: t.dataset.cli,
        titulo: 'Acuerdo de Pago registrado',
        mensaje: `Registramos tu acuerdo de pago (abono ${usd(abono)}, nueva fecha límite ${dia(fecha)}). Recargos adicionales congelados mientras cumplas el acuerdo.`,
        tipo: 'acuerdo'
      });
      cerrar();
      aviso('Acuerdo de pago guardado y notificado.');
    });
    return;
  }

  if (t.dataset.kyc) {
    const cli = clientesCache.find((x) => x.id === t.dataset.kyc);
    if (!cli) return;
    abrir(`<h2>Auditoría KYC — ${esc(cli.nombre)}</h2>
      <p class="nota">Cédula: <b>${esc(cli.cedula)}</b> • Tel: ${esc(cli.telefono)} • ${esc(cli.correo ?? '')}</p>
      <p class="detalle"><b>Domicilio:</b> ${esc(cli.estado ?? 'No registrado')}, ${esc(cli.ciudad ?? '')} — ${esc(cli.tipo_zona ?? '')}: ${esc(cli.direccion_detalle ?? 'Sin dirección')}</p>
      <div id="kycFotos" class="kyc-grid"><p class="nota">Cargando evidencias cifradas…</p></div>
      <div class="acciones" style="margin-top:16px;">
        <button id="btnKycOk" class="boton" type="button">✓ Aprobar KYC</button>
        <button id="btnKycBuro" class="boton alerta" type="button">${cli.suspendido ? 'Desbloquear del Buró' : '🚫 Suspender (Lista Negra)'}</button>
      </div>`);

    const [uCed, uSel] = await Promise.all([
      cli.foto_cedula_path && !cli.foto_cedula_path.startsWith('pendiente_')
        ? sb.storage.from('kyc_documentos').createSignedUrl(cli.foto_cedula_path, 900)
        : Promise.resolve({ data: null }),
      cli.foto_selfie_path && !cli.foto_selfie_path.startsWith('pendiente_')
        ? sb.storage.from('kyc_documentos').createSignedUrl(cli.foto_selfie_path, 900)
        : Promise.resolve({ data: null })
    ]);

    $('kycFotos').innerHTML = `
      <div class="kyc-box"><small>Foto Frontal de Cédula</small>${uCed.data?.signedUrl ? `<a href="${uCed.data.signedUrl}" target="_blank" rel="noopener"><img src="${uCed.data.signedUrl}" alt="Cédula"></a>` : '<p class="nota">Sin foto cargada</p>'}</div>
      <div class="kyc-box"><small>Selfie de Verificación</small>${uSel.data?.signedUrl ? `<a href="${uSel.data.signedUrl}" target="_blank" rel="noopener"><img src="${uSel.data.signedUrl}" alt="Selfie"></a>` : '<p class="nota">Sin selfie cargada</p>'}</div>`;

    $('btnKycOk').addEventListener('click', async () => {
      const { error } = await sb.from('clientes').update({ kyc_verificado: true }).eq('id', cli.id);
      if (error) return alert(error.message);
      cerrar(); aviso('Identidad KYC aprobada.'); dibujarClientes();
    });

    $('btnKycBuro').addEventListener('click', async () => {
      const nuevoEstado = !cli.suspendido;
      const motivo = nuevoEstado ? (prompt('Motivo de suspensión / Lista Negra (ej: Mora >15 días o comprobante falso):') || 'Suspendido por Organización') : null;
      const { error } = await sb.from('clientes').update({ suspendido: nuevoEstado, motivo_suspension: motivo }).eq('id', cli.id);
      if (error) return alert(error.message);
      cerrar(); aviso(nuevoEstado ? 'Cliente bloqueado en Buró Interno.' : 'Cliente reactivado.'); dibujarClientes();
    });
    return;
  }

  if (t.dataset.entrevista) {
    const { error } = await sb.from('solicitudes_tiendas').update({ estado: 'en_entrevista' }).eq('id', t.dataset.entrevista);
    if (error) return alert(error.message);
    aviso('Solicitud marcada en proceso de entrevista.');
    return cargar('tiendas');
  }

  if (t.dataset.aprobartienda) {
    const { data: s } = await sb.from('solicitudes_tiendas').select('*').eq('id', t.dataset.aprobartienda).single();
    if (!s || !confirm(`¿Confirmas que ${s.nombre_comercial} aprobó la entrevista y requisitos?`)) return;
    const codigo = String(Math.floor(800000000 + Math.random() * 99999999));
    const clave = `Tienda${Math.floor(1000 + Math.random() * 9000)}*`;
    const { error: errIns } = await sb.from('tiendas_aliadas').insert({
      solicitud_id: s.id,
      codigo_numerico: codigo,
      nombre_comercial: s.nombre_comercial,
      rif: s.rif,
      correo: s.correo,
      clave_acceso: clave,
      banco_pago_movil: s.banco_pago_movil,
      telefono_pago_movil: s.telefono_pago_movil
    });
    if (errIns) return alert('Error al activar tienda: ' + errIns.message);
    await sb.from('solicitudes_tiendas').update({ estado: 'aprobada' }).eq('id', s.id);
    alert(`Tienda aprobada.\nCódigo numérico de acceso: ${codigo}\nContraseña: ${clave}`);
    return cargar('tiendas');
  }

  
  if (t.dataset.resettienda) {
    if (!confirm(`¿Generar una nueva clave temporal para ${t.dataset.tnombre}?`)) return;
    const nuevaClave = `Tienda${Math.floor(1000 + Math.random() * 9000)}*`;
    const { error } = await sb.from('tiendas_aliadas').update({ clave_acceso: nuevaClave }).eq('id', t.dataset.resettienda);
    if (error) return alert('No se pudo restablecer: ' + error.message);
    alert(`Nueva clave generada para ${t.dataset.tnombre}:\n${nuevaClave}`);
    return cargar('tiendas');
  }

  if (t.dataset.rechazartienda) {
    if (!confirm('¿Rechazar esta solicitud de afiliación?')) return;
    await sb.from('solicitudes_tiendas').update({ estado: 'rechazada' }).eq('id', t.dataset.rechazartienda);
    aviso('Solicitud rechazada.');
    return cargar('tiendas');
  }

  if (t.dataset.asignar !== undefined) {
    const s = lista[Number(t.dataset.asignar)];
    prefill = { cliente_id: s.cliente_id, producto_id: s.producto_id, cantidad: s.cantidad, solicitud_id: s.id };
    return cargar('asignar');
  }
  if (t.dataset.fase) {
    if (confirm('¿Cambiar la fase de este cliente?')) llamar('cambiar_fase', { p_cliente_id: t.dataset.fase, p_fase: Number(t.dataset.nf) }, 'Fase actualizada.', 'clientes');
    return;
  }
  if (t.dataset.asignarcli) {
    if (t.dataset.curso === '1' && !confirm('Este cliente ya tiene una compra en curso. ¿Asignarle otro producto de todos modos?')) return;
    prefill = { cliente_id: t.dataset.asignarcli }; return cargar('asignar');
  }
  if (t.dataset.rechazar !== undefined) {
    const s = lista[Number(t.dataset.rechazar)];
    abrir(`<h2>Rechazar solicitud</h2><p class="nota">${esc(s.clientes?.nombre ?? '')}: ${esc(s.productos?.nombre ?? '')}</p>
      <label>Motivo<textarea id="rNota"></textarea></label><p id="rErr" class="error"></p>
      <button id="rOk" class="boton alerta" type="button">Rechazar solicitud</button>`);
    $('rOk').addEventListener('click', async () => {
      $('rOk').disabled = true;
      const { error } = await sb.rpc('rechazar_solicitud', { p_solicitud_id: s.id, p_nota: $('rNota').value });
      if (error) { $('rOk').disabled = false; $('rErr').textContent = error.message; return; }
      cerrar(); aviso('Solicitud rechazada.'); cargar('solicitudes');
    });
    return;
  }
  if (t.dataset.pago) {
    const ok = t.dataset.ok === '1';
    if (!confirm(ok ? '¿Confirmas que el pago llegó?' : '¿Rechazar este pago?')) return;
    t.disabled = true;
    const hecho = await llamar('resolver_pago', { p_pago_id: t.dataset.pago, p_ok: ok }, ok ? 'Pago verificado.' : 'Pago rechazado.', 'pagos');
    if (!hecho) t.disabled = false;
    return;
  }
  if (t.dataset.cancelar) {
    if (confirm('¿Cancelar esta compra? El producto vuelve al stock.')) llamar('cancelar_compra', { p_compra_id: t.dataset.cancelar }, 'Compra cancelada.', 'compras');
  }
});

iniciar(false);
