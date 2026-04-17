import { get, postForm } from '@/lib/http';
import { FolderSchema } from '@/lib/schemas';
import { z } from 'zod';

export const fetchFolders = () => get('/spa/api/folders', z.array(FolderSchema));

const UploadResponseSchema = z.object({ ok: z.literal(true), id: z.number().int() });
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

export const uploadDocument = (form: FormData): Promise<UploadResponse> =>
  postForm('/spa/api/documents', form, UploadResponseSchema);
