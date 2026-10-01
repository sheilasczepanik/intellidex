import { chromium } from 'playwright';
import path from 'path';

(async () => {
  // 1. Launch browser
  const browser = await chromium.launch({
    headless: false // Set to true if you don't need to watch it run
  });

  // 2. Set viewport & video output directory
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, // Standard clean desktop resolution
    recordVideo: {
      dir: './recordings',
      size: { width: 1440, height: 900 }
    }
  });

  const page = await context.newPage();

  // 3. Navigate to your local server (update port if not 5173/3000)
  await page.goto('http://localhost:5173'); 
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500); // Brief pause after initial load

  // --- INTERACTION FLOW (Customize these steps) ---

  // Example: Smooth scroll down the page
  await page.evaluate(() => {
    window.scrollBy({ top: 500, behavior: 'smooth' });
  });
  await page.waitForTimeout(2000);

  // Example: Click a button or nav item (change selector/text to match your UI)
  // await page.getByRole('button', { name: 'Open Case' }).click();
  // await page.waitForTimeout(2000);

  // ------------------------------------------------

  // 4. Save video
  await context.close();
  await browser.close();

  const videoPath = await page.video().path();
  console.log(`Video saved to: ${videoPath}`);
})();
