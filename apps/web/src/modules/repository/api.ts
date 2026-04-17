import { get, http } from '@/lib/http';
import { DocumentSchema, FolderSchema, OkSchema } from '@/lib/schemas';
import { z } from 'zod';

export interface DocFilters {
  folder?: number;
  status?: string;
  type?: string;
  q?: string;
  limit?: number;
}

export const fetchFolders = () => get('/spa/api/folders', z.array(FolderSchema));

export const fetchDocuments = (f: DocFilters = {}) =>
  get('/spa/api/documents', z.array(DocumentSchema), f as Record<string, unknown>);

export const fetchDocument = (id: number) =>
  get(`/spa/api/documents/${id}`, DocumentSchema);

export const deleteDocument = async (id: number) => {
  const { data } = await http.delete<unknown>(`/spa/api/documents/${id}`);
  return OkSchema.parse(data);
};
