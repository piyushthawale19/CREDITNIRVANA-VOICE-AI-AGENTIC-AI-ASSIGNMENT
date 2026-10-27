const TOKEN_KEY = 'nirvana_token'

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {}
}

export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export function apiUrl(path: string): string {
  if (path.startsWith('http')) return path
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
}

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const fullUrl = apiUrl(url)
  const token = getStoredToken()
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {})
  }

  const response = await fetch(fullUrl, {
    credentials: 'include',
    ...options,
    headers
  })

  if (response.status === 401 && !url.includes('/api/auth/login') && !url.includes('/api/auth/register')) {
    setStoredToken(null)
  }

  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) throw new Error(data?.error || data?.message || 'Something went wrong.')
  return data as T
}
