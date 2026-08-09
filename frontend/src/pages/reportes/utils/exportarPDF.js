import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Trae el logo como blob por fetch (no vía <img crossOrigin> + canvas): esa
// combinación tiñe el canvas si el Service Worker de la PWA responde la
// imagen desde caché de forma opaca, y toDataURL() tira SecurityError que
// quedaba tragado silenciosamente por el catch — el logo simplemente no
// aparecía en el PDF, sin ningún aviso. Leyendo el blob con FileReader se
// evita el canvas por completo.
//
// El query param ?_pdf=<timestamp> es necesario además de mode:'cors': el SW
// de la PWA cachea /uploads/* con CacheFirst y acepta respuestas opacas
// (vite.config.js). Como el logo también se pide en otras pantallas con un
// <img> normal (sin crossOrigin ⇒ modo 'no-cors'), el SW ya tiene guardada
// una respuesta OPACA para esa misma URL — y CacheFirst la devuelve igual
// aunque acá pidamos 'cors', ignorando el modo del pedido nuevo. Un query
// param distinto cambia la clave de caché del SW, forzando un pedido real a
// la red en modo 'cors', que sí es legible.
function cargarLogo(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const urlSinCache = url + (url.includes('?') ? '&' : '?') + '_pdf=' + Date.now();
    fetch(urlSinCache, { mode: 'cors', cache: 'no-store' })
      .then((resp) => (resp.ok ? resp.blob() : null))
      .then((blob) => {
        if (!blob) return resolve(null);
        const formato = blob.type.includes('png') ? 'PNG' : blob.type.includes('webp') ? 'WEBP' : 'JPEG';
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          // Cargar el data URL en un <img> solo para leer sus dimensiones
          // naturales — un data URL nunca es cross-origin, así que esto
          // jamás tiñe ningún canvas (acá ni se usa canvas).
          const img = new Image();
          img.onload = () => resolve({ dataUrl, formato, w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve(null);
          img.src = dataUrl;
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      })
      .catch(() => resolve(null));
  });
}

/**
 * @param {object} opts
 * @param {string}   opts.titulo        - Nombre del reporte
 * @param {string}  [opts.subtitulo]    - Período u otro subtexto
 * @param {string[]} opts.columnas      - Cabeceras de la tabla
 * @param {any[][]}  opts.filas         - Filas de datos
 * @param {{label:string,valor:string|number}[]} [opts.totales] - Tarjetas resumen
 * @param {string}  [opts.nombreArchivo]
 * @param {string}  [opts.empresa]      - Nombre del negocio (de config)
 * @param {string}  [opts.logo]         - URL absoluta del logo (de config)
 * @param {string}  [opts.direccion]    - Dirección del negocio (de config)
 * @param {string}  [opts.telefono]     - Teléfono del negocio (de config)
 * @param {string}  [opts.generadoPor]  - Nombre del usuario que genera el PDF
 */
