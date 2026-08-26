import type { AdminListInput } from "@/server/admin/admin.types";
import type { Prisma, SalesRegion, UserStatus } from "@prisma/client";

export type AdminDealerListInput = AdminListInput & {
  staffId?: string;
  status?: UserStatus;
  wallet?: "active" | "inactive";
  city?: string;
  name?: string;
  email?: string;
  phone?: string;
};

export type AdminDealerStaffAssignment = {
  id: bigint;
  staffId: bigint;
  active: boolean;
  assignedAt: Date;
  staff: {
    id: bigint;
    displayName: string;
    designation: string | null;
    staffRoleType: string | null;
    salesRegion: SalesRegion | null;
    user: { email: string; status: string; deletedAt: Date | null; role: string };
  };
};

export type AdminDealerRecord = {
  id: bigint;
  dealerCode: string | null;
  businessName: string;
  phone: string | null;
  city: string | null;
  state?: string | null;
  address: string | null;
  pincode: string | null;
  gstin: string | null;
  discountPercent: unknown;
  creditDays: number | null;
  creditLimitPaise?: bigint | null;
  annualTargetPaise?: bigint | null;
  notes?: string | null;
  priorityContact?: string | null;
  secondaryContactName?: string | null;
  secondaryContactPhone?: string | null;
  secondaryContactEmail?: string | null;
  imageUrl?: string | null;
  deletedAt?: Date | null;
  user: { id: bigint; email: string; username?: string | null; status: string; deletedAt?: Date | null };
  wallet?: { status: string } | null;
  region?: SalesRegion | null;
  rsmUserId?: bigint | null;
  regionalManager?: { id: bigint; email: string; staffProfile: { displayName: string; salesRegion: SalesRegion | null } | null } | null;
  staffAssignments?: AdminDealerStaffAssignment[];
};

export type CreateAdminDealerInput = {
  businessName: string;
  email: string;
  password: string;
  phone?: string;
  dealerCode?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstin?: string;
  discountPercent?: string;
  creditDays?: number;
  creditLimitPaise?: string;
  annualTargetPaise?: string;
  notes?: string;
  priorityContact?: "primary" | "secondary";
  secondaryContactName?: string;
  secondaryContactPhone?: string;
  secondaryContactEmail?: string;
  imageUrl?: string;
  status?: UserStatus;
  assignedStaffIds: string[];
  rsmUserId?: string;
  walletActive?: boolean;
};

export type UpdateAdminDealerInput = Partial<Omit<CreateAdminDealerInput, "password" | "status">>;

export type UpdateDealerStatusInput = {
  status: UserStatus;
  reason?: string;
};

export type AuthActor = {
  userId: bigint;
  sessionId: string;
  role: string;
};

export interface AdminDealerRepository {
  list(input: AdminDealerListInput): Promise<{ items: AdminDealerRecord[]; total: number }>;
  findById(dealerId: bigint): Promise<AdminDealerRecord | null>;
  create(input: CreateAdminDealerInput, actor: AuthActor, tx?: Prisma.TransactionClient): Promise<AdminDealerRecord>;
  update(dealerId: bigint, input: UpdateAdminDealerInput, actor: AuthActor): Promise<AdminDealerRecord>;
  updateStatus(dealerId: bigint, input: UpdateDealerStatusInput, actor: AuthActor): Promise<AdminDealerRecord>;
  softDelete(dealerId: bigint, actor: AuthActor): Promise<void>;
  getStaffAssignments(dealerId: bigint): Promise<AdminDealerStaffAssignment[]>;
  replaceStaffAssignments(dealerId: bigint, staffIds: bigint[], actor: AuthActor, rsmUserId?: bigint): Promise<AdminDealerStaffAssignment[]>;
}



