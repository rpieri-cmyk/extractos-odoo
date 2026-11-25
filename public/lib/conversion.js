/**
 * Lógica de conversión de extractos (copiada de apps-script/Codigo.gs, sección "Lógica pura").
 * Funciona igual en Node (require) y en el navegador (<script>), sin dependencias.
 */
'use strict';
// Encabezados habituales, para cuando las columnas del perfil no encuentran movimientos
// (por ejemplo, el banco cambió el formato de su exportación).
const PERFIL_AUTOMATICO = {
  nombre: 'detección automática', filaEncabezado: 0, fecha: 'fecha',
  concepto: 'concepto|descripcion|detalle|movimiento', cpbte: 'comprobante|cpbte|referencia|nro',
  debito: 'debito|debe|egreso', credito: 'credito|haber|ingreso', importe: 'importe|monto', invertir: false
};

function convertirExtracto(filas, cuitPropio, perfil) {
  try {
    return convertirConPerfil_(filas, cuitPropio, perfil);
  } catch (e) {
    let r;
    try { r = convertirConPerfil_(filas, cuitPropio, PERFIL_AUTOMATICO); } catch (e2) { throw e; }
    r.avisos = ['Las columnas del perfil "' + perfil.nombre + '" no coincidieron con este archivo; ' +
      'se detectaron los encabezados automáticamente. Revisá el resultado.'];
    return r;
  }
}

function convertirConPerfil_(filas, cuitPropio, perfil) {
  const enc = resolverColumnas(filas, perfil);
  if (!enc) {
    throw new Error('No encontré en el extracto las columnas del perfil "' + perfil.nombre +
      '". Revisá que elegiste el banco correcto o ajustá la fila de ese banco en la hoja "Bancos".');
  }

  const base = [];
  for (let r = enc.inicio; r < filas.length; r++) {
    const f = filas[r];
    const fecha = convertirFecha(f[enc.fecha]);
    if (!fecha) continue; // filas vacías, encabezados, separadores o totales
    const concepto = limpiar(enc.concepto.map(c => texto(f[c])).filter(Boolean).join(' '));
    const cpbte = enc.cpbte >= 0 ? texto(f[enc.cpbte]) : '';
    let importe;
    if (enc.debito >= 0 && enc.credito >= 0) {
      importe = Math.abs(numero(f[enc.credito])) - Math.abs(numero(f[enc.debito]));
    } else {
      importe = numero(f[enc.importe]) * (perfil.invertir ? -1 : 1);
    }
    importe = redondear_(importe);
    if (!concepto && importe === 0) continue;
    base.push({ fecha, concepto, cpbte, importe });
  }
  if (!base.length) {
    throw new Error('No encontré movimientos con el perfil "' + perfil.nombre +
      '". Revisá las columnas de ese banco en la hoja "Bancos".');
  }
  return armarResultado(base, cuitPropio);
}

/** base: [{ fecha:{y,m,d}, concepto, cpbte, importe }]. cuitsIgnorar: CUIT(s) a no usar, separados por coma. */
function armarResultado(base, cuitsIgnorar) {
  const movs = [];
  let ingresos = 0, egresos = 0, min = null, max = null, conCuit = 0;
  for (const b of base) {
    const cuit = extraerCuit(b.concepto, cuitsIgnorar);
    if (cuit) conCuit++;
    if (b.importe >= 0) ingresos += b.importe; else egresos += b.importe;
    const serial = serialExcel(b.fecha.y, b.fecha.m, b.fecha.d);
    if (min === null || serial < min.serial) min = { serial, f: b.fecha };
    if (max === null || serial > max.serial) max = { serial, f: b.fecha };
    movs.push({
      serial,
      fecha: fechaTexto(b.fecha),
      importe: b.importe,
      etiqueta: limpiar(b.concepto + ' ' + (b.cpbte || '')),
      cuit
    });
  }
  return {
    movs, conCuit,
    ingresos: redondear_(ingresos), egresos: redondear_(egresos),
    desde: fechaTexto(min.f), hasta: fechaTexto(max.f),
    estadoSugerido: estadoDeCuenta(min.f, max.f)
  };
}

/* ---------------------------------------------------------------------
 * Extractos en PDF. lineas: [{ p: página, x: x del primer texto, t: texto, cells: [[x, texto], ...] }]
 * --------------------------------------------------------------------- */

