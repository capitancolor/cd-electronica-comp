import { useState, useEffect, useRef } from 'react'
import { Icon, useToast, ToastContainer } from './components/UI'
import { getLocalConfig } from './services/config' 
import SetupLocal from './screens/SetupLocal' 
import Login from './screens/Login'
import Ventas from './screens/Ventas'
import Stock from './screens/Stock'
import Reportes from './screens/Reportes'
import Amortizacion from './screens/Amortizacion'
import Usuarios from './screens/Usuarios' 
import Notas from './screens/Notas' 
import Clientes from './screens/Clientes' 
import Reparaciones from './screens/Reparaciones'
// MonitorPrecios removed
import { inicializarBaseLocal, sincronizarTablasMaestras, sincronizarClientes, sincronizarReparacionesMaestras, procesarVentasPendientes, procesarProductosPendientes, procesarClientesPendientes, procesarTecnicosPendientes, congelarVentasAnteriores } from './services/negocio';

const NAV = [
  { id: 'ventas',       label: 'Nueva Venta',  icon: 'computer', roles: ['admin', 'vendedor'] },
  { id: 'stock',        label: 'Stock',        icon: 'stock',    roles: ['admin', 'vendedor'] },
  { id: 'reportes',     label: 'Ventas',       icon: 'reports',  roles: ['admin', 'vendedor'] },
  { id: 'amortizacion', label: 'Gastos',       icon: 'reports',  roles: ['admin'] },
  { id: 'reparaciones', label: 'Reparaciones', icon: 'stock',    roles: ['admin', 'vendedor'] },
  { id: 'clientes',     label: 'Clientes',     icon: 'stock',    roles: ['admin'] }, 
  { id: 'notas',        label: 'Notas',        icon: 'stock',     roles: ['admin'] },
  { id: 'usuarios',     label: 'Usuarios',     icon: 'eye',      roles: ['admin'] },
]

