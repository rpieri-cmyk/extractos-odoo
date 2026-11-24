/**
 * Arma en memoria los dos templates de importación de extractos de Odoo:
 *   "Importar a Odoo"     : Estado de cuenta | Fecha | Importe | Etiqueta | partner_id
 *   "Importar a Odoo (2)" : Fecha | Importe | Etiqueta | partner_id
 * Fecha como fecha (dd/mm/aaaa), Importe con 2 decimales sin separador de miles,
 * Etiqueta y partner_id como texto (el CUIT no se convierte en número).
 */
'use strict';

const XLSX = require('xlsx');

const ENC_CON = ['Estado de cuenta', 'Fecha', 'Importe', 'Etiqueta', 'partner_id'];
const ENC_SIN = ['Fecha', 'Importe', 'Etiqueta', 'partner_id'];

function celdaTexto(v) { return { t: 's', v: String(v == null ? '' : v) }; }

function armarLibro(movs, estado, conEstado) {
  const enc = conEstado ? ENC_CON : ENC_SIN;
  const filas = [enc.map(celdaTexto)];
  for (const m of movs) {
    const f = [];
    if (conEstado) f.push(celdaTexto(estado));
    f.push({ t: 'n', v: m.serial, z: 'dd/mm/yyyy' });
    f.push({ t: 'n', v: m.importe, z: '0.00' });
    f.push(celdaTexto(m.etiqueta));
    f.push(celdaTexto(m.cuit || ''));
    filas.push(f);
  }
  const hoja = XLSX.utils.aoa_to_sheet([]);
  XLSX.utils.sheet_add_aoa(hoja, filas, { origin: 'A1' });
  hoja['!cols'] = enc.map(h => ({ wch: h === 'Etiqueta' ? 70 : h === 'Estado de cuenta' ? 20 : 14 }));
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, conEstado ? 'Importar a Odoo' : 'Importar a Odoo (2)');
  return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx', compression: true });
}

function nombreArchivo(estado, conEstado) {
  const base = 'Odoo ' + String(estado).replace(/[\\/:*?"<>|]/g, '-');
  return base + (conEstado ? ' - con estado de cuenta' : ' - sin estado de cuenta') + '.xlsx';
}

module.exports = { armarLibro, nombreArchivo, ENC_CON, ENC_SIN };