function convertirPdf(lineas, cuitPropio, banco) {
  const lector = lectorPdf(banco);
  if (!lector) {
    throw new Error('Todavía no hay lector de PDF para "' + banco + '". Usá el Excel/CSV del banco ' +
      'o pasá un PDF de ejemplo para agregarlo.');
  }
  const r = lector(lineas);
  if (!r.movs.length) {
    throw new Error('No encontré movimientos en el PDF. ¿Es un resumen de ' + banco + '?');
  }
  const res = armarResultado(r.movs, [cuitPropio, r.titular].filter(Boolean).join(','));
  res.titular = r.titular;
  res.avisos = r.avisos;
  res.saldosOk = r.avisos.length === 0 && r.saldoVerificado;
  return res;
}

function lectorPdf(banco) {
  const n = normalizar(banco);
  if (n.indexOf('ciudad') >= 0) return leerPdfCiudad;
  if (n.indexOf('provincia') >= 0) return leerPdfProvincia;
  return null;
}

const CUITS_BANCOS = ['30999032083', '33999242109']; // Banco Ciudad, Banco Provincia

function cuitDeTexto_(t, re) {
  const m = t.match(re);
  if (!m) return '';
  const c = m[1].replace(/-/g, '');
  return esCuitValido(c) && CUITS_BANCOS.indexOf(c) < 0 ? c : '';
}

/**
 * Banco Ciudad (resumen de cuenta PDF). Línea típica:
 * 02-OCT-2026 TRANSFERENCIA 661.440,00 21916.166,33 27948996516 MORENO
 * El signo sale de la variación del saldo (débito y crédito están en columnas distintas).
 */
function leerPdfCiudad(lineas) {
  const MESES = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12 };
  const NUM = '(-?\\d[\\d.]*,\\d{2})';
  const reMov = new RegExp('(?:^|[^\\d])(\\d{2})-([A-Z]{3})-(\\d{4})\\s+(.+?)\\s+' + NUM + '\\s+' + NUM + '(?:\\s+(.*))?$');
  const reSaldoAnt = new RegExp('SALDO ANTERIOR\\s+' + NUM);
  const reSaldoFin = new RegExp('SALDO AL\\s+\\d{2}/\\d{2}/\\d{4}\\s+' + NUM);
  const movs = [], avisos = [];
  let titular = '', prev = null, saldoFinal = null;
  for (const l of lineas) {
    const t = limpiar(l.t);
    if (!titular) titular = cuitDeTexto_(t, /CUIL\/CUIT\/CDI\s+(\d{2}-?\d{8}-?\d)/);
    if (prev === null && !movs.length) {
      const ms = t.match(reSaldoAnt);
      if (ms) { prev = numero(ms[1]); continue; }
    }
    const mf = t.match(reSaldoFin);
    if (mf) { saldoFinal = numero(mf[1]); continue; }
    const m = t.match(reMov);
    if (!m || !MESES[m[2]]) continue;
    const fecha = { y: Number(m[3]), m: MESES[m[2]], d: Number(m[1]) };
    const monto = Math.abs(numero(m[5]));
    const saldo = numero(m[6]);
    let importe = -monto;
    if (prev !== null) {
      const dif = redondear_(saldo - prev);
      if (Math.abs(Math.abs(dif) - monto) < 0.005) importe = dif;
      else avisos.push('No cierra el saldo en "' + t + '"');
    } else {
      avisos.push('Sin saldo anterior: revisar el signo de "' + t + '"');
    }
    prev = saldo;
    // Como la macro FormatoCiudad: descripción del movimiento (sin espacios) + " " + concepto
    const desc = (m[7] || '').replace(/\s+/g, '');
    movs.push({ fecha, concepto: limpiar(desc + ' ' + m[4]), cpbte: '', importe });
  }
  if (saldoFinal !== null && prev !== null && Math.abs(saldoFinal - prev) > 0.005) {
    avisos.push('El saldo final del resumen (' + saldoFinal + ') no coincide con el último movimiento (' + prev + ').');
  }
  return { movs, titular, avisos, saldoVerificado: prev !== null };
}

