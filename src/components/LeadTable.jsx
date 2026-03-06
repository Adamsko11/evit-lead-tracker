import StatusBadge from './StatusBadge'

function DupBadge({ dup }) {
  if (!dup) return null
  const isHard = dup.type === 'hard'
  const matchName = [dup.match.first_name, dup.match.last_name].filter(Boolean).join(' ') || 'Unknown'
  const tooltip = `${dup.reason}: matches "${matchName}"${dup.match.company_name ? ` at ${dup.match.company_name}` : ''} (${dup.match.status || 'New'})`

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold cursor-help ${
        isHard ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full inline-block ${isHard ? 'bg-red-500' : 'bg-amber-500'}`} />
      {isHard ? 'DUP' : 'SIM'}
    </span>
  )
}

export default function LeadTable({ leads, loading, selectedId, onSelect, onStatusChange }) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
        <div className="text-gray-400 text-sm animate-pulse">Loading leads...</div>
      </div>
    )
  }

  if (leads.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
        <div className="text-5xl mb-4">📋</div>
        <div className="text-gray-700 font-semibold mb-1">No leads found</div>
        <div className="text-gray-400 text-sm">Import a file or add leads manually to get started</div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="text-left px-3 py-3 text-gray-400 font-medium w-14 text-xs uppercase tracking-wide"></th>
            <th className="text-left px-3 py-3 text-gray-400 font-medium text-xs uppercase tracking-wide">Name</th>
            <th className="text-left px-3 py-3 text-gray-400 font-medium text-xs uppercase tracking-wide">Company</th>
            <th className="text-left px-3 py-3 text-gray-400 font-medium text-xs uppercase tracking-wide">Position</th>
            <th className="text-left px-3 py-3 text-gray-400 font-medium text-xs uppercase tracking-wide">Email</th>
            <th className="text-left px-3 py-3 text-gray-400 font-medium text-xs uppercase tracking-wide">Location</th>
            <th className="text-left px-3 py-3 text-gray-400 font-medium text-xs uppercase tracking-wide">Status</th>
            <th className="text-left px-3 py-3 text-gray-400 font-medium text-xs uppercase tracking-wide">By</th>
            <th className="text-center px-3 py-3 text-gray-400 font-medium text-xs uppercase tracking-wide">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {leads.map(lead => (
            <tr
              key={lead.id}
              onClick={() => onSelect(lead)}
              className={`cursor-pointer hover:bg-blue-50 transition-colors ${
                selectedId === lead.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
              }`}
            >
              <td className="px-3 py-3 w-14">
                <DupBadge dup={lead._dup} />
              </td>
              <td className="px-3 py-3">
                <div className="font-medium text-gray-900">
                  {[lead.first_name, lead.last_name].filter(Boolean).join(' ') || <span className="text-gray-300">—</span>}
                </div>
                {lead.personal_linkedin && (
                  <a
                    href={lead.personal_linkedin.startsWith('http') ? lead.personal_linkedin : `https://${lead.personal_linkedin}`}
                    onClick={e => e.stopPropagation()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-500 hover:underline"
                  >
                    LinkedIn ↗
                  </a>
                )}
              </td>
              <td className="px-3 py-3">
                <div className="text-gray-800">{lead.company_name || <span className="text-gray-300">—</span>}</div>
                {lead.headcount && (
                  <div className="text-xs text-gray-400">{Number(lead.headcount).toLocaleString()} employees</div>
                )}
              </td>
              <td className="px-3 py-3 text-gray-600 max-w-[140px] truncate">{lead.job_title || <span className="text-gray-300">—</span>}</td>
              <td className="px-3 py-3">
                {lead.email
                  ? <a href={`mailto:${lead.email}`} onClick={e => e.stopPropagation()} className="text-blue-600 hover:underline">{lead.email}</a>
                  : <span className="text-gray-300">—</span>
                }
              </td>
              <td className="px-3 py-3 text-gray-600">{lead.location || <span className="text-gray-300">—</span>}</td>
              <td className="px-3 py-3">
                <StatusBadge status={lead.status || 'New'} />
              </td>
              <td className="px-3 py-3 text-gray-400 text-xs">{lead.added_by || '—'}</td>
              <td className="px-3 py-3 text-center">
                {lead.status !== 'Done' && onStatusChange ? (
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      onStatusChange(lead.id, 'Done')
                    }}
                    className="px-2 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded hover:bg-green-200 transition-colors"
                    title="Mark as Done"
                  >
                    ✓ Done
                  </button>
                ) : (
                  <span className="text-xs text-gray-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
        Showing {leads.length} lead{leads.length !== 1 ? 's' : ''}
      </div>
    </div>
  )
}
