/**
 * Prueba la conversión sin levantar el servidor:
 *   npm run probar -- "Credicoop" ruta/al/extracto.xls [cuitPropio]
 * Muestra el resumen y los primeros movimientos. No escribe ningún archivo.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('../lib/conversion');
const lectores = require('../lib/lectores');

(async () => {
  const [banco, archivo, cuitPropio = ''] = process.argv.slice(2);
  if (!banco || !archivo) {
    console.error('Uso: npm run probar -- "<banco>" <archivo> [cuitPropio]');
    process.exit(1);
  }
  const bancos = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'bancos.json'), 'utf8')).bancos;
  const perfil = bancos.find(b => b.nombre === banco);
  if (!perfil) { console.error('Banco desconocido. Opciones: ' + bancos.map(b => b.nombre).join(', ')); process.exit(1); }
  const buffer = fs.readFileSync(archivo);
  const tipo = lectores.tipoArchivo(archivo);
  const r = tipo === 'pdf'
    ? C.convertirPdf(await lectores.leerPdf(buffer), cuitPropio, perfil.nombre)
    : C.convertirExtracto(tipo === 'csv' ? lectores.leerCsv(buffer) : lectores.leerPlanilla(buffer), cuitPropio, perfil);
  console.log({
    movimientos: r.movs.length, conCuit: r.conCuit, ingresos: r.ingresos, egresos: r.egresos,
    neto: C.redondear(r.ingresos + r.egresos), desde: r.desde, hasta: r.hasta, estado: r.estadoSugerido,
    titular: r.titular, saldosOk: r.saldosOk, avisos: r.avisos
  });
  console.table(r.movs.slice(0, 10).map(m => ({ fecha: m.fecha, importe: m.importe, etiqueta: m.etiqueta.slice(0, 60), cuit: m.cuit })));
})().catch(e => { console.error(e.message); process.exit(1); });
