import { chromium } from 'playwright';

const BASE_URL = process.env.TEST_URL || 'http://127.0.0.1:5173';

async function runAudit() {
  console.log(`\n🔍 Starting automated QA Health Check on ${BASE_URL}...\n`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const issues = [];
  const networkErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      issues.push(`[Console Error] ${msg.text()}`);
    }
  });

  page.on('response', response => {
    if (response.status() >= 400) {
      networkErrors.push(`[HTTP ${response.status()}] ${response.url()}`);
    }
  });

  const routes = [
    { name: 'Hub Directory', path: '/hub' },
    { name: 'Case Overview', path: '/cases/CASE-0047' },
    { name: 'Chronology (Timeline)', path: '/cases/CASE-0047/timeline' },
    { name: 'Verify / Extraction', path: '/cases/CASE-0047/verify' },
    { name: 'Locations & Map', path: '/cases/CASE-0047/map' },
    { name: 'Search Network & Contacts', path: '/cases/CASE-0047/contacts' },
  ];

  for (const route of routes) {
    process.stdout.write(`Testing ${route.name.padEnd(28)}... `);
    try {
      const response = await page.goto(`${BASE_URL}${route.path}`, { waitUntil: 'networkidle', timeout: 15000 });
      if (!response || response.status() >= 400) {
        console.log(`❌ Failed with status ${response?.status()}`);
        continue;
      }

      const bodyText = await page.innerText('body');
      if (bodyText.trim().length < 50) {
        console.log(`⚠️ Warning: Page appears empty or unrendered.`);
      } else {
        console.log(`✅ Loaded`);
      }
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
    }
  }

  console.log('\n--- AUDIT SUMMARY ---');
  if (networkErrors.length > 0) {
    console.log(`\n🚨 Failed Network Requests (${networkErrors.length}):`);
    networkErrors.forEach(err => console.log(`   ${err}`));
  } else {
    console.log('\n✅ No 400/500 network errors detected.');
  }

  if (issues.length > 0) {
    console.log(`\n⚠ JavaScript Console Errors (${issues.length}):`);
    issues.forEach(err => console.log(`   ${err}`));
  } else {
    console.log('✅ No browser console errors logged.');
  }

  await browser.close();
  console.log('\n🏁 Audit complete.\n');
}

runAudit();
