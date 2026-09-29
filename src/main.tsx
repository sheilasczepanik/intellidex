import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initDb } from './db'

void Promise.race([
  initDb(),
  new Promise<void>((_, reject) => {
    window.setTimeout(() => reject(new Error("IndexedDB open timed out")), 8000);
  }),
]).catch((err) => {
  console.error("[DB] init failed", err);
}).finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
