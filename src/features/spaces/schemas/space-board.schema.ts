import { z } from "zod";
import { annotationsSchema, type AnnotationInput } from "./space.schema";
import { CANDIDATE_STATUSES, ROOM_TYPES, type CandidateStatus, type RoomType } from "./space-constants";
import type { SpaceDiagnosis } from "../server/gemini-space";

// Shapes the planner UI reads, and the zod schemas its Server Actions validate with.

export type SpaceDiagnosisCache = SpaceDiagnosis & { analyzedAt?: string };

export type SpaceProject = {
  id: string;
  name: string;
  room_type: RoomType;
  photo_path: string | null;
  annotations: AnnotationInput[];
  style_preference: string | null;
  ai_diagnosis: SpaceDiagnosisCache | null;
  created_at: string;
  updated_at: string;
};

export type FurnitureCandidate = {
  id: string;
  space_id: string;
  name: string;
  category: string | null;
  price: number | null;
  width_cm: number | null;
  depth_cm: number | null;
  height_cm: number | null;
  product_url: string | null;
  source_mall: string | null;
  status: CandidateStatus;
  memo: string | null;
  created_at: string;
};

export type SpaceListItem = Omit<SpaceProject, "ai_diagnosis" | "annotations"> & { photoUrl: string | null; annotationCount: number; candidateCount: number };
export type SpaceDetail = { space: SpaceProject; photoUrl: string | null; candidates: FurnitureCandidate[]; householdId: string };

export type SpaceActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).transform((v) => (v === "" ? null : v)).nullable().optional();
const optNum = (min: number, max: number) => z.number().min(min).max(max).nullable().optional();

export const spaceIdSchema = z.uuid();
export const createSpaceSchema = z.object({
  name: text(60).min(1, "공간 이름을 적어 주세요."),
  roomType: z.enum(ROOM_TYPES).default("etc"),
  style: optText(60),
});
export const updateSpaceMetaSchema = z.object({ roomType: z.enum(ROOM_TYPES).optional(), style: optText(60) });
export { annotationsSchema };

export const candidateInputSchema = z.object({
  name: text(100).min(1, "가구 이름을 적어 주세요."),
  category: optText(30),
  price: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  widthCm: optNum(1, 2000),
  depthCm: optNum(1, 2000),
  heightCm: optNum(1, 1000),
  productUrl: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .refine((v) => v == null || /^https?:\/\/\S+$/i.test(v), "상품 링크는 http(s)://로 시작해야 해요."),
  memo: optText(300),
});
export type CandidateInput = z.input<typeof candidateInputSchema>;
export const candidateStatusSchema = z.enum(CANDIDATE_STATUSES);
