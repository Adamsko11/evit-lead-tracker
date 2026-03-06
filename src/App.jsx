import { useState, useEffect, useMemo } from 'react'
import { supabase, isConfigured } from './lib/supabase'
import { checkDuplicate } from './lib/dedup'
import LeadTable from './components/LeadTable'
import LeadDetail from './components/LeadDetail'
import ImportModal from './components/ImportModal'
import SearchFilter from './components/SearchFilter'

const STORAGE_USER_KEY = 'evit_current_user'

// ─── Setup screen (shown if .env not configured) ────────────────────────────
function SetupScreen() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-lg w-full">
        <div className="text-4xl mb-3 text-center">⚙️</div>
        <h1 className="text-xl font-bold text-gray-800 mb-2 text-center">Database Not Configured</h1>
        <p className="text-gray-500 text-sm text-center mb-6">
          Add your Supabase credentials to connect the database.
        </p>
        <div className="bg-gray-50 rounded-lg p-4 text-sm font-mono text-gray-600 space-y-1">
          <div>VITE_SUPABASE_URL=<span className="text-blue-600">https://xxx.supabase.co</span></div>
          <div>VITE_SUPABASE_ANON_KEY=<span className="text-blue-600">eyJ...</span></div>
        </div>
        <p className="text-gray-400 text-xs mt-3 text-center">
          Set these as environment variables in Vercel → Project Settings → Environment Variables,
          then redeploy.
        </p>
      </div>
    </div>
  )
}