/**
 * Banco Provincia (extracto de cuenta informativo PDF). Línea típica:
 * 02/09/2026 TRANSF A MAXICONSUMO SA (30663005843) FAC FAC -463144.16 02-09 61147293.81
 * seguida a veces de una segunda línea de concepto ("00244777"). El importe trae signo.
 */
function leerPdfProvincia(lineas) {
  const NUM = '(-?\\d[\\d.,]*[.,]\\d{2})';
  const reMov = new RegExp('^(\\d{2}/\\d{2}/\\d{4})\\s+(.*?)\\s+' + NUM + '\\s+(\\d{2}-\\d{2})\\s+' + NUM + '$');
  const reSaldoAnt = new RegExp('^(\\d{2}/\\d{2}/\\d{4})\\s+SALDO ANTERIOR\\s+' + NUM + '$');
  const movs = [], avisos = [];
  let titular = '', prev = null, ult = null, pagina = -1, xConcepto = null;
  for (const l of lineas) {
    const t = limpiar(l.t);
    if (!titular) titular = cuitDeTexto_(t, /CUIT\s+(\d{2}-?\d{8}-?\d)\b/);
    if (l.p !== pagina) { pagina = l.p; ult = null; }
    const ms = t.match(reSaldoAnt);
    if (ms) { prev = numero(ms[2]); ult = null; continue; }
    const m = t.match(reMov);
    if (m) {
      const fecha = convertirFecha(m[1]);
      const importe = redondear_(numero(m[3]));
      const saldo = numero(m[5]);
      if (prev !== null && Math.abs(redondear_(prev + importe) - saldo) > 0.005) {
        avisos.push('No cierra el saldo en "' + t + '"');
      }
      prev = saldo;
      ult = { fecha, concepto: m[2], cpbte: '', importe };
      movs.push(ult);
      xConcepto = l.cells && l.cells[1] ? l.cells[1][0] : null;
      continue;
    }
    // Segunda línea del concepto: misma columna que el concepto, sin fecha ni importes
    if (ult && xConcepto !== null && Math.abs(l.x - xConcepto) < 6 &&
        !/^\d{2}\/\d{2}\/\d{4}/.test(t) && !/-?\d+\.\d{2}\s+\d{2}-\d{2}/.test(t)) {
      ult.concepto += ' ' + t;
      continue;
    }
    if (/^\d{2}\/\d{2}\/\d{4}\s/.test(t)) avisos.push('Línea no reconocida: "' + t + '"');
    ult = null;
  }
  return { movs, titular, avisos, saldoVerificado: prev !== null };
}

/**
 * Traduce el perfil a índices de columna. Cada campo es una letra (A, B, AA) o nombres de
 * encabezado separados por "|". Concepto admite varias partes unidas con "+".
 * Devuelve { inicio, fecha, concepto:[...], cpbte, debito, credito, importe } o null.
 */
function resolverColumnas(filas, perfil) {
  const campos = ['fecha', 'debito', 'credito', 'importe', 'cpbte', 'concepto'];
  const specs = {};
  campos.forEach(c => {
    const partes = String(perfil[c] || '').split('+').map(s => s.trim()).filter(Boolean);
    specs[c] = partes.map(p => /^[A-Z]{1,2}$/.test(p)
      ? { col: letraAColumna(p) }
      : { alias: p.split('|').map(a => normalizar(a)).filter(Boolean) });
  });
  const porNombre = campos.some(c => specs[c].some(s => s.alias));

  const intentar = filaEnc => {
    const usadas = {};
    const out = { fecha: -1, debito: -1, credito: -1, importe: -1, cpbte: -1, concepto: [] };
    for (const c of campos) {
      for (const s of specs[c]) {
        let idx = -1;
        if (s.col !== undefined) idx = s.col;
        else if (filaEnc >= 0) {
          const fila = filas[filaEnc] || [];
          for (const a of s.alias) {
            idx = fila.findIndex((v, i) => !usadas[i] && normalizar(texto(v)).indexOf(a) >= 0);
            if (idx >= 0) break;
          }
        }
        if (idx < 0) continue;
        usadas[idx] = true;
        if (c === 'concepto') out.concepto.push(idx); else if (out[c] < 0) out[c] = idx;
      }
    }
    const tieneImporte = (out.debito >= 0 && out.credito >= 0) || out.importe >= 0;
    return out.fecha >= 0 && out.concepto.length && tieneImporte ? out : null;
  };

  if (porNombre) {
    for (let r = 0; r < Math.min(filas.length, 60); r++) {
      const out = intentar(r);
      if (out) { out.inicio = r + 1; return out; }
    }
    return null;
  }
  const out = intentar(-1);
  if (out) out.inicio = Math.max(0, perfil.filaEncabezado || 0);
  return out;
}

