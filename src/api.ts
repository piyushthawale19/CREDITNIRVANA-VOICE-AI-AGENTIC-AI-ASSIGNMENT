export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: 'include', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options })
  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) throw new Error(data?.error || data?.message || 'Something went wrong.')
  return data as T
}
