import axios, { AxiosError, type AxiosInstance } from 'axios';
import { z, type ZodTypeAny } from 'zod';

/**
 * Single axios instance for all backend calls. Same-origin requests —
 * the session cookie rides automatically. In dev, Vite proxies these
 * paths to Node :3000 (see vite.config.ts).
 */
export const http: AxiosInstance = axios.create({
  baseURL: '/',
  withCredentials: true,
  timeout: 20_000,
});

export class HttpError extends Error {
  public readonly status: number;
  public readonly data: unknown;
  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

http.interceptors.response.use(
  (r) => r,
  (error: AxiosError) => {
    const status = error.response?.status ?? 0;
    const data = error.response?.data ?? null;
    const message =
      (typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : null) ?? error.message;
    return Promise.reject(new HttpError(message, status, data));
  },
);

/**
 * zod-validate every response body. Any shape drift becomes a typed
 * runtime error instead of a silent `any` that propagates into the UI.
 */
export async function get<S extends ZodTypeAny>(
  url: string,
  schema: S,
  params?: Record<string, unknown>,
): Promise<z.infer<S>> {
  const { data } = await http.get<unknown>(url, { params });
  return schema.parse(data);
}

export async function post<S extends ZodTypeAny>(
  url: string,
  body: unknown,
  schema: S,
): Promise<z.infer<S>> {
  const { data } = await http.post<unknown>(url, body);
  return schema.parse(data);
}

export async function postForm<S extends ZodTypeAny>(
  url: string,
  form: FormData,
  schema: S,
): Promise<z.infer<S>> {
  const { data } = await http.post<unknown>(url, form);
  return schema.parse(data);
}

export async function del<S extends ZodTypeAny>(url: string, schema: S): Promise<z.infer<S>> {
  const { data } = await http.delete<unknown>(url);
  return schema.parse(data);
}
