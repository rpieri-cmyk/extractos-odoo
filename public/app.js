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
      s.textContent = 'Perfil ' + b.estado.toLowerCase() + ': revisá el resultado antes de importarlo. ';
      nota.appendChild(s);
    }
    nota.appendChild(document.createTextNode(b.notas || ''));
  }

  fetch('api/bancos', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('No se pudo cargar la lista de bancos.')))
    .then(r => {
      bancos = r.bancos;
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
      notaBanco();
      $('boton').disabled = false;
    })
    .catch(e => mensaje(e.message, 'error'));

  $('banco').addEventListener('change', notaBanco);
  $('cuitPropio').value = leer('cuitPropio');

  // Zona para arrastrar el archivo
  const zona = $('zona');
  const mostrarArchivo = () => {
    const f = $('archivo').files[0];
    $('zonaTexto').textContent = f ? f.name : 'Arrastrá el archivo acá o hacé clic para elegirlo';
    zona.classList.toggle('con-archivo', !!f);
  };
  $('archivo').addEventListener('change', mostrarArchivo);
  ['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add('encima'); }));
  ['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove('encima'); }));
  zona.addEventListener('drop', e => {
    if (e.dataTransfer.files.length) { $('archivo').files = e.dataTransfer.files; mostrarArchivo(); }
  });

  $('form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = $('archivo').files[0];
    if (!f) { mensaje('Elegí un archivo primero.', 'error'); return; }
    const banco = $('banco').value;
    const cuitPropio = $('cuitPropio').value.trim();
    guardar('ultimoBanco', banco);
    guardar('cuitPropio', cuitPropio);
    $('boton').disabled = true;
    $('resultado').hidden = true;
    datos = null;
    mensaje('Procesando ' + f.name + ' (' + banco + ')…');
    try {
      const q = new URLSearchParams({ banco, nombre: f.name, cuitPropio });
      const r = await fetch('api/procesar?' + q, {
        method: 'POST', body: f, headers: { 'Content-Type': 'application/octet-stream' }
      });
      const j = await r.json().catch(() => ({ error: 'Respuesta inválida del servidor (' + r.status + ').' }));
      if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
      datos = j;
      mostrarResultado();
      mensaje('');
    } catch (err) {
      mensaje(err.message, 'error');
    } finally {
      $('boton').disabled = false;
    }
  });

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
    if (r.avisoPerfil) linea('El perfil "' + r.banco + '" está ' + r.avisoPerfil.toLowerCase() + '. Revisá fechas, importes y etiquetas antes de importar.', 'alerta');
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
    $('resultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.querySelectorAll('[data-variante]').forEach(b => b.addEventListener('click', async () => {
    if (!datos) return;
    const variante = b.dataset.variante;
    const estado = $('estado').value.trim();
    if (variante === 'con' && !estado) { mensaje('Completá el Estado de cuenta.', 'error'); $('estado').focus(); return; }
    b.disabled = true;
    try {
      const r = await fetch('api/descargar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado, variante, movs: datos.movs.map(m => ({ serial: m.serial, importe: m.importe, etiqueta: m.etiqueta, cuit: m.cuit })) })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Error ' + r.status);
      }
      const blob = await r.blob();
      const cd = r.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename\*=UTF-8''([^;]+)/);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = m ? decodeURIComponent(m[1]) : 'odoo.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (err) {
      mensaje(err.message, 'error');
    } finally {
      b.disabled = false;
    }
  }));
})();
