import { readTextFile, writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';

const CONFIG_FILE = 'app_config.json';

/**
 * Lee la configuración guardada
 */
export async function getLocalConfig() {
  // Hardcodeamos el retorno: la app pensará que ya existe el config
  return { 
    local_id: 1, 
    nombre_local: 'LOCAL 1' 
  };

}

// Dejamos estas vacías para que no tiren error de importación en otros lados
export async function saveLocalConfig() { return true; }
export async function hardReset() { window.location.reload(); }