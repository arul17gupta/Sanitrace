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
  /**
   * Derived from the audit trail -- the `changed_by` of the change set that
   * moved this record to `verified`. Deliberately not a stored column: a
   * duplicate could drift out of step with the trail, and the trail is the
   * record of authority.
   */
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
