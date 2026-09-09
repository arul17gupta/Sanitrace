/**
 * Mirrors the API's response types.
 *
 * Duplicated rather than shared through a third workspace: two packages and one
 * copied file is a smaller cost than a build graph, and the surface is small
 * enough that a drift shows up immediately in the client functions. Noted as a
 * trade-off in NOTES.md.
 */

export type EquipmentStatus = 'active' | 'retired';
export type CleaningStatus = 'pending' | 'verified';
export type UserRole = 'operator' | 'supervisor';

export interface User {
  id: string;
  name: string;
  role: UserRole;
}

export interface Equipment {
  id: string;
  name: string;
  code: string;
  status: EquipmentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CleaningMethod {
  id: string;
  code: string;
  name: string;
  type: 'cip' | 'manual' | 'solvent' | 'dry';
  version: number;
  isActive: boolean;
}

export interface CleaningRecord {
  id: string;
  equipmentId: string;
  cleanedBy: string;
  cleanedByName: string;
  cleanedAt: string;
  methodId: string;
  methodCode: string;
  methodName: string;
  notes: string | null;
  status: CleaningStatus;
  createdAt: string;
  updatedAt: string;
  verifiedBy: string | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
}

export interface AuditFieldEntry {
  id: number;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface AuditChangeSet {
  id: string;
  recordId: string;
  action: 'create' | 'update';
  reason: string | null;
  changedBy: string;
  changedByName: string;
  changedAt: string;
  entries: AuditFieldEntry[];
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface RecordDraft {
  cleanedBy: string;
  cleanedAt: string;
  methodId: string;
  notes: string | null;
}