function letraAColumna(l) {
  let n = 0;
  for (const ch of l) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Devuelve el primer CUIT/CUIL válido del texto (11 dígitos, con o sin guiones 20-12345678-9),
 * validando prefijo y dígito verificador. Ignora CBU (22 dígitos) y números de comprobante.
 */
function extraerCuit(textoLinea, cuitsIgnorar) {
  const ignorar = String(cuitsIgnorar || '').split(',').map(s => s.replace(/\D/g, '')).filter(Boolean);
  const tramos = String(textoLinea).match(/[0-9-]+/g) || [];
  for (const tramo of tramos) {
    const t = tramo.replace(/^-+|-+$/g, '');
    const candidatos = [];
    if (/^\d{11}$/.test(t) || /^\d{2}-\d{8}-\d$/.test(t)) candidatos.push(t.replace(/-/g, ''));
    t.split('-').forEach(p => { if (p.length === 11) candidatos.push(p); });
    for (const c of candidatos) {
      if (esCuitValido(c) && ignorar.indexOf(c) < 0) return c;
    }
  }
  return '';
}

function esCuitValido(c) {
  if (!/^\d{11}$/.test(c)) return false;
  if (['20', '23', '24', '25', '26', '27', '30', '33', '34'].indexOf(c.substr(0, 2)) < 0) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let s = 0;
  for (let i = 0; i < 10; i++) s += Number(c[i]) * pesos[i];
  let dv = 11 - (s % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) return false;
  return dv === Number(c[10]);
}

/** Acepta "30/10/2026", "30-10-2026", "30.10.26", "2026-10-30" o un serial de fecha. Devuelve {y,m,d} o null. */
function convertirFecha(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }
  const p = String(v).trim().split(/\s+/)[0].split(/[\/.\-]/);
  if (p.length !== 3 || !p.every(x => /^\d+$/.test(x))) return null;
  let d = Number(p[0]), m = Number(p[1]), y = Number(p[2]);
  if (p[0].length === 4) { y = Number(p[0]); d = Number(p[2]); } // aaaa-mm-dd
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1990 || y > 2100) return null;
  return { y, m, d };
}

/** Números como 1234.5, "1.234,56", "-1.234,56", "(1.234,56)", "$ 1.234,56", "1234,56-". */
function numero(v) {
  if (typeof v === 'number') return v;
  let s = String(v === null || v === undefined ? '' : v).replace(/[$\s ]/g, '');
  if (!s) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return neg ? -Math.abs(n) : n;
}

function texto(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

function limpiar(s) {
  return String(s).replace(/[\r\n\t ]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

function normalizar(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\./g, '').trim();
}

function serialExcel(y, m, d) {
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5;
}

function dos(n) { return (n < 10 ? '0' : '') + n; }
function fechaTexto(f) { return dos(f.d) + '/' + dos(f.m) + '/' + f.y; }

/** Formato del template: 2026.08.11-26 (mismo mes) o 2026.08.28-09.03 (meses distintos). */
function estadoDeCuenta(desde, hasta) {
  const ini = desde.y + '.' + dos(desde.m) + '.' + dos(desde.d);
  if (desde.y === hasta.y && desde.m === hasta.m) return ini + '-' + dos(hasta.d);
  if (desde.y === hasta.y) return ini + '-' + dos(hasta.m) + '.' + dos(hasta.d);
  return ini + '-' + hasta.y + '.' + dos(hasta.m) + '.' + dos(hasta.d);
}

function redondear_(x) { return Math.round(x * 100) / 100; }

const API = {
  convertirExtracto, convertirPdf, armarResultado, resolverColumnas, extraerCuit, esCuitValido,
  convertirFecha, numero, texto, limpiar, normalizar, serialExcel, fechaTexto, estadoDeCuenta,
  redondear: redondear_, PERFIL_AUTOMATICO
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else if (typeof window !== 'undefined') window.Conversion = API;