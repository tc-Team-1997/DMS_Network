import { z } from 'zod';
import { get, post, http } from '@/lib/http';
import { RoleSchema } from '@/lib/schemas';

export const UserRowSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  full_name: z.string().nullable(),
  email: z.string().nullable(),
  role: RoleSchema,
  branch: z.string().nullable(),
  status: z.enum(['Active', 'Locked', 'Disabled']),
  mfa_enabled: z.number().int(),
  tenant_id: z.string(),
  created_at: z.string(),
});
export type UserRow = z.infer<typeof UserRowSchema>;

export const CreateUserInputSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(6).max(200),
  full_name: z.string().max(120).optional(),
  email: z.string().email().max(200).optional(),
  role: RoleSchema,
  branch: z.string().max(80).optional(),
});
export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;

export const PatchUserInputSchema = z.object({
  full_name: z.string().max(120).optional(),
  email: z.string().email().max(200).optional(),
  role: RoleSchema.optional(),
  branch: z.string().nullable().optional(),
  status: z.enum(['Active', 'Locked', 'Disabled']).optional(),
  password: z.string().min(6).max(200).optional(),
});
export type PatchUserInput = z.infer<typeof PatchUserInputSchema>;

export const fetchUsers = () => get('/spa/api/users', z.array(UserRowSchema));

export const createUser = (body: CreateUserInput) =>
  post('/spa/api/users', CreateUserInputSchema.parse(body), UserRowSchema);

export const patchUser = async (id: number, body: PatchUserInput) => {
  const { data } = await http.patch(`/spa/api/users/${id}`, PatchUserInputSchema.parse(body));
  return UserRowSchema.parse(data);
};
