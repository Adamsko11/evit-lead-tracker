export default function SearchFilter({ filters, onChange }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm select-none">🔍</span>
      <input
        type="text"
        placeholder="Search name, company, email, location..."
        value={filters.search}
        onChange={e => onChange(prev => ({ ...prev, search: e.target.value }))}
        className="pl-9 pr-4 py-2 w-80 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
      />
    </div>
  )
}