// ─── User selector ──────────────────────────────────────────────────────────
function UserSelector({ onSelect }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-80 text-center">
        <div className="text-5xl mb-4">🎯</div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">EVIT Lead Tracker</h1>
        <p className="text-gray-400 text-sm mb-8">Who's using this session?</p>
        <div className="space-y-3">
          {['Adam', 'Lan'].map(name => (
            <button
              key={name}
              onClick={() => onSelect(name)}
              className="w-full py-3 px-4 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 active:scale-95 transition-all text-lg"
            >
              {name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [leads,        setLeads]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [dbError,      setDbError]      = useState(null)
  const [selectedLead, setSelectedLead] = useState(null) // null = panel closed, {} = new, {id,...} = edit
  const [showImport,   setShowImport]   = useState(false)
  const [filters,      setFilters]      = useState({ search: '', status: 'All' })
  const [currentUser,  setCurrentUser]  = useState(() => localStorage.getItem(STORAGE_USER_KEY) || null)

  // Guard: not configured
  if (!isConfigured) return <SetupScreen />
  // Guard: no user selected
  if (!currentUser)  return <UserSelector onSelect={name => { localStorage.setItem(STORAGE_USER_KEY, name); setCurrentUser(name) }} />

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    fetchLeads()

    // Realtime: any DB change → re-fetch
    const channel = supabase
      .channel('leads-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, fetchLeads)
      .subscribe()

    return () => supabase.removeChannel(channel)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchLeads() {
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      setLeads(data || [])
    } catch (err) {
      setDbError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Filtered leads with duplicate flags
  const filteredLeads = useMemo(() => {
    return leads
      .filter(lead => {
        if (filters.status !== 'All' && lead.status !== filters.status) return false
        if (filters.search) {
          const q = filters.search.toLowerCase()
          return (
            (lead.first_name    || '').toLowerCase().includes(q) ||
            (lead.last_name     || '').toLowerCase().includes(q) ||
            (lead.email         || '').toLowerCase().includes(q) ||
            (lead.company_name  || '').toLowerCase().includes(q) ||
            (lead.job_title     || '').toLowerCase().includes(q) ||
            (lead.location      || '').toLowerCase().includes(q)
          )
        }
        return true
      })
      .map(lead => ({
        ...lead,
        _dup: checkDuplicate(lead, leads.filter(l => l.id !== lead.id)),
      }))
  }, [leads, filters])

  // Status counts for filter bar
  const statusCounts = useMemo(() => {
    return {
      All:         leads.length,
      New:         leads.filter(l => l.status === 'New').length,
      'In Progress': leads.filter(l => l.status === 'In Progress').length,
      Done:        leads.filter(l => l.status === 'Done').length,
    }
  }, [leads])

  const hardDupCount = useMemo(
    () => filteredLeads.filter(l => l._dup?.type === 'hard').length,
    [filteredLeads]
  )

  // ── DB operations ──────────────────────────────────────────────────────────
  async function addLead(data) {
    const { error } = await supabase
      .from('leads')
      .insert([{ ...data, added_by: currentUser }])
    if (error) throw error
    await fetchLeads()
  }

  async function updateLead(id, updates) {
    const { error } = await supabase
      .from('leads')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    await fetchLeads()
    if (selectedLead?.id === id) setSelectedLead(prev => ({ ...prev, ...updates }))
  }

  async function deleteLead(id) {
    const { error } = await supabase.from('leads').delete().eq('id', id)
    if (error) throw error
    await fetchLeads()
    if (selectedLead?.id === id) setSelectedLead(null)
  }

  async function importLeads(leadsData) {
    // Clean ALL data before sending to Supabase
    const rows = leadsData.map(l => {
      const clean = { ...l, added_by: currentUser }
      // headcount MUST be integer or null — auto-fix silently
      if (clean.headcount !== undefined && clean.headcount !== null && clean.headcount !== '') {
        const num = parseInt(String(clean.headcount).replace(/[^0-9]/g, ''), 10)
        clean.headcount = isNaN(num) ? null : num
      } else {
        clean.headcount = null
      }
      return clean
    })
    // Batch insert in chunks of 500
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('leads').insert(rows.slice(i, i + 500))
      if (error) throw error
    }
    await fetchLeads()
  }

  async function changeLeadStatus(id, status) {
    try {
      await updateLead(id, { status })
    } catch (err) {
      alert(`Error updating status: ${err.message}`)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-200 px-6 py-3.5">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎯</span>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-tight">EVIT Lead Tracker</h1>
              <p className="text-xs text-gray-400">{leads.length.toLocaleString()} leads in database</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">
              Signed in as <span className="font-semibold text-gray-700">{currentUser}</span>
            </span>
            <button
              onClick={() => { localStorage.removeItem(STORAGE_USER_KEY); setCurrentUser(null) }}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              Switch
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-6 py-6">
        {/* DB error banner */}
        {dbError && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            ⚠️ <strong>Database error:</strong> {dbError}
          </div>
        )}

        {/* ── Toolbar ── */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <SearchFilter filters={filters} onChange={setFilters} />
          <div className="flex-1" />
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:border-gray-300 hover:bg-gray-50 transition-colors shadow-sm"
          >
            ⬆ Import Leads
          </button>
          <button
            onClick={() => setSelectedLead({})}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
          >
            + Add Lead
          </button>
        </div>

        {/* ── Status filter bar ── */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {['All', 'New', 'In Progress', 'Done'].map(s => (
            <button
              key={s}
              onClick={() => setFilters(prev => ({ ...prev, status: s }))}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                filters.status === s
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
            >
              {s}{' '}
              <span className={`text-xs ${filters.status === s ? 'opacity-80' : 'text-gray-400'}`}>
                {statusCounts[s]}
              </span>
            </button>
          ))}

          {hardDupCount > 0 && (
            <span className="ml-2 flex items-center gap-1.5 text-xs text-red-500">
              <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
              {hardDupCount} duplicate{hardDupCount !== 1 ? 's' : ''} visible
            </span>
          )}
        </div>

        {/* ── Main content ── */}
        <div className="flex gap-6">
          <div className={`transition-all duration-200 ${selectedLead !== null ? 'flex-1 min-w-0' : 'w-full'}`}>
            <LeadTable
              leads={filteredLeads}
              loading={loading}
              selectedId={selectedLead?.id}
              onSelect={setSelectedLead}
              onStatusChange={changeLeadStatus}
            />
          </div>

          {selectedLead !== null && (
            <div className="w-96 shrink-0">
              <LeadDetail
                key={selectedLead?.id || 'new'}
                lead={selectedLead}
                allLeads={leads}
                onSave={selectedLead.id ? updateLead : addLead}
                onDelete={deleteLead}
                onClose={() => setSelectedLead(null)}
              />
            </div>
          )}
        </div>
      </main>

      {showImport && (
        <ImportModal
          allLeads={leads}
          currentUser={currentUser}
          onImport={importLeads}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  )
}
