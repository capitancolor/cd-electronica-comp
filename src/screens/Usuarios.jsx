import React, { useState, useEffect } from 'react'
import { getUsuarios, crearUsuario, eliminarUsuario, actualizarUsuario, getLocales } from '../services/negocio'
import { Icon, Badge, toast } from '../components/UI'

/* ===============================
   PALETA VISUAL CLONADA DE STOCK
   =============================== */
const UI = {
  pageBg: '#e6e6e6',
  pageText: '#111111',
  pageMuted: '#555555',
  pageBorder: '#d9d9d9',
  title: '#111111',
  subtitle: '#444444',
  divider: '#d6d6d6',

  tableWrapBg: '#ffffff',
  tableWrapBorder: '#0d0d0d',
  theadBg: '#000000',
  theadText: '#ffffff',
  rowBg: '#ffffff',
  rowHoverBg: '#fafafa', 
  rowBorder: '#797979',

  accentBlue: '#2563eb',
  accentRed: '#dc2626',

  modalOverlayBg: 'rgba(0, 0, 0, 0.18)',
  modalBg: '#ffffff',
  modalBorder: '#000000',
  modalTitle: '#111111',
  modalText: '#222222',
  modalDivider: '#e5e5e5',
  modalSectionBg: '#fafafa',
  modalSectionBorder: '#dddddd',
  modalSectionTitle: '#2563eb',
  modalInputBg: '#ffffff',
  modalInputText: '#111111',
  modalInputBorder: '#797979',
  modalLabel: '#555555',

  modalConfirmBg: '#16a34a',
  modalConfirmText: '#ffffff',
  modalConfirmHoverBg: '#15803d',
  modalCancelBg: '#ffffff',
  modalCancelText: '#222222',
  modalCancelBorder: '#f40f0f'
}

function StockButton({ children, onClick, variant = 'confirm', type = 'button' }) {
  const [hover, setHover] = useState(false)
  const isConfirm = variant === 'confirm'
  
  return (
    <button
      type={type}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: isConfirm ? (hover ? UI.modalConfirmHoverBg : UI.modalConfirmBg) : (hover ? '#f5f5f5' : UI.modalCancelBg),
        color: isConfirm ? UI.modalConfirmText : UI.modalCancelText,
        border: `1px solid ${isConfirm ? UI.modalConfirmBg : UI.modalCancelBorder}`,
        borderRadius: 10,
        padding: '10px 16px',
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer'
      }}
    >
      {children}
    </button>
  )
}

