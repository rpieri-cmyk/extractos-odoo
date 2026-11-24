# Extractos bancarios → Odoo

Aplicación web que convierte extractos bancarios (.pdf, .xls, .xlsx, .csv) en los dos templates de importación de extractos de Odoo. Es la misma lógica de conversión que el Google Sheet "Extractos Odoo 17 | Template", pero la pueden usar muchas personas a la vez.

| Template | Columnas |
|---|---|
| Con estado de cuenta | Estado de cuenta · Fecha · Importe · Etiqueta · partner_id |
| Sin estado de cuenta | Fecha · Importe · Etiqueta · partner_id |

El partner_id es el CUIT que aparece en el concepto del movimiento. Se toma solo si tiene 11 dígitos y el dígito verificador es válido.

## Privacidad: no se guarda nada

- El extracto viaja en el pedido, se procesa en memoria y la respuesta vuelve solo a quien lo subió.
- El servidor no escribe archivos: ni el extracto ni los .xlsx generados. No hay base de datos ni sesiones.
- Las respuestas llevan `Cache-Control: no-store`, así que el navegador y el proxy no las guardan.
- Los logs registran solo errores internos (ruta y tipo de error), nunca el contenido del archivo.
- En el navegador de cada persona quedan solo dos preferencias: el último banco elegido y el CUIT propio a ignorar.
- El `.gitignore` excluye .xls, .xlsx, .csv y .pdf para que nunca se suba un extracto al repositorio.

## Cómo se usa

1. Elegir el banco y el archivo del extracto, y apretar **Procesar**.
2. Revisar el resumen, los avisos y la tabla de movimientos. Si un contacto no existe en Odoo, se puede corregir o borrar su partner_id.
3. Revisar el **Estado de cuenta** (se completa con el período) y descargar el template que corresponda.

## Bancos

Los bancos se configuran en [config/bancos.json](config/bancos.json), con los mismos campos que la hoja "Bancos" del Sheet. El archivo se relee en cada pedido, así que los cambios no requieren reiniciar el servicio.

| Banco | Formatos | Estado |
|---|---|---|
| Credicoop | SaldMovs .xls | Probado |
| Ciudad | PDF del resumen de cuenta; Excel con encabezados | Probado |
| Ciudad (home banking) | Excel del home banking | Probado |
| Provincia | PDF del extracto informativo | PDF probado; Excel sin probar |
| Nación | Excel (columnas de la macro) | Sin probar |
| Automático | Cualquier planilla con encabezados habituales | Genérico |

Si las columnas de un banco no coinciden con el archivo, la app intenta detectar los encabezados automáticamente y lo avisa. Los PDF se leen con un lector propio para cada banco (Ciudad y Provincia). Para agregar otro banco en PDF hay que escribir su lector en `lib/conversion.js`.

## Instalación en el servidor

Requisitos: Node.js 20 o posterior, y nginx o Apache como proxy.

```bash
git clone <url-del-repo> /opt/extractos-odoo
cd /opt/extractos-odoo
npm install --omit=dev
npm start            # escucha en 127.0.0.1:3000
```

Variables de entorno opcionales:

| Variable | Por defecto | Para qué |
|---|---|---|
| `PORT` | 3000 | Puerto local |
| `HOST` | 127.0.0.1 | Interfaz (dejarla local; el acceso es por el proxy) |
| `LIMITE_MB` | 20 | Tamaño máximo del extracto |
| `BANCOS_JSON` | config/bancos.json | Otro archivo de bancos |

Para dejarlo como servicio, en [despliegue/](despliegue/) hay ejemplos de configuración:

- `extractos-odoo.service` para systemd
- `nginx.conf`
- `apache.conf`

La app funciona en la raíz de un dominio o bajo una subruta, por ejemplo `/extractos/`.

### Actualizar

```bash
cd /opt/extractos-odoo && git pull && npm install --omit=dev && sudo systemctl restart extractos-odoo
```

## Probar un extracto sin levantar el servidor

```bash
npm run probar -- "Credicoop" /ruta/al/extracto.xls
```

## Estructura

| Archivo | Contenido |
|---|---|
| `server.js` | Servidor HTTP: `/api/bancos`, `/api/procesar`, `/api/descargar` y los archivos de `public/` |
| `lib/conversion.js` | Lógica de conversión: columnas, fechas, importes, CUIT y lectores de PDF (copiada del Apps Script) |
| `lib/lectores.js` | Lectura de .xls/.xlsx (SheetJS), .csv y .pdf (pdf.js), en memoria |
| `lib/salida.js` | Arma los .xlsx de Odoo en memoria |
| `public/` | Interfaz web |
| `config/bancos.json` | Perfiles de bancos |
