'use strict';

(function () {
  const $ = id => document.getElementById(id);
  let bancos = [];
  let datos = null; // resultado del último proceso (solo en esta pestaña del navegador)

  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } };
  const leer = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };

  function mensaje(texto, tipo) {
    const m = $('mensaje');
    m.textContent = texto || '';
    m.className = tipo || '';
  }

  function importe(x) {
    const s = Math.abs(x).toFixed(2).split('.');
    return (x < 0 ? '-' : '') + '$ ' + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + s[1];
  }

  function notaBanco() {
    const b = bancos.find(x => x.nombre === $('banco').value);
    const nota = $('notaBanco');
    nota.textContent = '';
    if (!b) return;
    if (b.estado && !/^probado/i.test(b.estado)) {
      const s = document.createElement('strong');
      s.textContent = 'Perfil ' + b.estado.toLowerCase() + ': revisa el resultado antes de importarlo. ';
      nota.appendChild(s);
    }
    nota.appendChild(document.createTextNode(b.notas || ''));
  }

  const esProbado = estado => /^probado/i.test(estado || '');

  // Desplegable de bancos. El <select> oculto guarda el valor; esta lista es la que se ve.
  const menu = (function () {
    const cont = $('selectBanco'), sel = $('banco'), boton = $('bancoBoton'), lista = $('bancoLista');
    let activa = -1;
    const items = () => [...lista.children];

    function armar() {
      lista.innerHTML = '';
      [...sel.options].forEach((o, i) => {
        const b = bancos.find(x => x.nombre === o.value);
        const li = document.createElement('li');
        li.id = 'bancoOpc' + i;
        li.setAttribute('role', 'option');
        li.dataset.valor = o.value;
        const n = document.createElement('span'); n.textContent = o.value;
        li.appendChild(n);
        if (b && b.estado && !esProbado(b.estado)) {
          const s = document.createElement('small'); s.textContent = b.estado.toLowerCase();
          li.appendChild(s);
        }
        li.addEventListener('click', () => { elegir(o.value); cerrar(true); });
        li.addEventListener('mousemove', () => marcar(i));
        lista.appendChild(li);
      });
      mostrar();
    }

    function mostrar() {
      $('bancoTexto').textContent = sel.value || 'Elige un banco';
      items().forEach(li => li.setAttribute('aria-selected', li.dataset.valor === sel.value ? 'true' : 'false'));
    }

    function elegir(valor) {
      if (sel.value === valor) return;
      sel.value = valor;
      sel.dispatchEvent(new Event('change'));
    }

    function marcar(i) {
      const li = items();
      if (!li.length) return;
      activa = Math.max(0, Math.min(li.length - 1, i));
      li.forEach((x, j) => x.classList.toggle('activa', j === activa));
      lista.setAttribute('aria-activedescendant', li[activa].id);
      li[activa].scrollIntoView({ block: 'nearest' });
    }

    function abrir() {
      if (!lista.children.length) return;
      items().forEach((li, i) => li.style.setProperty('--i', i));
      lista.hidden = false;
      cont.classList.add('abierto');
      boton.setAttribute('aria-expanded', 'true');
      marcar(Math.max(0, items().findIndex(li => li.dataset.valor === sel.value)));
      lista.focus();
    }

    function cerrar(devolverFoco) {
      if (lista.hidden) return;
      lista.hidden = true;
      cont.classList.remove('abierto');
      boton.setAttribute('aria-expanded', 'false');
      items().forEach(x => x.classList.remove('activa'));
      if (devolverFoco) boton.focus();
    }

    boton.addEventListener('click', () => (lista.hidden ? abrir() : cerrar(true)));
    boton.addEventListener('keydown', e => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); abrir(); }
    });
    lista.addEventListener('keydown', e => {
      const n = items().length;
      if (e.key === 'ArrowDown') { e.preventDefault(); marcar(activa + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); marcar(activa - 1); }
      else if (e.key === 'Home') { e.preventDefault(); marcar(0); }
      else if (e.key === 'End') { e.preventDefault(); marcar(n - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (activa >= 0) elegir(items()[activa].dataset.valor); cerrar(true); }
      else if (e.key === 'Escape') { e.preventDefault(); cerrar(true); }
      else if (e.key === 'Tab') cerrar(false);
      else if (e.key.length === 1) {
        // Saltar al primer banco que empieza con esa letra
        const k = items().findIndex(li => li.dataset.valor.toLowerCase().startsWith(e.key.toLowerCase()));
        if (k >= 0) marcar(k);
      }
    });
    document.addEventListener('pointerdown', e => { if (!cont.contains(e.target)) cerrar(false); });
    sel.addEventListener('change', mostrar);

    return { armar };
  })();

  // Perfiles de bancos: config/bancos.json (mismos campos que la hoja "Bancos" del Sheet)
  fetch('config/bancos.json', { cache: 'no-cache' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('No se pudo cargar la lista de bancos.')))
    .then(r => {
      bancos = (r.bancos || []).filter(b => b && b.nombre).map(b => ({
        nombre: String(b.nombre).trim(), filaEncabezado: Number(b.filaEncabezado) || 0,
        fecha: b.fecha || '', concepto: b.concepto || '', cpbte: b.cpbte || '',
        debito: b.debito || '', credito: b.credito || '', importe: b.importe || '',
        invertir: b.invertir === true, estado: String(b.estado || '').trim(), notas: String(b.notas || '')
      }));
      if (!bancos.length) throw new Error('No hay bancos configurados.');
      const sel = $('banco');
      sel.innerHTML = '';
      bancos.forEach(b => {
        const o = document.createElement('option');
        o.value = b.nombre;
        o.textContent = b.nombre + (b.estado && !/^probado/i.test(b.estado) ? ' (' + b.estado.toLowerCase() + ')' : '');
        sel.appendChild(o);
      });
      const ultimo = leer('ultimoBanco');
      if (bancos.some(b => b.nombre === ultimo)) sel.value = ultimo;
      menu.armar();
      notaBanco();
      $('boton').disabled = false;
    })
    .catch(e => mensaje(e.message, 'error'));

  $('banco').addEventListener('change', notaBanco);
  // Versiones anteriores guardaban el CUIT propio: se borra para no dejarlo en el navegador
  try { localStorage.removeItem('cuitPropio'); } catch (e) { /* sin almacenamiento */ }

  // Zona para arrastrar el archivo
  const zona = $('zona');
  const mostrarArchivo = () => {
    const f = $('archivo').files[0];
    $('zonaTitulo').textContent = f ? f.name : 'Arrastra tu extracto aquí';
    $('zonaSub').textContent = f ? (f.size / 1024).toFixed(0) + ' KB · Listo para procesar' : '.pdf, .xls, .xlsx o .csv · Un archivo a la vez';
    zona.classList.toggle('con-archivo', !!f);
  };

  // Indicador de pasos: 1 Carga, 2 Revisa, 3 Descarga
  function paso(n) {
    document.querySelectorAll('#pasos li').forEach((li, i) => {
      li.classList.toggle('activo', i + 1 === n);
      li.classList.toggle('hecho', i + 1 < n);
      if (i + 1 === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
  }
  $('archivo').addEventListener('change', mostrarArchivo);
  ['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add('encima'); }));
  ['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove('encima'); }));
  zona.addEventListener('drop', e => {
    if (e.dataTransfer.files.length) { $('archivo').files = e.dataTransfer.files; mostrarArchivo(); }
  });

  $('form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = $('archivo').files[0];
    if (!f) { mensaje('Elige un archivo primero.', 'error'); return; }
    paso(1);
    const banco = $('banco').value;
    guardar('ultimoBanco', banco);
    $('boton').disabled = true;
    $('resultado').hidden = true;
    datos = null;
    mensaje('Procesando ' + f.name + ' (' + banco + ')…');
    try {
      datos = await procesar(f, banco);
      mostrarResultado();
      mensaje('');
    } catch (err) {
      mensaje(err.message, 'error');
    } finally {
      $('boton').disabled = false;
    }
  });

  // Todo ocurre en esta pestaña: el archivo se lee en memoria y no se envía a ningún servidor.
  async function procesar(f, banco) {
    const tipo = Lectores.tipoArchivo(f.name);
    if (!tipo) throw new Error('Formato no soportado. Sube el extracto en .pdf, .xls, .xlsx o .csv.');
    if (!f.size) throw new Error('El archivo está vacío.');
    const perfil = bancos.find(b => b.nombre === banco) || bancos[0];
    const cuitPropio = ''; // el CUIT del titular se detecta solo en los PDF que lo traen
    const bytes = new Uint8Array(await f.arrayBuffer());
    let r;
    try {
      if (tipo === 'pdf') {
        r = Conversion.convertirPdf(await Lectores.leerPdf(bytes), cuitPropio, perfil.nombre);
      } else {
        const filas = tipo === 'csv' ? Lectores.leerCsv(bytes) : Lectores.leerPlanilla(bytes);
        r = Conversion.convertirExtracto(filas, cuitPropio, perfil);
      }
    } catch (e) {
      throw new Error(String(e && e.message || 'No se pudo leer el archivo.').replace(/la hoja "Bancos"/g, 'la configuración de bancos'));
    }
    return {
      archivo: f.name, banco: perfil.nombre,
      avisoPerfil: esProbado(perfil.estado) ? '' : perfil.estado,
      movs: r.movs, conCuit: r.conCuit, ingresos: r.ingresos, egresos: r.egresos,
      neto: Conversion.redondear(r.ingresos + r.egresos), desde: r.desde, hasta: r.hasta,
      estadoSugerido: r.estadoSugerido, titular: r.titular || '', saldosOk: r.saldosOk === true,
      avisos: r.avisos || []
    };
  }

  function cifra(titulo, valor, clase) {
    const d = document.createElement('div');
    d.className = 'cifra' + (clase ? ' ' + clase : '');
    const t = document.createElement('span'); t.textContent = titulo;
    const v = document.createElement('strong'); v.textContent = valor;
    d.append(t, v);
    return d;
  }

  function mostrarResultado() {
    const r = datos;
    $('origen').textContent = r.archivo + ' · ' + r.banco + ' · del ' + r.desde + ' al ' + r.hasta;
    const c = $('cifras');
    c.innerHTML = '';
    c.append(
      cifra('Movimientos', r.movs.length),
      cifra('Con CUIT', r.conCuit),
      cifra('Sin CUIT', r.movs.length - r.conCuit),
      cifra('Ingresos', importe(r.ingresos)),
      cifra('Egresos', importe(r.egresos)),
      cifra('Neto', importe(r.neto), r.neto < 0 ? 'negativo' : '')
    );

    const av = $('avisos');
    av.innerHTML = '';
    const linea = (texto, clase) => { const p = document.createElement('p'); p.className = clase; p.textContent = texto; av.appendChild(p); };
    if (r.titular) linea('Titular de la cuenta: CUIT ' + r.titular + ' (no se usa como contacto).', 'info');
    if (r.saldosOk) linea('Saldos verificados: los movimientos cierran con el saldo del banco.', 'ok');
    if (r.avisoPerfil) linea('El perfil "' + r.banco + '" está ' + r.avisoPerfil.toLowerCase() + '. Revisa fechas, importes y etiquetas antes de importar.', 'alerta');
    if (r.avisos.length) {
      linea('Revisar ' + r.avisos.length + ' aviso(s):', 'alerta');
      const ul = document.createElement('ul');
      ul.className = 'alerta';
      r.avisos.slice(0, 10).forEach(a => { const li = document.createElement('li'); li.textContent = a; ul.appendChild(li); });
      av.appendChild(ul);
    }

    $('estado').value = r.estadoSugerido;

    const tb = $('filas');
    tb.innerHTML = '';
    r.movs.forEach((m, i) => {
      const tr = document.createElement('tr');
      const td = (t, cls) => { const x = document.createElement('td'); x.textContent = t; if (cls) x.className = cls; tr.appendChild(x); };
      td(m.fecha);
      td(importe(m.importe), 'num' + (m.importe < 0 ? ' negativo' : ''));
      td(m.etiqueta, 'etiqueta');
      const tdCuit = document.createElement('td');
      const inp = document.createElement('input');
      inp.type = 'text'; inp.value = m.cuit || ''; inp.inputMode = 'numeric'; inp.maxLength = 13;
      inp.setAttribute('aria-label', 'partner_id de la fila ' + (i + 1));
      inp.addEventListener('change', () => { m.cuit = inp.value.replace(/\D/g, ''); inp.value = m.cuit; });
      tdCuit.appendChild(inp);
      tr.appendChild(tdCuit);
      tb.appendChild(tr);
    });
    $('resultado').hidden = false;
    paso(2);
    $('resultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.querySelectorAll('[data-variante]').forEach(b => b.addEventListener('click', async () => {
    if (!datos) return;
    const variante = b.dataset.variante;
    const estado = $('estado').value.trim();
    if (variante === 'con' && !estado) { mensaje('Completa el Estado de cuenta.', 'error'); $('estado').focus(); return; }
    b.disabled = true;
    try {
      const conEstado = variante !== 'sin';
      const movs = datos.movs.map(m => ({
        serial: m.serial, importe: m.importe, etiqueta: m.etiqueta,
        cuit: String(m.cuit || '').replace(/\D/g, '').slice(0, 11)
      }));
      if (!movs.length) throw new Error('No hay movimientos para exportar.');
      const blob = new Blob([Salida.armarLibro(movs, estado, conEstado)],
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = Salida.nombreArchivo(estado || 'extracto', conEstado);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      paso(3);
    } catch (err) {
      mensaje(err.message, 'error');
    } finally {
      b.disabled = false;
    }
  }));
})();
