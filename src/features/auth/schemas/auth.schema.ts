import { z } from "zod";

export const loginSchema = z.object({
  email: z.email("올바른 이메일을 입력하세요."),
  password: z.string().min(8, "비밀번호는 8자 이상이어야 합니다."),
});

export const signupSchema = loginSchema.extend({
  householdName: z.string().trim().min(1, "가구명을 입력하세요.").max(100, "가구명은 100자 이하입니다."),
  displayName: z.string().trim().min(1, "표시 이름을 입력하세요.").max(50, "표시 이름은 50자 이하입니다."),
});

/** Sign-up via an invite link: the household already exists, so no household name is asked. */
export const inviteSignupSchema = signupSchema.omit({ householdName: true });

export const householdSetupSchema = signupSchema.pick({ householdName: true, displayName: true });

export type SignupInput = z.infer<typeof signupSchema>;
