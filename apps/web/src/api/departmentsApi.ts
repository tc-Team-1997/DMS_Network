/**
 * departmentsApi.ts — Master Setup · Departments (§4.11 / SC-19) client.
 *
 * Wires the core departments master-data endpoints (built this session):
 *   GET    /departments
 *   GET    /departments/:id
 *   POST   /departments
 *   PUT    /departments/:id
 *   DELETE /departments/:id
 */
import { http, SVC } from "./http.js";

const BASE = SVC.core;

export interface Department {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  head: string | null;
  branch: string | null;
  status: string;
  createdAt: string | null;
}

export interface CreateDepartmentInput {
  code: string;
  name: string;
  parent_id?: string | null;
  head?: string;
  branch?: string;
  status?: string;
}

export async function listDepartments(): Promise<Department[]> {
  return (await http.get<{ departments: Department[] }>(`${BASE}/departments`)).departments ?? [];
}

export async function createDepartment(input: CreateDepartmentInput): Promise<Department> {
  return (await http.post<{ department: Department }>(`${BASE}/departments`, input)).department;
}

export async function updateDepartment(id: string, patch: Partial<CreateDepartmentInput>): Promise<Department> {
  return (await http.put<{ department: Department }>(`${BASE}/departments/${encodeURIComponent(id)}`, patch)).department;
}

export async function deleteDepartment(id: string): Promise<void> {
  await http.delete(`${BASE}/departments/${encodeURIComponent(id)}`);
}

export const departmentsApi = { listDepartments, createDepartment, updateDepartment, deleteDepartment };