function UsuariosModal({ title, onClose, children, actions, width = 420 }) {
  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        background: UI.modalOverlayBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 20
      }}
    >
      <div style={{
        background: UI.modalBg,
        border: `2px solid ${UI.modalBorder}`,
        borderRadius: 14,
        padding: 24,
        maxWidth: width,
        width: '100%',
        boxShadow: '0 10px 30px rgba(0,0,0,0.08)'
      }}>
        <div className="row-between" style={{ marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${UI.modalDivider}` }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: UI.modalTitle }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}>
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
        {actions && (
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22, paddingTop: 14, borderTop: `1px solid ${UI.modalDivider}` }}>
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState([])
  const [locales, setLocales] = useState([])
  const [modalNuevo, setModalNuevo] = useState(false)
  const [editandoId, setEditandoId] = useState(null)
  const [datosEdicion, setDatosEdicion] = useState({})

  useEffect(() => { cargarDatos() }, [])

  async function cargarDatos() {
    const [u, l] = await Promise.all([getUsuarios(), getLocales()])
    setUsuarios(u || [])
    setLocales(l || [])
  }

  const handleGuardarCambios = async (id) => {
    const payload = { ...datosEdicion, nombre: datosEdicion.username };
    if (!payload.password) delete payload.password;

    await actualizarUsuario(id, payload)
    setEditandoId(null); setDatosEdicion({}); cargarDatos()
    toast("Miembro actualizado")
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16, background: UI.pageBg, color: UI.pageText, padding: 8, borderRadius: 12 }}>
      
      <div className="row-between">
        <div className="col">
          <h2 style={{ fontSize: 20, fontWeight: 700, color: UI.title, margin: 0 }}>Gestión de Miembros</h2>
          <span style={{ color: UI.subtitle, fontSize: 12 }}>Administración de personal</span>
        </div>
        <button 
          className="btn-primary" 
          onClick={() => setModalNuevo(true)}
          style={{ height: 38, display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px' }}
        >
          <Icon name="plus" size={15} /> Registrar Miembro
        </button>
      </div>

      <hr style={{ margin: 0, border: 'none', borderTop: `1px solid ${UI.divider}` }} />

      <div className="table-wrap scroll-area" style={{ background: UI.tableWrapBg, border: `1px solid ${UI.tableWrapBorder}`, flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 5 }}>
            <tr style={{ background: UI.theadBg }}>
              <th style={{ padding: 14, textAlign: 'left', color: UI.theadText, fontSize: 12, fontWeight: 800 }}>USUARIO</th>
              <th style={{ padding: 14, textAlign: 'left', color: UI.theadText, fontSize: 12, fontWeight: 800 }}>LOCAL / ROL</th>
              <th style={{ padding: 14, textAlign: 'right', color: UI.theadText, fontSize: 12, fontWeight: 800 }}>ACCIONES</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map(u => (
              <tr key={u.id} className="row-stock" style={{ background: UI.rowBg, borderBottom: `1px solid ${UI.rowBorder}` }}>
                <td style={{ padding: 14 }}>
                  {editandoId === u.id ? (
                    <div className="col" style={{ gap: 8 }}>
                      <input 
                        placeholder="Nombre"
                        style={{ padding: '6px 10px', border: `1px solid ${UI.accentBlue}`, borderRadius: 6, width: '100%', fontWeight: 700 }}
                        defaultValue={u.username}
                        onChange={e => setDatosEdicion({...datosEdicion, username: e.target.value})}
                      />
                      <input 
                        type="password"
                        placeholder="Nueva contraseña (opcional)"
                        style={{ padding: '6px 10px', border: `1px solid #797979`, borderRadius: 6, width: '100%', fontSize: 12 }}
                        onChange={e => setDatosEdicion({...datosEdicion, password: e.target.value})}
                      />
                    </div>
                  ) : (
                    <span style={{ color: UI.pageText, fontWeight: 700, fontSize: 15 }}>{u.username}</span>
                  )}
                </td>
                <td style={{ padding: 14 }}>
                  {editandoId === u.id ? (
                    <div className="col" style={{ gap: 8 }}>
                      <select 
                        style={{ padding: '6px 10px', border: `1px solid ${UI.accentBlue}`, borderRadius: 6, width: '100%', fontWeight: 700 }}
                        defaultValue={u.local_id}
                        onChange={e => setDatosEdicion({...datosEdicion, local_id: e.target.value})}
                      >
                        {locales.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                      </select>
                      <select 
                        style={{ padding: '6px 10px', border: `1px solid ${UI.accentBlue}`, borderRadius: 6, width: '100%', fontSize: 12 }}
                        defaultValue={u.rol}
                        onChange={e => setDatosEdicion({...datosEdicion, rol: e.target.value})}
                      >
                        <option value="vendedor">Vendedor</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </div>
                  ) : (
                    <div className="col" style={{ gap: 4 }}>
                      <Badge color="#000">{u.local_nombre?.toUpperCase() || 'SIN LOCAL'}</Badge>
                      <span style={{ fontSize: 10, fontWeight: 800, color: u.rol === 'admin' ? UI.accentBlue : '#666' }}>
                        {u.rol?.toUpperCase() || 'VENDEDOR'}
                      </span>
                    </div>
                  )}
                </td>
                <td style={{ padding: 14, textAlign: 'right' }}>
                  <div className="row" style={{ gap: 12, justifyContent: 'flex-end' }}>
                    {editandoId === u.id ? (
                      <>
                        <button onClick={() => handleGuardarCambios(u.id)} style={{ color: '#16a34a', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 900 }}>OK</button>
                        <button onClick={() => {setEditandoId(null); setDatosEdicion({})}} style={{ color: '#666', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>X</button>
                      </>
                    ) : (
                      <>
                        <button 
                          onClick={() => {
                            setEditandoId(u.id);
                            setDatosEdicion({ username: u.username, local_id: u.local_id, rol: u.rol || 'vendedor' });
                          }} 
                          style={{ color: UI.accentBlue, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}
                        >
                          EDITAR
                        </button>
                        <button 
                          onClick={() => { if(confirm(`¿Eliminar a ${u.username}?`)) eliminarUsuario(u.id).then(cargarDatos) }}
                          style={{ color: UI.accentRed, background: 'none', border: 'none', cursor: 'pointer' }}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalNuevo && (
        <UsuariosModal 
          title="➕ Registrar Miembro" 
          onClose={() => setModalNuevo(false)}
          actions={
            <>
              <StockButton variant="cancel" onClick={() => setModalNuevo(false)}>Cancelar</StockButton>
              <StockButton onClick={async () => {
                const form = document.getElementById('form-usuario');
                const formData = new FormData(form);
                const data = Object.fromEntries(formData);
                await crearUsuario({ ...data, nombre: data.username });
                setModalNuevo(false);
                cargarDatos();
                toast("Miembro registrado");
              }}>Registrar Miembro</StockButton>
            </>
          }
        >
          <form id="form-usuario" className="col" style={{ gap: 20 }}>
            <div className="col" style={{ gap: 6 }}>
              <label style={{ fontWeight: 700, fontSize: 13, color: UI.pageText }}>Nombre / Usuario *</label>
              <input name="username" placeholder="Ej: Juan" autoFocus style={{ fontSize: 16, height: 44, background: UI.modalInputBg, border: `1px solid ${UI.modalInputBorder}`, padding: '0 12px', borderRadius: 8, fontWeight: 700 }} required />
            </div>

            <div style={{ background: UI.modalSectionBg, padding: 16, borderRadius: 10, border: `1px solid ${UI.modalSectionBorder}`, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: UI.modalSectionTitle, letterSpacing: 1 }}>SEGURIDAD Y ACCESO</div>
              
              <div className="col" style={{ gap: 4 }}>
                <label style={{ fontSize: 12, color: UI.modalLabel, fontWeight: 700 }}>Contraseña</label>
                <input name="password" type="password" style={{ background: UI.modalInputBg, border: `1px solid ${UI.modalInputBorder}`, padding: 10, borderRadius: 6 }} required />
              </div>

              <div className="row" style={{ gap: 10 }}>
                <div className="col" style={{ gap: 4, flex: 1 }}>
                  <label style={{ fontSize: 12, color: UI.modalLabel, fontWeight: 700 }}>Local</label>
                  <select name="local_id" style={{ background: UI.modalInputBg, border: `1px solid ${UI.modalInputBorder}`, padding: 10, borderRadius: 6, fontWeight: 700 }}>
                    {locales.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                  </select>
                </div>

                <div className="col" style={{ gap: 4, flex: 1 }}>
                  <label style={{ fontSize: 12, color: UI.modalLabel, fontWeight: 700 }}>Rol</label>
                  <select name="rol" style={{ background: UI.modalInputBg, border: `1px solid ${UI.modalInputBorder}`, padding: 10, borderRadius: 6, fontWeight: 700 }}>
                    <option value="vendedor">Vendedor</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
              </div>
            </div>
          </form>
        </UsuariosModal>
      )}
    </div>
  )
}