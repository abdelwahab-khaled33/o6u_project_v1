const API_BASE_PATH = '/api/v1';
const TOKEN_KEY = 'exam_platform_token';

export class ApiError extends Error {
  status: number;
  payload?: Record<string, unknown>;

  constructor(status: number, error: string, payload?: unknown) {
    super(error);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload != null && typeof payload === 'object' ? (payload as Record<string, unknown>) : undefined;
  }
}

let unauthorizedHandler: (() => void) | null = null;

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function onUnauthorized(handler: () => void): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

type ErrorBody = { error?: unknown; details?: unknown } | null;

async function readError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  const error = typeof body?.error === 'string' ? body.error : response.statusText || 'Request failed';
  return new ApiError(response.status, error, body);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_BASE_PATH}${path}`, { ...init, headers });
  if (!response.ok) {
    const error = await readError(response);
    if (error.status === 401) {
      clearToken();
      unauthorizedHandler?.();
    }
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function jsonRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return jsonRequest<T>('POST', path, body);
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return jsonRequest<T>('PUT', path, body);
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return jsonRequest<T>('PATCH', path, body);
  },
  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' });
  },
  upload<T>(path: string, body: FormData): Promise<T> {
    return request<T>(path, { method: 'POST', body });
  },
  async download(path: string): Promise<Blob> {
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(`${API_BASE_PATH}${path}`, { headers });
    if (!response.ok) {
      const error = await readError(response);
      if (error.status === 401) {
        clearToken();
        unauthorizedHandler?.();
      }
      throw error;
    }
    return response.blob();
  },
};
