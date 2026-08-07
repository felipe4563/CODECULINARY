// Constructor de comandos ESC/POS para impresión térmica desde el navegador
// (impresión Bluetooth vía RawBT — ver rawbt.js). Es un port directo de la
// clase `Esc` y las funciones `buildCaja`/`buildCocina` de
// print-agent/agent.js (el agente de Windows que imprime en impresora
// física): mismo protocolo, mismos datos de entrada (el payload que ya
// arma el backend en `_emitirImpresion`), para que el ticket salga igual
// sin importar el canal.

// Columnas de texto según el ancho de papel configurado en la caja (ver
// ancho_papel_bluetooth en el modelo Caja) — 58mm imprime ~32 columnas con
// la fuente normal, 80mm ~48, igual que la impresora de mostrador.
const COLS_POR_ANCHO = { '58mm': 32, '80mm': 48 };
// Tamaño máximo del logo en píxeles (a 203dpi, 8 dots/mm) — ~30x30mm,
// pensado como un logo chico arriba del ticket, no ocupar todo el ancho del
// papel. Es el mismo para 58mm y 80mm: 30mm entra cómodo en ambos.
export const LOGO_MAX_PX = 240;

// print-agent/agent.js (impresora física) prueba cp850/cp1252/ascii según
// config.json porque cada impresora/PC es distinta. Acá no hay ese control
// por dispositivo, y las impresoras térmicas portátiles clon casi nunca
// respetan bien cp850: un byte no soportado (típicamente la "ñ") no solo
// sale mal esa letra, corrompe el resto de la línea. Por eso, a diferencia
// del agente, acá se va directo a "ascii" (sin tildes, pero nunca se rompe)
// en vez de arriesgar cp850 como default.
const CODEPAGE = 'ascii';
const TABLA_ESC_T = { cp850: 2, cp1252: 16, ascii: 0 };
const REEMPLAZO_ASCII = {
  'á':'a','é':'e','í':'i','ó':'o','ú':'u',
  'Á':'A','É':'E','Í':'I','Ó':'O','Ú':'U',
  'ñ':'n','Ñ':'N','ü':'u','Ü':'U',
  '¡':'!','¿':'?','°':'o','·':'.',
  '★':'*','—':'-',
};

function quitarAcentos(str) {
  return str.replace(/[áéíóúÁÉÍÓÚñÑüÜ¡¿°·★—]/g, (ch) => REEMPLAZO_ASCII[ch] || ch);
}

class Esc {
  constructor(anchoPapel = '80mm') {
    this.b = [];
    this.anchoCols = COLS_POR_ANCHO[anchoPapel] || COLS_POR_ANCHO['80mm'];
  }
  raw(bytes) { this.b.push(...bytes); return this; }
  init() { return this.raw([0x1B, 0x40]); }
  charset() { return this.raw([0x1B, 0x74, TABLA_ESC_T[CODEPAGE]]); }
  cut() { return this.raw([0x1D, 0x56, 0x41, 0x05]); }
  lf(n = 1) { for (let i = 0; i < n; i++) this.b.push(0x0A); return this; }
  left() { return this.raw([0x1B, 0x61, 0x00]); }
  center() { return this.raw([0x1B, 0x61, 0x01]); }
  right() { return this.raw([0x1B, 0x61, 0x02]); }
  bold(on) { return this.raw([0x1B, 0x45, on ? 1 : 0]); }
  normal() { return this.raw([0x1D, 0x21, 0x00]); }
  dbl() { return this.raw([0x1D, 0x21, 0x11]); }
  dblH() { return this.raw([0x1D, 0x21, 0x01]); }
  dblW() { return this.raw([0x1D, 0x21, 0x10]); }
  text(s) {
    const str = quitarAcentos(String(s != null ? s : ''));
    for (let ci = 0; ci < str.length; ci++) {
      const code = str.charCodeAt(ci);
      // Todo queda en ASCII puro (7 bits) a propósito — ver el porqué en el
      // comentario de CODEPAGE más arriba. Cualquier símbolo fuera de ASCII
      // que no esté en REEMPLAZO_ASCII cae en '?' en vez de mandar un byte
      // alto que la impresora podría no soportar.
      this.b.push(code < 128 ? code : 0x3F);
    }
    return this;
  }
  line(s) { return this.text(s != null ? s : '').lf(); }
  rule(c) { const ch = c || '-'; return this.line(ch.repeat(this.anchoCols)); }
  cols(left, right) {
    const r = String(right != null ? right : '');
    const l = String(left != null ? left : '');
    const lw = this.anchoCols - r.length;
    const lp = l.length > lw ? l.substring(0, Math.max(0, lw - 1)) + '.' : l.padEnd(lw);
    return this.line(lp + r);
  }
  // Comando GS v 0 (raster bit image) — usado para el logo (ver logoEscPos.js).
  imagen(anchoBytes, alto, datos) {
    return this.raw([0x1D, 0x76, 0x30, 0x00, anchoBytes & 0xFF, (anchoBytes >> 8) & 0xFF, alto & 0xFF, (alto >> 8) & 0xFF, ...datos]);
  }
  build() { return Uint8Array.from(this.b); }
}

