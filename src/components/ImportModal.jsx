import { useState, useRef } from 'react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { checkDuplicate } from '../lib/dedup'

// ─── EVIT field definitions ────────────────────────────────────────────────
const EVIT_FIELDS = [
  { key: 'first_name',        label: 'First Name'          },
  { key: 'last_name',         label: 'Last Name'           },
  { key: 'email',             label: 'Email'               },
  { key: 'personal_linkedin', label: 'Personal LinkedIn'   },
  { key: 'company_name',      label: 'Company Name'        },
  { key: 'company_linkedin',  label: 'Company LinkedIn'    },
  { key: 'job_title',         label: 'Job Title / Position'},
  { key: 'headcount',         label: 'Headcount'           },
  { key: 'location',          label: 'Location'            },
]

// Auto-mapping: lowercase variants for each EVIT field
const AUTO_MAP_HINTS = {
  first_name:        ['first name','firstname','first','fname','given name','forename','given'],
  last_name:         ['last name','lastname','last','lname','surname','family name','family'],
  email:             ['email','email address','e-mail','mail','work email','business email','email id'],
  personal_linkedin: ['linkedin','personal linkedin','linkedin url','linkedin profile','li url','linkedin link','profile url','li profile','linkedin_url'],
  company_name:      ['company','company name','organization','organisation','account','employer','firm','company_name','org','account name'],
  company_linkedin:  ['company linkedin','company linkedin url','company li','org linkedin','company_linkedin'],
  job_title:         ['title','job title','position','role','designation','function','job function','job_title','jobtitle'],
  headcount:         ['headcount','employees','employee count','company size','team size','no. employees','num employees','size','employee_count','number of employees'],
  location:          ['location','country','region','city','geography','country/region','market','hq','headquarters'],
}

// ─── Fuzzy matching (simple Levenshtein distance) ──────────────────────────
function levenshteinDistance(str1, str2) {
  const len1 = str1.length, len2 = str2.length
  const matrix = Array.from({ length: len1 + 1 }, () => Array(len2 + 1).fill(0))
  for (let i = 0; i <= len1; i++) matrix[i][0] = i
  for (let j = 0; j <= len2; j++) matrix[0][j] = j
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i][j - 1] + 1, matrix[i][j] + 1, matrix[i - 1][j - 1] + cost)
    }
  }
  return matrix[len1][len2]
}

function isSimilarEnough(headerNorm, hintNorm) {
  // Exact match
  if (headerNorm === hintNorm) return true
  // High similarity (2 char or less edit distance)
  if (levenshteinDistance(headerNorm, hintNorm) <= 2) return true
  // Substring match
  if (headerNorm.includes(hintNorm) || hintNorm.includes(headerNorm)) return true
  return false
}

// ─── Smart auto-mapping with scoring & collision prevention ──────────────────
function calculateSimilarityScore(header, hints) {
  const headerNorm = header.toLowerCase().trim()
  let bestScore = 0

  for (const hint of hints) {
    let score = 0
    // Exact match = 100
    if (headerNorm === hint) return 100
    // Substring match = 80
    if (headerNorm.includes(hint) || hint.includes(headerNorm)) score = 80
    // Fuzzy match with Levenshtein = 60-80 based on distance
    else {
      const distance = levenshteinDistance(headerNorm, hint)
      if (distance <= 1) score = 80
      else if (distance <= 2) score = 70
      else if (distance <= 3) score = 60
    }
    bestScore = Math.max(bestScore, score)
  }
  return bestScore
}

