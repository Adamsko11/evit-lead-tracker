const normalizeUrl = (url) => {
  if (!url) return ''
  return url
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
    .trim()
}

const normalizeText = (text) => (text || '').toLowerCase().trim()

/**
 * Check if a lead is a duplicate of any existing lead.
 * Returns { type: 'hard'|'soft', reason: string, match: lead } or null.
 */
export function checkDuplicate(lead, existingLeads) {
  const results = []

  for (const existing of existingLeads) {
    // Skip self when editing
    if (lead.id && lead.id === existing.id) continue

    // HARD: same email
    if (lead.email && existing.email &&
        normalizeText(lead.email) === normalizeText(existing.email)) {
      results.push({ type: 'hard', reason: 'Same email', match: existing })
      continue
    }

    // HARD: same personal LinkedIn
    if (lead.personal_linkedin && existing.personal_linkedin) {
      const a = normalizeUrl(lead.personal_linkedin)
      const b = normalizeUrl(existing.personal_linkedin)
      if (a && b && a === b) {
        results.push({ type: 'hard', reason: 'Same LinkedIn URL', match: existing })
        continue
      }
    }

    // SOFT: same company name (different contact)
    if (lead.company_name && existing.company_name &&
        normalizeText(lead.company_name) === normalizeText(existing.company_name)) {
      results.push({ type: 'soft', reason: 'Same company', match: existing })
    }
  }

  // Return worst result first (hard beats soft)
  return results.find(r => r.type === 'hard') || results.find(r => r.type === 'soft') || null
}
