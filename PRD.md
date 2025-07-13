# 프로그램 기획서(PRD)

**프로젝트명**: StudyMini CX팀 – Supabase 통계 적재
**파일명**: sm-cx-supabase-pdr.md
**작성일**: 2025-07-12
**작성자**: Alex

---

## 1. 개요

워드프레스(WooCommerce) 운영 사이트의 주요 지표를 매일 Supabase에 자동 적재하여 BI·분석용 데이터 웨어하우스로 활용합니다.

### 1.1 대상 지표

* **매출 관련**: 매출 합계, 특정 상품 매출, 환불 금액, 쿠폰 사용액, 순판매액
* **주문 관련**: 주문 수, 신규회원 결제 수, 기존회원 재구매 결제 수
* **회원 관련**: 회원가입 수, 가입대비 결제율, 회원가입율
* **트래픽 관련**: GA4 순방문자수(DAU)

## 2. 목적

1. **자동화**: 매일 지정 시점에 외부에서 스크립트 실행 → 데이터 수집·적재
2. **분석 효율화**: Supabase에 누적 저장 → Metabase 등 BI 연동
3. **운영 안정성**: 로깅·재시도·알림으로 실패 대응

## 3. 범위

* 워드프레스에는 **WP OAuth Server(Pro)** 설치 + **SM-CX Stats API** 플러그인 활성화
* GitHub Actions 워크플로우 환경에서 **fetch-and-push.php** 스크립트 실행
* GA4 Data API(activeUsers) 연동
* Supabase 테이블 설계·마이그레이션
* 로깅·에러처리·재시도·관리자 알림

## 4. 기능 요구사항

|   ID  | 요구사항           | 설명                                                              |
| :---: | :------------- | :-------------------------------------------------------------- |
| FR-01 | 스케줄 실행         | GitHub Actions 스케줄(trigger)로 매일 KST 10:20 자동 실행                 |
| FR-02 | WooCommerce 통계 | REST API로 매출·환불·주문·쿠폰·회원 지표 수집                                  |
| FR-03 | GA4 DAU 조회     | GA4 Data API로 전날 `activeUsers` 메트릭 조회                           |
| FR-04 | Supabase 적재    | `sm_cx_daily_stats` 테이블에 INSERT                                 |
| FR-05 | 로그 기록          | Actions 로그 및 워크플로우 출력, 필요시 슬랙·메일 알림                             |
| FR-06 | 실패 시 재시도       | GitHub Actions `continue-on-error: false`, 스크립트 내부 최대 3회 재시도 로직 |

## 5. 비기능 요구사항

* **보안**:

  * WP OAuth Client ID/Secret, GA4 JSON, Supabase 키는 GitHub Secrets에만 저장
  * HTTPS 통신 강제
* **확장성**: 지표 컬럼 추가 시 스크립트·테이블 영향 최소화
* **가용성**: 외부 워크플로우 직립으로 워드프레스 서버 부하 최소화
* **유지보수성**: 일관된 네이밍·주석·문서화

## 6. 시스템 아키텍처

```text
[GitHub Actions]
    ├─(1) 스케줄 트리거 (KST 10:20)   
    ├─(2) OAuth2 Client Credentials → WP 토큰 발급   
    ├─(3) 보호된 REST API 호출 → `/wp-json/sm-cx/v1/daily-stats`  
    └─(4) Supabase REST API INSERT

[워드프레스 서버]
    └─WP OAuth Server(Pro) + SM-CX Stats API 플러그인
```

## 7. 모듈 설계

### 7.1 SM-CX Stats API 플러그인 (wp-content/plugins/sm-cx-stats-api)

* `/wp-json/sm-cx/v1/daily-stats` 엔드포인트 등록
* `current_user_can('manage_woocommerce')` 권한 검사
* WooCommerce 지표 + `sm_cx_get_ga4_dau()` → JSON 반환

### 7.2 외부 스크립트 (fetch-and-push.php)

* OAuth2 토큰 발급 (`/oauth/token`)
* `/wp-json/sm-cx/v1/daily-stats` 호출
* Supabase 적재 (supabase-php or Guzzle)
* 내부 재시도(최대 3회), 오류 시 예외 throw

## 8. 스케줄링 (GitHub Actions)

