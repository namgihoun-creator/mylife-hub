import { z } from "zod";
import { IMAGE_MIMES } from "../../kitchen/server/gemini-kitchen.ts";
import { ROOM_TYPES } from "../server/gemini-space.ts";

/** A measured line on the photo (coordinates are 0..1 fractions of the image; lengthCm is what the couple typed in). */
export const annotationSchema = z.object({
  id: z.string().min(1).max(64),
  x1: z.number().min(0).max(1),
  y1: z.number().min(0).max(1),
  x2: z.number().min(0).max(1),
  y2: z.number().min(0).max(1),
  label: z.string().trim().min(1).max(40),
  lengthCm: z.number().positive().max(2000),
});
export type AnnotationInput = z.infer<typeof annotationSchema>;

export const annotationsSchema = z.array(annotationSchema).max(30);

/** POST /api/spaces/analyze — the photo comes either inline (imageBase64 + mime) or from the private bucket (photoPath). */
export const analyzeBodySchema = z
  .object({
    spaceId: z.uuid().optional(), // when given, the result is cached on that space (space_projects.ai_diagnosis)
    imageBase64: z.string().max(1_400_000).optional(),
    mime: z.enum(IMAGE_MIMES).optional(),
    photoPath: z.string().min(1).max(300).optional(),
    annotations: annotationsSchema.default([]),
    roomType: z.enum(ROOM_TYPES).optional(),
    style: z.string().trim().max(60).optional(),
  })
  .refine((b) => (b.imageBase64 && b.mime) || b.photoPath || b.spaceId, { message: "photo required" });
