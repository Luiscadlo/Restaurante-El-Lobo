# Librerías que el sistema trae adentro

El sistema **no descarga nada de internet para funcionar** salvo la hoja de fuentes de Google (solo estética) y, claro, tu Supabase.
Las librerías que necesita viajan en esta carpeta, para que el botón de Excel funcione siempre y para que nadie pueda cambiarle el contenido
desde un sitio ajeno.

## xlsx.full.min.js — SheetJS «xlsx» 0.18.5 (Apache-2.0)
- **Para qué sirve:** arma el archivo `.xlsx` cuando pulsas «Exportar datos a Excel» en la pestaña Datos (el que lee el modelo financiero).
  Solo ESCRIBE archivos; el sistema nunca abre ni lee un Excel de afuera (por eso las fallas conocidas de esta versión al *leer* archivos no aplican).
- **De dónde salió:** el paquete oficial `xlsx@0.18.5` del registro de npm, archivo `dist/xlsx.full.min.js`. La huella del paquete (`sha512-dmg3LCjBPHZnQp5/F/+nnTa+miPJxUXB6vtk42YjBBKayDNagxGEeIdWApkYPOf3Z3pm3k62Knjzp7lMeTEtFQ==`)
  es la misma que npm publica. Antes la página lo pedía a cdn.jsdelivr.net en cada carga.
- **Huella del archivo (SHA-256):** `c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99`
- **Huella para SRI (SHA-384):** `sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw`
- **Licencia:** `xlsx-LICENCIA.txt` (Apache-2.0: se puede usar y redistribuir con ese texto).
- **Una prueba automática** (`tests/exportar-excel.spec.js`) comprueba que el archivo es exactamente este y que el botón de Excel baja un .xlsx de verdad.
- **Para cambiar de versión:** bajar el paquete nuevo con `npm pack xlsx@VERSION`, comprobar su huella contra `npm view xlsx@VERSION dist.integrity`,
  reemplazar el archivo y actualizar este texto y la huella de la prueba. No se edita a mano.
