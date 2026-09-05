# RL Gastos 3

App personal de gastos en guaraníes. Funciona sin backend, cuenta ni dependencias de producción. HTML, CSS y módulos JavaScript nativos; IndexedDB para datos y service worker para acceso sin conexión.

## Uso

- **Registrar:** monto al principio (`85.500 almuerzo itaú black`), revisar y guardar. También hay formulario manual y revisión editable de cargas múltiples. Categoría/medio desconocidos requieren selección.
- **Movimientos:** buscar, filtrar por mes o rango, editar, repetir desde favoritos y enviar a papelera. Restaurar mantiene la identidad original.
- **Presupuestos:** límites por mes; copiar el anterior o aplicar explícitamente los límites del backup. Cero/vacío significa sin límite por categoría. El total suma los límites definidos, no representa saldo bancario.
- **Exportar:** CSV del mes/historial, JSON para ChatGPT con historial completo y controles, backup restaurable y extracto imprimible. Compartir el último archivo está disponible en Ajustes cuando el navegador lo permite.

## Datos y recuperación

Al abrir por primera vez, una instalación existente con esquema v2 se valida y copia a IndexedDB sin borrar `localStorage`. IDs, fechas originales, notas y subcategorías se conservan. Los presupuestos antiguos se mantienen como referencia sin inventar meses históricos. Las instalaciones antiguas no compatibles o corruptas muestran un error recuperable, no un historial vacío.

El movimiento se confirma solo cuando termina la transacción. Las escrituras comparan la revisión actual dentro de una transacción para rechazar pestañas desactualizadas. La operación conserva un ID al reintentar. Los borradores se guardan durante la edición; el borrador confirmado se elimina en la misma transacción que guarda el movimiento. Las importaciones son reemplazos explícitos: generan una copia interna previa de manera atómica.

**IndexedDB y las copias internas siguen siendo locales.** Un backup externo es necesario ante pérdida del teléfono o borrado de los datos del navegador. La app recuerda generar uno después de siete días; no promete escribir automáticamente en iCloud/Drive. “Generado” tampoco confirma que el archivo se guardó externamente.

En Ajustes → Recuperación se pueden descargar las copias de migración y anterior al último reemplazo. No hay borrado permanente desde la interfaz. Los borradores de otras sesiones también se pueden recuperar.

## Excel / ChatGPT

`rl_gastos_chatgpt_YYYY-MM.json` incluye:

- `formatVersion`, moneda `PYG`, zona `America/Asuncion`, fecha de exportación y selección.
- `selectedIds`, controles de conteo/ingresos/gastos/neto por selección y mes.
- Historial completo con `id`, `version`, fechas, descripción y `deletedAt` para conciliación.

El historial completo permite detectar correcciones que movieron un gasto fuera del mes seleccionado. Exportar no marca el archivo como incorporado al Excel. El CSV incluye IDs y revisiones; al abrirlo en Excel, importar la columna `id` como **texto** para preservar identificadores numéricos antiguos. Los textos que podrían ejecutarse como fórmulas se protegen con un apóstrofo; el JSON conserva el texto original.

**Pendiente:** el adaptador que modifica la planilla del usuario requiere recibir y probar su Excel. Esta versión entrega datos y controles; no afirma que una carga por ChatGPT ya sea idempotente sin ese adaptador.

## Desarrollo y comprobaciones

Node 22 o posterior y Python 3 para el servidor de pruebas.

```sh
npm test
npm run build
npm run check
python3 -m http.server 8080 --bind 127.0.0.1
```

Abrir `http://127.0.0.1:8080/rl-gastos.html`. No abrir el HTML mediante `file://`.

Pruebas del almacenamiento nativo: abrir `/tests/browser.html` y ejecutar. Las bases temporales usan exclusivamente datos ficticios. Las pruebas E2E requieren Playwright (solo desarrollo):

```sh
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
node tests/e2e.mjs
```

Validación local de un backup real, sin copiarlo al repositorio:

```sh
node tests/verify-backup.mjs /ruta/privada/al/backup.json
```

La validación compara cada campo original y los totales por mes; verifica también edición, papelera y exportación/restauración. `.gitignore` excluye archivos financieros. Nunca agregar el backup real, exports ni Excel como fixtures.

## Actualizaciones

`npm run build` genera `sw.js` con una versión calculada desde todos los archivos de la app. `npm run check` detecta un worker desactualizado; CI ejecuta reglas, almacenamiento y flujos de navegador. El worker conserva la versión anterior hasta que el usuario elija actualizar; la app conserva el borrador antes de recargar. Los recursos ajenos a la app no reciben un HTML como fallback.

Netlify construye con Node 22. Primero usar una deploy preview y verificar importación, teclado, descarga/compartir y reapertura sin conexión en **Safari y la app instalada del iPhone real**. La emulación de Chrome no reemplaza esa comprobación. Cerrar la versión anterior en otras pestañas antes de migrar: el código antiguo no conoce IndexedDB.

No revertir al HTML antiguo para editar datos después de migrar: sus datos son una copia anterior de localStorage. Una reversión debe conservar IndexedDB y restaurar una versión compatible o usar un backup v3. Conservar backups antes de cualquier migración.

## Alcance

Registro de gastos e ingresos, no un libro de cuentas bancarias: no calcula deuda real de tarjetas, saldo disponible ni pagos de cuotas. No hay sincronización multi-dispositivo, OCR ni servicios externos. Las comparaciones entre meses se muestran solo para meses cerrados marcados como revisados. Modificar un movimiento invalida la revisión de los meses afectados.
