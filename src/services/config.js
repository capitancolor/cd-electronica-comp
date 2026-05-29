import { readTextFile, writeTextFile, BaseDirectory, mkdir } from '@tauri-apps/plugin-fs';

const CONFIG_FILE = 'app_config.json';

const BASE = BaseDirectory.AppLocalData;

async function ensureDir() {
  try { await mkdir('', { baseDir: BASE, recursive: true }); } catch { /* ya existe */ }
}

export async function getLocalConfig() {
  try {
    const data = await readTextFile(CONFIG_FILE, { baseDir: BASE });
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function saveLocalConfig(config) {
  try {
    await ensureDir();
    await writeTextFile(CONFIG_FILE, JSON.stringify(config), { baseDir: BASE });
    return true;
  } catch (e) {
    console.error('Error al guardar config:', e);
    return false;
  }
}

export async function hardReset() { window.location.reload(); }