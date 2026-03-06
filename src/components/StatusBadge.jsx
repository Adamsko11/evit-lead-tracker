const STATUS_CONFIG = {
  'New':         { bg: 'bg-blue-100',  text: 'text-blue-700',  dot: 'bg-blue-500'  },
  'In Progress': { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
  'Done':        { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
}

export default function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG['New']
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {status || 'New'}
    </span>
  )
}
