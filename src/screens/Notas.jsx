import { useState, useEffect } from 'react'
// Asegurate que esta ruta sea la correcta en tu proyecto
import { supabase } from '../supabase' 
import { Icon, toast, Badge } from '../components/UI'

/* =========================
   PALETA VISUAL DE ALTO CONTRASTE
   ========================= */
const UI = {
  pageBg: '#f3f4f6', 
  cardBg: '#ffffff',
  cardBorder: '#d1d5db', 
  inputBg: '#ffffff',
  inputBorder: '#9ca3af',
  inputText: '#111827',  // Texto principal (Casi negro)
  primaryBtn: '#2563eb',
  dangerBtn: '#dc2626',
  successBtn: '#16a34a',
  mutedText: '#4b5563',  // Texto secundario/fechas
  editBorder: '#2563eb'
}

/* =========================
   COMPONENTE BOTÓN INTERNO
   ========================= */
function SoftButton({ children, onClick, type = 'button', bg, color = '#fff', style = {} }) {
  return (
    <button 
      type={type} 
      onClick={onClick} 
      style={{ 
        background: bg, 
        color: color, 
        border: 'none', 
        padding: '10px 20px', 
        borderRadius: 10, 
        fontWeight: 700, 
        cursor: 'pointer',
        fontSize: 13,
        transition: 'opacity 0.2s',
        ...style 
      }}
      onMouseOver={e => e.currentTarget.style.opacity = '0.9'}
      onMouseOut={e => e.currentTarget.style.opacity = '1'}
    >
      {children}
    </button>
  )
}

export default function Notas({ usuario }) {
  const [notas, setNotas] = useState([])
  const [loading, setLoading] = useState(false)
  const [titulo, setTitulo] = useState('')
  const [contenido, setContenido] = useState('')
  const [editando, setEditando] = useState(null)
  const [tempTitulo, setTempTitulo] = useState('')
  const [tempContenido, setTempContenido] = useState('')

  useEffect(() => { cargarNotas() }, [])

  /* --- LÓGICA DE DATOS --- */
  async function cargarNotas() {
    setLoading(true)
    const { data, error } = await supabase
      .from('notas')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error) setNotas(data || [])
    setLoading(false)
  }

  async function guardarNota(e) {
    e.preventDefault()
    if (!titulo.trim() || !contenido.trim()) return
    setLoading(true)
    const { error } = await supabase
      .from('notas')
      .insert([{ titulo, contenido, usuario_id: usuario.id }])
    
    if (!error) {
      setTitulo(''); setContenido('')
      toast('Nota guardada', 'success')
      cargarNotas()
    } else {
      toast('Error al guardar', 'error')
    }
    setLoading(false)
  }

  async function eliminarNota(id) {
    if (!confirm('¿Borrar esta nota?')) return
    const { error } = await supabase.from('notas').delete().eq('id', id)
    if (!error) {
        toast('Nota eliminada', 'success')
        cargarNotas()
    }
  }

  async function actualizarNota(id) {
    const { error } = await supabase
      .from('notas')
      .update({ titulo: tempTitulo, contenido: tempContenido })
      .eq('id', id)
    
    if (!error) {
      setEditando(null)
      toast('Nota actualizada', 'success')
      cargarNotas()
    }
  }

  return (
    <div style={{ padding: 20, background: UI.pageBg, minHeight: '100%', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 20 }}>
      
      {/* FORMULARIO DE NUEVA NOTA */}
      <div style={{ background: UI.cardBg, padding: 20, borderRadius: 14, border: `1px solid ${UI.cardBorder}`, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
        <h2 style={{ margin: '0 0 15px 0', fontSize: 18, fontWeight: 800, color: UI.inputText }}>NUEVA NOTA</h2>
        <form onSubmit={guardarNota} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input 
            placeholder="Título de la nota..." 
            value={titulo} 
            onChange={e => setTitulo(e.target.value)}
            style={{ 
              padding: 12, borderRadius: 10, border: `2px solid ${UI.inputBorder}`, 
              fontSize: 14, fontWeight: 700, background: UI.inputBg, color: UI.inputText 
            }}
          />
          <textarea 
            placeholder="Escribí el contenido aquí..." 
            value={contenido} 
            onChange={e => setContenido(e.target.value)}
            style={{ 
              padding: 12, borderRadius: 10, border: `2px solid ${UI.inputBorder}`, 
              minHeight: 100, fontSize: 14, fontFamily: 'inherit', background: UI.inputBg, color: UI.inputText 
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <SoftButton type="submit" bg={UI.primaryBtn}>
              {loading ? 'GUARDANDO...' : 'GUARDAR NOTA'}
            </SoftButton>
          </div>
        </form>
      </div>

      {/* LISTADO DE NOTAS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {notas.map(nota => (
          <div key={nota.id} style={{ 
            background: UI.cardBg, padding: 18, borderRadius: 14, border: `1px solid ${UI.cardBorder}`,
            display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
          }}>
            {editando === nota.id ? (
              /* MODO EDICIÓN */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input 
                  value={tempTitulo} 
                  onChange={e => setTempTitulo(e.target.value)} 
                  style={{ padding: 10, borderRadius: 8, border: `2px solid ${UI.editBorder}`, color: UI.inputText, fontWeight: 700 }} 
                />
                <textarea 
                  value={tempContenido} 
                  onChange={e => setTempContenido(e.target.value)} 
                  style={{ padding: 10, borderRadius: 8, border: `2px solid ${UI.editBorder}`, color: UI.inputText, minHeight: 80, fontFamily: 'inherit' }} 
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 5 }}>
                  <button onClick={() => actualizarNota(nota.id)} style={{ background: UI.successBtn, color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>OK</button>
                  <button onClick={() => setEditando(null)} style={{ background: '#374151', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, cursor: 'pointer' }}>CANCELAR</button>
                </div>
              </div>
            ) : (
              /* MODO VISTA */
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <h4 style={{ margin: 0, fontWeight: 800, color: UI.inputText, fontSize: 16 }}>{nota.titulo}</h4>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button onClick={() => { setEditando(nota.id); setTempTitulo(nota.titulo); setTempContenido(nota.contenido); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.mutedText }}>
                       <Icon name="edit" size={16} />
                    </button>
                    <button onClick={() => eliminarNota(nota.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                       <Icon name="trash" size={16} />
                    </button>
                  </div>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{nota.contenido}</p>
                
                <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: UI.mutedText, fontWeight: 600 }}>
                    📅 {new Date(nota.created_at).toLocaleDateString('es-AR')}
                  </span>
                  <Icon name="reports" size={12} color="#d1d5db" />
                </div>
              </>
            )}
          </div>
        ))}

        {notas.length === 0 && !loading && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40, color: UI.mutedText, fontWeight: 600 }}>
            No hay notas guardadas aún.
          </div>
        )}
      </div>
    </div>
  )
}