function autoMapSmart(headers, rawData = []) {
  // Create scoring matrix: headers × fields
  const scores = {}
  for (const header of headers) {
    scores[header] = {}
    for (const [fieldKey, hints] of Object.entries(AUTO_MAP_HINTS)) {
      scores[header][fieldKey] = calculateSimilarityScore(header, hints)
    }
  }

  // Data-type validation: check if values match field types
  const sampleRows = rawData.slice(0, 10) // Check first 10 rows
  if (sampleRows.length > 0) {
    for (const header of headers) {
      const values = sampleRows.map(r => String(r[header] || '').trim()).filter(v => v)
      if (values.length === 0) continue

      // Detect field type from data
      const isNumeric = values.every(v => !isNaN(Number(v)))
      const isEmail = values.every(v => v.includes('@'))
      const isURL = values.every(v => v.includes('http') || v.includes('linkedin'))

      // Boost score for correct type matches
      if (isNumeric) {
        scores[header]['headcount'] = (scores[header]['headcount'] || 0) + 30
      }
      if (isEmail) {
        scores[header]['email'] = (scores[header]['email'] || 0) + 30
      }
      if (isURL) {
        scores[header]['company_linkedin'] = (scores[header]['company_linkedin'] || 0) + 20
        scores[header]['personal_linkedin'] = (scores[header]['personal_linkedin'] || 0) + 20
      }
    }
  }

  // Greedy matching: assign each field to best header (no collisions)
  const mapping = {}
  const usedHeaders = new Set()

  // Sort fields by average score (high confidence first)
  const fieldScores = Object.keys(AUTO_MAP_HINTS).map(fieldKey => ({
    fieldKey,
    maxScore: Math.max(...headers.map(h => scores[h][fieldKey] || 0)),
  })).sort((a, b) => b.maxScore - a.maxScore)

  for (const { fieldKey } of fieldScores) {
    let bestHeader = null
    let bestScore = 0

    for (const header of headers) {
      if (usedHeaders.has(header)) continue // Already assigned
      const score = scores[header][fieldKey] || 0
      if (score > bestScore) {
        bestScore = score
        bestHeader = header
      }
    }

    // Only assign if score > 50 (reasonable confidence)
    if (bestHeader && bestScore > 50) {
      mapping[fieldKey] = bestHeader
      usedHeaders.add(bestHeader)
    }
  }

  return mapping
}

function autoMap(headers, rawData = []) {
  return autoMapSmart(headers, rawData)
}

// ─── File parsing ──────────────────────────────────────────────────────────
function parseFile(file, callback) {
  const ext = file.name.split('.').pop().toLowerCase()

  if (ext === 'csv') {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: results => callback(null, results.data, results.meta.fields || []),
      error:    err    => callback(err.message),
    })
  } else if (['xlsx', 'xls'].includes(ext)) {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json(ws, { defval: '' })
        callback(null, data, data.length ? Object.keys(data[0]) : [])
      } catch (err) {
        callback(err.message)
      }
    }
    reader.readAsArrayBuffer(file)
  } else {
    callback('Unsupported file type. Please use CSV, XLSX, or XLS.')
  }
}

// ─── Data validation & transformation ─────────────────────────────────────
function validateAndTransformLeads(rawLeads, mapping) {
  const errors = []
  const transformed = rawLeads.map((row, idx) => {
    const lead = {}
    let rowErrors = []

    for (const field of EVIT_FIELDS) {
      if (mapping[field.key] && row[mapping[field.key]] !== undefined) {
        let value = String(row[mapping[field.key]] || '').trim()

        // Type coercion for headcount
        if (field.key === 'headcount' && value) {
          const num = parseInt(value, 10)
          if (isNaN(num)) {
            rowErrors.push(`"${field.label}" must be a number (got "${value}")`)
            lead[field.key] = null
          } else {
            lead[field.key] = value  // Store as-is; Supabase will handle the conversion
          }
        } else {
          lead[field.key] = value
        }
      }
    }

    if (rowErrors.length > 0) {
      errors.push({ rowNum: idx + 2, errors: rowErrors })  // +2 because row 1 is header
    }

    return { lead, hasError: rowErrors.length > 0 }
  })

  return { leads: transformed.map(t => t.lead), errors }
}

// ─── Paste parsing (Google Sheets = TSV) ──────────────────────────────────
function parsePasteText(text) {
  const lines = text.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) return { data: [], headers: [] }

  const first = lines[0]
  const tabCount   = (first.match(/\t/g)  || []).length
  const commaCount = (first.match(/,/g)   || []).length

  let rows
  if (tabCount > 0) {
    rows = lines.map(l => l.split('\t').map(c => c.trim()))
  } else {
    const parsed = Papa.parse(text, { header: false, skipEmptyLines: true })
    rows = parsed.data
  }

  const headers = rows[0]
  const data    = rows.slice(1).map(row => {
    const obj = {}
    headers.forEach((h, i) => { obj[h] = (row[i] || '').trim() })
    return obj
  })
  return { headers, data }
}

