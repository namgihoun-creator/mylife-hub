import { z } from "zod";

/** Standard Korean-household appliances for the 1-minute setup wizard. Keys match appliance_presets / appliance-icons. */
export type QuickAppliance = {
  key: string;
  name: string;
  space: string;
  category: string;
  tasks: { title: string; days: number }[];
};

export const QUICK_APPLIANCES: readonly QuickAppliance[] = [
  { key: "refrigerator", name: "냉장고", space: "주방", category: "주방가전", tasks: [{ title: "냉장고 내부 청소·성에 제거", days: 90 }] },
  { key: "water_purifier", name: "정수기", space: "주방", category: "주방가전", tasks: [{ title: "정수기 필터 교체·노즐 청소", days: 180 }] },
  { key: "induction", name: "인덕션/전기레인지", space: "주방", category: "주방가전", tasks: [{ title: "인덕션 상판·흡기구 청소", days: 30 }] },
  { key: "washer", name: "세탁기", space: "다용도실", category: "생활·환경가전", tasks: [{ title: "세탁기 통세척·거름망 청소", days: 60 }] },
  { key: "dryer", name: "건조기", space: "다용도실", category: "생활·환경가전", tasks: [{ title: "건조기 먼지 필터·열교환기 청소", days: 30 }] },
  { key: "aircon", name: "에어컨", space: "거실", category: "생활·환경가전", tasks: [{ title: "에어컨 필터 청소", days: 30 }] },
  { key: "air_purifier", name: "공기청정기", space: "거실", category: "생활·환경가전", tasks: [{ title: "공기청정기 필터 교체", days: 180 }] },
  { key: "bidet", name: "비데", space: "화장실", category: "생활·환경가전", tasks: [{ title: "비데 노즐·필터 청소", days: 30 }] },
] as const;

export const QUICK_KEYS = QUICK_APPLIANCES.map((a) => a.key);

export const quickApplianceInputSchema = z.object({
  items: z
    .array(z.object({ key: z.enum(QUICK_KEYS as [string, ...string[]]), ownership: z.enum(["OWNED", "RENTAL"]) }))
    .min(1, "등록할 가전을 하나 이상 골라 주세요.")
    .max(QUICK_APPLIANCES.length)
    .refine((a) => new Set(a.map((i) => i.key)).size === a.length, "같은 가전이 중복됐어요."),
});

export type QuickApplianceInput = z.input<typeof quickApplianceInputSchema>;
export type QuickApplianceResult = { ok: true; assetCount: number; ruleCount: number } | { ok: false; error: string };
