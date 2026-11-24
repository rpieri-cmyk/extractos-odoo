/**
 * Extractos bancarios -> templates de importación de Odoo.
 *
 * Servidor sin estado: el extracto llega en el cuerpo del pedido, se procesa en memoria y la
 * respuesta vuelve a quien lo subió. No se guarda ningún archivo, ni el extracto ni los .xlsx
 * generados, y no se registra su contenido en los logs.
 *
 *   GET  /api/bancos     lista de bancos (config/bancos.json, se relee en cada pedido)
 *   POST /api/procesar   cuerpo = archivo; query: banco, nombre, cuitPropio -> JSON con movimientos
 *   POST /api/descargar  JSON { estado, variante: "con"|"sin", movs } -> .xlsx para descargar
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const C = require('./lib/conversion');
const lectores = require('./lib/lectores');
const salida = require('./lib/salida');

const PUERTO = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const LIMITE_MB = Number(process.env.LIMITE_MB) || 20;
const ARCHIVO_BANCOS = process.env.BANCOS_JSON || path.join(__dirname, 'config', 'bancos.json');
const PUBLICO = path.join(__dirname, 'public');

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

class ErrorUsuario extends Error {}

function leerBancos() {
  const datos = JSON.parse(fs.readFileSync(ARCHIVO_BANCOS, 'utf8'));
  return (datos.bancos || []).filter(b => b && b.nombre).map(b => ({
    nombre: String(b.nombre).trim(), filaEncabezado: Number(b.filaEncabezado) || 0,
    fecha: b.fecha || '', concepto: b.concepto || '', cpbte: b.cpbte || '',
    debito: b.debito || '', credito: b.credito || '', importe: b.importe || '',
    invertir: b.invertir === true, estado: String(b.estado || '').trim(), notas: String(b.notas || '')
  }));
}

function esProbado(estado) { return /^probado/i.test(estado || ''); }

function leerCuerpo(req, limite) {
  return new Promise((ok, mal) => {
    let partes = [];
    let total = 0;
    req.on('data', d => {
      total += d.length;
      if (total > limite) { partes = null; return; } // se sigue leyendo (descartando) para poder responder
      if (partes) partes.push(d);
    });
    req.on('end', () => partes
      ? ok(Buffer.concat(partes))
      : mal(new ErrorUsuario('El archivo supera el máximo de ' + LIMITE_MB + ' MB.')));
    req.on('error', mal);
  });
}

function enviarJson(res, codigo, obj) {
  const cuerpo = Buffer.from(JSON.stringify(obj));
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8', 'Content-Length': cuerpo.length,
    'Cache-Control': 'no-store'
  });
  res.end(cuerpo);
}

async function procesar(req, res, url) {
  const banco = url.searchParams.get('banco') || '';
  const nombre = url.searchParams.get('nombre') || '';
  const cuitPropio = (url.searchParams.get('cuitPropio') || '').replace(/[^\d,]/g, '');
  const tipo = lectores.tipoArchivo(nombre);
  if (!tipo) throw new ErrorUsuario('Formato no soportado. Subí el extracto en .pdf, .xls, .xlsx o .csv.');

  const bancos = leerBancos();
  if (!bancos.length) throw new ErrorUsuario('No hay bancos configurados.');
  const perfil = bancos.find(b => b.nombre === banco) || bancos[0];

  const buffer = await leerCuerpo(req, LIMITE_MB * 1024 * 1024);
  if (!buffer.length) throw new ErrorUsuario('El archivo está vacío.');

  let r;
  try {
    if (tipo === 'pdf') {
      const lineas = await lectores.leerPdf(buffer);
      r = C.convertirPdf(lineas, cuitPropio, perfil.nombre);
    } else {
      const filas = tipo === 'csv' ? lectores.leerCsv(buffer) : lectores.leerPlanilla(buffer);
      r = C.convertirExtracto(filas, cuitPropio, perfil);
    }
  } catch (e) {
    // Los errores de conversión ya vienen redactados para el usuario
    throw new ErrorUsuario(/hoja "Bancos"/.test(e.message)
      ? e.message.replace(/la hoja "Bancos"/g, 'la configuración de bancos')
      : e.message || 'No se pudo leer el archivo.');
  }

  enviarJson(res, 200, {
    archivo: nombre, banco: perfil.nombre,
    avisoPerfil: esProbado(perfil.estado) ? '' : perfil.estado,
    movs: r.movs, conCuit: r.conCuit, ingresos: r.ingresos, egresos: r.egresos,
    neto: C.redondear(r.ingresos + r.egresos), desde: r.desde, hasta: r.hasta,
    estadoSugerido: r.estadoSugerido, titular: r.titular || '', saldosOk: r.saldosOk === true,
    avisos: r.avisos || []
  });
}

async function descargar(req, res) {
  const cuerpo = await leerCuerpo(req, LIMITE_MB * 1024 * 1024);
  let datos;
  try { datos = JSON.parse(cuerpo.toString('utf8')); } catch (e) { throw new ErrorUsuario('Pedido inválido.'); }
  const estado = String(datos.estado || '').trim();
  const conEstado = datos.variante !== 'sin';
  if (conEstado && !estado) throw new ErrorUsuario('Completá el Estado de cuenta.');
  if (!Array.isArray(datos.movs) || !datos.movs.length) throw new ErrorUsuario('No hay movimientos para exportar.');
  const movs = datos.movs.map(m => ({
    serial: Number(m.serial), importe: C.redondear(Number(m.importe)),
    etiqueta: String(m.etiqueta || '').slice(0, 2000), cuit: String(m.cuit || '').replace(/\D/g, '').slice(0, 11)
  }));
  if (movs.some(m => !isFinite(m.serial) || !isFinite(m.importe))) throw new ErrorUsuario('Hay movimientos con fecha o importe inválidos.');

  const archivo = salida.armarLibro(movs, estado, conEstado);
  const nombre = salida.nombreArchivo(estado || 'extracto', conEstado);
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Length': archivo.length,
    'Content-Disposition': "attachment; filename=\"odoo.xlsx\"; filename*=UTF-8''" + encodeURIComponent(nombre),
    'Cache-Control': 'no-store'
  });
  res.end(archivo);
}

function estatico(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const archivo = path.normalize(path.join(PUBLICO, rel));
  if (!archivo.startsWith(PUBLICO + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(archivo, (err, datos) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('No encontrado'); return; }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(datos);
  });
}

const servidor = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  const url = new URL(req.url, 'http://localhost');
  // Detrás de un proxy con subruta (ej. /extractos/) el front usa rutas relativas: se toma lo que sigue a /api/
  const iApi = url.pathname.indexOf('/api/');
  const ruta = iApi >= 0 ? url.pathname.slice(iApi) : null;
  try {
    if (ruta === '/api/bancos' && req.method === 'GET') {
      enviarJson(res, 200, { bancos: leerBancos().map(b => ({ nombre: b.nombre, estado: b.estado, notas: b.notas })) });
    } else if (ruta === '/api/procesar' && req.method === 'POST') {
      await procesar(req, res, url);
    } else if (ruta === '/api/descargar' && req.method === 'POST') {
      await descargar(req, res);
    } else if (ruta) {
      enviarJson(res, 404, { error: 'Ruta inexistente.' });
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      estatico(req, res, url);
    } else {
      res.writeHead(405); res.end();
    }
  } catch (e) {
    if (e instanceof ErrorUsuario) {
      if (!res.headersSent) enviarJson(res, 400, { error: e.message });
    } else {
      console.error(new Date().toISOString(), req.method, ruta || url.pathname, e && e.stack ? e.stack.split('\n')[0] : e);
      if (!res.headersSent) enviarJson(res, 500, { error: 'Error interno al procesar el archivo.' });
    }
  }
});

servidor.requestTimeout = 120000;
servidor.listen(PUERTO, HOST, () => {
  console.log('Extractos Odoo escuchando en http://' + HOST + ':' + PUERTO);
});
