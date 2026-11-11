import type { Metadata } from "next";
import { LegalPage } from "@/shared/components/layout/LegalPage";

export const metadata: Metadata = { title: "개인정보 처리방침" };

// A plain-language description of what the app actually does today. It is a working draft, not legal advice.
export default function PrivacyPage() {
  return (
    <LegalPage title="개인정보 처리방침" updated="2026.11.11">
      <p>MyLife Hub는 가족이 함께 쓰는 생활 관리 앱이에요. 아래는 이 앱이 어떤 정보를 어떻게 다루는지에 대한 안내예요.</p>
      <section className="space-y-2">
        <h2>수집하는 정보</h2>
        <ul>
          <li>계정: 이메일, 표시 이름</li>
          <li>직접 입력한 정보: 가전·렌탈 정보, 관리 규칙, 재료와 보관 정보, 지출 기록, 첨부한 영수증·보증서 파일</li>
          <li>알림 설정을 켠 경우: 푸시 구독 정보(브라우저가 발급한 주소)</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2>보관과 격리</h2>
        <ul>
          <li>데이터는 Supabase(PostgreSQL, Storage)에 저장돼요.</li>
          <li>모든 데이터는 가구 단위로 격리돼요. 다른 가구는 우리 가구의 데이터를 볼 수 없고, 개인(PRIVATE)으로 표시한 항목은 본인에게만 보여요.</li>
          <li>첨부 파일은 비공개 저장소에 있고, 짧게 유효한 링크로만 열려요.</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2>외부 서비스로 나가는 정보</h2>
        <ul>
          <li>AI 기능(찰칵 입고, 말로 정리, AI 셰프)을 쓸 때만, 사진이나 입력한 문장·재료 이름이 분석을 위해 Google Gemini로 전송돼요. 앱은 이 사진을 저장하지 않아요.</li>
          <li>동네 생활 레이더는 카카오맵 검색 링크로 연결만 해요. 앱은 위치를 묻거나 저장하지 않아요.</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2>삭제와 문의</h2>
        <ul>
          <li>앱에서 직접 항목을 삭제할 수 있고, 가구 관리자는 데이터를 JSON으로 내보내거나 복구할 수 있어요.</li>
          <li>계정이나 데이터 삭제가 필요하면 가구 관리자에게 요청해 주세요.</li>
        </ul>
      </section>
      <p className="text-xs text-slate-400 dark:text-zinc-500">이 문서는 현재 앱의 동작을 설명하는 초안이며 법률 자문이 아니에요.</p>
    </LegalPage>
  );
}
