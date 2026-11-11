import type { Metadata } from "next";
import { LegalPage } from "@/shared/components/layout/LegalPage";

export const metadata: Metadata = { title: "이용약관" };

// A plain-language working draft that mirrors how the app behaves today. It is not legal advice.
export default function TermsPage() {
  return (
    <LegalPage title="이용약관" updated="2026.11.11">
      <p>MyLife Hub를 쓰면 아래 내용에 동의한 것으로 봐요.</p>
      <section className="space-y-2">
        <h2>서비스</h2>
        <ul>
          <li>가전·렌탈 자산 관리, 소모품 교체 일정, 스마트 키친(재료·지출 관리)을 가족이 함께 쓰는 도구예요.</li>
          <li>가구 관리자는 가족을 초대하고 데이터를 관리할 수 있어요.</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2>참고용 정보</h2>
        <ul>
          <li>소비기한, 보관 방법, 레시피, 비용 비교, 절약액은 참고용 추정치예요. 제품에 적힌 소비기한과 실제 계약 조건이 우선해요.</li>
          <li>반려동물 독성 및 레시피 정보는 수의학적 진단이나 조언이 아니에요. 응급 상황에서는 즉시 24시 동물병원을 방문하세요.</li>
          <li>AI가 만든 내용은 틀릴 수 있으니 확인한 뒤 사용해 주세요.</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2>이용자의 책임</h2>
        <ul>
          <li>계정과 초대 링크를 안전하게 관리해 주세요. 매직 링크는 받은 사람이 과업을 완료할 수 있는 링크예요.</li>
          <li>다른 사람의 권리를 침해하거나 서비스를 방해하는 용도로 쓰지 마세요.</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2>변경</h2>
        <ul>
          <li>서비스와 약관은 개선에 따라 바뀔 수 있어요.</li>
        </ul>
      </section>
      <p className="text-xs text-slate-400 dark:text-zinc-500">이 문서는 현재 앱의 동작을 설명하는 초안이며 법률 자문이 아니에요.</p>
    </LegalPage>
  );
}