// ─── Column Mapper ─────────────────────────────────────────────────────────
function ColumnMapper({ headers, rawData, mapping, onMappingChange, allLeads, onImport, onBack }) {
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState(null)

  // Apply mapping to ALL rows
  const allMapped = rawData
    .map(row => {
      const lead = {}
      for (const field of EVIT_FIELDS) {
        if (mapping[field.key] && row[mapping[field.key]] !== undefined) {
          lead[field.key] = String(row[mapping[field.key]] || '').trim()
        }
      }
      return lead
    })
    .filter(l => Object.values(l).some(v => v)) // drop empty rows

  // Validate and transform data
  const { leads: validatedLeads, errors: validationErrors } = validateAndTransformLeads(allMapped, mapping)

  const newLeads = validatedLeads.filter(l => !checkDuplicate(l, allLeads))
  const hardDups = validatedLeads.filter(l => checkDuplicate(l, allLeads)?.type === 'hard')

  // Preview first 5 rows with dup info
  const preview = validatedLeads.slice(0, 5).map(l => ({
    ...l,
    _dup: checkDuplicate(l, allLeads),
  }))
  const mappedFields = EVIT_FIELDS.filter(f => mapping[f.key])

  // Check if any rows have validation errors
  const hasValidationErrors = validationErrors.length > 0

  // Check if mapping is confident (most critical fields mapped)
  const criticalFields = ['first_name', 'last_name', 'email', 'company_name']
  const mappingConfidence = criticalFields.filter(f => mapping[f]).length / criticalFields.length
  const isConfidentMapping = mappingConfidence >= 0.75 // 75% of critical fields mapped
  const [showManualMapping, setShowManualMapping] = useState(!isConfidentMapping)

  async function doImport() {
    setImporting(true)
    setImportError(null)
    try {
      await onImport(newLeads)
    } catch (err) {
      setImportError(err.message)
      setImporting(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <button onClick={onBack} className="text-sm text-gray-400 hover:text-gray-600">← Back</button>
        <h3 className="font-semibold text-gray-800">
          {isConfidentMapping && !showManualMapping ? '✅ Review Leads' : 'Map Columns'}
        </h3>
        <span className="text-xs text-gray-400">{rawData.length} rows detected</span>
      </div>

      {isConfidentMapping && !showManualMapping ? (
        <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
          ✅ Columns auto-detected successfully.
          <button
            onClick={() => setShowManualMapping(true)}
            className="ml-2 underline font-semibold hover:text-green-900"
          >
            Adjust manually if needed.
          </button>
        </div>
      ) : (
        <p className="text-xs text-gray-500 mb-3">
          Match your file's columns to EVIT fields. Auto-detected where possible — adjust if needed.
        </p>
      )}

      {/* Mapping grid - hidden if confident */}
      {showManualMapping && (
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-5 max-h-52 overflow-y-auto pr-1">
        {EVIT_FIELDS.map(field => (
          <div key={field.key} className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-28 shrink-0">{field.label}</span>
            <select
              value={mapping[field.key] || ''}
              onChange={e => onMappingChange({ ...mapping, [field.key]: e.target.value || undefined })}
              className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
            >
              <option value="">— skip —</option>
              {headers.map(h => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      )}

      {/* Preview table */}
      {preview.length > 0 && mappedFields.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Preview (first 5 rows)</p>
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1.5 text-left text-gray-400 w-8"></th>
                  {mappedFields.map(f => (
                    <th key={f.key} className="px-2 py-1.5 text-left text-gray-500 font-medium">{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.map((row, i) => (
                  <tr
                    key={i}
                    className={
                      row._dup?.type === 'hard' ? 'bg-red-50' :
                      row._dup?.type === 'soft' ? 'bg-amber-50' : ''
                    }
                  >
                    <td className="px-2 py-1.5 text-center">
                      {row._dup?.type === 'hard' && <span title={row._dup.reason}>🔴</span>}
                      {row._dup?.type === 'soft' && <span title={row._dup.reason}>🟡</span>}
                    </td>
                    {mappedFields.map(f => (
                      <td key={f.key} className="px-2 py-1.5 text-gray-700 max-w-[130px] truncate">
                        {row[f.key] || <span className="text-gray-300">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Validation Errors */}
      {hasValidationErrors && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="text-sm font-semibold text-red-700 mb-2">⚠️ Data Validation Issues Found</div>
          <div className="space-y-1 text-xs text-red-600 max-h-32 overflow-y-auto">
            {validationErrors.slice(0, 10).map((err, i) => (
              <div key={i} className="font-mono bg-white px-2 py-1 rounded border border-red-100">
                <span className="font-semibold">Row {err.rowNum}:</span> {err.errors.join(', ')}
              </div>
            ))}
            {validationErrors.length > 10 && (
              <div className="text-red-500 font-medium">... and {validationErrors.length - 10} more rows with issues</div>
            )}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="bg-gray-50 rounded-lg p-3 mb-4 space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-gray-500">Total rows in file:</span><span className="font-medium">{rawData.length}</span></div>
        <div className="flex justify-between text-green-700"><span>✅ New leads to import:</span><span className="font-medium">{newLeads.length}</span></div>
        {hardDups.length > 0 && (
          <div className="flex justify-between text-red-600"><span>🔴 Hard duplicates (will skip):</span><span className="font-medium">{hardDups.length}</span></div>
        )}
        {(allMapped.length - newLeads.length - hardDups.length) > 0 && (
          <div className="flex justify-between text-amber-600">
            <span>🟡 Similar company (will import):</span>
            <span className="font-medium">{allMapped.length - newLeads.length - hardDups.length}</span>
          </div>
        )}
      </div>

      {importError && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{importError}</div>
      )}

      <button
        onClick={doImport}
        disabled={importing || newLeads.length === 0}
        className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {importing
          ? 'Importing...'
          : `Import ${newLeads.length} lead${newLeads.length !== 1 ? 's' : ''}${hardDups.length > 0 ? ` · skip ${hardDups.length} dup${hardDups.length !== 1 ? 's' : ''}` : ''}`
        }
      </button>
    </div>
  )
}

// ─── Main ImportModal ──────────────────────────────────────────────────────
export default function ImportModal({ allLeads, onImport, onClose }) {
  const [tab,     setTab]     = useState('upload')
  const [step,    setStep]    = useState('input') // 'input' | 'map'
  const [parsed,  setParsed]  = useState(null)
  const [headers, setHeaders] = useState([])
  const [mapping, setMapping] = useState({})
  const [pasteText, setPasteText] = useState('')
  const [parseError, setParseError] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef()

  // Manual entry
  const [manual, setManual] = useState({
    first_name: '', last_name: '', email: '', personal_linkedin: '',
    company_name: '', company_linkedin: '', job_title: '', headcount: '',
    location: '', status: 'New', notes: '',
  })
  const [manualSaving,  setManualSaving]  = useState(false)
  const [manualError,   setManualError]   = useState(null)
  const [manualSuccess, setManualSuccess] = useState(false)
  const manualDup = checkDuplicate(manual, allLeads)

  function changeTab(t) {
    setTab(t); setStep('input'); setParseError(null)
  }

  function fileReady(file) {
    setParseError(null)
    parseFile(file, (err, data, hdrs) => {
      if (err) { setParseError(err); return }
      setParsed(data)
      setHeaders(hdrs)
      setMapping(autoMap(hdrs, data))
      setStep('map')
    })
  }

  function handleParse() {
    setParseError(null)
    const { data, headers: hdrs } = parsePasteText(pasteText)
    if (!data.length) {
      setParseError('No data found. Make sure you copied the header row too (first row = column names).')
      return
    }
    setParsed(data)
    setHeaders(hdrs)
    setMapping(autoMap(hdrs, data))
    setStep('map')
  }

  async function handleImportComplete(leads) {
    await onImport(leads)
    onClose()
  }

  function setManualField(k, v) { setManual(prev => ({ ...prev, [k]: v })) }

  async function saveManual() {
    setManualSaving(true); setManualError(null); setManualSuccess(false)
    try {
      const data = { ...manual }
      if (data.headcount) data.headcount = parseInt(data.headcount) || null
      await onImport([data])
      setManualSuccess(true)
      setManual({ first_name: '', last_name: '', email: '', personal_linkedin: '',
        company_name: '', company_linkedin: '', job_title: '', headcount: '',
        location: '', status: 'New', notes: '' })
      setTimeout(() => setManualSuccess(false), 4000)
    } catch (err) {
      setManualError(err.message)
    } finally {
      setManualSaving(false)
    }
  }

  const TABS = [
    { id: 'upload', label: '📁 Upload File' },
    { id: 'paste',  label: '📋 Paste Data'  },
    { id: 'manual', label: '✏️ Add Manually' },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-lg font-semibold text-gray-800">Import Leads</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-6 shrink-0">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => changeTab(t.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── UPLOAD TAB ── */}
          {tab === 'upload' && step === 'input' && (
            <div>
              <div
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) fileReady(f) }}
                onClick={() => fileInputRef.current.click()}
                className={`border-2 border-dashed rounded-xl p-14 text-center cursor-pointer transition-colors ${
                  isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="text-5xl mb-3">📁</div>
                <div className="font-semibold text-gray-700 mb-1">Drop your file here</div>
                <div className="text-sm text-gray-400 mb-3">or click to browse</div>
                <div className="text-xs text-gray-400 bg-gray-100 inline-block px-3 py-1 rounded-full">
                  CSV · XLSX · XLS
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={e => { if (e.target.files[0]) fileReady(e.target.files[0]) }}
              />
              {parseError && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{parseError}</div>
              )}
            </div>
          )}

          {/* ── PASTE TAB ── */}
          {tab === 'paste' && step === 'input' && (
            <div>
              <p className="text-sm text-gray-600 mb-1">
                In Google Sheets: select all rows (including the header row) → Copy → Paste here.
              </p>
              <p className="text-xs text-gray-400 mb-3">The first row must be column headers.</p>
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                placeholder="Paste your data here..."
                rows={10}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
              />
              {parseError && (
                <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">{parseError}</div>
              )}
              <button
                onClick={handleParse}
                disabled={!pasteText.trim()}
                className="mt-3 w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                Parse & Map Columns →
              </button>
            </div>
          )}

          {/* ── COLUMN MAPPER (upload + paste) ── */}
          {(tab === 'upload' || tab === 'paste') && step === 'map' && parsed && (
            <ColumnMapper
              headers={headers}
              rawData={parsed}
              mapping={mapping}
              onMappingChange={setMapping}
              allLeads={allLeads}
              onImport={handleImportComplete}
              onBack={() => setStep('input')}
            />
          )}

          {/* ── MANUAL ENTRY TAB ── */}
          {tab === 'manual' && (
            <div>
              {manualSuccess && (
                <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                  ✅ Lead added! Form is cleared — add another one.
                </div>
              )}

              {manualDup && (
                <div className={`mb-4 p-3 rounded-lg text-sm ${
                  manualDup.type === 'hard'
                    ? 'bg-red-50 border border-red-200 text-red-700'
                    : 'bg-amber-50 border border-amber-200 text-amber-700'
                }`}>
                  <div className="font-semibold">{manualDup.type === 'hard' ? '🔴 Already in system' : '🟡 Similar lead found'}</div>
                  <div className="text-xs mt-1">
                    {manualDup.reason}:{' '}
                    {[manualDup.match.first_name, manualDup.match.last_name].filter(Boolean).join(' ') || 'Unknown'}
                    {manualDup.match.company_name && ` at ${manualDup.match.company_name}`}
                    {' · '}{manualDup.match.status || 'New'}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'first_name',        label: 'First Name'           },
                  { key: 'last_name',         label: 'Last Name'            },
                  { key: 'email',             label: 'Email'                },
                  { key: 'personal_linkedin', label: 'Personal LinkedIn'    },
                  { key: 'company_name',      label: 'Company Name'         },
                  { key: 'company_linkedin',  label: 'Company LinkedIn'     },
                  { key: 'job_title',         label: 'Job Title / Position', span: true },
                  { key: 'headcount',         label: 'Headcount'            },
                  { key: 'location',          label: 'Location'             },
                ].map(({ key, label, span }) => (
                  <div key={key} className={span ? 'col-span-2' : ''}>
                    <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">{label}</label>
                    <input
                      type="text"
                      value={manual[key] || ''}
                      onChange={e => setManualField(key, e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                ))}

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">Notes</label>
                  <textarea
                    value={manual.notes || ''}
                    onChange={e => setManualField('notes', e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Status</label>
                <div className="flex gap-2">
                  {['New', 'In Progress', 'Done'].map(s => (
                    <button
                      key={s}
                      onClick={() => setManualField('status', s)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        manual.status === s
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {manualError && (
                <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{manualError}</div>
              )}

              <button
                onClick={saveManual}
                disabled={manualSaving}
                className="mt-4 w-full py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {manualSaving ? 'Adding...' : 'Add Lead'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