export async function exportarPDF({
  titulo, subtitulo, columnas, filas, totales, nombreArchivo,
  empresa, logo, direccion, telefono, generadoPor,
}) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297;
  const H = 210;
  const M = 15; // margen
  const nombreEmpresa = (empresa || 'RESTAURANTE').toUpperCase();
  const ahoraDate = new Date();
  const ahora = ahoraDate.toLocaleString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const NEGRO       = [30, 30, 34];
  const GRIS_OSCURO = [55, 55, 60];
  const GRIS_TEXTO  = [100, 100, 106];
  const GRIS_CLARO  = [242, 242, 245];
  const GRIS_BANDA  = [250, 250, 251];
  const GRIS_LINEA  = [205, 205, 210];
  const ACENTO      = [90, 60, 160];

  const logoInfo = await cargarLogo(logo);

  // ── Marco general del documento (le da un aire más formal a toda la hoja) ──
  doc.setDrawColor(...GRIS_LINEA);
  doc.setLineWidth(0.3);
  doc.rect(6, 6, W - 12, H - 12);

  // ── Banda de membrete (logo + datos del negocio + metadatos de emisión) ──
  const altoBanda = 34;
  doc.setFillColor(...GRIS_BANDA);
  doc.rect(6, 6, W - 12, altoBanda, 'F');

  let xTexto = M;
  if (logoInfo) {
    const altoLogo = 20;
    const anchoLogo = Math.min(altoLogo * (logoInfo.w / logoInfo.h), 40);
    doc.addImage(logoInfo.dataUrl, logoInfo.formato, M, 12, anchoLogo, altoLogo);
    xTexto = M + anchoLogo + 6;
  }

  doc.setTextColor(...NEGRO);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(nombreEmpresa, xTexto, 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GRIS_TEXTO);
  let yContacto = 25;
  if (direccion) { doc.text(direccion, xTexto, yContacto); yContacto += 5; }
  if (telefono) { doc.text(`Tel: ${telefono}`, xTexto, yContacto); }

  // Caja de metadatos de emisión (esquina superior derecha) — le da al
  // documento la formalidad de un comprobante con datos de emisión propios.
  const wCaja = 68;
  const xCaja = W - M - wCaja;
  doc.setDrawColor(...GRIS_LINEA);
  doc.setLineWidth(0.25);
  doc.roundedRect(xCaja, 12, wCaja, 20, 1, 1, 'S');
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRIS_TEXTO);
  doc.text('FECHA DE EMISIÓN', xCaja + wCaja / 2, 17, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...NEGRO);
  doc.text(ahora, xCaja + wCaja / 2, 22.5, { align: 'center' });
  if (generadoPor) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRIS_TEXTO);
    doc.text(`Generado por: ${generadoPor}`, xCaja + wCaja / 2, 28.5, { align: 'center' });
  }

  // Línea de acento que cierra el membrete
  doc.setDrawColor(...ACENTO);
  doc.setLineWidth(1);
  doc.line(6, 6 + altoBanda, W - 6, 6 + altoBanda);

  // ── Título del reporte ────────────────────────────────────────────────
  let y = 6 + altoBanda + 10;
  doc.setFillColor(...ACENTO);
  doc.rect(M, y - 5, 1.4, subtitulo ? 12 : 6.5, 'F');

  doc.setTextColor(...NEGRO);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(titulo.toUpperCase(), M + 5, y);

  if (subtitulo) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...GRIS_TEXTO);
    doc.text(subtitulo, M + 5, y + 6);
    y += 16;
  } else {
    y += 10;
  }

  // ── Tarjetas resumen ───────────────────────────────────────────────────
  if (totales && totales.length > 0) {
    const gap = 4;
    const colW = (W - 2 * M - gap * (totales.length - 1)) / totales.length;
    const altoTarjeta = 17;
    totales.forEach((item, i) => {
      const x = M + i * (colW + gap);
      doc.setFillColor(...GRIS_CLARO);
      doc.roundedRect(x, y, colW, altoTarjeta, 1.5, 1.5, 'F');
      doc.setDrawColor(...GRIS_LINEA);
      doc.setLineWidth(0.3);
      doc.roundedRect(x, y, colW, altoTarjeta, 1.5, 1.5, 'S');
      doc.setFillColor(...ACENTO);
      doc.rect(x, y, 1.4, altoTarjeta, 'F');
      doc.setTextColor(...GRIS_TEXTO);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.text(item.label.toUpperCase(), x + 5, y + 6.5);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...NEGRO);
      doc.text(String(item.valor), x + 5, y + 13.5);
    });
    y += altoTarjeta + 8;
  }

  // ── Tabla ───────────────────────────────────────────────────────────────
  autoTable(doc, {
    head: [columnas],
    body: filas,
    startY: y,
    styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak', textColor: GRIS_OSCURO, lineColor: GRIS_LINEA, lineWidth: 0.15 },
    headStyles: { fillColor: NEGRO, textColor: 255, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: GRIS_CLARO },
    margin: { left: M, right: M, bottom: 18 },
  });

  // ── Pie de página ─────────────────────────────────────────────────────
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...ACENTO);
    doc.setLineWidth(0.5);
    doc.line(M, H - 13, W - M, H - 13);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...NEGRO);
    doc.text(nombreEmpresa, M, H - 8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRIS_TEXTO);
    doc.text('Documento generado automáticamente por el sistema — no requiere firma ni sello', W / 2, H - 8.5, { align: 'center' });
    doc.text(`Página ${i} de ${pages}`, W - M, H - 8.5, { align: 'right' });
  }

  doc.save(nombreArchivo || 'reporte.pdf');
}
