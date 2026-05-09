# InsumosApp — React + PGlite


# Faltanding:

- Excel reporte ventas diarias por local (tarjeta)
- Interfaz
- Actualización de precios
- Subir a git 
- Roles de acceso
- Pantalla de admin para agregar/borrar usuarios
- Frontend
- Export a excel gastos
- Modificar ventas diarias y ventas mensuales

CDAELECTRONICA1*


✔ What is your app name? · insumos-appcdelectronica
✔ What should the window title be? · cd-electronica
✔ Where are your web assets (HTML/CSS/JS) located, relative to the "<current dir>/src-tauri/tauri.conf.json" file that will be created? · ../src
✔ What is the url of your dev server? · http://localhost:3000
✔ What is your frontend dev command? · npm run dev
✔ What is your frontend build command? · npm run build

Supabase: --//'CDAinformatica' 

Sistema de gestión de ventas e inventario. Corre 100% en el browser,
sin servidor, sin instalación especial. Los datos persisten en IndexedDB.

## Requisitos
- Node.js 18+ (ya tenés v22 ✓)

## Correr en desarrollo

```bash
npm install
npm run dev
```

Abre http://localhost:5173

## Compilar para producción

```bash
npm run build
# Los archivos quedan en dist/
# Subí esa carpeta a Netlify, Vercel, o cualquier hosting estático
```

## Usuarios demo
| Usuario   | Contraseña | Rol      |
|-----------|------------|----------|
| admin     | admin123   | Admin    |
| vendedor1 | vendedor1  | Vendedor |
| vendedor2 | vendedor2  | Vendedor |

## Migración futura a servidor
Cuando tengas backend, solo hay que reemplazar las funciones
en `src/services/negocio.js` por llamadas fetch() a tu API.
El resto de la app no cambia nada.
