export type TimelineStatus = "未着手" | "進行中" | "完了";
export type TimelinePlan = "本線" | "コンチプラン";
export type ApprovalStatus = "未申請" | "申請中" | "承認済み";

export type TimelineItem = {
  id: number;
  startAt: string;
  endAt: string;
  actualStartAt?: string;
  actualEndAt?: string;
  title: string;
  owner: string;
  status: TimelineStatus;
  plan: TimelinePlan;
};

export type ApprovalItem = {
  id: number;
  title: string;
  owner: string;
  due: string;
  status: ApprovalStatus;
  url: string;
};

export type ResourceLink = {
  id: number;
  title: string;
  description: string;
  category: string;
  url: string;
};

export type StaffingAssignment = {
  id: number;
  name: string;
  phone: string;
  startAt: string;
  endAt: string;
  location: string;
  note: string;
};

export type ReleaseWork = {
  release: {
    id: number;
    systemId: string;
    name: string;
    version: string;
    releaseDate: string;
    environment: string;
    status: string;
    manager: string;
    updatedBy: string;
    updatedAt: string;
  };
  timeline: TimelineItem[];
  staffing: StaffingAssignment[];
  approvals: ApprovalItem[];
  links: ResourceLink[];
};

export type ReleaseRecord = ReleaseWork & {
  id: number;
};

export type ReleaseSummary = ReleaseWork["release"] & {
  progress: number;
  timelineCount: number;
  approvalCount: number;
};

export type CreateReleaseInput = Pick<
  ReleaseWork["release"],
  "systemId" | "name" | "version" | "releaseDate" | "environment" | "manager"
>;