```yaml
name: Daily Stats Sync
on:
  schedule:
    # UTC 기준 01:20 → KST 10:20
    - cron: '20 1 * * *'

jobs:
  fetch-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Set up PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.0'
      - name: Install dependencies
        run: composer install --no-dev --optimize-autoloader
      - name: Run stats fetch-and-push
        env:
          WP_BASE_URL: ${{ secrets.WP_BASE_URL }}
          WP_CLIENT_ID: ${{ secrets.WP_CLIENT_ID }}
          WP_CLIENT_SECRET: ${{ secrets.WP_CLIENT_SECRET }}
          GA4_CREDENTIALS: ${{ secrets.GA4_CREDENTIALS }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
        run: php fetch-and-push.php
```

## 9. 로깅·모니터링

* **GitHub Actions UI**에서 실행 로그 확인
* **슬랙/이메일 알림**: Actions 워크플로우에 `actions-slack` 또는 `mail` 액션 추가 가능

## 10. 보안

* **GitHub Secrets**에만 민감 정보 보관
* \*\*WP OAuth Server(Pro)\*\*로 모든 API 호출 인증·보호
* **Role/Scope 최소화**: Client Credentials scope 제한

## 11. 에러 처리 및 재시도

1. 스크립트 내 API 응답 검증
2. 실패 시 지수 백오프(1,2,4분) 최대 3회 재시도
3. 마지막 실패 시 워크플로우 실패 처리 및 알림

## 12. 배포 및 운영 절차

1. PR 머지 시 GitHub Actions 워크플로우 자동 배포 검증
2. WP 플러그인 업데이트 & OAuth Client 설정 완료
3. Supabase 테이블(`sm_cx_daily_stats`) 마이그레이션 실행
4. 초기 실행 로그 검토 → 이슈 대응
5. BI 도구(Metabase) 대시보드 연결 확인

## 13. 네이밍 컨벤션

* **리포지토리**: `sm-cx-supabase`
* ****: `fetch-and-push.php`
* **엔드포인트 플러그인**: `wp-content/plugins/sm-cx-stats-api`
* **테이블**: `sm_cx_daily_stats`
* **워크플로우 파일**: `.github/workflows/daily-stats-sync.yml`

## 14. Supabase 저장 데이터 구조

| 필드명                    | 설명                | 계산 방식                                      |
| :--------------------- | :---------------- | :----------------------------------------- |
| `date`                 | 데이터 수집 날짜         | YYYY-MM-DD                                 |
| `total_sales`          | 매출 합계             | WooCommerce 주문 합산                          |
| `product_sales`        | 특정 SKU 매출         | SKU 필터링 후 합산                               |
| `refund_amount`        | 환불액 총합            | WooCommerce 환불 합산                          |
| `coupon_usage`         | 쿠폰 사용액 총합         | WooCommerce 쿠폰 합산                          |
| `net_sales`            | 순판매액              | 매출 - 환불 - 쿠폰                               |
| `dau`                  | 순방문자수(DAU)        | GA4 Data API `activeUsers`                 |
| `order_count`          | 주문 수 (0원 상품 제외)   | WooCommerce 주문 건수                          |
| `new_customer_orders`  | 신규회원 결제 수         | 가입 14일 이내 신규회원의 첫 결제 건수                    |
| `returning_orders`     | 기존회원 재구매 결제 수     | 과거 비0원 결제 이력 회원이 재구매한 건수                   |
| `signups`              | 회원가입 수            | WooCommerce 회원가입자 수                        |
| `signup_to_order_rate` | 가입대비 신규회원 결제율 (%) | (`new_customer_orders` / `signups`) \* 100 |
| `signup_rate`          | 회원가입율 (%)         | (`signups` / `total_clicks`) \* 100        |

### 14.1 회원가입율 계산 상세

* **총 클릭수 (`total_clicks`)**:

  * `naver_insights.clicks` + `meta_insights.clicks` + `google_insights.clicks` 합산
* **날짜 매칭 기준**: 각 테이블의 `date` 필드 동일 날짜 데이터 사용

---

> **추후 확장**: 파티셔닝, 백업 전략, 추가 지표 고도화 필요 시 별도 문서화하여 관리합니다.