function buildCaja(data, logo) {
  const pedido = data.pedido;
  const metodo_pago = data.metodo_pago;
  const cfg = data.config || {};
  const esLlevar = pedido.tipo === 'llevar';
  const nLevar = pedido.numero_llevar != null ? pedido.numero_llevar : pedido.id;
  const nOrden = String(data.numero_orden_diario != null ? data.numero_orden_diario : (esLlevar ? nLevar : pedido.id)).padStart(3, '0');
  const ahora = new Date();
  const fecha = ahora.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = ahora.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
  const sym = cfg.simbolo_moneda || 'Bs.';
  const nombre = cfg.nombre_negocio || 'RESTAURANTE';

  const detallesTotal = pedido.detalles || [];
  const subtotalLineas = detallesTotal.reduce((s, d) => s + parseFloat(d.precio) * d.cantidad, 0);
  const montoRecibido = pedido.monto_recibido != null ? parseFloat(pedido.monto_recibido) : null;
  const cambioTotal = parseFloat(pedido.cambio || 0);
  const total = montoRecibido != null ? montoRecibido - cambioTotal : subtotalLineas;
  const descuento = parseFloat(pedido.descuento || 0);
  const propina = parseFloat(pedido.propina || 0);
  const descuentoCupon = parseFloat(pedido.descuento_cupon || 0);
  const puntosGanados = pedido.puntos_ganados || 0;
  const puntosCanjeados = pedido.puntos_canjeados || 0;
  const descuentoPuntos = Math.max(0, subtotalLineas - descuento - descuentoCupon + propina - total);
  const hayAjustes = descuento > 0 || descuentoCupon > 0 || descuentoPuntos > 0 || propina > 0;

  const t = new Esc(data.ancho_papel_bluetooth);
  t.init().charset();

  if (logo) t.center().imagen(logo.anchoBytes, logo.alto, logo.datos).lf();

  t.rule('=');
  t.center().bold(true).line(nombre.toUpperCase()).bold(false);
  const direccionTel = [cfg.direccion, cfg.telefono ? 'Tel: ' + cfg.telefono : null].filter(Boolean).join(' - ');
  if (direccionTel) t.center().line(direccionTel);
  t.rule('=');

  t.left().bold(true).cols('NOTA DE VENTA', 'Nro. ' + nOrden).bold(false);
  t.rule('-');

  t.left().cols('Fecha: ' + fecha, hora);
  if (esLlevar) {
    t.left().line('PARA LLEVAR — ' + (pedido.nombre_cliente || 'Cliente'));
  } else {
    const mesaNombre = (pedido.mesa && pedido.mesa.nombre) ? pedido.mesa.nombre : '---';
    t.left().line(mesaNombre.toUpperCase());
  }
  t.rule('-');

  t.left().line('Descripcion');
  t.rule('-');
  const detalles = pedido.detalles || [];
  for (const d of detalles) {
    const esCombo = !!d.combo;
    const prod = String(esCombo ? ('COMBO: ' + d.combo.nombre) : ((d.producto && d.producto.nombre) ? d.producto.nombre : '')).toUpperCase();
    const sub = (parseFloat(d.precio) * d.cantidad).toFixed(2);
    if (d.peso != null) {
      const pesoKg = parseFloat(d.peso).toFixed(3);
      const precioKg = parseFloat((d.producto && d.producto.precio) || 0).toFixed(2);
      t.left().cols(pesoKg + 'kg ' + prod, sub);
      t.left().line('  (' + sym + ' ' + precioKg + '/kg)');
    } else {
      const qty = d.cantidad;
      const pu = parseFloat(d.precio).toFixed(2);
      t.left().cols(qty + ' ' + prod, sub);
      if (qty > 1) t.left().line('  (' + sym + ' ' + pu + ' c/u)');
    }
    if (esCombo && d.combo.productos && d.combo.productos.length) {
      const contenidoCombo = d.combo.productos.map((p) => {
        const cant = (p.ComboProducto && p.ComboProducto.cantidad) || 1;
        return cant + 'x ' + p.nombre;
      }).join(', ');
      t.left().line('  (' + contenidoCombo + ')');
    }
    if (d.nota) t.left().bold(true).line('  >> ' + d.nota).bold(false);
  }
  t.rule('-');

  if (hayAjustes) {
    t.left().cols('Subtotal', sym + ' ' + subtotalLineas.toFixed(2));
    if (descuento > 0) t.left().cols('Descuento', '-' + sym + ' ' + descuento.toFixed(2));
    if (descuentoCupon > 0) {
      const etiquetaCupon = 'Cupon' + (pedido.cupon ? ' (' + pedido.cupon.codigo + ')' : '');
      t.left().cols(etiquetaCupon, '-' + sym + ' ' + descuentoCupon.toFixed(2));
      const esCuponCumple = pedido.cupon && /^CUMPLE/.test(pedido.cupon.codigo);
      if (esCuponCumple) {
        const nombreCumple = (pedido.cliente && pedido.cliente.nombre) ? pedido.cliente.nombre.toUpperCase() : '';
        t.center().bold(true).line('*** FELIZ CUMPLEAÑOS' + (nombreCumple ? ' ' + nombreCumple : '') + ' ***').bold(false);
      }
    }
    if (descuentoPuntos > 0) t.left().cols('Puntos (' + puntosCanjeados + ')', '-' + sym + ' ' + descuentoPuntos.toFixed(2));
    if (propina > 0) t.left().cols('Propina', sym + ' ' + propina.toFixed(2));
  }
  t.left().bold(true).cols('TOTAL ' + sym, total.toFixed(2)).bold(false);
  t.rule('=');

  t.left().line('Pago: ' + (metodo_pago === 'efectivo' ? 'Efectivo' : 'QR / Transferencia'));
  t.rule('-');

  if (pedido.cliente && (puntosGanados > 0 || pedido.cliente.puntos != null)) {
    if (pedido.cliente.nombre) t.left().line('Cliente: ' + pedido.cliente.nombre);
    if (puntosGanados > 0) t.left().line('+ ' + puntosGanados + ' puntos ganados');
    if (pedido.cliente.puntos != null) t.left().bold(true).line('Saldo puntos: ' + pedido.cliente.puntos).bold(false);
    t.rule('-');
  }

  t.lf(1).center().line('Gracias por su preferencia').center().line(nombre).lf(3).cut();
  return t.build();
}

