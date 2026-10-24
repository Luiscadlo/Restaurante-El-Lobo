// Configuración de las pruebas de El Lobo. Correr con: npm test
// En tu computador: la primera vez, `npx playwright install chromium`.
// Si ya tienes un Chromium instalado, puedes apuntarlo con PW_CHROMIUM=/ruta/al/chromium.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.js/,
  timeout: 30000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    viewport: { width: 1280, height: 900 },
    timezoneId: 'America/Bogota',
    locale: 'es-CO',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
});