export default function App() {
  const [config, setConfig] = useState(null)
  const [checking, setChecking] = useState(true)
  const [usuario, setUsuario] = useState(null)
  const [seccion, setSeccion] = useState('ventas')
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const { toasts } = useToast()

  // --- LÓGICA DE SINCRONIZACIÓN ORDENADA (PUSH -> PULL) ---
  const lastSyncRef = useRef(0);
  const syncingRef = useRef(false);

const ejecutarSincroCompleta = async () => {
    if (!navigator.onLine) return;
    if (syncingRef.current) {
      console.log("⏱️ Sync omitido: ya hay una sincronización en curso");
      return;
    }
    
    // Prevenir sync loop: mínimo 30 segundos entre sincros automáticas
    const now = Date.now();
    if (lastSyncRef.current && (now - lastSyncRef.current) < 30000) {
      console.log("⏱️ Sync omitido: demasiado pronto desde la última sincro");
      return;
    }
    lastSyncRef.current = now;
    syncingRef.current = true;

    try {
      setSyncing(true);
      console.log("🔄 Sincronización: Intentando subir ventas...");
      
      await procesarVentasPendientes();
      console.log("⬆️ Ventas subidas correctamente.");

      await procesarProductosPendientes();
      console.log("⬆️ Productos importados sincronizados.");

      await procesarClientesPendientes();
      console.log("⬆️ Clientes pendientes subidos.");

      await procesarTecnicosPendientes();
      console.log("⬆️ Técnicos pendientes subidos.");

      await sincronizarClientes();
      console.log("⬇️ Clientes sincronizados desde la nube.");

      await sincronizarTablasMaestras();
      console.log("⬇️ Stock actualizado desde la nube.");

      await congelarVentasAnteriores();
      console.log("📸 Ventas anteriores congeladas.");

      await sincronizarReparacionesMaestras();
      console.log("⬇️ Reparaciones sincronizadas desde la nube.");

      setLastSync(new Date());
    } catch (error) {
      console.warn("⚠️ Sincro abortada para proteger el stock local:", error.message);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  };

  // --- FLUJO DE INICIO ---
  useEffect(() => {
  const prepararSistema = async () => {
      try {
        setChecking(true);
        
        await inicializarBaseLocal();

        const savedConfig = await getLocalConfig();
        if (savedConfig) {
          await ejecutarSincroCompleta();
          setConfig(savedConfig);
        }
      } catch (error) {
        console.error("Error en el arranque de la app:", error);
      } finally {
        setChecking(false);
      }
    };

    prepararSistema();

    window.addEventListener('online', ejecutarSincroCompleta);

    const interval = setInterval(ejecutarSincroCompleta, 60000);

    return () => {
      window.removeEventListener('online', ejecutarSincroCompleta);
      clearInterval(interval);
    };
  }, []);

  // 1. Pantalla de carga/Splash
  if (checking) {
    return (
      <div style={{ 
        height: '100vh', display: 'flex', flexDirection: 'column', 
        alignItems: 'center', justifyContent: 'center', background: '#1f2937', color: 'white' 
      }}>
        <div style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 10 }}>CD ELECTRÓNICA</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>Sincronizando base de datos local...</div>
      </div>
    );
  }

  const handleConfigured = async (nuevaConfig) => {
    setConfig(nuevaConfig);
    if (navigator.onLine) {
      await ejecutarSincroCompleta();
    }
  };

  // 2. Si no hay configuración de local (Primera vez)
  if (!config) return (
    <>
      <SetupLocal onConfigured={handleConfigured} />
      <ToastContainer toasts={toasts} />
    </>
  )

  // 3. Si no hay usuario logueado
  if (!usuario) return (
    <>
      <Login onLogin={setUsuario} />
      <ToastContainer toasts={toasts} />
    </>
  )

  const menuFiltrado = NAV.filter(item => item.roles.includes(usuario.rol || 'vendedor'))

  const screens = { 
    ventas: Ventas, 
    stock: Stock, 
    clientes: Clientes,
    reparaciones: Reparaciones,
    reportes: Reportes, 
    amortizacion: Amortizacion,
    notas: Notas, 
    usuarios: Usuarios 
  }

  const Screen = screens[seccion] || Ventas

  return (
    <div className="layout" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Estilos del Sidebar */}
      <style>{`
        .sidebar { width: 90px; min-width: 90px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; background: #1f2937; color: white; padding-top: 5px; }
        .nav-item { display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; padding: 6px 0 !important; gap: 2px !important; width: 100%; min-height: 58px; border: none; background: transparent; cursor: pointer; color: rgba(255,255,255,0.4); transition: 0.2s; }
        .nav-item.active { color: #fff !important; background: transparent !important; }
        .nav-item span { font-size: 9px; text-align: center; line-height: 1.1; width: 100%; display: block; padding: 0 4px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.2px; }
        .main-content { flex-grow: 1; background: #f3f4f6; overflow: auto; }
        .nav-item:hover { color: rgba(255,255,255,0.8); }
      `}</style>

      <nav className="sidebar">
        <div style={{ padding: '10px 0', marginBottom: 10, textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', width: '100%' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: '#fbbf24' }}>LOCAL</div>
          <div style={{ fontSize: 14, fontWeight: 900, color: '#fbbf24' }}>{config.local_id}</div>
        </div>

        <div className="nav-group" style={{ width: '100%' }}>
          {menuFiltrado.map(n => {
            const isActive = seccion === n.id;
            return (
              <button 
                key={n.id} 
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setSeccion(n.id)} 
              >
                <Icon name={n.icon} size={18} color={isActive ? '#fff' : 'rgba(255,255,255,0.4)'} />
                <span>{n.label}</span>
              </button>
            )
          })}
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.05)', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div style={{ fontSize: 9, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
            CONECTADO
          </div>
          {lastSync && (
            <div style={{ fontSize: 8, color: '#6b7280' }}>
              {lastSync.toLocaleTimeString()}
            </div>
          )}
        </div>
        
        <div style={{ padding: '12px 0', borderTop: '1px solid rgba(255,255,255,0.08)', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ fontSize: 8, background: usuario.rol === 'admin' ? '#2563eb' : '#4b5563', color: 'white', padding: '1px 8px', borderRadius: 10, fontWeight: 800, textTransform: 'uppercase' }}>
            {usuario.rol}
          </div>
          <div style={{ fontSize: 10, color: '#fff', fontWeight: 700 }}>{usuario.nombre?.split(' ')[0]}</div>
          <button onClick={() => { setUsuario(null); setSeccion('ventas'); }} style={{ color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 10, fontWeight: 700 }}>
            <Icon name="logout" size={12} color="#f87171" />
            <span>SALIR</span>
          </button>
        </div>
      </nav>

      <main className="main-content">
        <Screen usuario={usuario} config={config} onConfigChange={setConfig} />
      </main>

      <ToastContainer toasts={toasts} />
    </div>
  )
}