import { useState } from 'react'
import { checkDuplicate } from '../lib/dedup'

const FIELDS = [
  { key: 'first_name',        label: 'First Name',          type: 'text'   },
  { key: 'last_name',         label: 'Last Name',           type: 'text'   },
  { key: 'email',             label: 'Email',               type: 'email'  },
  { key: 'personal_linkedin', label: 'Personal LinkedIn',   type: 'url'    },
  { key: 'company_name',      label: 'Company Name',        type: 'text'   },
  { key: 'company_linkedin',  label: 'Company LinkedIn',    type: 'url'    },
  { key: 'job_title',         label: 'Job Title / Position',type: 'text'   },
  { key: 'headcount',         label: 'Headcount',           type: 'number' },
  { key: 'location',          label: 'Location',            type: 'text'   },
]

export default function LeadDetail({ lead, allLeads, onSave, onDelete, onClose }) {
  const isNew = !lead.id

  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', personal_linkedin: '',
    company_name: '', company_linkedin: '', job_title: '', headcount: '',
    location: '', status: 'New', notes: '',
    ...lead,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  const dup = checkDuplicate(form, allLeads.filter(l => l.id !== lead.id))

  function set(key, val) {
    setForm(prev => ({ ...prev, [key]: val }))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const data = { ...form }
      if (data.headcount !== '' && data.headcount !== null) {
        data.headcount = parseInt(data.headcount) || null
      } else {
        data.headcount = null
      }
      delete data._dup
      if (isNew) {
        await onSave(data)
        onClose()
      } else {
        await onSave(lead.id, data)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this lead? This cannot be undone.')) return
    try {
      await onDelete(lead.id)
      onClose()
    } catch (err) {
      setError(err.message)
    }
  }

  const displayName = isNew ? 'New Lead' : [form.first_name, form.last_name].filter(Boolean).join(' ') || 'Edit Lead'

  return (
    <div className="bg-white rounded-xl border border-gray-200 flex flex-col" style={{ maxHeight: 'calc(100vh - 140px)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
        <h2 className="font-semibold text-gray-800 truncate">{displayName}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-2">×</button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Dup warning */}
        {dup && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${
            dup.type === 'hard'
              ? 'bg-red-50 border border-red-200 text-red-700'
              : 'bg-amber-50 border border-amber-200 text-amber-700'
          }`}>
            <div className="font-semibold">{dup.type === 'hard' ? '🔴 Duplicate detected' : '🟡 Similar lead found'}</div>
            <div className="text-xs mt-1">
              {dup.reason}:{' '}
              <strong>{[dup.match.first_name, dup.match.last_name].filter(Boolean).join(' ') || 'Unknown'}</strong>
              {dup.match.company_name && <> at {dup.match.company_name}</>}
              {' · '}<span className="capitalize">{dup.match.status || 'New'}</span>
            </div>
          </div>
        )}

        {/* Status selector */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Status</label>
          <div className="flex gap-2">
            {['New', 'In Progress', 'Done'].map(s => (
              <button
                key={s}
                onClick={() => set('status', s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  form.status === s
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Fields */}
        <div className="space-y-3">
          {FIELDS.map(({ key, label, type }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">{label}</label>
              <input
                type={type}
                value={form[key] || ''}
                onChange={e => set(key, e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 transition-shadow"
              />
            </div>
          ))}

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">Notes</label>
            <textarea
              value={form.notes || ''}
              onChange={e => set('notes', e.target.value)}
              rows={3}
              placeholder="Any notes about this lead..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none transition-shadow"
            />
          </div>
        </div>

        {error && (
          <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{error}</div>
        )}

        {/* Action buttons */}
        <div className="mt-4 flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : isNew ? 'Add Lead' : 'Save Changes'}
          </button>
          {!isNew && (
            <button
              onClick={handleDelete}
              className="px-3 py-2 border border-red-200 text-red-500 rounded-lg text-sm hover:bg-red-50 transition-colors"
              title="Delete lead"
            >
              🗑
            </button>
          )}
        </div>

        {!isNew && (
          <div className="mt-3 text-xs text-gray-400 text-center">
            Added by <strong>{lead.added_by || 'Unknown'}</strong>
            {lead.created_at && <> · {new Date(lead.created_at).toLocaleDateString()}</>}
          </div>
        )}
      </div>
    </div>
  )
}
