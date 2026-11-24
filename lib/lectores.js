/**
 * Lectura de los archivos subidos, todo en memoria (nada se escribe en disco).
 *   .xls / .xlsx / .ods / .html -> matriz de filas (SheetJS)
 *   .csv / .txt                 -> matriz de filas (separador ; , o tabulador, UTF-8 o Latin-1)
 *   .pdf                        -> líneas de texto con posición (pdf.js), como lo hacía el diálogo del Sheet
 */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const XLSX = require('xlsx');

function tipoArchivo(nombre) {
  const ext = path.extname(String(nombre || '')).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.csv' || ext === '.txt') return 'csv';
  if (['.xls', '.xlsx', '.ods', '.html', '.htm'].includes(ext)) return 'planilla';
  return '';
}

/** Primera hoja como matriz. Las fechas quedan como serial de Excel (convertirFecha las entiende). */
function leerPlanilla(buffer) {
  const libro = XLSX.read(buffer, { type: 'buffer', cellDates: false, cellHTML: false, dense: true });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  if (!hoja) return [];
  return XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: '', blankrows: false });
}

function leerCsv(buffer) {
  let txt = buffer.toString('utf8');
  if (txt.includes('�')) txt = buffer.toString('latin1');
  txt = txt.replace(/^﻿/, '');
  const primeras = txt.split(/\r?\n/).slice(0, 20).join('\n');
  const cuenta = s => primeras.split(s).length - 1;
  const sep = [';', '\t', ','].sort((a, b) => cuenta(b) - cuenta(a))[0];
  return parsearCsv(txt, sep);
}

function parsearCsv(txt, sep) {
  const filas = [];
  let fila = [], campo = '', comillas = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (comillas) {
      if (c === '"' && txt[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && txt[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

let pdfjsPromesa = null;
function cargarPdfJs() {
  if (!pdfjsPromesa) {
    pdfjsPromesa = import('pdfjs-dist/legacy/build/pdf.mjs').then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc =
        pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
      return pdfjs;
    });
  }
  return pdfjsPromesa;
}

/** Devuelve [{ p, x, t, cells: [[x, texto], ...] }] en orden de lectura (arriba-abajo, izq-der). */
async function leerPdf(buffer) {
  const pdfjs = await cargarPdfJs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false,
    disableFontFace: true, verbosity: 0
  }).promise;
  const out = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      // Se descarta el texto rotado (leyendas verticales en el margen)
      const items = tc.items.filter(i => i.str && i.str.trim() &&
          Math.abs(i.transform[1]) < 0.01 && Math.abs(i.transform[2]) < 0.01)
        .map(i => ({ x: i.transform[4], y: i.transform[5], w: i.width, s: i.str }));
      const filas = [];
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      for (const it of items) {
        let f = filas.find(f => Math.abs(f.y - it.y) < 2.5);
        if (!f) { f = { y: it.y, items: [] }; filas.push(f); }
        f.items.push(it);
      }
      filas.sort((a, b) => b.y - a.y);
      for (const f of filas) {
        f.items.sort((a, b) => a.x - b.x);
        const cells = [];
        for (const it of f.items) {
          const c = cells[cells.length - 1];
          if (c && it.x - c.fin < 1.5) { c.s += it.s; c.fin = it.x + it.w; }
          else cells.push({ x: it.x, s: it.s, fin: it.x + it.w });
        }
        const cl = cells.map(c => [Math.round(c.x * 10) / 10, c.s.replace(/\s+/g, ' ').trim()]).filter(c => c[1]);
        if (cl.length) out.push({ p, x: cl[0][0], t: cl.map(c => c[1]).join(' '), cells: cl });
      }
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return out;
}

module.exports = { tipoArchivo, leerPlanilla, leerCsv, parsearCsv, leerPdf };