function buildCocina(data) {
  const pedido = data.pedido;
  const cfg = data.config || {};
  const t = new Esc(data.ancho_papel_bluetooth);
  const esLlevar = pedido.tipo === 'llevar';
  const nLevar = pedido.numero_llevar != null ? pedido.numero_llevar : pedido.id;
  const nOrden = String(data.numero_orden_diario != null ? data.numero_orden_diario : (esLlevar ? nLevar : pedido.id)).padStart(3, '0');
  const ahora = new Date();
  const hora = ahora.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
  const sym = cfg.simbolo_moneda || 'Bs.';

  t.init().charset();

  t.rule('#');
  t.center().bold(true).dblW().line('COCINA').normal().bold(false);
  t.rule('#');

  if (esLlevar) {
    t.center().dbl().bold(true).line('PARA LLEVAR').normal().bold(false);
    t.center().dbl().bold(true).line('# ' + nOrden).normal().bold(false);
  } else {
    const mesaNombre2 = (pedido.mesa && pedido.mesa.nombre) ? pedido.mesa.nombre : '---';
    t.center().dbl().bold(true).line(mesaNombre2.toUpperCase()).normal().bold(false);
    t.center().dbl().bold(true).line('# ' + nOrden).normal().bold(false);
  }
  t.rule('#');

  if (esLlevar) t.left().bold(true).dblH().line('Cliente: ' + (pedido.nombre_cliente || '-')).normal().bold(false);
  t.left().line('Hora: ' + hora);
  t.rule('#');

  const detalles2 = pedido.detalles || [];
  for (const d2 of detalles2) {
    const esCombo2 = !!d2.combo;
    const prod2 = String(esCombo2 ? ('COMBO: ' + d2.combo.nombre) : ((d2.producto && d2.producto.nombre) ? d2.producto.nombre : '')).toUpperCase();
    const sub2 = (parseFloat(d2.precio) * d2.cantidad).toFixed(2);
    if (d2.peso != null) {
      const pesoKg2 = parseFloat(d2.peso).toFixed(3);
      const precioKg2 = parseFloat((d2.producto && d2.producto.precio) || 0).toFixed(2);
      t.left().dbl().bold(true).line(pesoKg2 + 'kg  ' + prod2).normal().bold(false);
      t.left().line(sym + ' ' + precioKg2 + '/kg  Sub: ' + sym + ' ' + sub2);
    } else {
      const qty2 = d2.cantidad;
      const pu2 = parseFloat(d2.precio).toFixed(2);
      t.left().dbl().bold(true).line(qty2 + '  ' + prod2).normal().bold(false);
      t.left().line(sym + ' ' + pu2 + ' c/u  Sub: ' + sym + ' ' + sub2);
    }
    if (esCombo2 && d2.combo.productos && d2.combo.productos.length) {
      const contenidoCombo2 = d2.combo.productos.map((p) => {
        const cant = (p.ComboProducto && p.ComboProducto.cantidad) || 1;
        return cant + 'x ' + p.nombre;
      }).join(', ');
      t.left().bold(true).line('>> Incluye: ' + contenidoCombo2).bold(false);
    }
    if (d2.nota) t.left().bold(true).dblH().line('>> ' + d2.nota).normal().bold(false);
    t.rule('-');
  }
  t.rule('#');

  if (pedido.notas) {
    t.center().bold(true).line('!! NOTA ESPECIAL !!').bold(false);
    t.left().bold(true).dblH().line(pedido.notas).normal().bold(false);
    t.rule('#');
  }

  t.center().line('-- ticket de cocina --').lf(3).cut();
  return t.build();
}

export { Esc, buildCaja, buildCocina };
