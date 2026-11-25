# Generador de Extractos → Odoo

Página web que convierte extractos bancarios (.pdf, .xls, .xlsx, .csv) en los dos templates de importación de extractos de Odoo. Usa la misma lógica de conversión que el Google Sheet "Extractos Odoo 17 | Template", y la pueden usar muchas personas a la vez.

| Template | Columnas |
|---|---|
| Con estado de cuenta | Estado de cuenta · Fecha · Importe · Etiqueta · partner_id |
| Sin estado de cuenta | Fecha · Importe · Etiqueta · partner_id |

El partner_id es el CUIT que aparece en el concepto del movimiento. Se toma solo si tiene 11 dígitos y el dígito verificador es válido.

## Privacidad: el extracto no sale de la computadora

- Es un sitio estático: no hay servidor que reciba archivos. El extracto se lee y se convierte **dentro del navegador** de quien lo carga, y el .xlsx se genera ahí mismo para descargar.
- No hay base de datos, sesiones ni historial.
- La página tiene una política de seguridad (Content-Security-Policy) que solo le permite conectarse a sí misma y a los CDN de las librerías, así que no puede enviar el extracto a ningún otro lado.
- En el navegador de cada persona queda solo una preferencia: el último banco elegido.
- El `.gitignore` excluye .xls, .xlsx, .csv y .pdf para que nunca se suba un extracto al repositorio.

## Cómo se usa

1. Elegir el banco y el archivo del extracto, y apretar **Procesar extracto**.
2. Revisar el resumen, los avisos y la tabla de movimientos. Si un contacto no existe en Odoo, se puede corregir o borrar su partner_id.
3. Revisar el **Estado de cuenta** (se completa con el período) y descargar el template que corresponda.

## Bancos

Los bancos se configuran en [public/config/bancos.json](public/config/bancos.json), con los mismos campos que la hoja "Bancos" del Sheet. Al guardar un cambio en GitHub, Vercel publica la versión nueva en uno o dos minutos.

| Banco | Formatos | Estado |
|---|---|---|
| Credicoop | SaldMovs .xls | Probado |
| Ciudad | PDF del resumen de cuenta; Excel con encabezados | Probado |
| Ciudad (home banking) | Excel del home banking | Probado |
| Provincia | PDF del extracto informativo | PDF probado; Excel sin probar |
| Nación | Excel (columnas de la macro) | Sin probar |
| Automático | Cualquier planilla con encabezados habituales | Genérico |

Si las columnas de un banco no coinciden con el archivo, la página intenta detectar los encabezados automáticamente y lo avisa. Los PDF se leen con un lector propio para cada banco (Ciudad y Provincia). Para agregar otro banco en PDF hay que escribir su lector en `public/lib/conversion.js`.

## Publicación en Vercel

1. Entrar a vercel.com con la cuenta de GitHub dueña del repositorio.
2. **Add New → Project**, importar `extractos-odoo`.
3. Dejar todo como viene: `vercel.json` ya indica que no hay compilación y que el sitio está en `public/`.
4. **Deploy**. Queda en una dirección `*.vercel.app`; en **Settings → Domains** se puede agregar un dominio propio.

Cada cambio que se guarde en la rama `main` se publica solo.

También funciona en cualquier hosting de archivos estáticos (Cloudflare Pages, Netlify, nginx, Apache): basta con publicar la carpeta `public/`.

## Probar en la computadora

Cualquier servidor de archivos estáticos sirve, por ejemplo:

```bash
npx serve public
```

Abrir el archivo `index.html` directamente (doble clic) no funciona, porque el navegador no deja leer `config/bancos.json` desde el disco.

## Estructura

| Archivo | Contenido |
|---|---|
| `public/index.html` | Página |
| `public/estilos.css` | Diseño (paleta e Inter, según el diseño en Figma) |
| `public/app.js` | Interfaz: carga del archivo, resultado y descargas |
| `public/lib/conversion.js` | Lógica de conversión: columnas, fechas, importes, CUIT y lectores de PDF (copiada del Apps Script) |
| `public/lib/lectores.js` | Lectura de .xls/.xlsx (SheetJS), .csv y .pdf (pdf.js) |
| `public/lib/salida.js` | Arma los .xlsx de Odoo |
| `public/config/bancos.json` | Perfiles de bancos |
| `public/logo.svg` | Logo e ícono |
| `vercel.json` | Configuración de Vercel y encabezados de seguridad |

Librerías externas, cargadas desde CDN con versión fija: SheetJS 0.20.3 (cdn.sheetjs.com) y pdf.js 4.10.38 (jsDelivr).
